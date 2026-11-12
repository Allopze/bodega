import ExcelJS from "exceljs"
import { loadXlsxTolerant } from "@/lib/reports/xlsx-normalize"
import { db, type Tx } from "@/db"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { cleanName, findByNameKey, nameKey, normalizeCode, normalizePlate, parseLocaleNumber } from "@/lib/mantencion/normalize"
import { EXCEL_DATE_FORMAT } from "@/lib/reports/excel-dates"
import { xlsxToBase64 } from "@/lib/reports/export-module/excel-builder"
import type { MantActionResult } from "./result"
import { actorEquipmentScope, isWorksiteInScope } from "./access"
import { applyCreate, applyUpdate } from "./equipment"
import { diffEquipmentFields, summarizeChanges, type MantActor } from "./equipment-history"
import type { MantWorksiteScope } from "./fleet"
import {
  findIdentityByCode, loadEquipmentCatalogs, loadEquipmentCurrents, NEW_WORKSITE, resolveEquipment,
  type EquipmentCatalogs, type EquipmentCurrent, type EquipmentInput, type ResolvedEquipment, type VehicleIdentity,
} from "./equipment-resolve"
import { styleHeaderRow } from "./export-equipment"
import { ensureCatalogEntry } from "./catalogs"
import { listIncorporationCandidates } from "./fleet-incorporation"
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
  // Tolera planillas con el espacio de nombres prefijado (OpenXML SDK): la plantilla
  // completada con una de esas herramientas se rechazaba como si no fuera un Excel.
  const workbook = await loadXlsxTolerant(buffer)
  if (!workbook) return { ok: false, message: "No se pudo leer el archivo: sube una planilla de Excel (.xlsx), como la plantilla." }
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

/** `dd-mm-aaaa`, `dd/mm/aaaa` o `aaaa-mm-dd` → `aaaa-mm-dd`. */
function parseDateText(text: string): string | null | "invalid" {
  if (!text) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text)
  return match ? `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}` : "invalid"
}

/** `skipped` = «No aplica»: la fila es válida pero no corresponde a Mantención (tipo sin medidor). No bloquea. */
export type ImportRowKind = "create" | "incorporate" | "update" | "unchanged" | "skipped" | "error"

export interface ImportRowResult {
  row: number
  code: string
  kind: ImportRowKind
  /** Resumen del equipo («Camión · Scania · Arauco») para reconocer la fila. */
  label: string
  /** Motivos de error, o los cambios sobre un equipo existente. */
  messages: string[]
  /** Avisos que no impiden importar la fila (p. ej. una lectura inicial que se conserva). */
  notices?: string[]
}

export interface ImportSummary {
  /** Filas con error al confirmar (la confirmación revalida: pueden diferir de la vista previa). */
  errorRows?: ImportRowResult[]
  total: number
  created: number
  incorporated: number
  updated: number
  unchanged: number
  skipped: number
  errors: number
  newWorksites: string[]
  /** Marcas que no están en la lista: en la vista previa, las que se crearían; al confirmar, las creadas. */
  newBrands: string[]
  /** Marca nueva → la existente que se le parece («Mercedes Benz» → «Mercedes»): probable error de escritura. */
  newBrandHints?: Record<string, string>
}

export interface ImportPreview { rows: ImportRowResult[]; summary: ImportSummary }

type PlanItem =
  | { kind: "error"; result: ImportRowResult }
  | { kind: "skipped"; result: ImportRowResult }
  | { kind: "unchanged"; result: ImportRowResult }
  | { kind: "create" | "incorporate"; result: ImportRowResult; resolved: ResolvedEquipment; incorporate: VehicleIdentity | null }
  | { kind: "update"; result: ImportRowResult; resolved: ResolvedEquipment; current: EquipmentCurrent }

const SIN_PATENTE = "sin patente"

