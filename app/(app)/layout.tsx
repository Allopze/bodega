export const dynamic = "force-dynamic"

import { redirect } from "next/navigation"
import { unstable_cache } from "next/cache"
import { auth } from "@/lib/auth/auth"
import { approvalQueueFilter } from "@/lib/approvals-queue"
import { db } from "@/db"
import { worksites, purchaseRequests, purchaseOrders } from "@/db/schema"
import { eq, inArray, count, and, sql } from "drizzle-orm"
import { Suspense } from "react"
import { AppShell } from "@/components/layout/app-shell"
import { SessionProvider } from "@/components/providers/session-provider"
import { QueryProvider } from "@/components/providers/query-provider"
import { NavigationProgress } from "@/components/layout/navigation-progress"
import { Toaster } from "sonner"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"
import { can } from "@/lib/auth/can"
import { getEnabledModuleIds } from "@/lib/services/module-toggles"
import { getCriticalStockAlertCount } from "@/lib/services/stock-alerts"
import { getOperationalWorkCount } from "@/lib/services/operational-work-queue"
import type { Session } from "next-auth"

// P-01: Cache badge counts per user for 30s. Prevents repeated badge queries
// on every navigation event. Invalidated via revalidateTag('badge-counts-{userId}')
// from server actions that mutate relevant state (submit request, issue OC, …).
const getCachedBadgeCounts = unstable_cache(
  async (userId: string, isGlobal: boolean, wsIds: string[], canViewAllRequests: boolean) => {
    // Predicado compartido con /aprobaciones (lib/approvals-queue.ts). Antes
    // estaba duplicado aquí y derivó: excluía sólo 'repuestos', mientras la
    // página excluía también 'servicios', así que el badge contaba solicitudes
    // que nunca aparecían en la lista.
    const approvalFilter = approvalQueueFilter({ isGlobal, worksiteIds: wsIds })

    const purchaseFilter = isGlobal
      ? inArray(purchaseOrders.status, ["issued"])
      : and(
          inArray(purchaseOrders.status, ["issued"]),
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
      inArray(purchaseRequests.status, ["draft", "submitted", "in_review", "partially_approved", "returned", "approved", "in_purchasing"]),
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
    tags: ["badge-counts"],
  }
)

const getCachedOperationalWorkCount = unstable_cache(
  async (userId: string, roles: string[], permissions: string[], worksiteIds: string[], isGlobal: boolean) => {
    const session = {
      user: { id: userId, roles, permissions, worksiteIds, isGlobal },
    } as Session
    return getOperationalWorkCount(session)
  },
  ["operational-work-count"],
  { revalidate: 30, tags: ["badge-counts"] },
)

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/login")

  const isGlobal = isGlobalRole(session)
  const wsIds = visibleWorksiteIds(session)
  const canViewOwnRequests = can(session, "requests:view_own")
  const canViewAllRequests = can(session, "requests:view_all")
  const canApprove = can(session, "approvals:approve")
  const canViewPurchasing = can(session, "purchasing:view")
  const canViewReceiving = can(session, "receiving:view")
  const canViewStock = can(session, "warehouse:view_stock")
  const canViewOperations = can(session, "operations:view_work")

  const [ws, rawBadgeCounts, operationalWorkCount, enabledModuleIds] = await Promise.all([
    session.user.primaryWorksiteId
      ? db.query.worksites.findFirst({ where: eq(worksites.id, session.user.primaryWorksiteId) })
      : Promise.resolve(undefined),
    getCachedBadgeCounts(session.user.id, isGlobal, wsIds, canViewAllRequests),
    canViewOperations
      ? getCachedOperationalWorkCount(session.user.id, session.user.roles, session.user.permissions, wsIds, isGlobal)
      : Promise.resolve(0),
    getEnabledModuleIds(),
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
      <AppShell session={session} worksiteName={ws?.name} badgeCounts={badgeCounts} enabledModuleIds={Array.from(enabledModuleIds)}>
        {children}
      </AppShell>
      <Toaster
        position="top-right"
        visibleToasts={4}
        expand
        closeButton
        offset={16}
        gap={8}
        toastOptions={{
          duration: 4000,
          classNames: {
            toast:
              "font-sans text-sm shadow-[var(--shadow-md)] border border-[var(--color-border)] " +
              "data-[swipe=end]:opacity-0 data-[swipe=end]:translate-x-full " +
              "!transition-all !duration-[var(--duration-default)] !ease-[var(--ease-out)]",
            title:       "font-medium text-[var(--color-text)]",
            description: "text-[var(--color-text-muted)]",
          },
        }}
      />
    </SessionProvider>
    </QueryProvider>
  )
}
