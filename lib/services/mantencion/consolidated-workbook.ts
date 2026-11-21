import { createHash } from "node:crypto"
import ExcelJS from "exceljs"
import JSZip from "jszip"
import { actionTypeFromText, specialtiesFromText, type ActionTypeOrUnknown, type Specialty } from "@/lib/mantencion/action-type"
import { plateKey } from "@/lib/mantencion/equipment-identity"
import { nameKey } from "@/lib/mantencion/normalize"
import { loadXlsxTolerant } from "@/lib/reports/xlsx-normalize"
import { cellField, type HistoricalField } from "./historical-workbook"

/**
 * Lector del consolidado de Chome (combustible, mantención e inspección), 2026-11-21, Trinorma.
 *
 * Lee las hojas MANTENCIONES, INSPECCIONES, HALLAZGOS_INSPECCION y PAUTAS_PREVENTIVAS, más
 * EQUIPOS y CALIDAD_DATOS que sólo sirven para clasificar e informar. COMBUSTIBLE y
 * CONTROL_SELLOS no se leen en la Fase 1.
 *
 * Las columnas se buscan por su nombre (no por posición), así que reordenarlas no rompe la carga.
 * Lo que falta o no se entiende no se adivina: una columna obligatoria ausente aborta toda la
 * lectura; una fila ilegible se rechaza con su motivo y queda en el informe.
 */

export const CONSOLIDATED_MAX_BYTES = 30 * 1024 * 1024
/** Tope del XML descomprimido (el consolidado real pesa 3,2 MB comprimido y 26 MB inflado). */
const MAX_UNCOMPRESSED_BYTES = 120 * 1024 * 1024
const MAX_ENTRIES = 2000
const MAX_ROWS_PER_SHEET = 50_000
const MAX_CELL_LENGTH = 100_000

export const CONSOLIDATED_SHEETS = {
  maintenance: "MANTENCIONES",
  inspections: "INSPECCIONES",
  findings: "HALLAZGOS_INSPECCION",
  scheduleChecks: "PAUTAS_PREVENTIVAS",
  equipment: "EQUIPOS",
  quality: "CALIDAD_DATOS",
} as const

export type ConsolidatedSheetKey = "maintenance" | "inspections" | "findings" | "scheduleChecks"

export interface ConsolidatedRejected { sheet: string; rowNumber: number; recordId: string | null; reason: string }

interface RowBase { sourceKey: string; fingerprint: string; sheet: string; rowNumber: number; fields: HistoricalField[]; warnings: string[] }

export interface ConsolidatedMaintenanceRow extends RowBase {
  sourceRecordId: string | null
  originSource: string | null
  /** `YYYY-MM-DD`, igual que las filas que ya cargó el importador del formulario. */
  submittedAt: string
  worksiteText: string
  equipmentText: string
  /** ID_EQUIPO, PATENTE y EQUIPO_ORIGINAL por separado: la identidad usa cada uno. */
  code: string
  plate: string
  originalEquipment: string
  orderText: string
  kindText: string
  readingText: string
  description: string
  entryDate: string | null
  exitDate: string | null
  hoursText: string
  actionType: ActionTypeOrUnknown
  laborHours: number | null
  downtimeDays: number | null
  specialties: Specialty[] | null
  contractText: string | null
  qualityNotes: string | null
  isTest: boolean
}

export interface ConsolidatedInspectionRow extends RowBase {
  sourceRecordId: string | null
  inspectionId: string
  /** Marca temporal al segundo, `YYYY-MM-DD HH:MM:SS`. */
  submittedAt: string
  inspectionDate: string
  formKind: string
  unitKind: string
  equipmentText: string
  code: string
  plate: string
  worksiteText: string
  reading: number | null
  goodCount: number
  regularCount: number
  badCount: number
  missingCount: number
  notApplicableCount: number
  /** Más de una fila con la misma clave derivada: se agregó un número de orden y se informa. */
  keyCollision: boolean
}

