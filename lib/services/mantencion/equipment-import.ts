import ExcelJS from "exceljs"
import { db, type Tx } from "@/db"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { cleanName, nameKey, normalizeCode } from "@/lib/mantencion/normalize"
import { EXCEL_DATE_FORMAT } from "@/lib/reports/excel-dates"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import type { MantActionResult } from "./result"
import { applyCreate, applyUpdate } from "./equipment"
import { diffEquipmentFields, summarizeChanges, type MantActor } from "./equipment-history"
import {
  findIdentityByCode, loadEquipmentCatalogs, loadEquipmentCurrents, NEW_WORKSITE, resolveEquipment,
  type EquipmentCatalogs, type EquipmentCurrent, type EquipmentInput, type ResolvedEquipment, type VehicleIdentity,
} from "./equipment-resolve"
import { styleHeaderRow } from "./export-equipment"
import { resolveOrCreateWorksite } from "./worksites"

/**
 * Importación de equipos y lecturas iniciales (§10): plantilla `.xlsx`,
 * vista previa fila por fila y confirmación. La confirmación vuelve a leer y a
 * validar el archivo en el servidor —no confía en la vista previa— y escribe
 * sólo las filas válidas, todas en una transacción, con su historial
 * (acción `import`) y una fila de auditoría. Valida con `resolveEquipment`, la
 * misma definición de «equipo válido» que usa el formulario.
 */

export const IMPORT_MAX_ROWS = 2000
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024

const COLUMNS = [
  { key: "code", header: "Código", width: 14, aliases: ["codigo", "codigo interno"] },
  { key: "plate", header: "Patente", width: 14, aliases: ["patente"] },
  { key: "type", header: "Tipo de equipo", width: 22, aliases: ["tipo de equipo", "tipo"] },
  { key: "brand", header: "Marca", width: 16, aliases: ["marca"] },
  { key: "model", header: "Modelo", width: 18, aliases: ["modelo"] },
  { key: "year", header: "Año", width: 8, aliases: ["ano"] },
  { key: "worksite", header: "Faena", width: 20, aliases: ["faena"] },
  { key: "schedule", header: "Pauta", width: 24, aliases: ["pauta", "pauta de mantencion"] },
  { key: "reading", header: "Lectura inicial", width: 16, aliases: ["lectura inicial", "lectura", "lectura actual"] },
  { key: "readingDate", header: "Fecha de la lectura", width: 19, aliases: ["fecha de la lectura", "fecha lectura", "fecha de la lectura inicial"] },
] as const
type ColumnKey = (typeof COLUMNS)[number]["key"]

export interface RawImportRow extends Record<ColumnKey, string> {
  row: number
  /** La lectura cuando la celda es numérica: evita confundir «1.234» (miles) con 1,234. */
  readingNumber: number | null
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if ("richText" in value) return value.richText.map((part) => part.text).join("").trim()
  if ("text" in value) return String(value.text).trim()
  if ("result" in value) return value.result === undefined ? "" : cellText(value.result as ExcelJS.CellValue)
  return ""
}

export async function parseEquipmentWorkbook(buffer: ArrayBuffer): Promise<{ ok: true; rows: RawImportRow[] } | { ok: false; message: string }> {
  if (buffer.byteLength > IMPORT_MAX_BYTES) return { ok: false, message: "El archivo pesa más de 5 MB. Divide la planilla en partes." }
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(Buffer.from(buffer) as never)
  } catch {
    return { ok: false, message: "No se pudo leer el archivo: sube una planilla de Excel (.xlsx), como la plantilla." }
  }
  const sheet = workbook.getWorksheet("Equipos") ?? workbook.worksheets[0]
  if (!sheet) return { ok: false, message: "La planilla no tiene hojas." }

  const columnOf = new Map<ColumnKey, number>()
  sheet.getRow(1).eachCell((cell, column) => {
    const key = nameKey(cellText(cell.value))
    const match = COLUMNS.find((candidate) => (candidate.aliases as readonly string[]).includes(key))
    if (match && !columnOf.has(match.key)) columnOf.set(match.key, column)
  })
  if (!columnOf.has("code")) return { ok: false, message: "No encontré la columna «Código» en la primera fila. Usa la plantilla para no equivocarte de encabezados." }

  const rows: RawImportRow[] = []
  for (let number = 2; number <= sheet.rowCount; number++) {
    const sheetRow = sheet.getRow(number)
    const row = { row: number, readingNumber: null } as RawImportRow
    for (const column of COLUMNS) {
      const index = columnOf.get(column.key)
      const value = index ? sheetRow.getCell(index).value : null
      row[column.key] = cellText(value)
      if (column.key === "reading" && typeof value === "number") row.readingNumber = value
    }
    if (COLUMNS.every((column) => row[column.key] === "")) continue
    rows.push(row)
    if (rows.length > IMPORT_MAX_ROWS) return { ok: false, message: `La planilla trae más de ${IMPORT_MAX_ROWS.toLocaleString("es-CL")} filas. Divídela en partes.` }
  }
  if (rows.length === 0) return { ok: false, message: "La planilla no trae equipos: llena al menos una fila bajo los encabezados." }
  return { ok: true, rows }
}

