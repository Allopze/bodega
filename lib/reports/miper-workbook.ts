/**
 * Libro Excel RE-04 de una versión SELLADA de la MIPER. Lo comparten la
 * descarga (`app/api/prevencion/miper/[id]/export`) y el archivado automático
 * al aprobar, así que la copia archivada es el mismo libro que se descarga. Se
 * arma desde la foto de la versión, nunca desde los datos vivos: lo que se
 * archiva es exactamente lo que se aprobó. La hoja "Programa de Trabajo" llega
 * en F2.
 */
import ExcelJS from "exceljs"
import { sanitizeCell as safe } from "@/lib/reports/export-module/excel-builder"
import { CLASSIFICATION_CRITERIA, CLASSIFICATION_LABEL, CONSEQUENCE_LEVELS, PROBABILITY_LEVELS, RISK_CLASSIFICATIONS } from "@/lib/prevention/miper/methodology"
import { CONTROL_HIERARCHY_LABEL, CONTROLLED_STATUS_LABEL, type MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import type { getMiperVersion } from "@/lib/services/miper/queries"
import { formatDate } from "@/lib/utils"

export type MiperVersionDetail = Awaited<ReturnType<typeof getMiperVersion>>

const FILL: Record<string, string> = { tolerable: "FFD9EAD3", moderate: "FFFFF2CC", important: "FFF4CCCC", intolerable: "FFC00000" }
const HEADER_FILL = "FF1F3864"

function headerStyle(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } }
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } } })
}

export function miperFilenameBase(detail: MiperVersionDetail) {
  return `RE-04-MIPER-${detail.worksiteCode}-${detail.version.period ?? "sin-periodo"}-v${detail.version.versionNumber}`
}