/** Un hallazgo no guarda la fila original: su inspección ya la guarda. */
export interface ConsolidatedFindingRow {
  /** sha256(clave de la inspección + «\n» + sección + «\n» + ítem); con número de orden si se repite. */
  sourceKey: string
  sheet: string
  rowNumber: number
  inspectionSourceKey: string
  foundOn: string
  section: string
  item: string
  condition: "regular" | "mal" | "no_tiene"
  keyCollision: boolean
}

export interface ConsolidatedScheduleRow extends RowBase {
  /** Marca temporal al segundo, `YYYY-MM-DD HH:MM:SS`. */
  submittedAt: string
  performedOn: string | null
  formKind: string
  scheduleLabel: string
  equipmentText: string
  code: string
  plate: string
  worksiteText: string
  reading: number | null
  doneCount: number
  notDoneCount: number
  notApplicableCount: number
  compliance: number | null
  isTest: boolean
  keyCollision: boolean
}

export interface ConsolidatedEquipmentRow { rowNumber: number; code: string; plate: string; category: string; type: string; notEquipment: boolean }
export interface ConsolidatedQualityRow { source: string; problem: string; count: number | null }

export interface ConsolidatedData {
  maintenance: ConsolidatedMaintenanceRow[]
  inspections: ConsolidatedInspectionRow[]
  findings: ConsolidatedFindingRow[]
  scheduleChecks: ConsolidatedScheduleRow[]
  equipment: ConsolidatedEquipmentRow[]
  quality: ConsolidatedQualityRow[]
  /** Filas que el lector descartó con su motivo (fecha ilegible, clave repetida, hallazgo sin inspección…). */
  rejected: ConsolidatedRejected[]
  /** Hojas que no se encontraron y avisos de lectura (hoja opcional ausente, tabla de detalle ignorada…). */
  notes: string[]
}
export type ConsolidatedParse = { ok: true; data: ConsolidatedData } | { ok: false; message: string }

const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const compactKey = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "")

/* ── Lectura de celdas ───────────────────────────────────────────────────── */

type Raw = Date | number | string | boolean | null

/** Valor de la celda sin envoltorios: resultado de fórmula, texto con formato o enlace. Vacío = `null`. */
function rawValue(cell: ExcelJS.Cell): Raw {
  let value: unknown = cell.value
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const wrapped = value as { result?: unknown; text?: unknown; richText?: Array<{ text: string }>; error?: unknown }
    if ("result" in wrapped && wrapped.result != null) value = wrapped.result
    else if ("richText" in wrapped && Array.isArray(wrapped.richText)) value = wrapped.richText.map((part) => part.text).join("")
    else if (typeof wrapped.text === "string") value = wrapped.text
    else value = null
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "boolean") return value
  if (typeof value === "string") return value.trim() === "" ? null : value
  return null
}

const text = (value: Raw): string => {
  if (value === null) return ""
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).trim()
}

/** `YYYY-MM-DD`. Excel guarda fechas sin zona horaria; se leen en UTC para conservar el calendario de la celda. */
function toDate(value: Raw): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value !== "string") return null
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\D.*)?$/.exec(value.trim())
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:\D.*)?$/.exec(value.trim())
  const parts = dmy ? [dmy[3], dmy[2], dmy[1]] : iso ? [iso[1], iso[2], iso[3]] : null
  if (!parts) return null
  const [year, month, day] = parts.map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/** `YYYY-MM-DD HH:MM:SS`, truncada al segundo. Sin hora no hay marca temporal: `null`. */