/** Vehículo cuya patente (normalizada) coincide con la de la fila. */
function findIdentityByPlate(identities: readonly VehicleIdentity[], rawPlate: string): VehicleIdentity | null {
  const key = normalizePlate(rawPlate)
  if (!key) return null
  return identities.find((item) => (normalizePlate(item.plate) ?? normalizeCode(item.plate)) === key) ?? null
}

/**
 * Lo que la fila querría cambiar de la FLOTA en un vehículo que ya existe.
 * Faena, patente y tipo son datos de la flota compartida: la planilla de
 * Mantención no los cambia (decisión 2026-11-11, auditoría I-1/I-2). Un
 * traslado se hace en la ficha, que exige administrar la faena de origen y la
 * de destino. Se revisa ANTES de resolver: así una faena mal escrita nunca
 * llega a crearse.
 */
function fleetConflicts(raw: RawImportRow, code: string, fleet: VehicleIdentity, catalogs: EquipmentCatalogs): string[] {
  const messages: string[] = []
  if (raw.worksite && fleet.worksiteId) {
    const typed = findByNameKey(catalogs.worksites, raw.worksite)
    if (typed?.id !== fleet.worksiteId) {
      const currentName = catalogs.worksites.find((item) => item.id === fleet.worksiteId)?.name ?? "otra"
      messages.push(`La faena de ${code} es ${currentName}: la planilla no traslada equipos. Para moverlo, usa su ficha.`)
    }
  }
  if (raw.type && fleet.equipmentTypeId) {
    const typed = catalogs.types.find((item) => nameKey(item.name) === nameKey(raw.type))
    if (typed && typed.id !== fleet.equipmentTypeId) {
      const currentName = catalogs.types.find((item) => item.id === fleet.equipmentTypeId)?.name ?? "otro tipo"
      messages.push(`${code} es «${currentName}» en la flota: la planilla no cambia el tipo. Cámbialo en su ficha.`)
    }
  }
  if (raw.plate) {
    const typed = nameKey(raw.plate) === SIN_PATENTE ? code : (normalizePlate(raw.plate) ?? normalizeCode(raw.plate))
    const current = normalizePlate(fleet.plate) ?? normalizeCode(fleet.plate)
    if (typed !== current) messages.push(`La patente de ${code} es ${fleet.plate}: la planilla no la cambia. Corrígela en su ficha.`)
  }
  return messages
}

/** Arma el `EquipmentInput` de una fila: la fila gana; lo que viene en blanco conserva la ficha (o la flota). */
function inputFromRow(raw: RawImportRow, current: EquipmentCurrent | null, fleet: VehicleIdentity | null, catalogs: EquipmentCatalogs) {
  const pre: Record<string, string> = {}
  const keep = current?.fields
  let typeId = fleet?.equipmentTypeId ?? ""
  if (!typeId) {
    const typeText = raw.type || keep?.type || ""
    const type = typeText ? catalogs.types.find((item) => item.isActive && nameKey(item.name) === nameKey(typeText)) : undefined
    if (typeText && !type) pre.equipmentTypeId = `El tipo «${typeText}» no existe. Revisa la hoja «Listas» de la plantilla.`
    typeId = type?.id ?? ""
  }
  const brandText = raw.brand || keep?.brand || ""
  const brand = brandText ? catalogs.brands.find((item) => item.isActive && nameKey(item.name) === nameKey(brandText)) : undefined
  if (brandText && !brand) pre.brandId = `La marca «${brandText}» no está en la lista de marcas. Agrégala en Mantención › Catálogos o marca «Crear estas marcas».`
  const scheduleText = raw.schedule || keep?.schedule || ""
  const schedule = scheduleText && nameKey(scheduleText) !== "sin pauta"
    ? catalogs.schedules.find((item) => nameKey(item.name) === nameKey(scheduleText))
    : undefined
  if (scheduleText && nameKey(scheduleText) !== "sin pauta" && !schedule) pre.scheduleId = `La pauta «${scheduleText}» no existe.`

  // Al incorporar, lo que la fila deja en blanco se conserva de la flota (antes se borraba el modelo y el año).
  const keepYear = keep ? keep.year : fleet?.year ?? null
  const yearText = raw.year || (keepYear != null ? String(keepYear) : "")
  const year = yearText ? Number(yearText) : null
  if (yearText && !/^\d{4}$/.test(yearText)) pre.year = "Año no válido."
  const reading = raw.readingNumber ?? (raw.reading ? parseLocaleNumber(raw.reading) : (keep?.initialReading ?? null))
  if (reading === "invalid") pre.initialReading = "La lectura debe ser un número."
  const date = parseDateText(raw.readingDate)
  if (date === "invalid") pre.initialReadingDate = "Escribe la fecha como dd-mm-aaaa."

  const noPlate = raw.plate ? nameKey(raw.plate) === SIN_PATENTE : (keep?.noPlate ?? false)
  const input: EquipmentInput = {
    code: raw.code,
    plate: noPlate ? "" : raw.plate || keep?.plate || fleet?.plate || "",
    noPlate,
    equipmentTypeId: typeId,
    brandId: brand?.id ?? "",
    model: raw.model || (keep ? keep.model : fleet?.model) || "",
    year: year !== null && Number.isInteger(year) ? year : null,
    // Un vehículo que ya existe conserva su faena: va por id, no por nombre.
    worksiteId: fleet?.worksiteId ?? NEW_WORKSITE,
    newWorksiteName: fleet?.worksiteId ? "" : raw.worksite || keep?.worksite || "",
    scheduleId: schedule?.id ?? null,
    initialReading: reading === "invalid" ? null : reading,
    initialReadingDate: date === "invalid" ? null : date,
  }
  return { input, pre }
}

