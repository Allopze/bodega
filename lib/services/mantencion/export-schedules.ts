import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { formatReading } from "@/lib/mantencion/format"
import { safeWorksheetName, xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import { addExportMetadataSheet } from "@/lib/reports/export-metadata"
import { todayInChile } from "@/lib/utils"
import { styleHeaderRow } from "./export-equipment"
import { listSchedules, loadScheduleEditor, type ScheduleEditorModel } from "./schedules"

/**
 * Excel de pautas (§12): una hoja por pauta con la matriz ítem × intervalo y,
 * debajo, la tabla de reglas por marca. Quien llama exige `mant:export` y
 * `mant:schedules:manage` (las pautas sólo las ve jefatura).
 */

const RULE_LABEL = { A: "Aplica", W: "Revisar", X: "No aplica" } as const

function writeSchedule(sheet: ExcelJS.Worksheet, model: ScheduleEditorModel) {
  const intervalHeaders = model.intervals.map((interval) => formatReading(interval.value, model.unit))
  sheet.columns = [
    { header: "Sistema", key: "group", width: 22 },
    { header: "Actividad", key: "item", width: 46 },
    ...intervalHeaders.map((header, index) => ({ header, key: `iv${index}`, width: 14 })),
    { header: "Nota", key: "note", width: 18 },
  ]
  for (const group of model.groups) {
    for (const item of group.items) {
      const row: Record<string, string> = { group: group.name, item: item.name, note: item.note ?? "" }
      model.intervals.forEach((interval, index) => { row[`iv${index}`] = item.applies[interval.id] ? "Sí" : "No" })
      sheet.addRow(row)
    }
  }
  styleHeaderRow(sheet, 2 + model.intervals.length + 1)

  const { brands, rows } = model.brandRules
  if (rows.length === 0) return
  sheet.addRow([])
  const title = sheet.addRow(["Reglas por marca"])
  title.font = { bold: true }
  const header = sheet.addRow(["", "Actividad", ...brands.map((brand) => brand.name)])
  header.font = { bold: true }
  for (const rule of rows) {
    sheet.addRow(["", rule.activity + (rule.inSchedule ? "" : " (no está en la pauta)"), ...brands.map((brand) => RULE_LABEL[rule.values[brand.id] ?? "A"])])
  }
}

export async function exportSchedules(
  session: Session,
  input: { scheduleIds: string[] | null },
): Promise<{ base64: string; filename: string; sheetCount: number }> {
  const all = await listSchedules()
  const wanted = input.scheduleIds ? all.filter((schedule) => input.scheduleIds!.includes(schedule.id)) : all
  const workbook = new ExcelJS.Workbook()
  const used = new Set<string>(["metadatos"])
  let rowCount = 0
  for (const schedule of wanted) {
    const model = await loadScheduleEditor(schedule.id)
    if (!model) continue
    const sheet = workbook.addWorksheet(safeWorksheetName(model.name, used))
    writeSchedule(sheet, model)
    rowCount += model.groups.reduce((sum, group) => sum + group.items.length, 0)
  }
  addExportMetadataSheet(workbook, session, { filters: { pautas: wanted.map((schedule) => schedule.name).join(", ") }, rowCount })
  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "export",
    entityType: "mant_schedule_export",
    entityId: nanoid(),
    newState: { schedules: wanted.map((schedule) => schedule.name), rowCount },
  })
  const single = wanted.length === 1 ? `-${wanted[0]!.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}` : ""
  return { base64: await xlsxToBase64(workbook), filename: `pautas-mantencion${single}_${todayInChile()}.xlsx`, sheetCount: wanted.length }
}
