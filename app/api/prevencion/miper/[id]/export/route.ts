export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { recordAudit } from "@/lib/audit"
import { addExportMetadataSheet } from "@/lib/reports/export"
import { sanitizeCell as safe } from "@/lib/reports/export-module/excel-builder"
import { getPublishedRiskMatrix } from "@/lib/services/prevention-risk-legal"
import { encodeContentDisposition } from "@/lib/utils"

function style(sheet: { getRow: (row: number) => { font: object; fill: object } }) {
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:risk:view")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  try {
    const { id } = await params
    const detail = await getPublishedRiskMatrix(id, { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions })
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    workbook.creator = "Plataforma Chome"
    workbook.created = new Date()
    const matrix = workbook.addWorksheet("Matriz MIPER")
    matrix.columns = [
      { header: "Faena", key: "worksite", width: 24 }, { header: "Versión", key: "version", width: 10 }, { header: "Proceso", key: "process", width: 24 },
      { header: "Tarea", key: "task", width: 28 }, { header: "Puesto", key: "position", width: 24 }, { header: "Código peligro", key: "code", width: 16 },
      { header: "Peligro", key: "hazard", width: 34 }, { header: "Factor", key: "factor", width: 30 }, { header: "Evento/daño", key: "damage", width: 34 },
      { header: "Personas expuestas", key: "exposed", width: 30 }, { header: "Cantidad", key: "count", width: 10 }, { header: "Enfoque de género", key: "gender", width: 34 },
      { header: "Sensibilidad", key: "sensitivity", width: 34 }, { header: "Evaluación inherente", key: "inherent", width: 28 }, { header: "Nivel inherente", key: "inherentLevel", width: 16 },
      { header: "Evaluación residual", key: "residual", width: 28 }, { header: "Nivel residual", key: "residualLevel", width: 16 }, { header: "Crítico", key: "critical", width: 10 },
      { header: "Responsable", key: "responsible", width: 24 }, { header: "Evidencia", key: "evidence", width: 34 }, { header: "Metodología especial", key: "special", width: 28 },
    ]
    for (const row of detail.entries) matrix.addRow({ worksite: safe(detail.worksiteName), version: detail.matrix.matrixVersion, process: safe(row.process.name), task: safe(row.task.name), position: safe(row.position.name), code: safe(row.entry.hazardCode), hazard: safe(row.entry.hazard), factor: safe(row.entry.riskFactor), damage: safe(row.entry.expectedEventOrDamage), exposed: safe(row.entry.exposedPeopleDescription), count: row.entry.exposedPeopleCount ?? "", gender: safe(row.entry.genderConsiderations), sensitivity: safe(row.entry.sensitiveWorkerConsiderations), inherent: safe(row.entry.inherentDimensions), inherentLevel: safe(row.entry.inherentLevel), residual: safe(row.entry.residualDimensions), residualLevel: safe(row.entry.residualLevel), critical: row.entry.isCritical ? "Sí" : "No", responsible: safe(row.entry.responsibleSnapshot), evidence: safe(row.entry.evidenceReference), special: safe(row.entry.specialMethodologyReference) })
    style(matrix); matrix.autoFilter = { from: "A1", to: "U1" }
    const controls = workbook.addWorksheet("Controles")
    controls.columns = [{ header: "Peligro ID", key: "risk", width: 26 }, { header: "Descripción", key: "description", width: 44 }, { header: "Jerarquía", key: "hierarchy", width: 18 }, { header: "Existente", key: "existing", width: 12 }, { header: "Crítico", key: "critical", width: 12 }, { header: "Estándar de desempeño", key: "standard", width: 42 }, { header: "Frecuencia", key: "frequency", width: 18 }, { header: "Responsable", key: "responsible", width: 24 }, { header: "Estado", key: "status", width: 16 }, { header: "Eficacia", key: "effectiveness", width: 16 }, { header: "Evidencia", key: "evidence", width: 36 }]
    for (const control of detail.controls) controls.addRow({ risk: control.riskEntryId, description: safe(control.description), hierarchy: control.hierarchy, existing: control.isExisting ? "Sí" : "No", critical: control.isCritical ? "Sí" : "No", standard: safe(control.performanceStandard), frequency: safe(control.verificationFrequency), responsible: safe(control.responsibleSnapshot), status: control.status, effectiveness: control.effectivenessStatus, evidence: safe(control.evidenceReference) })
    style(controls)
    const approval = workbook.addWorksheet("Aprobación")
    approval.addRows([["Campo", "Valor"], ["Estado", detail.matrix.status], ["Metodología", safe(detail.matrix.methodologySnapshot)], ["Motivo", safe(detail.matrix.revisionReason)], ["Participación", safe(detail.matrix.participationSummary)], ["Evidencia consulta", safe(detail.matrix.consultationEvidenceReference)], ["Revisor", detail.matrix.reviewedByUserId ?? ""], ["Fecha revisión", detail.matrix.reviewedAt ?? ""], ["Aprobador", detail.matrix.approvedByUserId ?? ""], ["Fecha aprobación", detail.matrix.approvedAt ?? ""], ["Publicador", detail.matrix.publishedByUserId ?? ""], ["Fecha publicación", detail.matrix.publishedAt ?? ""], ["Vigencia", detail.matrix.effectiveFrom ?? ""], ["Próxima revisión", detail.matrix.reviewDueAt ?? ""], ["SHA-256", detail.matrix.publishedHashSha256 ?? ""]]); style(approval)
    const triggers = workbook.addWorksheet("Revisiones")
    triggers.addRow(["Tipo", "Origen", "Descripción", "Estado", "Vence", "Resolución", "Actor", "Fecha"])
    detail.triggers.forEach((item) => triggers.addRow([item.triggerType, `${safe(item.sourceType)}:${safe(item.sourceId)}`, safe(item.description), item.status, item.dueAt, safe(item.resolution), item.resolvedByUserId ?? "", item.resolvedAt ?? ""])); style(triggers)
    addExportMetadataSheet(workbook, session, { filters: { worksiteId: detail.matrix.worksiteId, matrixId: detail.matrix.id, status: detail.matrix.status, sourceHashSha256: detail.matrix.publishedHashSha256 }, rowCount: detail.entries.length })
    await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "export", entityType: "prevention_risk_matrix", entityId: detail.matrix.id, entityCode: `MIPER-v${detail.matrix.matrixVersion}`, newState: { sheetCount: workbook.worksheets.length, entryCount: detail.entries.length, controlCount: detail.controls.length, sourceHashSha256: detail.matrix.publishedHashSha256 }, reason: "Exportación Excel de MIPER publicada" })
    const bytes = await workbook.xlsx.writeBuffer()
    return new NextResponse(bytes, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": encodeContentDisposition(`MIPER_${detail.worksiteName}_v${detail.matrix.matrixVersion}.xlsx`, "attachment"), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } })
  } catch {
    return NextResponse.json({ error: "MIPER no encontrada o fuera de alcance" }, { status: 404 })
  }
}