/**
 * Qué hacer con una faena o una marca que no existe:
 * - `preview`: se anuncia (vista previa) y la fila cuenta como válida;
 * - `create`: se crea (confirmación con la casilla marcada, sólo alcance total);
 * - `forbid`: la fila queda con error (sin la casilla, o sin alcance total).
 * Antes la importación creaba faenas en silencio: con la planilla real habría
 * creado «Sin ubicación», «Servimar» o «Calymag» (2026-11-11).
 */
export type NewEntryMode = "preview" | "create" | "forbid"

/** Nombres que significan «no sé dónde está»: nunca se crean como faena. */
const PLACEHOLDER_WORKSITES = new Set(["sin ubicacion", "sin faena", "sin asignar", "por asignar", "no aplica"])

/** Id provisorio de una marca nueva en la vista previa (nunca se escribe). */
const PENDING_BRAND = "nueva-marca:"

interface PlanContext {
  catalogs: EquipmentCatalogs
  currents: Map<string, EquipmentCurrent>
  createWorksite?: (name: string) => Promise<{ id: string; name: string }>
  createBrand?: (name: string) => Promise<{ id: string; name: string }>
  newWorksites: NewEntryMode
  newBrands: NewEntryMode
  /** Faenas que puede administrar quien importa: una fila sobre otra se rechaza en vez de escribirse. */
  scope: MantWorksiteScope
}

