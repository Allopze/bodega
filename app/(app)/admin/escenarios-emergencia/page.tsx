import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { listEmergencyScenarioTypeAdminRows } from "@/lib/services/prevention-emergency-catalog"
import { EmergencyScenarioTypeCatalog } from "./scenario-type-catalog"

export const metadata: Metadata = { title: "Escenarios de emergencia" }

export default async function EmergencyScenarioTypesPage() {
  try {
    await requirePermission("admin:emergency_scenario_catalog")
  } catch {
    redirect("/forbidden")
  }

  const rows = await listEmergencyScenarioTypeAdminRows()
  return <EmergencyScenarioTypeCatalog rows={rows.map((row) => ({
    ...row,
    scenarioCount: Number(row.scenarioCount),
    drillCount: Number(row.drillCount),
  }))} />
}
