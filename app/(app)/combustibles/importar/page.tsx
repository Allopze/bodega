import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { ImportFuelLoadsForm } from "./import-form"

export default async function ImportarPage() {
  try { await requirePermission("combustibles:import") }
  catch { redirect("/forbidden") }

  return <ImportFuelLoadsForm />
}
