export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { recordAudit } from "@/lib/audit"
import { addExportMetadataSheet } from "@/lib/reports/export"
import { getLegalDashboard } from "@/lib/services/prevention-risk-legal"
import { encodeContentDisposition } from "@/lib/utils"

function safe(value: unknown) { const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value); return /^[=+\-@]/.test(text) ? `'${text}` : text }
function style(sheet: { getRow: (row: number) => { font: object; fill: object } }) { sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } } }

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:legal:export")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  const dashboard = await getLegalDashboard({ userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions })
  const ExcelJS = await import("exceljs"); const workbook = new ExcelJS.Workbook(); workbook.creator = "Plataforma Chome"; workbook.created = new Date()
  const requirements = workbook.addWorksheet("Requisitos")
  requirements.addRow(["Código", "Versión", "Estado", "Tipo", "Autoridad", "Fuente", "Referencia", "Artículo", "Requisito", "Vigencia desde", "Vigencia hasta", "Tema", "Rol Chome", "Evidencia requerida", "Frecuencia", "Revisor", "Aprobador", "Publicación", "SHA-256"])
  dashboard.requirements.forEach((item) => requirements.addRow([safe(item.code), item.requirementVersion, item.status, item.sourceType, safe(item.authority), safe(item.sourceTitle), safe(item.sourceReference), safe(item.article), safe(item.requirement), item.validFrom, item.validTo ?? "", safe(item.topic), safe(item.chomeRole), safe(item.evidenceRequired), safe(item.frequency), item.reviewedByUserId ?? "", item.approvedByUserId ?? "", item.publishedAt ?? "", item.publishedHashSha256 ?? ""])); style(requirements)
  const applicability = workbook.addWorksheet("Aplicabilidad")
  applicability.addRow(["Requisito", "Faena", "Proceso ID", "Actividad", "Decisión", "Fundamento", "Responsable", "Evidencia", "Vence evidencia", "Cumplimiento", "Evaluador", "Aprobador", "Versión"])
  dashboard.applicabilities.forEach((item) => applicability.addRow([safe(item.requirement.code), safe(item.worksiteName), item.applicability.processId ?? "", safe(item.applicability.activityReference), item.applicability.applicabilityStatus, safe(item.applicability.rationale), safe(item.applicability.responsibleSnapshot), safe(item.applicability.evidenceReference), item.applicability.evidenceDueAt ?? "", item.applicability.complianceStatus, item.applicability.assessedByUserId ?? "", item.applicability.approvedByUserId ?? "", item.applicability.version])); style(applicability)
  const assessments = workbook.addWorksheet("Evaluaciones")
  assessments.addRow(["Aplicabilidad ID", "Estado", "Hallazgo", "Evidencia", "CAPA", "Evaluador", "Fecha", "Próxima evaluación"])
  dashboard.assessments.forEach((item) => assessments.addRow([item.applicabilityId, item.status, safe(item.finding), safe(item.evidenceReference), item.capaActionId ?? "", item.assessedByUserId, item.assessedAt, item.nextAssessmentAt ?? ""])); style(assessments)
  const gaps = workbook.addWorksheet("Brechas")
  gaps.addRow(["Requisito", "Faena", "Estado", "Evidencia", "Responsable"])
  dashboard.gaps.forEach((item) => gaps.addRow([safe(item.requirement.code), safe(item.worksiteName), item.applicability.complianceStatus, safe(item.applicability.evidenceReference), safe(item.applicability.responsibleSnapshot)])); style(gaps)
  addExportMetadataSheet(workbook, session, { filters: { scope: resolveWorksiteScope(session).mode, requirementCount: dashboard.requirements.length, gapCount: dashboard.gaps.length }, rowCount: dashboard.applicabilities.length })
  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "export", entityType: "prevention_legal_register", entityId: "scoped", newState: { sheets: workbook.worksheets.length, requirements: dashboard.requirements.length, applicabilities: dashboard.applicabilities.length, gaps: dashboard.gaps.length }, reason: "Exportación XLSX del registro legal" })
  const bytes = await workbook.xlsx.writeBuffer()
  return new NextResponse(bytes, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": encodeContentDisposition(`registro_legal_${new Date().toISOString().slice(0, 10)}.xlsx`, "attachment"), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } })
}
