import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { ImportFuelLoadsWizard } from "./import-wizard"

export default async function ImportarPage() {
  try { await requirePermission("combustibles:import") }
  catch { redirect("/forbidden") }

  return <ImportFuelLoadsWizard />
}
