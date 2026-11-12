import { asc, isNull } from "drizzle-orm"
import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { db } from "@/db"
import { mantSchedules } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { formatReading } from "@/lib/mantencion/format"
import type { MantBrandRuleValue, MantScheduleSnapshot } from "@/lib/mantencion/types"
import { safeWorksheetName, xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import { addExportMetadataSheet } from "@/lib/reports/export-metadata"
import { todayInChile } from "@/lib/utils"
import { styleHeaderRow } from "./export-equipment"
import { buildScheduleSnapshot, getScheduleSnapshot } from "./schedule-versions"
import { loadScheduleEditor } from "./schedules"

/**
 * Excel de pautas (§12): una hoja por pauta con la matriz ítem × intervalo y,
 * debajo, la tabla de reglas por marca. Quien llama exige `mant:export` y
 * `mant:schedules:manage` (las pautas sólo las ve jefatura).
 *
 * Exporta la versión PUBLICADA (el snapshot que leen el teléfono, el panel y los
 * equipos), no el borrador del editor: el archivo tiene que decir lo mismo que lo
 * que el mecánico ve. Si la pauta tiene cambios sin publicar, la hoja de metadatos lo
 * avisa. La nota de cada ítem no viaja en el snapshot y se toma del editor.
 */

const RULE_LABEL = { A: "Aplica", W: "Revisar", X: "No aplica" } as const

interface BrandRuleRow { activity: string; values: Record<string, MantBrandRuleValue> }

function writeSchedule(sheet: ExcelJS.Worksheet, snapshot: MantScheduleSnapshot, notes: Map<string, string | null>, brands: Array<{ id: string; name: string }>, rows: BrandRuleRow[]) {
  const intervalHeaders = snapshot.intervals.map((value) => formatReading(value, snapshot.unit))
  sheet.columns = [
    { header: "Sistema", key: "group", width: 22 },
    { header: "Actividad", key: "item", width: 46 },
    ...intervalHeaders.map((header, index) => ({ header, key: `iv${index}`, width: 14 })),
    { header: "Nota", key: "note", width: 18 },
  ]
  for (const group of snapshot.groups) {
    for (const item of group.items) {
      const row: Record<string, string> = { group: group.name, item: item.name, note: notes.get(item.key) ?? "" }
      snapshot.intervals.forEach((_, index) => { row[`iv${index}`] = item.applies[index] ? "Sí" : "No" })
      sheet.addRow(row)
    }
  }
  styleHeaderRow(sheet, 2 + snapshot.intervals.length + 1)

  if (rows.length === 0) return
  sheet.addRow([])
  const title = sheet.addRow(["Reglas por marca"])
  title.font = { bold: true }
  const header = sheet.addRow(["", "Actividad", ...brands.map((brand) => brand.name)])
  header.font = { bold: true }
  for (const rule of rows) {
    sheet.addRow(["", rule.activity, ...brands.map((brand) => RULE_LABEL[rule.values[brand.id] ?? "A"])])
  }
}

/** Reglas por marca de la versión publicada: una fila por ítem con alguna regla, columnas por marca. */
function publishedBrandRules(snapshot: MantScheduleSnapshot, brandNames: Map<string, string>) {
  const itemNames = new Map(snapshot.groups.flatMap((group) => group.items.map((item) => [item.key, item.name] as const)))
  const byItem = new Map<string, BrandRuleRow>()
  const brandIds = new Set<string>()
  for (const rule of snapshot.brandRules) {
    const activity = itemNames.get(rule.itemKey)
    if (!activity) continue
    brandIds.add(rule.brandId)
    const row = byItem.get(rule.itemKey) ?? { activity, values: {} }
    row.values[rule.brandId] = rule.value
    byItem.set(rule.itemKey, row)
  }
  const brands = [...brandIds]
    .map((id) => ({ id, name: brandNames.get(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
  return { brands, rows: [...byItem.values()].sort((a, b) => a.activity.localeCompare(b.activity, "es")) }
}

export async function exportSchedules(
  session: Session,
  input: { scheduleIds: string[] | null },
): Promise<{ base64: string; filename: string; sheetCount: number }> {
  // Sólo hacen falta id y nombre: `listSchedules()` calcula además el estado de borrador de cada pauta.
  const all = await db.select({ id: mantSchedules.id, name: mantSchedules.name }).from(mantSchedules)
    .where(isNull(mantSchedules.deletedAt)).orderBy(asc(mantSchedules.name))
  const wanted = input.scheduleIds ? all.filter((schedule) => input.scheduleIds!.includes(schedule.id)) : all
  const workbook = new ExcelJS.Workbook()
  const used = new Set<string>(["metadatos"])
  let rowCount = 0
  const unpublished: string[] = []
  for (const schedule of wanted) {
    const live = await loadScheduleEditor(schedule.id)
    if (!live) continue
    // Invariante: toda pauta viva tiene su snapshot publicado; si faltara, se arma desde el estado vivo.
    const snapshot = await getScheduleSnapshot(schedule.id, live.version) ?? await buildScheduleSnapshot(db, schedule.id, live.version)
    if (live.draft.dirty) unpublished.push(live.name)
    const notes = new Map(live.groups.flatMap((group) => group.items.map((item) => [item.key, item.note] as const)))
    const { brands, rows } = publishedBrandRules(snapshot, new Map(live.brandRules.brands.map((brand) => [brand.id, brand.name])))
    const sheet = workbook.addWorksheet(safeWorksheetName(snapshot.name, used))
    writeSchedule(sheet, snapshot, notes, brands, rows)
    rowCount += snapshot.groups.reduce((sum, group) => sum + group.items.length, 0)
  }
  await addExportMetadataSheet(workbook, session, {
    filters: { pautas: wanted.map((schedule) => schedule.name).join(", ") },
    rowCount,
    notes: unpublished.length > 0
      ? [`Versión publicada de las pautas. Con cambios sin publicar en el editor (no incluidos en este archivo): ${unpublished.join(", ")}.`]
      : [],
  })
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