/** «40.312» → 40312; «1.234,5» → 1234.5; «1234.5» → 1234.5. */
function parseNumberText(text: string): number | null | "invalid" {
  if (!text) return null
  let normalized = text.replace(/\s/g, "")
  if (normalized.includes(",")) normalized = normalized.replace(/\./g, "").replace(",", ".")
  else if (/^\d{1,3}(\.\d{3})+$/.test(normalized)) normalized = normalized.replace(/\./g, "")
  if (!/^\d+(\.\d+)?$/.test(normalized)) return "invalid"
  return Number(normalized)
}

/** `dd-mm-aaaa`, `dd/mm/aaaa` o `aaaa-mm-dd` → `aaaa-mm-dd`. */
function parseDateText(text: string): string | null | "invalid" {
  if (!text) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text)
  return match ? `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}` : "invalid"
}

export type ImportRowKind = "create" | "incorporate" | "update" | "unchanged" | "error"

export interface ImportRowResult {
  row: number
  code: string
  kind: ImportRowKind
  /** Resumen del equipo («Camión · Scania · Arauco») para reconocer la fila. */
  label: string
  /** Motivos de error, o los cambios sobre un equipo existente. */
  messages: string[]
}

export interface ImportSummary {
  total: number
  created: number
  incorporated: number
  updated: number
  unchanged: number
  errors: number
  newWorksites: string[]
}

export interface ImportPreview { rows: ImportRowResult[]; summary: ImportSummary }

type PlanItem =
  | { kind: "error"; result: ImportRowResult }
  | { kind: "unchanged"; result: ImportRowResult }
  | { kind: "create" | "incorporate"; result: ImportRowResult; resolved: ResolvedEquipment; incorporate: VehicleIdentity | null }
  | { kind: "update"; result: ImportRowResult; resolved: ResolvedEquipment; current: EquipmentCurrent }

const SIN_PATENTE = "sin patente"

/** Arma el `EquipmentInput` de una fila: la fila gana; lo que viene en blanco conserva la ficha actual. */
function inputFromRow(raw: RawImportRow, current: EquipmentCurrent | null, catalogs: EquipmentCatalogs) {
  const pre: Record<string, string> = {}
  const keep = current?.fields
  const typeText = raw.type || keep?.type || ""
  const type = typeText ? catalogs.types.find((item) => item.isActive && nameKey(item.name) === nameKey(typeText)) : undefined
  if (typeText && !type) pre.equipmentTypeId = `El tipo «${typeText}» no existe. Revisa la hoja «Listas» de la plantilla.`
  const brandText = raw.brand || keep?.brand || ""
  const brand = brandText ? catalogs.brands.find((item) => item.isActive && nameKey(item.name) === nameKey(brandText)) : undefined
  if (brandText && !brand) pre.brandId = `La marca «${brandText}» no está en la lista de marcas.`
  const scheduleText = raw.schedule || keep?.schedule || ""
  const schedule = scheduleText && nameKey(scheduleText) !== "sin pauta"
    ? catalogs.schedules.find((item) => nameKey(item.name) === nameKey(scheduleText))
    : undefined
  if (scheduleText && nameKey(scheduleText) !== "sin pauta" && !schedule) pre.scheduleId = `La pauta «${scheduleText}» no existe.`

  const yearText = raw.year || (keep?.year != null ? String(keep.year) : "")
  const year = yearText ? Number(yearText) : null
  if (yearText && !/^\d{4}$/.test(yearText)) pre.year = "Año no válido."
  const reading = raw.readingNumber ?? (raw.reading ? parseNumberText(raw.reading) : (keep?.initialReading ?? null))
  if (reading === "invalid") pre.initialReading = "La lectura debe ser un número."
  const date = parseDateText(raw.readingDate)
  if (date === "invalid") pre.initialReadingDate = "Escribe la fecha como dd-mm-aaaa."

  const noPlate = raw.plate ? nameKey(raw.plate) === SIN_PATENTE : (keep?.noPlate ?? false)
  const input: EquipmentInput = {
    code: raw.code,
    plate: noPlate ? "" : raw.plate || keep?.plate || "",
    noPlate,
    equipmentTypeId: type?.id ?? "",
    brandId: brand?.id ?? "",
    model: raw.model || keep?.model || "",
    year: year !== null && Number.isInteger(year) ? year : null,
    worksiteId: NEW_WORKSITE,
    newWorksiteName: raw.worksite || keep?.worksite || "",
    scheduleId: schedule?.id ?? null,
    initialReading: reading === "invalid" ? null : reading,
    initialReadingDate: date === "invalid" ? null : date,
  }
  return { input, pre }
}

