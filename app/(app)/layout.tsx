export const dynamic = "force-dynamic"

import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/auth"
import { db } from "@/db"
import { worksites, purchaseRequests, purchaseOrders } from "@/db/schema"
import { eq, inArray, count } from "drizzle-orm"
import { AppShell } from "@/components/layout/app-shell"
import { SessionProvider } from "@/components/providers/session-provider"
import { Toaster } from "sonner"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/login")

  // Load worksite name + pending badge counts in parallel
  const [ws, [approvalRow], [purchaseRow]] = await Promise.all([
    session.user.primaryWorksiteId
      ? db.query.worksites.findFirst({ where: eq(worksites.id, session.user.primaryWorksiteId) })
      : Promise.resolve(undefined),
    db.select({ n: count() }).from(purchaseRequests)
      .where(inArray(purchaseRequests.status, ["submitted", "in_review", "partially_approved"])),
    db.select({ n: count() }).from(purchaseOrders)
      .where(inArray(purchaseOrders.status, ["issued"])),
  ])

  const badgeCounts: Record<string, number> = {
    "/aprobaciones": approvalRow?.n ?? 0,
    "/compras":      purchaseRow?.n ?? 0,
  }

  return (
    <SessionProvider session={session}>
      <AppShell session={session} worksiteName={ws?.name} badgeCounts={badgeCounts}>
        {children}
      </AppShell>
      <Toaster
        position="top-right"
        toastOptions={{
          classNames: {
            toast:       "font-sans text-sm shadow-[var(--shadow-md)] border border-[var(--color-border)]",
            title:       "font-medium text-[var(--color-text)]",
            description: "text-[var(--color-text-muted)]",
          },
        }}
      />
    </SessionProvider>
  )
}
