import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/auth"

/** Minimal layout for print/export pages — no sidebar, no navigation shell. */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/login")
  return <>{children}</>
}