interface PlanContext {
  catalogs: EquipmentCatalogs
  currents: Map<string, EquipmentCurrent>
  createWorksite?: (name: string) => Promise<{ id: string; name: string }>
}

async function planImport(client: Pick<Tx, "select">, rows: RawImportRow[], context: PlanContext): Promise<PlanItem[]> {
  const { catalogs, currents } = context
  const plan: PlanItem[] = []
  const seen = new Map<string, number>()
  const fail = (raw: RawImportRow, messages: string[]): PlanItem => ({
    kind: "error", result: { row: raw.row, code: normalizeCode(raw.code), kind: "error", label: "", messages },
  })

  for (const raw of rows) {
    const code = normalizeCode(raw.code)
    if (!code) { plan.push(fail(raw, ["Falta el código del equipo."])); continue }
    const firstRow = seen.get(code)
    if (firstRow) { plan.push(fail(raw, [`El código ${code} ya aparece en la fila ${firstRow} de la planilla.`])); continue }
    seen.set(code, raw.row)

    const identity = findIdentityByCode(catalogs.identities, code)
    const current = identity?.hasProfile ? currents.get(identity.id) ?? null : null
    if (current && !current.active) {
      plan.push(fail(raw, [`El equipo ${code} está dado de baja: reactívalo desde su ficha antes de actualizarlo.`]))
      continue
    }
    const { input, pre } = inputFromRow(raw, current, catalogs)
    const hasPre = Object.keys(pre).length > 0
    // Con errores de lectura de la fila no se crea la faena nueva: la fila no se va a importar.
    const resolved = await resolveEquipment(client, input, { current, catalogs, createWorksite: hasPre ? undefined : context.createWorksite })
    if (!resolved.ok) {
      plan.push(fail(raw, Object.values({ ...resolved.fieldErrors, ...pre })))
      continue
    }
    if (hasPre) { plan.push(fail(raw, Object.values(pre))); continue }

    const value = resolved.value
    const label = [value.type.name, value.brand.name, value.worksite.name].filter(Boolean).join(" · ")
    if (!current) {
      const incorporate = resolved.incorporate
      if (incorporate) Object.assign(incorporate, { code: value.code, plate: value.plate, hasProfile: true })
      else catalogs.identities.push({ id: `import-fila-${raw.row}`, code: value.code, plate: value.plate, isActive: true, hasProfile: true })
      plan.push({
        kind: incorporate ? "incorporate" : "create", resolved: value, incorporate,
        result: { row: raw.row, code, kind: incorporate ? "incorporate" : "create", label, messages: [] },
      })
      continue
    }
    const changes = diffEquipmentFields(current.fields, value.fields)
    if (identity) Object.assign(identity, { code: value.code, plate: value.plate })
    const entries = Object.entries(changes)
    if (entries.length === 0) {
      plan.push({ kind: "unchanged", result: { row: raw.row, code, kind: "unchanged", label, messages: [] } })
    } else {
      plan.push({
        kind: "update", resolved: value, current,
        result: { row: raw.row, code, kind: "update", label, messages: entries.map(([field, change]) => summarizeChanges({ [field]: change })) },
      })
    }
  }
  return plan
}

