export const dynamic = "force-dynamic"

import { redirect } from "next/navigation"
import { unstable_cache } from "next/cache"
import { auth } from "@/lib/auth/auth"
import { approvalQueueFilter } from "@/lib/approvals-queue"
import { db } from "@/db"
import { worksites, purchaseRequests, purchaseOrders } from "@/db/schema"
import { eq, inArray, count, and, sql } from "drizzle-orm"
import { Suspense } from "react"
import { headers } from "next/headers"
import { AppShell } from "@/components/layout/app-shell"
import { SessionProvider } from "@/components/providers/session-provider"
import { QueryProvider } from "@/components/providers/query-provider"
import { NavigationProgress } from "@/components/layout/navigation-progress"
import { AppToaster } from "@/components/ui/app-toaster"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { can } from "@/lib/auth/can"
import { getNavigationToggleState, routeIsEnabled, type NavigationToggleState } from "@/lib/services/module-toggles"
import { registry } from "@/modules/registry"
import { getCriticalStockAlertCount } from "@/lib/services/stock-alerts"
import { getOperationalWorkCount } from "@/lib/services/operational-work-queue"
import { badgeCountsTags } from "@/lib/services/operational-cache"
import type { Session } from "next-auth"

// P-01: Cache badge counts per user for 30s. Prevents repeated badge queries
// on every navigation event. Invalidated via revalidateTag('badge-counts-{userId}')
// from server actions that mutate relevant state (submit request, issue OC, …).
// PER-T01 (auditoría 2026-09-14): las etiquetas ya no son una sola global. Cada
// entrada se guarda además con la etiqueta de cada faena que esa sesión ve (o la
// global si las ve todas), de modo que una mutación que declara su faena no
// vacía los badges de la plataforma entera. El envoltorio se construye por
// request porque `unstable_cache` fija sus `tags` al crearse; la clave sigue
// saliendo de `keyParts` + argumentos, así que la entrada es la misma.
const badgeCountsLoader = (tags: string[]) => unstable_cache(
  async (userId: string, isGlobal: boolean, wsIds: string[], canViewAllRequests: boolean) => {
    // Predicado compartido con /aprobaciones (lib/approvals-queue.ts). Antes
    // estaba duplicado aquí y derivó: excluía sólo 'repuestos', mientras la
    // página excluía también 'servicios', así que el badge contaba solicitudes
    // que nunca aparecían en la lista.
    const approvalFilter = approvalQueueFilter({ isGlobal, worksiteIds: wsIds })

    // El badge de Compras cuenta las OC en borrador: son las que esperan un
    // "Emitir y enviar" (antes contaba las emitidas, estado ya retirado).
    const purchaseFilter = isGlobal
      ? inArray(purchaseOrders.status, ["draft"])
      : and(
          inArray(purchaseOrders.status, ["draft"]),
          wsIds.length > 0 ? inArray(purchaseOrders.worksiteId, wsIds) : sql`false`
        )

    const receivingFilter = isGlobal
      ? inArray(purchaseOrders.status, ["sent", "partially_office_received", "office_received", "partially_received"])
      : and(
          inArray(purchaseOrders.status, ["sent", "partially_office_received", "office_received", "partially_received"]),
          wsIds.length > 0 ? inArray(purchaseOrders.worksiteId, wsIds) : sql`false`
        )

    // Solicitudes que aún tienen un siguiente paso. Un usuario sin view_all
    // ve sólo las propias aun cuando comparta faena con otros solicitantes.
    const requestScopeFilter = isGlobal
      ? undefined
      : wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`false`
    const requestFilter = and(
      requestScopeFilter,
      inArray(purchaseRequests.status, ["draft", "submitted", "in_review", "partially_approved", "approved", "in_purchasing"]),
      canViewAllRequests ? undefined : eq(purchaseRequests.requesterId, userId),
    )

    const [[approvalRow], [purchaseRow], [receivingRow], [requestRow], stockAlertCount] = await Promise.all([
      db.select({ n: count() }).from(purchaseRequests).where(approvalFilter),
      db.select({ n: count() }).from(purchaseOrders).where(purchaseFilter),
      db.select({ n: count() }).from(purchaseOrders).where(receivingFilter),
      db.select({ n: count() }).from(purchaseRequests).where(requestFilter),
      getCriticalStockAlertCount(isGlobal ? "all" : wsIds),
    ])

    return {
      "/solicitudes":  requestRow?.n ?? 0,
      "/aprobaciones": approvalRow?.n ?? 0,
      "/compras":      purchaseRow?.n ?? 0,
      "/recepcion":    receivingRow?.n ?? 0,
      "/bodega":       stockAlertCount,
    }
  },
  ["badge-counts"],
  {
    revalidate: 30,
    tags,
  }
)

