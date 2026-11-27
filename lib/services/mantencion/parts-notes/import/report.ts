import ExcelJS from "exceljs"
import { formatDateTime } from "@/lib/utils"
import type { ApplyResult } from "./apply"
import type { ImportPlan } from "./plan"

/**
 * Informe de la importación: el resumen para la consola y el Excel (`--report`) con una hoja por cosa que jefatura debe
 * revisar. No lleva correos ni datos de usuarios: sólo folios de origen, textos del archivo y nombres de faenas.
 */

export const REPORT_SHEETS = {
  summary: "Resumen",
  charges: "Pendientes de cargo",
  articles: "Artículos sin calce",
  suppliers: "Proveedores sin calce",
  worksites: "Faenas sin calce",
  excluded: "Excluidas",
  existing: "Ya importadas",
  problems: "Errores y avisos",
} as const

export interface ImportReport {
  fileName: string
  plan: ImportPlan
  /** `null` = simulación. */
  applied: ApplyResult | null
}

type Cell = string | number | null

/** Los criterios que conviene tener a la vista junto a los números. */
export const REPORT_CRITERIA: readonly string[] = [
  "No se crean productos ni proveedores desde texto libre (ensucia el catálogo): lo que no calza queda con product_id vacío y el proveedor como texto; jefatura crea los maestros desde los informes «Artículos sin calce» y «Proveedores sin calce» y vuelve a correr.",
  "Notas Cerradas: sus líneas quedan «en compra» SIN compra viva (la importación no compra ni recibe nada); el estado de la nota se escribe directo y ningún recálculo automático (llegadas, recepciones, cierre de OT) lo cambia.",
  "Cargos: equipo por código o patente, o por la tabla de equivalencias; lo que no calza queda como texto en el cargo y en «Pendientes de cargo».",
]

function importedNotes(report: ImportReport) {
  const refs = report.applied ? new Set(report.applied.applied.map((note) => note.externalRef)) : null
  return report.plan.toImport.filter((note) => !refs || refs.has(note.externalRef))
}

/** Pares concepto / valor del resumen; los usa la hoja «Resumen» y la consola. Una fila con valor `null` es un título. */
export function summaryRows(report: ImportReport): Array<[string, Cell]> {
  const { plan, applied } = report
  const notes = importedNotes(report)
  const lines = notes.flatMap((note) => note.lines)
  const count = (predicate: (line: (typeof lines)[number]) => boolean) => lines.filter(predicate).length
  const byStatus = (status: string) => notes.filter((note) => note.status === status).length
  const folios = applied?.applied.map((note) => note.code).sort() ?? []
  return [
    ["Modo", applied ? "APLICADO (se escribió)" : "SIMULACIÓN (no se escribió nada)"],
    ["Archivo", report.fileName],
    ["Notas en el archivo", plan.totalInFile],
    [applied ? "Notas importadas" : "Notas que se importarían", notes.length],
    ["Ya importadas antes (se saltan)", plan.alreadyImported.length + (applied?.alreadyThere.length ?? 0)],
    ["Excluidas (de prueba)", plan.excluded.length],
    ["Sin faena que calce (no se importan)", plan.worksiteUnmatched.reduce((sum, site) => sum + site.notes, 0)],
    ["Inválidas (no se importan)", plan.invalid.length],
    ["Fallidas al escribir", applied?.failed.length ?? 0],
    ["Folios NP asignados", folios.length ? `${folios[0]} a ${folios.at(-1)}` : applied ? "ninguno" : "se asignan al aplicar"],
    ["Notas por estado", null],
    ...(["enviada", "aceptada", "en_espera", "rechazada", "cerrada"] as const).map((status): [string, Cell] => [`  ${status}`, byStatus(status)]),
    ["Líneas", lines.length],
    ["  con producto del catálogo", count((line) => !!line.productId)],
    ["  sin producto (sólo texto)", count((line) => !line.productId)],
    ["  cargo a un equipo", count((line) => !!line.chargeVehicleId)],
    ["  cargo a un centro de costo", count((line) => !!line.chargeCostCenterId)],
    ["  cargo pendiente de revisar", count((line) => !!line.chargeText)],
    ["  sin cargo", count((line) => !line.chargeVehicleId && !line.chargeCostCenterId && !line.chargeText)],
    ["  proveedor del catálogo", count((line) => !!line.suggestedSupplierId)],
    ["  proveedor sólo como texto", count((line) => !!line.supplierHint)],
    ["Notas a nombre de un usuario de la plataforma", notes.filter((note) => note.requestedByUserId).length],
    ["Notas sólo con el nombre de quien pidió", notes.filter((note) => !note.requestedByUserId).length],
    ["Artículos distintos sin calce", plan.articlesWithoutMatch.length],
    ["Proveedores distintos sin calce", plan.suppliersWithoutMatch.length],
    ["Faenas distintas sin calce", plan.worksiteUnmatched.length],
    ["Líneas con cargo pendiente", plan.pendingCharges.length],
  ]
}