function summarize(plan: PlanItem[]): ImportSummary {
  const count = (kind: ImportRowKind) => plan.filter((item) => item.kind === kind).length
  const newWorksites = new Map<string, string>()
  for (const item of plan) {
    if ("resolved" in item && item.resolved.worksite.id === null) newWorksites.set(nameKey(item.resolved.worksite.name), item.resolved.worksite.name)
  }
  return {
    total: plan.length, created: count("create"), incorporated: count("incorporate"), updated: count("update"),
    unchanged: count("unchanged"), errors: count("error"), newWorksites: [...newWorksites.values()],
  }
}

/** Vista previa: qué se crearía, qué cambiaría y qué filas traen error. No escribe nada. */
export async function previewEquipmentImport(buffer: ArrayBuffer): Promise<MantActionResult<ImportPreview>> {
  const parsed = await parseEquipmentWorkbook(buffer)
  if (!parsed.ok) return { ok: false, message: parsed.message }
  const catalogs = await loadEquipmentCatalogs(db)
  const currents = new Map((await loadEquipmentCurrents(db)).map((item) => [item.vehicleId, item]))
  const plan = await planImport(db, parsed.rows, { catalogs, currents })
  return { ok: true, data: { rows: plan.map((item) => item.result), summary: summarize(plan) } }
}

/** Confirma la importación: vuelve a validar el archivo y escribe las filas válidas en una sola transacción. */
export async function commitEquipmentImport(actor: MantActor, buffer: ArrayBuffer, fileName: string): Promise<MantActionResult<ImportSummary>> {
  const parsed = await parseEquipmentWorkbook(buffer)
  if (!parsed.ok) return { ok: false, message: parsed.message }
  return db.transaction(async (tx) => {
    const catalogs = await loadEquipmentCatalogs(tx)
    const currents = new Map((await loadEquipmentCurrents(tx)).map((item) => [item.vehicleId, item]))
    const createdWorksites: string[] = []
    const plan = await planImport(tx, parsed.rows, {
      catalogs, currents,
      createWorksite: async (name) => {
        const worksite = await resolveOrCreateWorksite(tx, { typedName: name, actor: { userId: actor.userId, email: actor.email } })
        if (worksite.created) createdWorksites.push(worksite.name)
        return worksite
      },
    })
    for (const item of plan) {
      if (item.kind === "create" || item.kind === "incorporate") await applyCreate(tx, actor, item.resolved, item.incorporate, "import")
      else if (item.kind === "update") await applyUpdate(tx, actor, item.current, item.resolved, "import")
    }
    const summary = summarize(plan)
    // Las faenas se crearon durante la validación: se informan las creadas, ya no las pendientes.
    summary.newWorksites = createdWorksites
    const written = summary.created + summary.incorporated + summary.updated
    if (written > 0) {
      await recordAudit({
        userId: actor.userId, userEmail: actor.email ?? undefined, action: "create",
        entityType: "mant_equipment_import", entityId: nanoid(),
        newState: { fileName: cleanName(fileName).slice(0, 120), ...summary },
      }, tx)
    }
    const parts = [
      summary.created ? `${summary.created} ${summary.created === 1 ? "equipo creado" : "equipos creados"}` : "",
      summary.incorporated ? `${summary.incorporated} incorporados desde la flota` : "",
      summary.updated ? `${summary.updated} ${summary.updated === 1 ? "actualizado" : "actualizados"}` : "",
      summary.unchanged ? `${summary.unchanged} sin cambios` : "",
      summary.errors ? `${summary.errors} con error (no se importaron)` : "",
    ].filter(Boolean)
    return { ok: true as const, data: summary, message: parts.length ? parts.join(" · ") : "No había filas para importar." }
  })
}