export async function buildMiperWorkbook(detail: MiperVersionDetail) {
  const snapshot = detail.version.snapshot as MiperSnapshot
  const h = snapshot.header
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Plataforma CHOME"

  const sheet = workbook.addWorksheet("RE-04 IPER", {
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "12:13" },
  })
  sheet.mergeCells("A1:U1")
  sheet.getCell("A1").value = "Matriz de Identificación de Peligros y Evaluación de Riesgos (IPER)"
  sheet.getCell("A1").font = { bold: true, size: 14 }
  // `safe()` devuelve el valor ya neutralizado (string | number | boolean):
  // las columnas de valor no son sólo texto.
  const headerRows: Array<[string, ExcelJS.CellValue, string, ExcelJS.CellValue]> = [
    ["CÓDIGO IPER", safe(h.iperCode ?? "RE-04"), "FECHA ELABORACIÓN", h.elaboratedOn ? formatDate(h.elaboratedOn) : ""],
    ["RAZÓN SOCIAL", safe(h.companyName ?? ""), "FECHA ACTUALIZACIÓN", h.updatedOn ? formatDate(h.updatedOn) : ""],
    ["RUT EMPLEADOR", safe(h.companyRut ?? ""), "PERÍODO / VERSIÓN", `${h.period ?? ""} · v${detail.version.versionNumber}`],
    ["DIRECCIÓN / COMUNA", safe([h.companyAddress, h.companyCommune].filter(Boolean).join(", ")), "N° DE ADHERENTE", safe(h.adherentNumber ?? "")],
    ["ACTIVIDAD ECONÓMICA PRINCIPAL", safe(h.economicActivity ?? ""), "NOMBRE CENTRO DE TRABAJO", safe(h.worksiteName ?? detail.worksiteName)],
    ["REPRESENTANTE DE LA EMPRESA EN LA FAENA (ADMINISTRADOR DE CONTRATO)", safe(h.siteRepresentativeName ?? ""), "N° TRABAJADORES (TOTAL / H / M / OTRO)", `${h.headcountTotal ?? ""} / ${h.headcountMale ?? ""} / ${h.headcountFemale ?? ""} / ${h.headcountOther ?? ""}`],
    ["NOMBRE QUIEN ELABORÓ", safe(detail.version.elaboratedByName), "NOMBRE QUIEN REVISÓ", safe(detail.version.technicalReviewerName)],
    ["NOMBRE QUIEN APROBÓ (LEGAL Y RRHH)", safe(detail.version.approverName), "FECHA DE APROBACIÓN", formatDate(detail.version.approvedAt)],
  ]
  headerRows.forEach(([labelA, valueA, labelB, valueB], index) => {
    const row = sheet.getRow(3 + index)
    row.getCell(1).value = labelA; row.getCell(4).value = valueA
    row.getCell(11).value = labelB; row.getCell(14).value = valueB
    row.getCell(1).font = { bold: true }; row.getCell(11).font = { bold: true }
  })

  const top = sheet.getRow(12)
  const labels = ["N°", "ACTIVIDAD", "TAREA", "PUESTO DE TRABAJO", "LUGAR DE TRABAJO ESPECÍFICO", "N° DE TRABAJADORES", "", "", "FACTORES DE RIESGO", "RUTINARIA / NO RUTINARIA", "PELIGRO", "RIESGO", "DAÑO PROBABLE", "EVALUACIÓN DEL RIESGO", "", "", "", "MEDIDA DE CONTROL", "¿ESTÁ CONTROLADO EL RIESGO?", "RESPONSABLE", "PLAZOS"]
  labels.forEach((label, index) => { top.getCell(index + 1).value = label })
  const sub = sheet.getRow(13)
  ;[[6, "F"], [7, "M"], [8, "OTRO"], [14, "PROBABILIDAD"], [15, "CONSECUENCIA"], [16, "MR"], [17, "CLASIFICACIÓN DEL RIESGO"]].forEach(([col, label]) => { sub.getCell(col as number).value = label as string })
  sheet.mergeCells("F12:H12"); sheet.mergeCells("N12:Q12")
  for (const col of [1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 18, 19, 20, 21]) sheet.mergeCells(12, col, 13, col)
  headerStyle(top); headerStyle(sub)

  for (const entry of snapshot.entries) {
    const measures = entry.controls.map((control) => `${CONTROL_HIERARCHY_LABEL[control.hierarchy]}: ${control.description}`).join("\n")
    const responsible = [...new Set(entry.controls.map((control) => control.responsibleName).filter(Boolean))].join("\n")
    const deadlines = entry.controls.map((control) => (control.dueDate ? formatDate(control.dueDate) : "")).filter(Boolean).join("\n")
    const row = sheet.addRow([
      entry.rowNumber, safe(entry.activity ?? ""), safe(entry.task ?? ""), safe(entry.position ?? ""), safe(entry.location ?? ""),
      entry.exposedFemale, entry.exposedMale, entry.exposedOther, safe(entry.riskFactor ?? ""),
      entry.isRoutine === null ? "" : entry.isRoutine ? "Rutinaria" : "No rutinaria",
      safe(entry.hazard ?? ""), safe(entry.risk ?? ""), safe(entry.probableDamage ?? ""),
      entry.probability ?? "", entry.consequence ?? "", entry.magnitude ?? "",
      entry.classification ? CLASSIFICATION_LABEL[entry.classification].toUpperCase() : "",
      safe(measures), entry.controlledStatus ? CONTROLLED_STATUS_LABEL[entry.controlledStatus] : "", safe(responsible), deadlines,
    ])
    row.alignment = { vertical: "top", wrapText: true }
    if (entry.classification) {
      const cell = row.getCell(17)
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[entry.classification]! } }
      cell.font = { bold: true, color: { argb: entry.classification === "intolerable" ? "FFFFFFFF" : "FF000000" } }
    }
  }
  const widths = [5, 22, 22, 20, 20, 5, 5, 6, 16, 13, 28, 24, 26, 8, 8, 6, 14, 48, 14, 20, 12]
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width })
  sheet.views = [{ state: "frozen", xSplit: 3, ySplit: 13 }]

  const changes = workbook.addWorksheet("Modificaciones")
  headerStyle(changes.addRow(["Revisión", "Fecha", "Modificaciones", "Responsable", "Aprobó"]))
  for (const version of detail.versions) changes.addRow([version.versionNumber, formatDate(version.approvedAt), safe(version.changeSummary), safe(version.elaboratedByName), safe(version.approverName)])
  changes.columns = [{ width: 10 }, { width: 14 }, { width: 70 }, { width: 28 }, { width: 28 }]

  const criteria = workbook.addWorksheet("Criterios de Evaluación IPER")
  headerStyle(criteria.addRow(["PROBABILIDAD", "VALOR", "CRITERIO"]))
  for (const level of PROBABILITY_LEVELS) criteria.addRow([level.label, level.value, level.description])
  criteria.addRow([])
  headerStyle(criteria.addRow(["CONSECUENCIA", "VALOR", "CRITERIO"]))
  for (const level of CONSEQUENCE_LEVELS) criteria.addRow([level.label, level.value, level.description])
  criteria.addRow([])
  headerStyle(criteria.addRow(["CLASIFICACIÓN", "MR", "CRITERIO"]))
  const bandMr: Record<string, string> = { tolerable: "1 - 2", moderate: "4", important: "8", intolerable: "16" }
  for (const classification of RISK_CLASSIFICATIONS) criteria.addRow([CLASSIFICATION_LABEL[classification].toUpperCase(), bandMr[classification], CLASSIFICATION_CRITERIA[classification]])
  criteria.columns = [{ width: 30 }, { width: 10 }, { width: 110 }]
  criteria.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true } })

  return workbook
}
