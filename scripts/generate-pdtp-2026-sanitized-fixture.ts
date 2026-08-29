import fs from "node:fs/promises"
import path from "node:path"
import ExcelJS from "exceljs"
import catalog from "../db/seed/pdtp-catalog-2026.json"
import {
  PDTP_2026_EXECUTED_CELLS,
  PDTP_2026_SOURCE,
  PDTP_2026_VIEW_MEMBERSHIPS,
} from "../lib/services/pdtp-adapters/contract-2026"

const SHEETS = [
  ["PDTP GENERAL", "pdtp_general"],
  ["CPHS", "cphs"],
  ["PRF Y Adm. de contrato", "prf_adm_contrato"],
  ["Sup, JT", "sup_jt"],
  ["PRF", "prf"],
  ["Adm. de contrato", "adm_contrato"],
  ["Subgerente operaciones y mant.", "subgerente"],
  ["Capacitación y Campañas ", "capacitacion"],
] as const

const outputPath = path.resolve(process.cwd(), process.argv[2] ?? ".tmp/pdtp-2026-sanitized.xlsx")
const activityByNumber = new Map(catalog.activities.map((activity) => [activity.n, activity]))
const executedByActivity = new Map<number, typeof PDTP_2026_EXECUTED_CELLS[number][]>()
for (const cell of PDTP_2026_EXECUTED_CELLS) {
  const existing = executedByActivity.get(cell.activityNumber) ?? []
  existing.push(cell)
  executedByActivity.set(cell.activityNumber, existing)
}

async function main() {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Chome fixture generator"
  workbook.created = new Date("2026-01-01T00:00:00.000Z")
  workbook.modified = new Date("2026-01-01T00:00:00.000Z")
  workbook.calcProperties.fullCalcOnLoad = true

  for (const [sheetName, sheetCode] of SHEETS) {
    const sheet = workbook.addWorksheet(sheetName)
    sheet.getCell("A1").value = "FIXTURE SANITIZADA — NO ES DOCUMENTO OFICIAL"
    sheet.getCell("A2").value = `Estructura compatible con ${PDTP_2026_SOURCE.filename}`
    sheet.getCell("A3").value = "Código documental"
    sheet.getCell("B3").value = "RE-36-FIXTURE"
    sheet.getCell("A4").value = "Total planificado"
    sheet.getCell("B4").value = { formula: "SUM(E14,E14:CT102)", result: 0 }
    sheet.getCell("C4").value = "Cumplimiento"
    sheet.getCell("D4").value = { formula: "IFERROR(SUM(F14:CU102)/SUM(E14:CT102),0)", result: 0 }

    // El adaptador 2026 valida esta fila contractual; las actividades
    // comienzan en la 14 y no se solapan con el encabezado.
    const header = sheet.getRow(12)
    header.getCell(1).value = "N°"
    header.getCell(2).value = "ACTIVIDAD"
    header.getCell(3).value = "GUÍA DE EJECUCIÓN"
    header.getCell(4).value = "RESPONSABLE"
    for (let sequence = 0; sequence < 48; sequence++) {
      header.getCell(5 + sequence * 2).value = "P"
      header.getCell(6 + sequence * 2).value = "E"
    }

    const activityNumbers = PDTP_2026_VIEW_MEMBERSHIPS[sheetCode]
    activityNumbers.forEach((activityNumber, index) => {
      const activity = activityByNumber.get(activityNumber)
      if (!activity) throw new Error(`Actividad ${activityNumber} ausente del catálogo 2026.`)
      // Siempre por POSICIÓN en la vista, nunca por número de actividad. En
      // `pdtp_general` faltan la 4 y la 8, así que `13 + activityNumber`
      // desplazaba una fila todo lo que viene después del primer hueco y las
      // celdas E caían fuera de donde el contrato las fija (`F18` para la
      // actividad 6, no `F19`). El extractor lee secuencialmente, así que los
      // conteos seguían cuadrando y el desfase no se veía.
      const rowNumber = 14 + index
      const row = sheet.getRow(rowNumber)
      row.getCell(1).value = activity.n
      row.getCell(2).value = activity.activity
      row.getCell(3).value = activity.program
      row.getCell(4).value = activity.responsibleDisplay
      for (const planned of activity.schedule) {
        const sequence = (planned.month - 1) * 4 + (planned.week - 1)
        row.getCell(5 + sequence * 2).value = planned.plannedQuantity
      }
      if (sheetCode === "pdtp_general") {
        for (const executed of executedByActivity.get(activityNumber) ?? []) {
          const sequence = (executed.month - 1) * 4 + (executed.week - 1)
          row.getCell(6 + sequence * 2).value = executed.quantity
        }
      }
    })

    sheet.views = [{ state: "frozen", ySplit: 13, xSplit: 4 }]
    sheet.getColumn(1).width = 10
    sheet.getColumn(2).width = 54
    sheet.getColumn(3).width = 44
    sheet.getColumn(4).width = 24
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await workbook.xlsx.writeFile(outputPath)
  console.log(`Fixture sanitizada escrita en ${path.relative(process.cwd(), outputPath)}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