async function planImport(client: Pick<Tx, "select">, rows: RawImportRow[], context: PlanContext): Promise<PlanItem[]> {
  const { catalogs, currents } = context
  const plan: PlanItem[] = []
  const seen = new Map<string, number>()
  const fail = (raw: RawImportRow, messages: string[]): PlanItem => ({
    kind: "error", result: { row: raw.row, code: normalizeCode(raw.code), kind: "error", label: "", messages },
  })

  for (const original of rows) {
    const raw = { ...original }
    const code = normalizeCode(raw.code)
    if (!code) { plan.push(fail(raw, ["Falta el código del equipo."])); continue }
    const firstRow = seen.get(code)
    if (firstRow) { plan.push(fail(raw, [`El código ${code} ya aparece en la fila ${firstRow} de la planilla.`])); continue }
    seen.set(code, raw.row)

    const identity = findIdentityByCode(catalogs.identities, code)
    // Un vehículo de la flota se reconoce por código o, si el código es nuevo, por patente.
    const byPlate = !identity && raw.plate && nameKey(raw.plate) !== SIN_PATENTE ? findIdentityByPlate(catalogs.identities, raw.plate) : null
    if (byPlate?.code && normalizeCode(byPlate.code) !== code) {
      plan.push(fail(raw, [`La patente ${byPlate.plate} es del equipo ${byPlate.code} en la flota: usa ese código en la fila.`]))
      continue
    }
    const existing = identity ?? byPlate
    // Sólo cuenta como «de la flota» un vehículo guardado (las altas de este mismo archivo no tienen faena todavía).
    const fleet = existing?.worksiteId ? existing : null
    const current = identity?.hasProfile ? currents.get(identity.id) ?? null : null
    if (current && !current.active) {
      plan.push(fail(raw, [`El equipo ${code} está dado de baja: reactívalo desde su ficha antes de actualizarlo.`]))
      continue
    }
    // «Sin ubicación» y similares: en un vehículo que ya existe es como dejarla en blanco; en uno nuevo, falta la faena.
    if (raw.worksite && PLACEHOLDER_WORKSITES.has(nameKey(raw.worksite))) {
      if (fleet || current) raw.worksite = ""
      else { plan.push(fail(raw, [`«${raw.worksite}» no es una faena: escribe la faena real del equipo.`])); continue }
    }
    // Tipos sin odómetro ni horómetro (carros, bateas, camas bajas): no llevan pauta. Aviso, no error.
    const typeRow = fleet?.equipmentTypeId
      ? catalogs.types.find((item) => item.id === fleet.equipmentTypeId)
      : (raw.type ? catalogs.types.find((item) => nameKey(item.name) === nameKey(raw.type)) : undefined)
    if (typeRow && !typeRow.unit && !current) {
      plan.push({ kind: "skipped", result: {
        row: raw.row, code, kind: "skipped", label: typeRow.name,
        messages: [`No aplica: «${typeRow.name}» no se mide en kilómetros ni en horas, así que no lleva pauta de mantención. Sus vencimientos se ven en Flota.`],
      } })
      continue
    }
    if (fleet) {
      // Alcance de ORIGEN: la faena que el vehículo tiene hoy (auditoría I-1/I-2).
      if (!isWorksiteInScope(context.scope, fleet.worksiteId)) {
        plan.push(fail(raw, ["Ese equipo es de una faena que no administras: no puedes importarlo."]))
        continue
      }
      const conflicts = fleetConflicts(raw, code, fleet, catalogs)
      if (conflicts.length) { plan.push(fail(raw, conflicts)); continue }
    }
    // Marca que no está en la lista: se anuncia, se crea o es error según el modo (B2).
    const brandText = raw.brand || current?.fields.brand || ""
    if (brandText && cleanName(brandText).length < 2) { plan.push(fail(raw, [`La marca «${brandText}» es demasiado corta.`])); continue }
    if (brandText && context.newBrands !== "forbid" && !catalogs.brands.some((item) => item.isActive && nameKey(item.name) === nameKey(brandText))) {
      const inactive = catalogs.brands.find((item) => nameKey(item.name) === nameKey(brandText))
      if (inactive) { plan.push(fail(raw, [`La marca «${inactive.name}» está desactivada. Actívala en Mantención › Catálogos.`])); continue }
      if (context.newBrands === "create" && context.createBrand) {
        const created = await context.createBrand(cleanName(brandText))
        catalogs.brands.push({ id: created.id, name: created.name, isActive: true })
      } else {
        catalogs.brands.push({ id: `${PENDING_BRAND}${nameKey(brandText)}`, name: cleanName(brandText), isActive: true })
      }
    }
    const { input, pre } = inputFromRow(raw, current, fleet, catalogs)
    const hasPre = Object.keys(pre).length > 0
    // Con errores de lectura de la fila no se crea la faena nueva: la fila no se va a importar.
    const resolved = await resolveEquipment(client, input, {
      current, catalogs, keepWorksiteId: fleet?.worksiteId ?? null, ignoreLockedInitialReading: true,
      createWorksite: hasPre || context.newWorksites !== "create" ? undefined : context.createWorksite,
    })
    if (!resolved.ok) {
      plan.push(fail(raw, Object.values({ ...resolved.fieldErrors, ...pre })))
      continue
    }
    if (hasPre) { plan.push(fail(raw, Object.values(pre))); continue }

    const value = resolved.value
    const notices = resolved.notices.length ? resolved.notices : undefined
    if (value.worksite.id === null && context.scope === "all" && context.newWorksites === "forbid") {
      plan.push(fail(raw, [`La faena «${value.worksite.name}» no existe: marca «Crear estas faenas» o corrige el nombre.`]))
      continue
    }
    // La faena de la fila (o la que se crearía) tiene que caer en el alcance de quien importa.
    if (!isWorksiteInScope(context.scope, value.worksite.id)) {
      plan.push(fail(raw, [value.worksite.id
        ? "Ese equipo es de una faena que no administras: no puedes importarlo."
        : "Esa faena no existe y no puedes crearla: no administras esa faena."]))
      continue
    }
    // El vehículo que `resolveEquipment` decidió incorporar puede no ser el que se emparejó
    // antes (p. ej. «Sin patente»: la patente pasa a ser el código y choca con otro de la
    // flota). Se le aplican las mismas reglas: alcance de origen y datos de flota fijos.
    const target = resolved.incorporate
    if (target && target.id !== fleet?.id && target.worksiteId) {
      if (!isWorksiteInScope(context.scope, target.worksiteId)) {
        plan.push(fail(raw, ["Ese equipo es de una faena que no administras: no puedes importarlo."]))
        continue
      }
      const moved = value.worksite.id !== target.worksiteId || value.type.id !== target.equipmentTypeId
      const recoded = !!target.code && normalizeCode(target.code) !== code
      if (moved || recoded) {
        plan.push(fail(raw, [`La patente ${target.plate} ya es del equipo ${target.code ?? target.plate} en la flota: usa su código, su faena y su tipo, o corrige la fila.`]))
        continue
      }
    }
    const label = [value.type.name, value.brand.name, value.worksite.name].filter(Boolean).join(" · ")
    if (!current) {
      const incorporate = resolved.incorporate
      if (incorporate) Object.assign(incorporate, { code: value.code, plate: value.plate, hasProfile: true })
      else {
        catalogs.identities.push({
          id: `import-fila-${raw.row}`, code: value.code, plate: value.plate, isActive: true, hasProfile: true,
          worksiteId: null, equipmentTypeId: null,
        })
      }
      plan.push({
        kind: incorporate ? "incorporate" : "create", resolved: value, incorporate,
        result: { row: raw.row, code, kind: incorporate ? "incorporate" : "create", label, messages: [], notices },
      })
      continue
    }
    const changes = diffEquipmentFields(current.fields, value.fields)
    if (identity) Object.assign(identity, { code: value.code, plate: value.plate })
    const entries = Object.entries(changes)
    if (entries.length === 0) {
      plan.push({ kind: "unchanged", result: { row: raw.row, code, kind: "unchanged", label, messages: [], notices } })
    } else {
      plan.push({
        kind: "update", resolved: value, current,
        result: { row: raw.row, code, kind: "update", label, messages: entries.map(([field, change]) => summarizeChanges({ [field]: change })), notices },
      })
    }
  }
  return plan
}