function toTimestamp(value: Raw): string | null {
  if (value instanceof Date) return value.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "")
  if (typeof value !== "string") return null
  const date = toDate(value)
  const time = /(?:\s|T)(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value)
  if (!date || !time) return null
  const h = Number(time[1]); const m = Number(time[2]); const s = Number(time[3] ?? 0)
  if (h > 23 || m > 59 || s > 59) return null
  return `${date} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function toNumber(value: Raw): number | null {
  if (typeof value === "number") return value
  if (typeof value === "string" && /^-?\d+(?:[.,]\d+)?$/.test(value.trim())) return Number(value.trim().replace(",", "."))
  return null
}

/** Número que cabe en `numeric(precision, scale)` y no es negativo; si no, `null` con su aviso. */
function storableNumber(value: Raw, label: string, scale: number, max: number, warnings: string[]): number | null {
  if (value === null) return null
  const number = toNumber(value)
  if (number === null || number < 0 || number >= max) {
    warnings.push(`${label}: «${typeof value === "string" ? "valor no numérico" : String(value)}» no se puede guardar; queda vacío.`)
    return null
  }
  const factor = 10 ** scale
  return Math.round(number * factor) / factor
}

function count(value: Raw): number {
  const number = toNumber(value)
  return number !== null && number > 0 ? Math.round(number) : 0
}

/* ── Hojas ───────────────────────────────────────────────────────────────── */

interface SheetRow { rowNumber: number; get(header: string): Raw; fields(exclude: (header: string) => boolean): HistoricalField[] }
type Table = { ok: true; rows: SheetRow[]; stoppedAt: number | null; skippedAfter: number } | { ok: false; message: string }

/**
 * Lee la tabla que empieza en la fila 1. `stopAtBlank`: la hoja PAUTAS_PREVENTIVAS trae, bajo
 * la tabla de pautas, otra tabla («Detalle por ítem») separada por filas en blanco; ésa no es
 * una pauta y no se importa.
 */
function readTable(sheet: ExcelJS.Worksheet, required: readonly string[], options: { stopAtBlank?: boolean } = {}): Table {
  if (sheet.rowCount > MAX_ROWS_PER_SHEET || sheet.columnCount > 120) return { ok: false, message: `La hoja ${sheet.name} es demasiado grande.` }
  const headerRow = sheet.getRow(1)
  const headers: string[] = []
  const index = new Map<string, number>()
  for (let column = 1; column <= sheet.columnCount; column++) {
    const header = text(rawValue(headerRow.getCell(column)))
    headers.push(header)
    const key = compactKey(header)
    if (key && !index.has(key)) index.set(key, column)
  }
  const missing = required.filter((header) => !index.has(compactKey(header)))
  if (missing.length) return { ok: false, message: `La hoja ${sheet.name} no tiene las columnas esperadas del consolidado: falta ${missing.join(", ")}.` }
  const rows: SheetRow[] = []
  let stoppedAt: number | null = null
  let skippedAfter = 0
  for (let number = 2; number <= sheet.rowCount; number++) {
    const row = sheet.getRow(number)
    const empty = headers.every((_, i) => rawValue(row.getCell(i + 1)) === null)
    if (stoppedAt !== null) {
      // Filas que quedaron sin leer tras la fila en blanco, para informarlas.
      if (!empty) skippedAfter++
      continue
    }
    if (empty) {
      if (options.stopAtBlank && rows.length) { stoppedAt = number; continue }
      continue
    }
    rows.push({
      rowNumber: number,
      get: (header) => {
        const column = index.get(compactKey(header))
        return column ? rawValue(row.getCell(column)) : null
      },
      fields: (exclude) => headers.flatMap((header, i) => {
        if (!header || exclude(header)) return []
        return [cellField(row.getCell(i + 1), header)]
      }),
    })
  }
  return { ok: true, rows, stoppedAt, skippedAfter }
}

/** Las fotos, imágenes y respaldos son enlaces a archivos de terceros: no se guardan. */
const isEvidenceColumn = (header: string) => /FOTO|IMAGEN|^IMG_|RESPALDO/.test(header.toUpperCase())

function oversize(fields: HistoricalField[]): boolean {
  return fields.some((field) => field.value.length > MAX_CELL_LENGTH || (field.formula?.length ?? 0) > MAX_CELL_LENGTH || (field.hyperlink?.length ?? 0) > MAX_CELL_LENGTH)
}

/* ── Carga del libro ─────────────────────────────────────────────────────── */

/**
 * El consolidado trae gráficos (hoja RESUMEN) y ExcelJS falla al leer ese dibujo
 * («Cannot read properties of undefined (reading 'anchors')»): `loadXlsxTolerant` lo reintenta y
 * tampoco puede. Nada de lo que se importa está en los dibujos, así que se quitan del paquete antes
 * de cargar. `null` si no es un zip válido.
 */
export async function stripDrawings(input: ArrayBuffer | Uint8Array): Promise<Uint8Array | null> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(input)
  } catch {
    return null
  }
  const entries = Object.values(zip.files)
  if (entries.length > MAX_ENTRIES) return null
  let inflated = 0
  for (const entry of entries) inflated += (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
  if (inflated > MAX_UNCOMPRESSED_BYTES) return null
  const drawingSheets = new Set<string>()
  for (const entry of entries) {
    const match = /^\/?xl\/worksheets\/_rels\/(.+)\.rels$/.exec(entry.name)
    if (match && /relationships\/drawing"/.test(await entry.async("string"))) drawingSheets.add(match[1]!)
  }
  if (!drawingSheets.size && !entries.some((entry) => /^\/?xl\/(drawings|charts)\//.test(entry.name))) return input instanceof Uint8Array ? input : new Uint8Array(input)
  for (const entry of entries) {
    const name = entry.name.replace(/^\/+/, "")
    if (/^xl\/(drawings|charts)\//.test(name)) zip.remove(entry.name)
    else if (/^xl\/worksheets\/_rels\/.+\.rels$/.test(name)) {
      // Sólo se quita la relación al dibujo; si la hoja tiene otras (tablas, enlaces) se conservan.
      const xml = await entry.async("string")
      zip.file(entry.name, xml.replace(/<Relationship\b[^>]*relationships\/drawing"[^>]*\/>/g, ""))
    } else if (/^xl\/worksheets\/[^/]+\.xml$/.test(name)) {
      const xml = await entry.async("string")
      if (/<(?:\w+:)?drawing\b/.test(xml)) zip.file(entry.name, xml.replace(/<(?:\w+:)?drawing\b[^>]*\/>/g, ""))
    } else if (name === "[Content_Types].xml") {
      const xml = await entry.async("string")
      zip.file(entry.name, xml.replace(/<Override\b[^>]*PartName="\/xl\/(?:drawings|charts)\/[^"]*"[^>]*\/>/g, ""))
    }
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })
}

async function loadConsolidated(buffer: ArrayBuffer | Uint8Array): Promise<ExcelJS.Workbook | null> {
  const stripped = await stripDrawings(buffer)
  if (!stripped) return null
  return loadXlsxTolerant(stripped)
}

/* ── Parser ──────────────────────────────────────────────────────────────── */

const MAINTENANCE_HEADERS = ["ID_REGISTRO", "ID_EQUIPO", "PATENTE", "EQUIPO_ORIGINAL", "FUENTE", "MARCA_TEMPORAL", "FAENA", "CONTRATO", "OT", "TIPO_ACCION", "TIPO_TRABAJO", "ODOMETRO_HOROMETRO", "TRABAJO_REALIZADO", "F_INGRESO", "F_SALIDA", "HORAS_TRABAJADAS", "DIAS_DETENIDO", "OBS_CALIDAD", "POSIBLE_PRUEBA", "CORREO"]
const INSPECTION_HEADERS = ["ID_INSPECCION", "N_FORMULARIO", "MARCA_TEMPORAL", "FECHA", "FORMULARIO", "TIPO_UNIDAD", "PATENTE_ORIGINAL", "PATENTE", "ID_EQUIPO", "FAENA_GRUPO", "KM_INSPECCION", "BUEN_ESTADO", "REGULAR", "MAL_ESTADO", "NO_TIENE", "NO_APLICA"]
const FINDING_HEADERS = ["ID_INSPECCION", "SECCION", "ITEM", "ESTADO", "NIVEL"]
const SCHEDULE_HEADERS = ["FORMULARIO", "ES_PRUEBA", "FECHA", "MARCA_TEMPORAL", "FAENA", "PATENTE", "ID_EQUIPO", "ODOMETRO_HOROMETRO", "PAUTA", "REALIZADO", "NO_REALIZADO", "NO_APLICA", "%_CUMPLIMIENTO"]

const equipmentLabel = (code: string, plate: string) => [code, plate].filter(Boolean).join(" / ")

/** Primera aparición = la clave tal cual; las siguientes llevan un número de orden para no pisarse. */
function uniqueKey(base: string, seen: Map<string, number>): { key: string; collision: boolean } {
  const occurrence = (seen.get(base) ?? 0) + 1
  seen.set(base, occurrence)
  return occurrence === 1 ? { key: hash(base), collision: false } : { key: hash(`${base}\n#${occurrence}`), collision: true }
}