export function formatConsoleSummary(report: ImportReport): string {
  const rows = summaryRows(report).map(([key, value]) => (value === null ? `\n${key}:` : `${key}: ${value}`))
  return [...rows, "", ...REPORT_CRITERIA.map((line) => `- ${line}`)].join("\n")
}

interface Column { header: string; width: number }

function addSheet(workbook: ExcelJS.Workbook, name: string, columns: Column[], rows: Cell[][]) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] })
  sheet.columns = columns.map((column) => ({ header: column.header, width: column.width }))
  sheet.getRow(1).font = { bold: true }
  for (const row of rows) sheet.addRow(row)
  if (rows.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  return sheet
}

export function buildReportWorkbook(report: ImportReport): ExcelJS.Workbook {
  const { plan, applied } = report
  const workbook = new ExcelJS.Workbook()
  const summary = addSheet(workbook, REPORT_SHEETS.summary, [{ header: "Concepto", width: 52 }, { header: "Valor", width: 40 }], summaryRows(report))
  summary.addRow([])
  for (const criterion of REPORT_CRITERIA) {
    const row = summary.addRow([criterion])
    summary.mergeCells(row.number, 1, row.number, 2)
    row.alignment = { wrapText: true, vertical: "top" }
    row.height = 48
  }

  addSheet(workbook, REPORT_SHEETS.charges, [
    { header: "Folio de origen", width: 16 }, { header: "Fecha", width: 18 }, { header: "Faena", width: 24 },
    { header: "Artículo", width: 44 }, { header: "Cargo original", width: 24 }, { header: "Motivo", width: 70 },
  ], plan.pendingCharges.map((item) => [item.externalRef, formatDateTime(item.createdAt), item.faena, item.articulo, item.cargo, item.reason]))

  addSheet(workbook, REPORT_SHEETS.articles, [
    { header: "Artículo", width: 52 }, { header: "Código", width: 18 }, { header: "Líneas", width: 10 },
    { header: "Cantidad total", width: 15 }, { header: "Notas", width: 10 },
  ], plan.articlesWithoutMatch.map((item) => [item.articulo, item.codigo, item.lines, item.quantity, item.notes]))

  addSheet(workbook, REPORT_SHEETS.suppliers, [
    { header: "Proveedor (texto de origen)", width: 52 }, { header: "Líneas", width: 10 }, { header: "Notas", width: 10 },
  ], plan.suppliersWithoutMatch.map((item) => [item.proveedor, item.lines, item.notes]))

  addSheet(workbook, REPORT_SHEETS.worksites, [
    { header: "Faena (texto de origen)", width: 36 }, { header: "Notas", width: 10 }, { header: "Líneas", width: 10 }, { header: "Folios de origen", width: 70 },
  ], plan.worksiteUnmatched.map((item) => [item.faena, item.notes, item.lines, item.refs.length > 25 ? `${item.refs.slice(0, 25).join(", ")}…` : item.refs.join(", ")]))

  addSheet(workbook, REPORT_SHEETS.excluded, [
    { header: "Folio de origen", width: 16 }, { header: "Fecha", width: 18 }, { header: "Solicitante", width: 24 },
    { header: "Observación", width: 44 }, { header: "Motivo", width: 70 },
  ], plan.excluded.map((item) => [item.externalRef, formatDateTime(item.createdAt), item.solicitante, item.observacion, item.reason]))

  const there = [...plan.alreadyImported, ...(applied?.alreadyThere ?? []).map((note) => ({ ...note, createdAt: "" }))]
  addSheet(workbook, REPORT_SHEETS.existing, [
    { header: "Folio de origen", width: 16 }, { header: "Folio NP", width: 16 }, { header: "Estado actual", width: 18 }, { header: "Fecha", width: 18 },
  ], there.map((item) => [item.externalRef, item.code, item.status, item.createdAt ? formatDateTime(item.createdAt) : null]))

  addSheet(workbook, REPORT_SHEETS.problems, [
    { header: "Tipo", width: 30 }, { header: "Folio de origen", width: 16 }, { header: "Posición en el archivo", width: 14 }, { header: "Detalle", width: 100 },
  ], [
    ...plan.invalid.flatMap((item) => item.errors.map((error): Cell[] => ["Error: no se importó", item.externalRef, item.position, error])),
    ...(applied?.failed ?? []).map((item): Cell[] => ["Falló al escribir (se deshizo)", item.externalRef, null, item.error]),
    ...plan.toImport.flatMap((note) => note.warnings.map((warning): Cell[] => ["Aviso: se importó con ajuste", note.externalRef, null, warning])),
  ])
  return workbook
}