/** Plantilla descargable: hoja «Equipos» vacía con listas desplegables, y hojas de instrucciones y valores válidos. */
export async function buildEquipmentTemplate(): Promise<{ base64: string; filename: string }> {
  const catalogs = await loadEquipmentCatalogs(db)
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Equipos")
  sheet.columns = COLUMNS.map(({ header, key, width }) => ({ header, key, width }))
  styleHeaderRow(sheet, COLUMNS.length)
  sheet.getColumn("readingDate").numFmt = EXCEL_DATE_FORMAT
  sheet.getColumn("reading").numFmt = "#,##0"

  const lists = workbook.addWorksheet("Listas")
  const types = catalogs.types.filter((item) => item.isActive && item.unit).sort((a, b) => a.name.localeCompare(b.name, "es"))
  const brands = catalogs.brands.filter((item) => item.isActive).sort((a, b) => a.name.localeCompare(b.name, "es"))
  const sites = catalogs.worksites.filter((item) => item.isActive).sort((a, b) => a.name.localeCompare(b.name, "es"))
  const schedules = [...catalogs.schedules].sort((a, b) => a.name.localeCompare(b.name, "es"))
  const lastRow = (count: number) => Math.max(2, count + 1)
  lists.columns = [
    { header: "Tipo de equipo", key: "type", width: 24 }, { header: "Se mide en", key: "unit", width: 12 },
    { header: "Marca", key: "brand", width: 18 }, { header: "Faena", key: "site", width: 22 }, { header: "Pauta", key: "schedule", width: 26 },
  ]
  const longest = Math.max(types.length, brands.length, sites.length, schedules.length)
  for (let index = 0; index < longest; index++) {
    lists.addRow({
      type: types[index]?.name, unit: types[index] ? (types[index]!.unit === "km" ? "kilómetros" : "horas") : undefined,
      brand: brands[index]?.name, site: sites[index]?.name, schedule: schedules[index]?.name,
    })
  }
  styleHeaderRow(lists, 5)
  const dropdown = (column: string, key: string, count: number) => {
    for (let row = 2; row <= 501; row++) {
      sheet.getCell(`${key}${row}`).dataValidation = {
        type: "list", allowBlank: true, formulae: [`Listas!$${column}$2:$${column}$${lastRow(count)}`],
        // Aviso, no bloqueo: una faena nueva se puede escribir; el resto lo valida la vista previa.
        errorStyle: "warning", showErrorMessage: true, errorTitle: "Valor fuera de la lista", error: "Ese valor no está en la hoja «Listas». La vista previa te dirá si se puede importar.",
      }
    }
  }
  dropdown("A", "C", types.length)
  dropdown("C", "D", brands.length)
  dropdown("D", "G", sites.length)
  dropdown("E", "H", schedules.length)

  const help = workbook.addWorksheet("Instrucciones")
  help.columns = [{ key: "text", width: 110 }]
  for (const line of [
    "Cómo llenar la planilla",
    "• Una fila por equipo, bajo los encabezados de la hoja «Equipos». Obligatorios: Código, Patente, Tipo de equipo, Marca y Faena.",
    "• Patente: formato ABCD-12 o AB-1234. Si el equipo no tiene, escribe «Sin patente»; su patente será igual a su código.",
    "• Tipo de equipo, Marca y Pauta deben ser los de la hoja «Listas». La Marca es de lista cerrada. La pauta debe medirse en la misma unidad que el tipo.",
    "• Faena: si no existe, se creará con ese nombre (si ya existe con otro acento o mayúsculas, se usa la existente).",
    "• Lectura inicial: kilómetros u horas actuales; sirve para calcular la próxima mantención antes del primer registro. Fecha de la lectura: dd-mm-aaaa (si la dejas vacía, hoy).",
    "• Si el código ya existe, la fila actualiza ese equipo: lo que dejes en blanco no se toca. Si el vehículo ya estaba en la flota sin mantención, se incorpora.",
    "• Esta planilla no da de baja ni reactiva equipos, y no cambia la lectura inicial de un equipo que ya tiene registros.",
    `• Hasta ${IMPORT_MAX_ROWS.toLocaleString("es-CL")} filas por archivo. Antes de importar verás una vista previa con las filas válidas y las que traen error.`,
  ]) help.addRow({ text: line })
  help.getRow(1).font = { bold: true, size: 13 }
  help.getColumn("text").alignment = { wrapText: true, vertical: "top" }
  return { base64: await xlsxToBase64(workbook), filename: "plantilla-equipos-mantencion.xlsx" }
}