export async function parseConsolidatedWorkbook(buffer: ArrayBuffer | Uint8Array): Promise<ConsolidatedParse> {
  if (buffer.byteLength > CONSOLIDATED_MAX_BYTES) return { ok: false, message: `El archivo supera ${CONSOLIDATED_MAX_BYTES / 1024 / 1024} MB.` }
  const workbook = await loadConsolidated(buffer)
  if (!workbook) return { ok: false, message: "No se pudo leer el archivo Excel." }
  const notes: string[] = []
  const rejected: ConsolidatedRejected[] = []
  const sheetOf = (name: string) => workbook.worksheets.find((sheet) => compactKey(sheet.name) === compactKey(name))

  const required = [CONSOLIDATED_SHEETS.maintenance, CONSOLIDATED_SHEETS.inspections, CONSOLIDATED_SHEETS.findings, CONSOLIDATED_SHEETS.scheduleChecks]
  const absent = required.filter((name) => !sheetOf(name))
  if (absent.length) return { ok: false, message: `El archivo no es el consolidado: faltan las hojas ${absent.join(", ")}.` }

  /* MANTENCIONES */
  const maintenanceTable = readTable(sheetOf(CONSOLIDATED_SHEETS.maintenance)!, MAINTENANCE_HEADERS)
  if (!maintenanceTable.ok) return maintenanceTable
  const maintenance: ConsolidatedMaintenanceRow[] = []
  const maintenanceKeys = new Map<string, number>()
  for (const row of maintenanceTable.rows) {
    const recordId = text(row.get("ID_REGISTRO")) || null
    const reject = (reason: string) => rejected.push({ sheet: CONSOLIDATED_SHEETS.maintenance, rowNumber: row.rowNumber, recordId, reason })
    const stamp = toTimestamp(row.get("MARCA_TEMPORAL"))
    const submittedAt = toDate(row.get("MARCA_TEMPORAL"))
    const email = text(row.get("CORREO")).toLowerCase()
    if (!stamp || !submittedAt) { reject("Falta una marca temporal válida (fecha y hora) para identificar la respuesta."); continue }
    if (!email) { reject("Falta el correo de origen que identifica la respuesta."); continue }
    // Misma identidad que el importador del formulario: las 142 filas que ya están en producción deben coincidir.
    const baseKey = `google-forms\n${stamp}\n${email}`
    const sourceKey = hash(baseKey)
    const previous = maintenanceKeys.get(sourceKey)
    if (previous) { reject(`Misma marca temporal y correo que la fila ${previous}: posible duplicado, no se importó.`); continue }
    maintenanceKeys.set(sourceKey, row.rowNumber)
    const fields = row.fields(isEvidenceColumn)
    if (oversize(fields)) { reject("Una celda es demasiado extensa."); continue }
    const warnings: string[] = []
    const code = text(row.get("ID_EQUIPO"))
    const plate = text(row.get("PATENTE"))
    const originalEquipment = text(row.get("EQUIPO_ORIGINAL"))
    const kindText = text(row.get("TIPO_ACCION"))
    maintenance.push({
      sourceKey, fingerprint: hash(JSON.stringify(fields)), sheet: CONSOLIDATED_SHEETS.maintenance, rowNumber: row.rowNumber, fields, warnings,
      sourceRecordId: recordId, originSource: text(row.get("FUENTE")) || null, submittedAt,
      worksiteText: text(row.get("FAENA")), equipmentText: originalEquipment || equipmentLabel(code, plate), code, plate, originalEquipment,
      orderText: text(row.get("OT")), kindText, readingText: text(row.get("ODOMETRO_HOROMETRO")), description: text(row.get("TRABAJO_REALIZADO")),
      entryDate: toDate(row.get("F_INGRESO")), exitDate: toDate(row.get("F_SALIDA")), hoursText: text(row.get("HORAS_TRABAJADAS")),
      actionType: actionTypeFromText(kindText),
      laborHours: storableNumber(row.get("HORAS_TRABAJADAS"), "HORAS_TRABAJADAS", 2, 1_000_000, warnings),
      downtimeDays: storableNumber(row.get("DIAS_DETENIDO"), "DIAS_DETENIDO", 1, 100_000, warnings),
      specialties: specialtiesFromText(text(row.get("TIPO_TRABAJO"))),
      contractText: text(row.get("CONTRATO")) || null, qualityNotes: text(row.get("OBS_CALIDAD")) || null,
      isTest: text(row.get("POSIBLE_PRUEBA")) !== "",
    })
  }

  /* INSPECCIONES */
  const inspectionTable = readTable(sheetOf(CONSOLIDATED_SHEETS.inspections)!, INSPECTION_HEADERS)
  if (!inspectionTable.ok) return inspectionTable
  const inspections: ConsolidatedInspectionRow[] = []
  const inspectionKeys = new Map<string, number>()
  const inspectionById = new Map<string, { sourceKey: string; inspectionDate: string } | null>()
  for (const row of inspectionTable.rows) {
    const inspectionId = text(row.get("ID_INSPECCION"))
    const reject = (reason: string) => {
      rejected.push({ sheet: CONSOLIDATED_SHEETS.inspections, rowNumber: row.rowNumber, recordId: inspectionId || null, reason })
      if (inspectionId) inspectionById.set(inspectionId, null)
    }
    const stamp = toTimestamp(row.get("MARCA_TEMPORAL"))
    const submittedAt = toDate(row.get("MARCA_TEMPORAL"))
    const inspectionDate = toDate(row.get("FECHA")) ?? submittedAt
    if (!stamp || !submittedAt || !inspectionDate) { reject("Falta una marca temporal o fecha de inspección válida."); continue }
    const unitKind = text(row.get("TIPO_UNIDAD"))
    const plate = text(row.get("PATENTE"))
    const base = `inspeccion\n${stamp}\n${text(row.get("N_FORMULARIO"))}\n${unitKind}\n${plateKey(text(row.get("PATENTE_ORIGINAL")) || plate)}`
    const { key: sourceKey, collision } = uniqueKey(base, inspectionKeys)
    const fields = row.fields(isEvidenceColumn)
    if (oversize(fields)) { reject("Una celda es demasiado extensa."); continue }
    const warnings: string[] = []
    const code = text(row.get("ID_EQUIPO"))
    if (inspectionId) inspectionById.set(inspectionId, { sourceKey, inspectionDate })
    inspections.push({
      sourceKey, fingerprint: hash(JSON.stringify(fields)), sheet: CONSOLIDATED_SHEETS.inspections, rowNumber: row.rowNumber, fields, warnings,
      sourceRecordId: inspectionId || null, inspectionId, submittedAt: stamp, inspectionDate,
      formKind: text(row.get("FORMULARIO")), unitKind, equipmentText: equipmentLabel(code, plate) || text(row.get("PATENTE_ORIGINAL")), code, plate,
      worksiteText: text(row.get("FAENA_GRUPO")),
      reading: storableNumber(row.get("KM_INSPECCION"), "KM_INSPECCION", 1, 1e13, warnings),
      goodCount: count(row.get("BUEN_ESTADO")), regularCount: count(row.get("REGULAR")), badCount: count(row.get("MAL_ESTADO")),
      missingCount: count(row.get("NO_TIENE")), notApplicableCount: count(row.get("NO_APLICA")), keyCollision: collision,
    })
  }

  /* HALLAZGOS_INSPECCION */
  const findingTable = readTable(sheetOf(CONSOLIDATED_SHEETS.findings)!, FINDING_HEADERS)
  if (!findingTable.ok) return findingTable
  const findings: ConsolidatedFindingRow[] = []
  const findingKeys = new Map<string, number>()
  for (const row of findingTable.rows) {
    const inspectionId = text(row.get("ID_INSPECCION"))
    const reject = (reason: string) => rejected.push({ sheet: CONSOLIDATED_SHEETS.findings, rowNumber: row.rowNumber, recordId: inspectionId || null, reason })
    if (!inspectionById.has(inspectionId)) { reject(inspectionId ? `La inspección ${inspectionId} no está en la hoja ${CONSOLIDATED_SHEETS.inspections}.` : "Falta el ID de la inspección."); continue }
    const inspection = inspectionById.get(inspectionId)
    if (!inspection) { reject(`La inspección ${inspectionId} fue rechazada; sus hallazgos no se importaron.`); continue }
    const level = compactKey(text(row.get("NIVEL")) || text(row.get("ESTADO")))
    const condition = level.startsWith("REGULAR") ? "regular" : level.startsWith("MAL") ? "mal" : level.startsWith("NOTIENE") ? "no_tiene" : null
    if (!condition) { reject("El estado del ítem no es Regular, Mal ni No tiene."); continue }
    const section = text(row.get("SECCION"))
    const item = text(row.get("ITEM"))
    if (!item) { reject("Falta el nombre del ítem."); continue }
    const { key: sourceKey, collision } = uniqueKey(`${inspection.sourceKey}\n${section}\n${item}`, findingKeys)
    findings.push({
      sourceKey, sheet: CONSOLIDATED_SHEETS.findings, rowNumber: row.rowNumber,
      inspectionSourceKey: inspection.sourceKey, foundOn: inspection.inspectionDate, section, item, condition, keyCollision: collision,
    })
  }

  /* PAUTAS_PREVENTIVAS */
  const scheduleTable = readTable(sheetOf(CONSOLIDATED_SHEETS.scheduleChecks)!, SCHEDULE_HEADERS, { stopAtBlank: true })
  if (!scheduleTable.ok) return scheduleTable
  if (scheduleTable.stoppedAt) notes.push(`${CONSOLIDATED_SHEETS.scheduleChecks}: la lectura se detuvo en la fila ${scheduleTable.stoppedAt} (fila en blanco). Lo que sigue es una tabla de detalle por ítem, que no se importa: ${scheduleTable.skippedAfter} filas con datos quedaron sin importar (incluyen el título y el encabezado de esa tabla).`)
  const scheduleChecks: ConsolidatedScheduleRow[] = []
  const scheduleKeys = new Map<string, number>()
  for (const row of scheduleTable.rows) {
    const reject = (reason: string) => rejected.push({ sheet: CONSOLIDATED_SHEETS.scheduleChecks, rowNumber: row.rowNumber, recordId: null, reason })
    const stamp = toTimestamp(row.get("MARCA_TEMPORAL"))
    const submittedAt = toDate(row.get("MARCA_TEMPORAL"))
    if (!stamp || !submittedAt) { reject("Falta una marca temporal válida para identificar la pauta."); continue }
    const plate = text(row.get("PATENTE"))
    const scheduleLabel = text(row.get("PAUTA"))
    const { key: sourceKey, collision } = uniqueKey(`pauta\n${stamp}\n${plateKey(plate)}\n${scheduleLabel}`, scheduleKeys)
    const fields = row.fields(isEvidenceColumn)
    if (oversize(fields)) { reject("Una celda es demasiado extensa."); continue }
    const warnings: string[] = []
    const done = count(row.get("REALIZADO"))
    const notDone = count(row.get("NO_REALIZADO"))
    const declared = toNumber(row.get("%_CUMPLIMIENTO"))
    let compliance: number | null = null
    if (declared !== null && declared >= 0 && declared <= 1) compliance = Math.round(declared * 10_000) / 10_000
    else if (declared !== null) warnings.push("%_CUMPLIMIENTO fuera de 0 a 1; se calculó con los ítems realizados y no realizados.")
    if (compliance === null && done + notDone > 0) compliance = Math.round((done / (done + notDone)) * 10_000) / 10_000
    const code = text(row.get("ID_EQUIPO"))
    const test = text(row.get("ES_PRUEBA"))
    scheduleChecks.push({
      sourceKey, fingerprint: hash(JSON.stringify(fields)), sheet: CONSOLIDATED_SHEETS.scheduleChecks, rowNumber: row.rowNumber, fields, warnings,
      submittedAt: stamp, performedOn: toDate(row.get("FECHA")), formKind: text(row.get("FORMULARIO")), scheduleLabel,
      equipmentText: equipmentLabel(code, plate), code, plate, worksiteText: text(row.get("FAENA")),
      reading: storableNumber(row.get("ODOMETRO_HOROMETRO"), "ODOMETRO_HOROMETRO", 1, 1e13, warnings),
      doneCount: done, notDoneCount: notDone, notApplicableCount: count(row.get("NO_APLICA")), compliance,
      // ES_PRUEBA distinto de «No» es prueba; vacío no se puede afirmar como prueba y se importa como pauta real.
      isTest: test !== "" && nameKey(test) !== "no", keyCollision: collision,
    })
  }

  /* EQUIPOS y CALIDAD_DATOS (sólo para clasificar e informar) */
  const equipment: ConsolidatedEquipmentRow[] = []
  const equipmentSheet = sheetOf(CONSOLIDATED_SHEETS.equipment)
  if (equipmentSheet) {
    const table = readTable(equipmentSheet, ["ID_EQUIPO", "PATENTE", "CATEGORIA"])
    if (!table.ok) return table
    for (const row of table.rows) {
      const category = text(row.get("CATEGORIA"))
      equipment.push({ rowNumber: row.rowNumber, code: text(row.get("ID_EQUIPO")), plate: text(row.get("PATENTE")), category, type: text(row.get("TIPO")), notEquipment: nameKey(category).startsWith("no es equipo") })
    }
    // Hace auditable el rechazo de «lo que no es equipo»: cuántas filas de EQUIPOS lo son (sin copiar
    // sus textos, que pueden ser nombres de personas). Las filas de mantención que apunten a ellas se
    // cuentan como rechazadas en su hoja.
    const notEquipmentRows = equipment.filter((row) => row.notEquipment).length
    notes.push(`${CONSOLIDATED_SHEETS.equipment}: ${notEquipmentRows} de ${equipment.length} filas tienen categoría «No es equipo»; se usan para rechazar las filas de las otras hojas que las nombren.`)
  } else notes.push(`No se encontró la hoja ${CONSOLIDATED_SHEETS.equipment}: no se pudo clasificar lo que no es equipo ni cotejar la flota.`)
  const quality: ConsolidatedQualityRow[] = []
  const qualitySheet = sheetOf(CONSOLIDATED_SHEETS.quality)
  if (qualitySheet) {
    const table = readTable(qualitySheet, ["FUENTE", "PROBLEMA", "CANTIDAD"])
    if (table.ok) for (const row of table.rows) quality.push({ source: text(row.get("FUENTE")), problem: text(row.get("PROBLEMA")), count: toNumber(row.get("CANTIDAD")) })
  }

  return { ok: true, data: { maintenance, inspections, findings, scheduleChecks, equipment, quality, rejected, notes } }
}
