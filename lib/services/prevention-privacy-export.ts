import { createHash } from "node:crypto"
import ExcelJS from "exceljs"
import type { WorksiteScope } from "@/lib/auth/scope"
import type { RequestContext } from "@/lib/services/prevention-documents/utils"
import {
  getPreventionPrivacyExportDataset,
  recordPreventionPrivacyDelivery,
} from "@/lib/services/prevention-privacy"

function safeCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  const text = String(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

function styleSheet(sheet: ExcelJS.Worksheet, lastColumn: string) {
  const header = sheet.getRow(1)
  header.font = { bold: true, color: { argb: "FFFFFFFF" } }
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4D3A" } }
  sheet.autoFilter = { from: "A1", to: `${lastColumn}1` }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true }
  })
}

function flattenJson(value: unknown, path = "$"): Array<{ path: string; value: string }> {
  if (value === null || typeof value !== "object") return [{ path, value: safeCell(value) }]
  if (Array.isArray(value)) {
    if (value.length === 0) return [{ path, value: "[]" }]
    return value.flatMap((entry, index) => flattenJson(entry, `${path}[${index}]`))
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return [{ path, value: "{}" }]
  return entries.flatMap(([key, entry]) => flattenJson(entry, `${path}.${key}`))
}

export async function buildPreventionPrivacySubjectExport(args: {
  requestId: string
  includeClinical: boolean
  purpose: string
  ctx: RequestContext
  scope: WorksiteScope
  permissions: readonly string[]
}) {
  const dataset = await getPreventionPrivacyExportDataset(args)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Plataforma Chome"
  workbook.created = new Date()
  workbook.subject = `Solicitud de privacidad ${dataset.request.id}`

  const scopeSheet = workbook.addWorksheet("Alcance y custodia")
  scopeSheet.columns = [
    { header: "Campo", key: "field", width: 32 },
    { header: "Valor", key: "value", width: 100 },
    { header: "Clasificación", key: "classification", width: 24 },
  ]
  const scopeRows = [
    ["Solicitud", dataset.request.id, "personal"],
    ["Derecho", dataset.request.rightType, "personal"],
    ["Alcance solicitado", dataset.request.requestScope, "personal"],
    ["Propósito de esta entrega", dataset.purpose, "personal"],
    ["Contenido clínico incluido", dataset.includesClinical ? "Sí" : "No", "clinical"],
    ["Custodia", "Archivo confidencial. Entregar sólo al titular cuya identidad fue validada y por canal autorizado.", "personal"],
    ["Exclusión deliberada", "No incluye auditorías internas, datos de terceros ni casos reservados sin vinculación estructurada al titular.", "reserved_investigation"],
  ] as const
  for (const [field, value, classification] of scopeRows) {
    scopeSheet.addRow({ field, value: safeCell(value), classification })
  }
  styleSheet(scopeSheet, "C")

  const subjectSheet = workbook.addWorksheet("Titular")
  subjectSheet.columns = [
    { header: "Trabajador ID", key: "id", width: 28 },
    { header: "RUT", key: "rut", width: 18 },
    { header: "Nombres", key: "firstName", width: 28 },
    { header: "Apellidos", key: "lastName", width: 28 },
    { header: "Cargo", key: "position", width: 30 },
    { header: "Faena", key: "worksite", width: 32 },
    { header: "Clasificación", key: "classification", width: 20 },
  ]
  subjectSheet.addRow({
    id: safeCell(dataset.worker.id),
    rut: safeCell(dataset.worker.rut),
    firstName: safeCell(dataset.worker.firstName),
    lastName: safeCell(dataset.worker.lastName),
    position: safeCell(dataset.worker.position),
    worksite: safeCell(dataset.worksite?.name),
    classification: "personal",
  })
  styleSheet(subjectSheet, "G")

  const healthSheet = workbook.addWorksheet("Salud ocupacional")
  healthSheet.columns = [
    { header: "Registro ID", key: "id", width: 28 },
    { header: "Tipo", key: "recordType", width: 24 },
    { header: "Estado", key: "status", width: 18 },
    { header: "Aptitud", key: "fitnessStatus", width: 24 },
    { header: "Restricciones", key: "restrictions", width: 55 },
    { header: "Vigente desde", key: "validFrom", width: 18 },
    { header: "Vigente hasta", key: "validUntil", width: 18 },
    { header: "Emisor", key: "issuer", width: 30 },
    { header: "Prestador", key: "provider", width: 30 },
    { header: "Clasificación", key: "classification", width: 24 },
  ]
  for (const record of dataset.healthRecords) {
    healthSheet.addRow({
      id: safeCell(record.id),
      recordType: safeCell(record.recordType),
      status: safeCell(record.status),
      fitnessStatus: safeCell(record.fitnessStatus),
      restrictions: safeCell(record.restrictionsSummary),
      validFrom: safeCell(record.validFrom),
      validUntil: safeCell(record.validUntil),
      issuer: safeCell(record.issuerName),
      provider: safeCell(record.providerName),
      classification: "sensitive_preventive",
    })
  }
  styleSheet(healthSheet, "J")

  if (dataset.includesClinical) {
    const clinicalSheet = workbook.addWorksheet("Clínico")
    clinicalSheet.columns = [
      { header: "Registro ID", key: "recordId", width: 28 },
      { header: "Ruta", key: "path", width: 52 },
      { header: "Valor", key: "value", width: 80 },
      { header: "Clasificación", key: "classification", width: 20 },
    ]
    for (const clinical of dataset.clinicalPayloads) {
      for (const entry of flattenJson(clinical.payload)) {
        clinicalSheet.addRow({
          recordId: safeCell(clinical.recordId),
          path: safeCell(entry.path),
          value: entry.value,
          classification: "clinical",
        })
      }
    }
    styleSheet(clinicalSheet, "D")
  }

  const bytes = Buffer.from(await workbook.xlsx.writeBuffer())
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex")
  await recordPreventionPrivacyDelivery({
    requestId: dataset.request.id,
    subjectWorkerId: dataset.worker.id,
    worksiteId: dataset.worker.worksiteId,
    includesClinical: dataset.includesClinical,
    healthRecordCount: dataset.healthRecords.length,
    checksumSha256,
    purpose: dataset.purpose,
    ctx: args.ctx,
  })

  return { bytes, checksumSha256, requestId: dataset.request.id }
}
