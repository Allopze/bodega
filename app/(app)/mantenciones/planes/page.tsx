import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { getMaintenancePageData, listMaintenanceAssignees, listMaintenancePlans } from "@/lib/services/maintenance"
import { MaintenancePlansScreen } from "./maintenance-plans-screen"

export const metadata: Metadata = { title: "Planes preventivos" }

export default async function MaintenancePlansPage() {
  let session
  try { session = await requirePermission("mantenciones:view") }
  catch { redirect("/forbidden") }
  const [plans, options, assignees] = await Promise.all([
    listMaintenancePlans(session),
    getMaintenancePageData(session, { limit: 1 }),
    listMaintenanceAssignees(session),
  ])
  return <MaintenancePlansScreen
    plans={plans}
    vehicles={options.vehicles.map((vehicle) => ({ id: vehicle.id, plate: vehicle.plate, code: vehicle.code, worksiteId: vehicle.worksiteId }))}
    suppliers={options.suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
    costCenters={options.costCenters.map((center) => ({ id: center.id, code: center.code, name: center.name, worksiteId: center.worksiteId }))}
    assignees={assignees}
    canEdit={can(session, "mantenciones:edit")}
    canCreateOrders={can(session, "mantenciones:create")}
  />
}
