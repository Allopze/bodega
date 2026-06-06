import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/auth"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { eq } from "drizzle-orm"
import { AppShell } from "@/components/layout/app-shell"
import { SessionProvider } from "@/components/providers/session-provider"
import { Toaster } from "sonner"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/login")

  // Load the primary worksite name for the sidebar context
  let worksiteName: string | undefined
  if (session.user.primaryWorksiteId) {
    const ws = await db.query.worksites.findFirst({
      where: eq(worksites.id, session.user.primaryWorksiteId),
    })
    worksiteName = ws?.name
  }

  return (
    <SessionProvider session={session}>
      <AppShell session={session} worksiteName={worksiteName}>
        {children}
      </AppShell>
      <Toaster richColors position="top-right" />
    </SessionProvider>
  )
}
