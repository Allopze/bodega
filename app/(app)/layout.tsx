export const dynamic = "force-dynamic"

import { redirect } from "next/navigation"
import { unstable_cache } from "next/cache"
import { auth } from "@/lib/auth/auth"
import { approvalQueueFilter } from "@/lib/approvals-queue"
import { db } from "@/db"
import { worksites, purchaseRequests, purchaseOrders, dispatchGuides } from "@/db/schema"
import { eq, inArray, count, and, sql } from "drizzle-orm"
import { Suspense } from "react"
import { headers } from "next/headers"
import { AppShell } from "@/components/layout/app-shell"
import { SessionProvider } from "@/components/providers/session-provider"
import { QueryProvider } from "@/components/providers/query-provider"
import { NavigationProgress } from "@/components/layout/navigation-progress"
import { AppToaster } from "@/components/ui/app-toaster"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { can, canAny } from "@/lib/auth/can"
import { getNavigationToggleState, routeIsEnabled, type NavigationToggleState } from "@/lib/services/module-toggles"
import { registry } from "@/modules/registry"
import { getOperationalWorkCounts, type OperationalWorkCounts } from "@/lib/services/operational-work-queue"
import { actionableQueueSources } from "@/lib/services/work-queue-eligibility"
import { badgeCountsTags } from "@/lib/services/operational-cache"
import { countPendingPurchaseRequests } from "@/lib/services/purchasing-module/pending-purchase-queue"
import { countFuelInboxPending } from "@/lib/combustibles/inbox/queries"
import { RECEIVABLE_ORDER_STATUSES } from "@/lib/work-queue-labels"
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
  async (userId: string, isGlobal: boolean, wsIds: string[], canViewAllRequests: boolean, canViewFuel: boolean) => {
    // Predicado compartido con /aprobaciones (lib/approvals-queue.ts). Antes
    // estaba duplicado aquí y derivó: excluía sólo 'repuestos', mientras la
    // página excluía también 'servicios', así que el badge contaba solicitudes
    // que nunca aparecían en la lista.
    const approvalFilter = approvalQueueFilter({ isGlobal, worksiteIds: wsIds })

    // El badge de Compras cuenta las OC en borrador: son las que esperan un
    // "Emitir OC" (antes contaba las emitidas, estado ya retirado).
    const purchaseFilter = isGlobal
      ? inArray(purchaseOrders.status, ["draft"])
      : and(
          inArray(purchaseOrders.status, ["draft"]),
          wsIds.length > 0 ? inArray(purchaseOrders.worksiteId, wsIds) : sql`false`
        )

    // TRV-01 (auditoría 2026-10-05): "te toca", no "todo lo abierto". Recepción
    // cuenta las OC con una acción de recepción pendiente; los estados salen de
    // la misma constante que la pestaña por defecto de /recepcion.
    const receivingFilter = isGlobal
      ? inArray(purchaseOrders.status, [...RECEIVABLE_ORDER_STATUSES])
      : and(
          inArray(purchaseOrders.status, [...RECEIVABLE_ORDER_STATUSES]),
          wsIds.length > 0 ? inArray(purchaseOrders.worksiteId, wsIds) : sql`false`
        )

    // TRV-01: guías despachadas que la faena destino aún no confirma. Se cuelga
    // de "Guías de despacho" y no de "Bodega" (que nunca tuvo conteo).
    const guideFilter = and(
      eq(dispatchGuides.status, "dispatched"),
      isGlobal
        ? undefined
        : wsIds.length > 0 ? inArray(dispatchGuides.destinationWorksiteId, wsIds) : sql`false`,
    )

    // Misma definición y mismo scope que la cola "Por comprar" de /compras.
    const purchaseRequestScope = isGlobal
      ? undefined
      : wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`false`

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

    const [[approvalRow], [purchaseRow], [receivingRow], [requestRow], [guideRow], pendingPurchaseRequests, fuelInboxCount] = await Promise.all([
      db.select({ n: count() }).from(purchaseRequests).where(approvalFilter),
      db.select({ n: count() }).from(purchaseOrders).where(purchaseFilter),
      db.select({ n: count() }).from(purchaseOrders).where(receivingFilter),
      db.select({ n: count() }).from(purchaseRequests).where(requestFilter),
      db.select({ n: count() }).from(dispatchGuides).where(guideFilter),
      countPendingPurchaseRequests(purchaseRequestScope),
      // «Por revisar» de Combustible: lo que espera a una persona, dentro de su alcance de faenas.
      canViewFuel ? countFuelInboxPending(isGlobal ? "all" : wsIds) : Promise.resolve(0),
    ])

    return {
      "/solicitudes":  requestRow?.n ?? 0,
      "/aprobaciones": approvalRow?.n ?? 0,
      // TRV-01: solicitudes con ítems aprobados sin OC + OC en borrador por emitir.
      "/compras":      (purchaseRow?.n ?? 0) + pendingPurchaseRequests,
      "/recepcion":    receivingRow?.n ?? 0,
      "/bodega/guias": guideRow?.n ?? 0,
      "/combustibles/revisar": fuelInboxCount,
    }
  },
  ["badge-counts"],
  {
    revalidate: 30,
    tags,
  }
)