/** Distancia de edición (Levenshtein) entre dos claves cortas. */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]!
}

/**
 * La existente que probablemente quiso escribir: una contiene a la otra como
 * palabra inicial («Mercedes Benz» ~ «Mercedes», «Ford» ~ «Ford Cargo») o están
 * a 1–2 letras («Sinotruck» ~ «Sinotruk»). `null` si no hay una sola candidata clara.
 */
export function similarName(typed: string, existing: readonly string[]): string | null {
  const key = nameKey(typed).replace(/[^a-z0-9 ]/g, "")
  const hits = existing.filter((name) => {
    const other = nameKey(name).replace(/[^a-z0-9 ]/g, "")
    if (!other || other === key) return false
    if (other.startsWith(`${key} `) || key.startsWith(`${other} `)) return true
    return Math.min(key.length, other.length) >= 4 && editDistance(key, other) <= (Math.max(key.length, other.length) >= 8 ? 2 : 1)
  })
  return hits.length === 1 ? hits[0]! : null
}

function summarize(plan: PlanItem[]): ImportSummary {
  const count = (kind: ImportRowKind) => plan.filter((item) => item.kind === kind).length
  const newWorksites = new Map<string, string>()
  const newBrands = new Map<string, string>()
  for (const item of plan) {
    if (!("resolved" in item)) continue
    if (item.resolved.worksite.id === null) newWorksites.set(nameKey(item.resolved.worksite.name), item.resolved.worksite.name)
    if (item.resolved.brand.id.startsWith(PENDING_BRAND)) newBrands.set(nameKey(item.resolved.brand.name), item.resolved.brand.name)
  }
  return {
    total: plan.length, created: count("create"), incorporated: count("incorporate"), updated: count("update"),
    unchanged: count("unchanged"), skipped: count("skipped"), errors: count("error"),
    newWorksites: [...newWorksites.values()], newBrands: [...newBrands.values()],
  }
}

