export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { recordAudit } from "@/lib/audit"
import {
  LEGAL_APPLICABILITY_STATUS_LABELS,
  LEGAL_COMPLIANCE_STATUS_LABELS,
  LEGAL_REQUIREMENT_STATUS_LABELS,
} from "@/lib/prevention/badges"
import { addExportMetadataSheet } from "@/lib/reports/export"
import { sanitizeCell as safe } from "@/lib/reports/export-module/excel-builder"
import { getLegalDashboard } from "@/lib/services/prevention-risk-legal"
import { encodeContentDisposition, todayInChile} from "@/lib/utils"

function style(sheet: { getRow: (row: number) => { font: object; fill: object } }) { sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } } }

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:legal:export")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  const dashboard = await getLegalDashboard({ userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions })
  const ExcelJS = await import("exceljs"); const workbook = new ExcelJS.Workbook(); workbook.creator = "Plataforma Chome"; workbook.created = new Date()
  const requirements = workbook.addWorksheet("Requisitos")
  // Los estados salían en inglés crudo, el mismo LEGAL-09 de la ficha: quien lee
  // esta planilla es un fiscalizador, no el esquema.
  requirements.addRow(["Código", "Versión", "Estado", "Tipo", "Autoridad", "Fuente", "Referencia", "Artículo", "Requisito", "Vigencia desde", "Vigencia hasta", "Tema", "Rol Chome", "Evidencia requerida", "Frecuencia", "Revisor", "Aprobador", "Publicación", "SHA-256", "Vigente hoy"])
  dashboard.requirements.forEach((item) => requirements.addRow([safe(item.code), item.requirementVersion, LEGAL_REQUIREMENT_STATUS_LABELS[item.status] ?? item.status, item.sourceType, safe(item.authority), safe(item.sourceTitle), safe(item.sourceReference), safe(item.article), safe(item.requirement), item.validFrom, item.validTo ?? "", safe(item.topic), safe(item.chomeRole), safe(item.evidenceRequired), safe(item.frequency), item.reviewedByUserId ?? "", item.approvedByUserId ?? "", item.publishedAt ?? "", item.publishedHashSha256 ?? "", item.inForce ? "Sí" : "No"])); style(requirements)
  const applicability = workbook.addWorksheet("Aplicabilidad")
  applicability.addRow(["Requisito", "Faena", "Proceso ID", "Actividad", "Decisión", "Fundamento", "Responsable", "Evidencia", "Vence evidencia", "Cumplimiento", "Evaluador", "Aprobador", "Versión", "Requisito vigente"])
  dashboard.applicabilities.forEach((item) => applicability.addRow([safe(item.requirement.code), safe(item.worksiteName), item.applicability.processId ?? "", safe(item.applicability.activityReference), LEGAL_APPLICABILITY_STATUS_LABELS[item.applicability.applicabilityStatus] ?? item.applicability.applicabilityStatus, safe(item.applicability.rationale), safe(item.applicability.responsibleSnapshot), safe(item.applicability.evidenceReference), item.applicability.evidenceDueAt ?? "", LEGAL_COMPLIANCE_STATUS_LABELS[item.applicability.complianceStatus] ?? item.applicability.complianceStatus, item.applicability.assessedByUserId ?? "", item.applicability.approvedByUserId ?? "", item.applicability.version, item.inForce ? "Sí" : "No"])); style(applicability)
  const assessments = workbook.addWorksheet("Evaluaciones")
  assessments.addRow(["Aplicabilidad ID", "Estado", "Hallazgo", "Evidencia", "CAPA", "Evaluador", "Fecha", "Próxima evaluación"])
  dashboard.assessments.forEach((item) => assessments.addRow([item.applicabilityId, LEGAL_COMPLIANCE_STATUS_LABELS[item.status] ?? item.status, safe(item.finding), safe(item.evidenceReference), item.capaActionId ?? "", item.assessedByUserId, item.assessedAt, item.nextAssessmentAt ?? ""])); style(assessments)
  const gaps = workbook.addWorksheet("Brechas")
  // "Motivo": desde LEGAL-06 una aplicabilidad puede ser brecha estando en
  // 'compliant' (evidencia o re-evaluación vencida). Sin esta columna la
  // planilla contradice a su propia columna de estado.
  gaps.addRow(["Requisito", "Faena", "Estado", "Motivo", "Evidencia", "Responsable"])
  dashboard.gaps.forEach((item) => gaps.addRow([safe(item.requirement.code), safe(item.worksiteName), LEGAL_COMPLIANCE_STATUS_LABELS[item.applicability.complianceStatus] ?? item.applicability.complianceStatus, safe(item.gapReason), safe(item.applicability.evidenceReference), safe(item.applicability.responsibleSnapshot)])); style(gaps)
  addExportMetadataSheet(workbook, session, { filters: { scope: resolveWorksiteScope(session).mode, requirementCount: dashboard.requirements.length, gapCount: dashboard.gaps.length }, rowCount: dashboard.applicabilities.length })
  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "export", entityType: "prevention_legal_register", entityId: "scoped", newState: { sheets: workbook.worksheets.length, requirements: dashboard.requirements.length, applicabilities: dashboard.applicabilities.length, gaps: dashboard.gaps.length }, reason: "Exportación Excel del registro legal" })
  const bytes = await workbook.xlsx.writeBuffer()
  return new NextResponse(bytes, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": encodeContentDisposition(`registro_legal_${todayInChile()}.xlsx`, "attachment"), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } })
}
