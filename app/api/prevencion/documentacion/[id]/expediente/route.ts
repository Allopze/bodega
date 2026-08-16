import ExcelJS from "exceljs"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/auth"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getDocumentBundle, recordDocumentDownload } from "@/lib/services/prevention-documents-library"
import { sanitizeCell as safeCell } from "@/lib/reports/export-module/excel-builder"
import { encodeContentDisposition } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

interface RouteContext { params: Promise<{ id: string }> }

function style(sheet: ExcelJS.Worksheet, lastColumn: string) {
  const header = sheet.getRow(1)
  header.font = { bold: true, color: { argb: "FFFFFFFF" } }
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4D3A" } }
  sheet.autoFilter = { from: "A1", to: `${lastColumn}1` }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  sheet.eachRow((row, number) => { if (number > 1) row.alignment = { vertical: "top", wrapText: true } })
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  if (!can(session, "prevention:docs:view")) return NextResponse.json({ error: "Sin permisos" }, { status: 403 })
  const { id } = await context.params
  const bundle = await getDocumentBundle(id, resolveWorksiteScope(session), session.user.permissions)
  if (!bundle) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Plataforma Chome"
  workbook.created = new Date()
  workbook.subject = `Expediente documental ${bundle.doc.id}`

  const documentSheet = workbook.addWorksheet("Documento")
  documentSheet.columns = [{ header: "Campo", key: "field", width: 34 }, { header: "Valor", key: "value", width: 100 }]
  for (const [field, value] of Object.entries(bundle.doc)) documentSheet.addRow({ field, value: safeCell(value) })
  style(documentSheet, "B")

  const versions = workbook.addWorksheet("Versiones")
  versions.columns = [
    { header: "ID", key: "id", width: 28 }, { header: "Versión", key: "version", width: 10 },
    { header: "Estado", key: "status", width: 18 }, { header: "Archivo", key: "fileName", width: 40 },
    { header: "Checksum SHA-256", key: "checksum", width: 66 }, { header: "Subido por", key: "uploadedBy", width: 28 },
    { header: "Revisado por", key: "reviewedBy", width: 28 }, { header: "Aprobado por", key: "approvedBy", width: 28 },
    { header: "Aprobado en", key: "approvedAt", width: 24 }, { header: "Reemplaza a", key: "supersedesId", width: 28 },
    { header: "Creado en", key: "createdAt", width: 24 },
  ]
  bundle.versions.forEach((row) => versions.addRow(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, safeCell(value)]))))
  style(versions, "K")

  const distribution = workbook.addWorksheet("Distribución")
  distribution.columns = [
    { header: "Asignación ID", key: "id", width: 28 }, { header: "Versión ID", key: "versionId", width: 28 },
    { header: "Usuario ID", key: "userId", width: 28 }, { header: "Trabajador ID", key: "workerId", width: 28 },
    { header: "Motivo", key: "assignmentReason", width: 50 }, { header: "Faena", key: "worksiteId", width: 24 },
    { header: "Asignado por", key: "assignedByUserId", width: 28 }, { header: "Asignado en", key: "assignedAt", width: 24 },
    { header: "Vence", key: "dueAt", width: 24 }, { header: "Estado", key: "status", width: 16 },
    { header: "Exención", key: "exemptionReason", width: 50 }, { header: "Recordatorios", key: "reminderCount", width: 14 },
    { header: "Último recordatorio", key: "lastReminderAt", width: 24 },
  ]
  bundle.distribution.forEach((row) => distribution.addRow(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, safeCell(value)]))))
  style(distribution, "M")

  const acknowledgments = workbook.addWorksheet("Acuses")
  acknowledgments.columns = [
    { header: "Acuse ID", key: "id", width: 28 }, { header: "Versión ID", key: "versionId", width: 28 },
    { header: "Usuario ID", key: "userId", width: 28 }, { header: "Firma SHA-256", key: "signature", width: 66 },
    { header: "Fecha", key: "acknowledgedAt", width: 24 }, { header: "Checksum versión", key: "checksum", width: 66 },
  ]
  const checksumByVersion = new Map(bundle.versions.map((version) => [version.id, version.checksum]))
  bundle.acks.forEach((row) => acknowledgments.addRow({ ...row, checksum: checksumByVersion.get(row.versionId) ?? "" }))
  style(acknowledgments, "F")

  const links = workbook.addWorksheet("Vínculos")
  links.columns = [
    { header: "Vínculo ID", key: "id", width: 28 }, { header: "Tipo", key: "entityType", width: 24 },
    { header: "Entidad ID", key: "entityId", width: 32 }, { header: "Notas", key: "notes", width: 60 },
  ]
  bundle.links.forEach((row) => links.addRow(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, safeCell(value)]))))
  style(links, "D")

  const audit = workbook.addWorksheet("Bitácora")
  audit.columns = [
    { header: "Evento ID", key: "id", width: 28 }, { header: "Acción", key: "action", width: 20 },
    { header: "Versión ID", key: "versionId", width: 28 }, { header: "Actor", key: "userId", width: 28 },
    { header: "Desde", key: "fromStatus", width: 18 }, { header: "Hacia", key: "toStatus", width: 18 },
    { header: "Comentario", key: "comment", width: 60 }, { header: "Metadata", key: "metadata", width: 90 },
    { header: "Fecha", key: "createdAt", width: 24 },
  ]
  bundle.audit.forEach((row) => audit.addRow(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, safeCell(value)]))))
  style(audit, "I")

  const bytes = await workbook.xlsx.writeBuffer()
  await recordDocumentDownload({
    documentId: bundle.doc.id,
    versionId: bundle.doc.currentVersionId,
    userId: session.user.id,
    source: "expediente_xlsx",
  })
  return new Response(bytes as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": encodeContentDisposition(`expediente-${bundle.doc.internalCode || bundle.doc.id}.xlsx`, "attachment"),
      "Cache-Control": "private, max-age=0, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
