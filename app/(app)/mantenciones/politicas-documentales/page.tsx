import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { listMaintenanceDocumentPolicies } from "@/lib/services/maintenance"
import { canManageMaintenanceDocumentPolicies, MaintenanceSectionNav } from "../maintenance-section-nav"
import { MaintenanceDocumentPolicies } from "./maintenance-document-policies"

export const metadata: Metadata = { title: "Políticas documentales" }

export default async function MaintenanceDocumentPoliciesPage() {
  let session
  try { session = await requirePermission("mantenciones:view") }
  catch { redirect("/forbidden") }
  const data = await listMaintenanceDocumentPolicies(session)
  return <MaintenanceDocumentPolicies nav={<MaintenanceSectionNav session={session} activeKey="politica" />} data={data} canEdit={canManageMaintenanceDocumentPolicies(session)} />
}
