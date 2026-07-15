export const dynamic = "force-dynamic"

import { redirect } from "next/navigation"
import { unstable_cache } from "next/cache"
import { auth } from "@/lib/auth/auth"
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
import { getEnabledModuleIds } from "@/lib/services/module-toggles"

// P-01: Cache badge counts per user for 30s. Prevents 3 DB queries on every
// navigation event. Invalidated via revalidateTag('badge-counts-{userId}')
// from server actions that mutate relevant state (submit request, issue OC, …).
const getCachedBadgeCounts = unstable_cache(
  async (userId: string, isGlobal: boolean, wsIds: string[]) => {
    // Must mirror the /aprobaciones page query (app/(app)/aprobaciones/page.tsx)
    // exactly, or the badge outruns the list: repuestos are approved via their own
    // quotation flow (not this per-item queue), and a request only belongs in the
    // queue while it still has an item in 'requested' status. Without these two
    // filters the badge shows (1) while the page reports "Sin ítems pendientes".
    const approvalFilter = and(
      inArray(purchaseRequests.status, ["submitted", "in_review", "partially_approved"]),
      sql`${purchaseRequests.requestType} != 'repuestos'`,
      sql`exists (
        select 1
        from purchase_request_items pending_items
        where pending_items.request_id = ${purchaseRequests.id}
          and pending_items.status = 'requested'
      )`,
      isGlobal
        ? undefined
        : wsIds.length > 0
          ? inArray(purchaseRequests.worksiteId, wsIds)
          : sql`false`,
    )

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

    const [[approvalRow], [purchaseRow], [receivingRow]] = await Promise.all([
      db.select({ n: count() }).from(purchaseRequests).where(approvalFilter),
      db.select({ n: count() }).from(purchaseOrders).where(purchaseFilter),
      db.select({ n: count() }).from(purchaseOrders).where(receivingFilter),
    ])

    return {
      "/aprobaciones": approvalRow?.n ?? 0,
      "/compras":      purchaseRow?.n ?? 0,
      "/recepcion":    receivingRow?.n ?? 0,
    }
  },
  ["badge-counts"],
  {
    revalidate: 30,
    tags: ["badge-counts"],
  }
)

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/login")

  const isGlobal = isGlobalRole(session)
  const wsIds = visibleWorksiteIds(session)

  const [ws, badgeCounts, enabledModuleIds] = await Promise.all([
    session.user.primaryWorksiteId
      ? db.query.worksites.findFirst({ where: eq(worksites.id, session.user.primaryWorksiteId) })
      : Promise.resolve(undefined),
    getCachedBadgeCounts(session.user.id, isGlobal, wsIds),
    getEnabledModuleIds(),
  ])

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
