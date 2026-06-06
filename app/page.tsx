import { redirect } from "next/navigation"

// Root redirects to dashboard (middleware handles auth)
export default function RootPage() {
  redirect("/dashboard")
}
