export const dynamic = "force-dynamic"

import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/auth"
import { db } from "@/db"
import { worksites, purchaseRequests, purchaseOrders } from "@/db/schema"
import { eq, inArray, count, and, sql } from "drizzle-orm"
import { AppShell } from "@/components/layout/app-shell"
import { SessionProvider } from "@/components/providers/session-provider"
import { QueryProvider } from "@/components/providers/query-provider"
import { Toaster } from "sonner"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/can"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/login")

  const isGlobal = isGlobalRole(session)
  const wsIds = visibleWorksiteIds(session)

  const approvalFilter = isGlobal
    ? inArray(purchaseRequests.status, ["submitted", "in_review", "partially_approved"])
    : and(
        inArray(purchaseRequests.status, ["submitted", "in_review", "partially_approved"]),
        wsIds.length > 0 ? inArray(purchaseRequests.worksiteId, wsIds) : sql`1 = 0`
      )

  const purchaseFilter = isGlobal
    ? inArray(purchaseOrders.status, ["issued"])
    : and(
        inArray(purchaseOrders.status, ["issued"]),
        wsIds.length > 0 ? inArray(purchaseOrders.worksiteId, wsIds) : sql`1 = 0`
      )

  const receivingFilter = isGlobal
    ? inArray(purchaseOrders.status, ["sent", "partially_received"])
    : and(
        inArray(purchaseOrders.status, ["sent", "partially_received"]),
        wsIds.length > 0 ? inArray(purchaseOrders.worksiteId, wsIds) : sql`1 = 0`
      )

  // Load worksite name + pending badge counts in parallel
  const [ws, [approvalRow], [purchaseRow], [receivingRow]] = await Promise.all([
    session.user.primaryWorksiteId
      ? db.query.worksites.findFirst({ where: eq(worksites.id, session.user.primaryWorksiteId) })
      : Promise.resolve(undefined),
    db.select({ n: count() }).from(purchaseRequests)
      .where(approvalFilter),
    db.select({ n: count() }).from(purchaseOrders)
      .where(purchaseFilter),
    db.select({ n: count() }).from(purchaseOrders)
      .where(receivingFilter),
  ])

  const badgeCounts: Record<string, number> = {
    "/aprobaciones": approvalRow?.n ?? 0,
    "/compras":      purchaseRow?.n ?? 0,
    "/recepcion":    receivingRow?.n ?? 0,
  }

  return (
    <QueryProvider>
    <SessionProvider session={session}>
      <AppShell session={session} worksiteName={ws?.name} badgeCounts={badgeCounts}>
        {children}
      </AppShell>
      <Toaster
        position="top-right"
        visibleToasts={4}
        expand
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