/** Vista previa: qué se crearía, qué cambiaría y qué filas traen error. No escribe nada. */
export async function previewEquipmentImport(buffer: ArrayBuffer, scope: MantWorksiteScope = "all"): Promise<MantActionResult<ImportPreview>> {
  const parsed = await parseEquipmentWorkbook(buffer)
  if (!parsed.ok) return { ok: false, message: parsed.message }
  const catalogs = await loadEquipmentCatalogs(db)
  const currents = new Map((await loadEquipmentCurrents(db)).map((item) => [item.vehicleId, item]))
  // Faenas y marcas nuevas: sólo quien ve todas las faenas puede crearlas; a los demás se les informa como error.
  const mode: NewEntryMode = scope === "all" ? "preview" : "forbid"
  const existingBrands = catalogs.brands.filter((brand) => brand.isActive).map((brand) => brand.name)
  const plan = await planImport(db, parsed.rows, { catalogs, currents, scope, newWorksites: mode, newBrands: mode })
  const summary = summarize(plan)
  const hints: Record<string, string> = {}
  for (const name of summary.newBrands) {
    const similar = similarName(name, existingBrands)
    if (similar) hints[name] = similar
  }
  if (Object.keys(hints).length) summary.newBrandHints = hints
  return { ok: true, data: { rows: plan.map((item) => item.result), summary } }
}

/** Confirma la importación: vuelve a validar el archivo y escribe las filas válidas en una sola transacción. */
export interface CommitImportOptions {
  /** La persona marcó «Crear estas faenas» en la vista previa. */
  allowNewWorksites?: boolean
  /** La persona marcó «Crear estas marcas» en la vista previa. */
  allowNewBrands?: boolean
}

