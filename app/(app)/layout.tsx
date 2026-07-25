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
import { getEnabledModuleIds } from "@/lib/services/module-toggles"

// P-01: Cache badge counts per user for 30s. Prevents 3 DB queries on every
// navigation event. Invalidated via revalidateTag('badge-counts-{userId}')
// from server actions that mutate relevant state (submit request, issue OC, …).
const getCachedBadgeCounts = unstable_cache(
  async (userId: string, isGlobal: boolean, wsIds: string[]) => {
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
