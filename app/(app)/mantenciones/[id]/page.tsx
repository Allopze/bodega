import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { getMaintenanceRecordDetail } from "@/lib/services/maintenance"
import { MaintenanceOrderWorkbench } from "./maintenance-order-workbench"

export const metadata: Metadata = { title: "Orden de trabajo" }

export default async function MaintenanceOrderPage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requirePermission("mantenciones:view") }
  catch { redirect("/forbidden") }
  const { id } = await params
  let record
  try { record = await getMaintenanceRecordDetail(session, id) }
  catch (error) {
    if (error instanceof Error && error.message.includes("no encontrada")) notFound()
    redirect("/forbidden")
  }
  return <MaintenanceOrderWorkbench record={record} canEdit={can(session, "mantenciones:edit")} canViewCosts={can(session, "combustibles:view_costs")} canApproveCosts={can(session, "mantenciones:approve_costs")} />
}