export async function commitEquipmentImport(
  actor: MantActor,
  buffer: ArrayBuffer,
  fileName: string,
  options: CommitImportOptions = {},
): Promise<MantActionResult<ImportSummary>> {
  const parsed = await parseEquipmentWorkbook(buffer)
  if (!parsed.ok) return { ok: false, message: parsed.message }
  const scope = actorEquipmentScope(actor)
  return db.transaction(async (tx) => {
    const catalogs = await loadEquipmentCatalogs(tx)
    const currents = new Map((await loadEquipmentCurrents(tx)).map((item) => [item.vehicleId, item]))
    const createdWorksites: string[] = []
    const createdBrands: string[] = []
    // Sólo quien ve todas las faenas puede crear faenas o marcas, y sólo si marcó la casilla.
    const canCreate = scope === "all"
    const plan = await planImport(tx, parsed.rows, {
      catalogs, currents, scope,
      newWorksites: canCreate && options.allowNewWorksites ? "create" : "forbid",
      newBrands: canCreate && options.allowNewBrands ? "create" : "forbid",
      createWorksite: async (name) => {
        const worksite = await resolveOrCreateWorksite(tx, { typedName: name, actor: { userId: actor.userId, email: actor.email } })
        if (worksite.created) createdWorksites.push(worksite.name)
        return worksite
      },
      createBrand: async (name) => {
        const brand = await ensureCatalogEntry(tx, "brands", name)
        if (brand.created) createdBrands.push(cleanName(name))
        return { id: brand.id, name: cleanName(name) }
      },
    })
    for (const item of plan) {
      if (item.kind === "create" || item.kind === "incorporate") await applyCreate(tx, actor, item.resolved, item.incorporate, "import")
      else if (item.kind === "update") await applyUpdate(tx, actor, item.current, item.resolved, "import")
    }
    const summary = summarize(plan)
    // Las faenas se crearon durante la validación: se informan las creadas, ya no las pendientes.
    summary.newWorksites = createdWorksites
    summary.newBrands = createdBrands
    summary.errorRows = plan.filter((item) => item.kind === "error").map((item) => item.result)
    const written = summary.created + summary.incorporated + summary.updated
    if (written > 0) {
      await recordAudit({
        userId: actor.userId, userEmail: actor.email ?? undefined, action: "create",
        entityType: "mant_equipment_import", entityId: nanoid(),
        newState: { fileName: cleanName(fileName).slice(0, 120), ...summary, errorRows: undefined },
      }, tx)
    }
    const parts = [
      summary.created ? `${summary.created} ${summary.created === 1 ? "equipo creado" : "equipos creados"}` : "",
      summary.incorporated ? `${summary.incorporated} incorporados desde la flota` : "",
      summary.updated ? `${summary.updated} ${summary.updated === 1 ? "actualizado" : "actualizados"}` : "",
      summary.unchanged ? `${summary.unchanged} sin cambios` : "",
      summary.skipped ? `${summary.skipped} no aplican` : "",
      summary.errors ? `${summary.errors} con error (no se importaron)` : "",
    ].filter(Boolean)
    return { ok: true as const, data: summary, message: parts.length ? parts.join(" · ") : "No había filas para importar." }
  })
}

/**
 * Plantilla descargable. La hoja «Equipos» viene con los vehículos de la flota
 * (del alcance de quien descarga) que aún no están en Mantención: código,
 * patente, tipo y faena llenos y bloqueados —la planilla no los cambia—, y la
 * marca sugerida; sólo falta completar marca, pauta y lectura. Debajo se pueden
 * agregar altas nuevas. Trae además las hojas de instrucciones y valores válidos.
 */
