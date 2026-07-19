export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import ExcelJS from "exceljs"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getDocumentIntegrityFindings } from "@/lib/services/prevention-documents-library"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:docs:publish")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  }

  const findings = await getDocumentIntegrityFindings(
    resolveWorksiteScope(session),
    session.user.permissions,
  )
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Plataforma Chome"
  workbook.created = new Date()

  const sheet = workbook.addWorksheet("Regularización")
  sheet.columns = [
    { header: "Severidad", key: "severity", width: 14 },
    { header: "Código", key: "code", width: 38 },
    { header: "Documento ID", key: "documentId", width: 30 },
    { header: "Documento", key: "documentTitle", width: 42 },
    { header: "Versión ID", key: "versionId", width: 30 },
    { header: "Vínculo ID", key: "linkId", width: 30 },
    { header: "Hallazgo", key: "detail", width: 72 },
    { header: "Acción requerida", key: "recommendedAction", width: 72 },
    { header: "Utilizable como evidencia", key: "evidenceUsable", width: 24 },
  ]
  for (const finding of findings) {
    sheet.addRow({
      ...finding,
      severity: finding.severity === "critico" ? "Crítico" : "Alto",
      evidenceUsable: "No",
    })
  }
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4D3A" } }
  sheet.autoFilter = { from: "A1", to: "I1" }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true }
  })

  const warning = workbook.addWorksheet("Advertencia")
  warning.columns = [{ width: 120 }]
  warning.addRow(["Este informe identifica inconsistencias automáticas. Cada expediente listado se considera no utilizable como evidencia hasta una regularización auditada; no corrige estados de forma masiva."])
  warning.getCell("A1").alignment = { wrapText: true, vertical: "top" }
  warning.getCell("A1").font = { bold: true }

  const bytes = await workbook.xlsx.writeBuffer()
  return new Response(bytes as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="regularizacion-documental-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  })
}