// La clave lleva versión: lo que se guarda dejó de ser un número y pasó a ser el total más el desglose de Mantención.
// Una entrada vieja con la forma anterior no se lee jamás (la caché de 30 s sobrevive a un despliegue).
const operationalWorkCountsLoader = (tags: string[]) => unstable_cache(
  async (userId: string, roles: string[], permissions: string[], worksiteIds: string[], isGlobal: boolean): Promise<OperationalWorkCounts> => {
    const session = {
      user: { id: userId, roles, permissions, worksiteIds, isGlobal },
    } as Session
    return getOperationalWorkCounts(session)
  },
  ["operational-work-counts-v2"],
  { revalidate: 30, tags },
)

const NO_WORK_COUNTS: OperationalWorkCounts = { total: 0, ot: 0, registros: 0, notas: 0 }

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
  const canReceiveGuides = can(session, "warehouse:receive_guide")
  const canViewOperations = can(session, "operations:view_work")
  const canViewFuel = can(session, "combustibles:view")
  // Los avisos de Mantención salen de la misma cola que «Mis pendientes», así que el cálculo corre también para quien tiene
  // trabajo de Mantención sin tener la bandeja (un rol personalizado): su número del menú no depende de ese permiso.
  const hasMantencionWork = actionableQueueSources(session.user.permissions ?? []).some((source) => source.startsWith("mant_"))
  const badgeTags = badgeCountsTags({ isGlobal, worksiteIds: session.user.worksiteIds ?? [] })

  const [ws, rawBadgeCounts, operationalCounts] = await Promise.all([
    session.user.primaryWorksiteId
      ? db.query.worksites.findFirst({ where: eq(worksites.id, session.user.primaryWorksiteId) })
      : Promise.resolve(undefined),
    badgeCountsLoader(badgeTags)(session.user.id, isGlobal, wsIds, canViewAllRequests, canViewFuel),
    canViewOperations || hasMantencionWork
      ? operationalWorkCountsLoader(badgeTags)(session.user.id, session.user.roles, session.user.permissions, wsIds, isGlobal)
      : Promise.resolve(NO_WORK_COUNTS),
  ])
  // No serializar conteos de módulos que esta sesión no puede abrir. Los
  // controles visuales respetan el permiso y el propio dato también.
  const badgeCounts = {
    "/solicitudes":  canViewOwnRequests || canViewAllRequests ? rawBadgeCounts["/solicitudes"] : 0,
    "/aprobaciones": canApprove ? rawBadgeCounts["/aprobaciones"] : 0,
    "/compras":      canViewPurchasing ? rawBadgeCounts["/compras"] : 0,
    "/recepcion":    canViewReceiving ? rawBadgeCounts["/recepcion"] : 0,
    // Sólo quien puede confirmar la recepción de una guía ve que le toca hacerlo.
    "/bodega/guias": canReceiveGuides ? rawBadgeCounts["/bodega/guias"] : 0,
    "/combustibles/revisar": canViewFuel ? rawBadgeCounts["/combustibles/revisar"] : 0,
    "/pendientes":   canViewOperations ? operationalCounts.total : 0,
    // Mantención: el mismo cálculo que la cola. Cada número sólo viaja si la sesión puede abrir esa pantalla.
    "/mantencion/ot":            canAny(session, "mant:ot:view_worksite", "mant:ot:view_all", "mant:ot:execute") ? operationalCounts.ot : 0,
    "/mantencion/notas-pedido":  canAny(session, "mant:np:view_worksite", "mant:np:manage") ? operationalCounts.notas : 0,
    "/mantencion/registros":     canAny(session, "mant:records:view_own", "mant:records:view_worksite", "mant:records:view_all") ? operationalCounts.registros : 0,
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