export async function buildEquipmentTemplate(scope: MantWorksiteScope = "all"): Promise<{ base64: string; filename: string }> {
  const catalogs = await loadEquipmentCatalogs(db)
  const candidates = (await listIncorporationCandidates(scope, catalogs)).filter((item) => !item.blocker).slice(0, IMPORT_MAX_ROWS)
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Equipos")
  sheet.columns = COLUMNS.map(({ header, key, width }) => ({ header, key, width }))
  styleHeaderRow(sheet, COLUMNS.length)
  sheet.getColumn("readingDate").numFmt = EXCEL_DATE_FORMAT
  sheet.getColumn("reading").numFmt = "#,##0"
  const brandName = new Map(catalogs.brands.map((brand) => [brand.id, brand.name]))
  const scheduleName = new Map(catalogs.schedules.map((schedule) => [schedule.id, schedule.name]))
  for (const item of candidates) {
    sheet.addRow({
      code: item.code, plate: item.code && normalizeCode(item.plate) === normalizeCode(item.code) ? "Sin patente" : item.plate,
      type: item.typeName, brand: item.suggestedBrandId ? brandName.get(item.suggestedBrandId) : undefined,
      model: item.model ?? undefined, year: item.year ?? undefined, worksite: item.worksiteName,
      schedule: item.suggestedScheduleId ? scheduleName.get(item.suggestedScheduleId) : undefined,
    })
  }
  // Bloqueo: sólo las celdas de la flota en las filas precargadas. El resto (y las filas nuevas) se edita.
  const lastEditableRow = IMPORT_MAX_ROWS + 1
  const fleetLocked = new Set(["A", "B", "C", "G"])
  for (let row = 2; row <= lastEditableRow; row++) {
    for (const column of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]) {
      sheet.getCell(`${column}${row}`).protection = { locked: row <= candidates.length + 1 && fleetLocked.has(column) }
    }
  }
  if (candidates.length > 0) {
    await sheet.protect("", { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true, autoFilter: true })
  }

  const lists = workbook.addWorksheet("Listas")
  const types = catalogs.types.filter((item) => item.isActive && item.unit).sort((a, b) => a.name.localeCompare(b.name, "es"))
  const brands = catalogs.brands.filter((item) => item.isActive).sort((a, b) => a.name.localeCompare(b.name, "es"))
  const sites = catalogs.worksites.filter((item) => item.isActive).sort((a, b) => a.name.localeCompare(b.name, "es"))
  const schedules = [...catalogs.schedules].sort((a, b) => a.name.localeCompare(b.name, "es"))
  const lastRow = (count: number) => Math.max(2, count + 1)
  const unitLabel = (unit: string | null | undefined) => (unit ? (unit === "km" ? "kilómetros" : "horas") : undefined)
  lists.columns = [
    { header: "Tipo de equipo", key: "type", width: 24 }, { header: "Se mide en", key: "unit", width: 12 },
    { header: "Marca", key: "brand", width: 18 }, { header: "Faena", key: "site", width: 22 },
    { header: "Pauta", key: "schedule", width: 26 }, { header: "Pauta se mide en", key: "scheduleUnit", width: 16 },
  ]
  const longest = Math.max(types.length, brands.length, sites.length, schedules.length)
  for (let index = 0; index < longest; index++) {
    lists.addRow({
      type: types[index]?.name, unit: unitLabel(types[index]?.unit),
      brand: brands[index]?.name, site: sites[index]?.name,
      schedule: schedules[index]?.name, scheduleUnit: unitLabel(schedules[index]?.unit),
    })
  }
  styleHeaderRow(lists, 6)
  const dropdown = (column: string, key: string, count: number) => {
    for (let row = 2; row <= lastEditableRow; row++) {
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
    "• Las primeras filas ya traen los vehículos de la flota que aún no están en Mantención: completa su Marca, Pauta y Lectura. Su código, patente, tipo y faena vienen de la flota y no se pueden cambiar aquí.",
    "• Si el código ya existe, la fila actualiza ese equipo: lo que dejes en blanco no se toca. Si el vehículo ya estaba en la flota sin mantención, se incorpora.",
    "• Faena, patente y tipo de un vehículo que ya existe no se cambian con esta planilla: un traslado se hace en la ficha del equipo.",
    "• Para quitarle la pauta a un equipo, escribe «Sin pauta» en la columna Pauta.",
    "• Esta planilla no da de baja ni reactiva equipos, y no cambia la lectura inicial de un equipo que ya tiene registros.",
    `• Hasta ${IMPORT_MAX_ROWS.toLocaleString("es-CL")} filas por archivo. Antes de importar verás una vista previa con las filas válidas y las que traen error.`,
  ]) help.addRow({ text: line })
  help.getRow(1).font = { bold: true, size: 13 }
  help.getColumn("text").alignment = { wrapText: true, vertical: "top" }
  return { base64: await xlsxToBase64(workbook), filename: "plantilla-equipos-mantencion.xlsx" }
}