const operationalWorkCountLoader = (tags: string[]) => unstable_cache(
  async (userId: string, roles: string[], permissions: string[], worksiteIds: string[], isGlobal: boolean) => {
    const session = {
      user: { id: userId, roles, permissions, worksiteIds, isGlobal },
    } as Session
    return getOperationalWorkCount(session)
  },
  ["operational-work-count"],
  { revalidate: 30, tags },
)

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/login")
  const pathname = (await headers()).get("x-chome-pathname")
  // El proxy es el punto de aplicación (corre en cada request, incluidas las
  // navegaciones RSC que NO vuelven a ejecutar este layout). Aquí el estado se
  // usa sobre todo para pintar la navegación, así que un fallo de lectura
  // degrada el menú en vez de dejar la plataforma entera en 500.
  let toggleState: NavigationToggleState
  try {
    toggleState = await getNavigationToggleState()
  } catch {
    toggleState = { enabledModuleIds: new Set(registry.map((module) => module.id)), disabledSubmoduleHrefs: new Set() }
  }
  // `redirect()` fuera del try: lanza una excepción de control que un catch
  // genérico se tragaría.
  if (pathname && !routeIsEnabled(pathname, toggleState)) {
    redirect(`/modulo-inactivo?desde=${encodeURIComponent(pathname)}`)
  }

  const isGlobal = isGlobalRole(session)
  const wsIds = visibleWorksiteIds(session)
  const canViewOwnRequests = can(session, "requests:view_own")
  const canViewAllRequests = can(session, "requests:view_all")
  const canApprove = can(session, "approvals:approve")
  const canViewPurchasing = can(session, "purchasing:view")
  const canViewReceiving = can(session, "receiving:view")
  const canViewStock = can(session, "warehouse:view_stock")
  const canViewOperations = can(session, "operations:view_work")
  const badgeTags = badgeCountsTags({ isGlobal, worksiteIds: session.user.worksiteIds ?? [] })

  const [ws, rawBadgeCounts, operationalWorkCount] = await Promise.all([
    session.user.primaryWorksiteId
      ? db.query.worksites.findFirst({ where: eq(worksites.id, session.user.primaryWorksiteId) })
      : Promise.resolve(undefined),
    badgeCountsLoader(badgeTags)(session.user.id, isGlobal, wsIds, canViewAllRequests),
    canViewOperations
      ? operationalWorkCountLoader(badgeTags)(session.user.id, session.user.roles, session.user.permissions, wsIds, isGlobal)
      : Promise.resolve(0),
  ])
  // No serializar conteos de módulos que esta sesión no puede abrir. Los
  // controles visuales respetan el permiso y el propio dato también.
  const badgeCounts = {
    "/solicitudes":  canViewOwnRequests || canViewAllRequests ? rawBadgeCounts["/solicitudes"] : 0,
    "/aprobaciones": canApprove ? rawBadgeCounts["/aprobaciones"] : 0,
    "/compras":      canViewPurchasing ? rawBadgeCounts["/compras"] : 0,
    "/recepcion":    canViewReceiving ? rawBadgeCounts["/recepcion"] : 0,
    "/bodega":       canViewStock ? rawBadgeCounts["/bodega"] : 0,
    "/pendientes":   canViewOperations ? operationalWorkCount : 0,
  }

  return (
    <QueryProvider>
    <SessionProvider session={session}>
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <AppShell
        session={session}
        worksiteName={ws?.name}
        badgeCounts={badgeCounts}
        enabledModuleIds={Array.from(toggleState.enabledModuleIds)}
        disabledSubmoduleHrefs={Array.from(toggleState.disabledSubmoduleHrefs)}
      >
        {children}
      </AppShell>
      <AppToaster />
    </SessionProvider>
    </QueryProvider>
  )
}
