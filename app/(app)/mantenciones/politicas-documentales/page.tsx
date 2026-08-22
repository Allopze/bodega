import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { isGlobalRole } from "@/lib/auth/scope"
import { listMaintenanceDocumentPolicies } from "@/lib/services/maintenance"
import { MaintenanceDocumentPolicies } from "./maintenance-document-policies"

export const metadata: Metadata = { title: "Políticas documentales" }

export default async function MaintenanceDocumentPoliciesPage() {
  let session
  try { session = await requirePermission("mantenciones:view") }
  catch { redirect("/forbidden") }
  const data = await listMaintenanceDocumentPolicies(session)
  return <MaintenanceDocumentPolicies data={data} canEdit={can(session, "mantenciones:edit") && isGlobalRole(session)} />
}
