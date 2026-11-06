/**
 * scripts/apply-vencimientos-planilla-2026-11.ts
 *
 * Carga única de `Control_vencimientos_Chome_consolidado.xlsx`, el control
 * manual que hasta hoy se llevaba fuera de Chome, y que esta carga deja de
 * necesitar (decisiones del usuario, 2026-11-05):
 *
 * - **La planilla manda** en faena, código interno y fechas de los equipos.
 * - **Carros y bateas entran a Flota**, como tipos de equipo propios (categoría
 *   `other`, sin medidor), de modo que quedan fuera de rendimiento, anomalías y
 *   mantención, que filtran por medidor.
 * - **Una sola faena «Masisa»**: «Masisa maderas» y «Masisa tableros» resuelven
 *   a la faena activa «Masisa».
 * - **Los equipos sin código quedan sin código** (se identifican por patente):
 *   «NO TIENE CODIGO» o una celda vacía es «sin código». «KA.137» es «KA-137».
 * - **Cargos que conducen**: se crea el catálogo de cargos con sus nombres
 *   alternativos, capacidades y clases de licencia que exige cada uno, y se
 *   clasifica a los trabajadores de la planilla según su columna Cargo.
 * - **Licencias**: clase, vencimiento y observación de cada trabajador.
 * - Los trabajadores de la planilla que no están en Chome se crean, activos.
 *
 * El script **lee la planilla al ejecutarse** (`--file`): RUT, nombres y fechas
 * no entran al repositorio. Las únicas constantes que el código lleva son el
 * plan (faenas y cargos) y la marca, modelo y año de los equipos nuevos.
 *
 * Pasos (cada cambio va en su propia transacción y deja su fila en `audit_log`
 * a nombre de `--actor-email`):
 *
 *   1. Tipos de equipo «Carro» y «Batea».
 *   2. Faenas de la planilla → faenas activas de Chome.
 *   3. Equipos: alta de los que faltan; faena y código de los que existen.
 *   4. SOAP, permiso de circulación y revisión técnica.
 *   5. Catálogo de cargos (nombres alternativos, capacidades y clases exigidas).
 *   6. Trabajadores: alta de los que faltan y clasificación según su cargo.
 *   7. Licencias de conducir.
 *   8. Informe: lo aplicado y lo que hay que revisar.
 *
 * Idempotente: cada acción compara el estado real con lo que la planilla pide y
 * se salta si ya coincide, así que reejecutar es seguro. Lo que no se puede
 * decidir solo (un alias en conflicto, una fecha vacía, una clase que no se
 * reconoce) no se adivina: se informa en «A revisar».
 *
 *   npx tsx scripts/apply-vencimientos-planilla-2026-11.ts --file <xlsx> --actor-email <correo>          # dry-run
 *   npx tsx scripts/apply-vencimientos-planilla-2026-11.ts --file <xlsx> --actor-email <correo> --apply  # escribe
 *
 * Se aplica una vez, a mano; no forma parte del deploy. El informe nombra a las
 * personas con sus iniciales y la fila de la planilla, nunca con RUT ni nombre.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import ExcelJS from "exceljs"
import { and, eq, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  fuelEquipmentTypes, fuelVehicleOperationalIntervals, fuelVehicleProducts, fuelVehicles,
  users, workerCapabilities, workerDriverLicenses, workerPositionAliases, workerPositionCapabilities,
  workerPositions, workers, worksites,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { moveProviderMappingsWithVehicleTx } from "@/lib/combustibles/provider-mappings"
import { fuelEquipmentTypeSchema, fuelEquipmentTypeSlug } from "@/lib/combustibles/validation"
import {
  formatExcelDateUTC, isExcelErrorText, normalizeCellValue, normalizePlate, parseSheetDate, plateMatchKey,
} from "@/lib/combustibles/xlsx-utils"
import { civilDaysBetween } from "@/lib/expiry"
import { nanoid } from "@/lib/id"
import { cleanRut, validateRut } from "@/lib/rut"
import { writeDriverLicense } from "@/lib/services/driver-licenses"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import {
  addWorkerPositionAlias, bulkAssignWorkerPosition, createWorkerPosition, recordWorkerPositionChange,
  LICENSE_REQUIRING_CAPABILITY_CODES, replaceWorkerPositionCapabilities, resolveWorkerPosition, updateWorkerPosition,
  WorkerPositionDomainError,
} from "@/lib/services/worker-positions"
import { normalizeWorkerPositionKey } from "@/lib/services/worker-positions/normalization"
import { insertWorker } from "@/lib/services/workers"
import { todayInChile } from "@/lib/utils"
import {
  driverLicenseSchema, DRIVER_LICENSE_NOTES_MAX, formatLicenseClassList, licenseSatisfies, parseLicenseClasses,
  type DriverLicenseClass,
} from "@/lib/validation/driver-licenses"

const REASON = "Planilla de vencimientos 2026-11"

/* ── Plan ─────────────────────────────────────────────────────────────────── */

/** Tipos que el catálogo no tenía. Mismos campos y validación que Administración › Tipos de equipo. */
const NEW_EQUIPMENT_TYPES = [
  { name: "Carro", category: "other", defaultMeterType: "none", defaultPerformanceUnit: "not_applicable", sortOrder: 140, description: "Remolque o carro de arrastre: no tiene motor ni medidor." },
  { name: "Batea", category: "other", defaultMeterType: "none", defaultPerformanceUnit: "not_applicable", sortOrder: 150, description: "Semirremolque batea que va acoplado a un tractocamión: no tiene motor ni medidor." },
] as const

/**
 * Nombres de la planilla que no coinciden con una faena de Chome, tal como los
 * compara `worksiteKey` (sin tildes, mayúsculas). Lo demás se busca por nombre.
 */
const WORKSITE_ALIASES = new Map<string, string>([
  [worksiteKey("Masisa maderas"), "Masisa"],
  [worksiteKey("Masisa tableros"), "Masisa"],
])

/** La columna «Máquina» de la planilla → slug del tipo de equipo. Lo que no está acá se busca por su slug. */
const MACHINE_TYPE_SLUGS = new Map<string, string>([
  ["camion", "camion"],
  ["carro", "carro"],
  ["batea", "batea"],
  ["tracto camion", "tracto"],
  ["tractocamion", "tracto"],
  ["tracto", "tracto"],
])

interface VehicleDetails { brand: string | null; model: string | null; year: number | null }

/**
 * Marca, modelo y año de los 16 equipos que la planilla trae y Chome no tenía.
 * La planilla no los lleva: están pendientes del usuario. Un `null` crea el
 * equipo sin esos datos (son opcionales) y se completan después desde Flota.
 * La clave es la patente tal como la escribe la planilla.
 */
export const NEW_VEHICLE_DETAILS: Record<string, VehicleDetails | null> = {
  // completar con los datos que entregue el usuario
  "BPDH-67": null,
  "PWTD-82": null,
  "HGKG-54": null,
  "JP-3896": null,
  "JN-6770": null,
  "JN-9374": null,
  "JN-9376": null,
  "JWPY-64": null,
  "PWTY-84": null,
  "PWTY-85": null,
  "PWYL-34": null,
  "PWYL-35": null,
  "JA-1225": null,
  "PWTK-77": null,
  "JK-2385": null,
  "HGKG-53": null,
}

/**
 * Combustibles compatibles con que nacen los equipos nuevos, según su medidor:
 * un equipo con medidor (BPDH-67, camión) carga diésel; un carro o una batea
 * (sin medidor) no cargan nada y nacen sin compatibles.
 */
const compatibleProductIdsFor = (meterType: string): string[] => (meterType === "none" ? [] : ["fuel-diesel"])

type CapabilityCode = "drives_vehicle" | "operates_equipment"
const CAPABILITY_LABEL: Record<CapabilityCode, string> = {
  drives_vehicle: "Conduce vehículos",
  operates_equipment: "Opera maquinaria",
}

interface PositionPlan {
  /** Código del cargo si hay que crearlo (lo conserva el que ya exista). */
  code: string
  name: string
  /** Cargo existente que, si no hay uno con `name`, se renombra en lugar de crear otro. */
  renamesFrom?: string
  /** Nombres con que la planilla y las matrices MIPER llaman al cargo; calzan por `resolveWorkerPosition`. */
  aliases: readonly string[]
  capabilities: readonly CapabilityCode[]
  /** Basta con una de estas clases. Vacío = no exige una en particular. */
  requiredLicenseClasses: readonly DriverLicenseClass[]
}

/**
 * Catálogo de cargos que conducen. Las clases siguen la Ley de Tránsito (A4 carga
 * simple, A5 carga articulada, B particulares, D maquinaria) y quedan editables
 * en Administración › Cargos: la carga no pisa lo que ya se haya definido ahí.
 */
const POSITION_PLANS: readonly PositionPlan[] = [
  {
    code: "CONDUCTOR-CAMION", name: "Conductor de camión", renamesFrom: "Chofer Camión",
    aliases: ["Chofer", "Conductor", "Chofer Camión", "Chófer de camión recolector", "Conductor o chófer de camión ampliroll", "Conductor camión Copec"],
    // A2 antigua también habilita camión (decisión del usuario, 2026-11-05).
    capabilities: ["drives_vehicle"], requiredLicenseClasses: ["A4", "A5", "A2_ANTIGUA"],
  },
  {
    code: "CONDUCTOR-TRACTO", name: "Conductor de tracto",
    aliases: ["Conductor tracto batea", "Conductor tracto camión"],
    capabilities: ["drives_vehicle"], requiredLicenseClasses: ["A5"],
  },
  {
    code: "CONDUCTOR-MECANICO", name: "Conductor y mecánico",
    aliases: ["Conductor/Mecánico"],
    capabilities: ["drives_vehicle"], requiredLicenseClasses: ["A4", "A5", "A2_ANTIGUA"],
  },
  {
    code: "OPERADOR-MAQUINARIA", name: "Operador de maquinaria",
    aliases: ["Operador tractor", "Operador cargador frontal", "Operador bulldozer", "Operador grúa maderera"],
    capabilities: ["operates_equipment", "drives_vehicle"], requiredLicenseClasses: ["D"],
  },
  { code: "SUPERVISOR", name: "Supervisor", aliases: [], capabilities: ["drives_vehicle"], requiredLicenseClasses: ["B"] },
  { code: "JEFE-TERRENO", name: "Jefe de terreno", aliases: [], capabilities: ["drives_vehicle"], requiredLicenseClasses: ["B"] },
  { code: "ADMINISTRADOR-CONTRATO", name: "Administrador de contrato", aliases: [], capabilities: ["drives_vehicle"], requiredLicenseClasses: ["B"] },
  {
    code: "PREVENCIONISTA-RIESGOS", name: "Prevencionista de riesgos",
    aliases: ["Prev. de riesgos", "Prevención de riesgos", "Prevención"],
    capabilities: ["drives_vehicle"], requiredLicenseClasses: ["B"],
  },
  { code: "MECANICO", name: "Mecánico", aliases: ["Mecánico soldador"], capabilities: ["drives_vehicle"], requiredLicenseClasses: ["B"] },
  { code: "AYUDANTE-MECANICO", name: "Ayudante mecánico", aliases: ["Ayudante mecánico soldador"], capabilities: ["drives_vehicle"], requiredLicenseClasses: ["B"] },
  { code: "SOLDADOR", name: "Soldador", aliases: [], capabilities: [], requiredLicenseClasses: [] },
  { code: "AUXILIAR", name: "Auxiliar", aliases: ["Peoneta"], capabilities: [], requiredLicenseClasses: [] },
  { code: "ADMINISTRATIVO", name: "Administrativo", aliases: [], capabilities: [], requiredLicenseClasses: [] },
]

/** El cargo del plan al que apunta un texto de la planilla (por nombre o nombre alternativo), sin mirar la base. */
function planForCargo(text: string): PositionPlan | null {
  const key = normalizeWorkerPositionKey(text)
  if (key.length < 2) return null
  return POSITION_PLANS.find((plan) =>
    normalizeWorkerPositionKey(plan.name) === key
    || (plan.renamesFrom !== undefined && normalizeWorkerPositionKey(plan.renamesFrom) === key)
    || plan.aliases.some((alias) => normalizeWorkerPositionKey(alias) === key),
  ) ?? null
}

/* ── Resultado ────────────────────────────────────────────────────────────── */

type Result = "aplicado" | "dry-run" | "ya estaba" | "omitido"
export interface Outcome { step: string; item: string; action: string; result: Result; detail?: string }

export type ReviewKind =
  | "equipo_vencido" | "licencia_vencida" | "clase_insuficiente" | "clase_no_reconocida"
  | "fila_omitida" | "dato_vacio" | "cargo_pendiente" | "conflicto" | "inactivo"
  | "faena_distinta" | "codigo_duplicado" | "identificado_por_nombre"
export interface ReviewNote { kind: ReviewKind; item: string; detail: string }

export interface VencimientosReport { outcomes: Outcome[]; review: ReviewNote[] }

const REVIEW_TITLES: Record<ReviewKind, string> = {
  equipo_vencido: "Equipos con todo vencido hace más de un año",
  licencia_vencida: "Licencias vencidas",
  clase_insuficiente: "Conductores con clase insuficiente para su cargo",
  clase_no_reconocida: "Clases de licencia que no se reconocieron",
  fila_omitida: "Filas omitidas",
  identificado_por_nombre: "Trabajadores identificados por nombre (RUT de la planilla a corregir)",
  dato_vacio: "Datos vacíos en la planilla",
  cargo_pendiente: "Cargos que no estaban en el catálogo",
  conflicto: "Conflictos del catálogo de cargos",
  inactivo: "Equipos y trabajadores inactivos en Chome",
  faena_distinta: "Trabajadores en otra faena que la de la planilla (no se movieron)",
  codigo_duplicado: "Códigos de equipo repetidos",
}

interface Actor { userId: string; email: string }
type Client = typeof db | Tx

/* ── Utilidades de texto ──────────────────────────────────────────────────── */

/** Misma comparación que el import de flota: sin tildes, mayúsculas, sin puntuación. */
function worksiteKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()
}

/** Encabezados de la planilla y nombres de hoja: sin tildes, minúsculas, sin puntuación. */
function headerKey(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

/** «KA.137» → «KA-137»; «NO TIENE CODIGO» o vacío → sin código. Lo que no tiene forma de código se informa. */
export function normalizeEquipmentCode(raw: string | null): { code: string | null; invalid: boolean } {
  if (!raw) return { code: null, invalid: false }
  const upper = raw.trim().toUpperCase()
  if (!upper || /^(NO\s+TIENE(\s+C[OÓ]DIGO)?|SIN\s+C[OÓ]DIGO|S\/C|N\/A|-+)$/.test(upper)) return { code: null, invalid: false }
  const match = /^([A-Z]{1,4})[\s.\-_]*(\d{1,4})$/.exec(upper)
  return match ? { code: `${match[1]}-${match[2]}`, invalid: false } : { code: null, invalid: true }
}

const NAME_PARTICLES = new Set(["de", "del", "la", "las", "los", "da", "di"])

function titleCase(text: string): string {
  return text.trim().split(/\s+/).map((word, index) => {
    const lower = word.toLocaleLowerCase("es-CL")
    if (index > 0 && NAME_PARTICLES.has(lower)) return lower
    return lower.replace(/(^|[-'’])(\p{L})/gu, (_match, before: string, letter: string) => before + letter.toLocaleUpperCase("es-CL"))
  }).join(" ")
}

/**
 * Separa «Nombre Nombre Apellido Apellido» en nombre y apellidos, en formato
 * título. Los dos últimos apellidos son las dos últimas palabras (con sus
 * partículas: «de la Fuente»); con dos palabras es nombre y apellido; con una
 * sola no se puede separar. Es una heurística: el informe dice cuántas palabras
 * fueron a cada lado para que se pueda revisar sin ver el nombre.
 */
export function splitFullName(raw: string | null): { firstName: string; lastName: string; firstWords: number; lastWords: number } | null {
  const words = (raw ?? "").trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return null
  let start = words.length
  for (let surname = 0; surname < 2 && start > 1; surname++) {
    start -= 1
    while (start > 1 && NAME_PARTICLES.has(words[start - 1]!.toLocaleLowerCase("es-CL"))) start -= 1
  }
  const first = words.slice(0, start)
  const last = words.slice(start)
  if (first.length === 0 || last.length === 0) return null
  return { firstName: titleCase(first.join(" ")), lastName: titleCase(last.join(" ")), firstWords: first.length, lastWords: last.length }
}

/** Iniciales para el informe: nunca el nombre. */
function initials(name: string | null): string {
  const parts = (name ?? "").split(/\s+/).filter(Boolean)
  return parts.length ? `${parts.map((part) => part[0]!.toLocaleUpperCase("es-CL")).join(".")}.` : "?"
}

/* ── Lectura de la planilla ───────────────────────────────────────────────── */

type DateKey = "soap" | "permit" | "review"
const DATE_FIELDS: ReadonlyArray<{ key: DateKey; column: "soapExpiresAt" | "circulationPermitExpiresAt" | "technicalReviewExpiresAt"; label: string }> = [
  { key: "soap", column: "soapExpiresAt", label: "SOAP" },
  { key: "permit", column: "circulationPermitExpiresAt", label: "Permiso de circulación" },
  { key: "review", column: "technicalReviewExpiresAt", label: "Revisión técnica" },
]

export interface MachineRow {
  row: number
  faena: string | null
  machine: string | null
  code: string | null
  /** La celda traía algo que no tiene forma de código. */
  codeInvalid: boolean
  plate: string
  dates: Record<DateKey, string | null>
  /** Fechas escritas en la celda que no se pudieron interpretar. */
  unreadableDates: string[]
}

export interface WorkerRow {
  row: number
  faena: string | null
  name: string | null
  /** RUT en forma canónica (`12345678-9`). */
  rut: string | null
  cargo: string | null
  classes: string | null
  expiresAt: string | null
  unreadableDate: boolean
  notes: string | null
}

export interface PlanillaData { machines: MachineRow[]; workers: WorkerRow[]; skipped: ReviewNote[] }

const MACHINE_COLUMNS = {
  faena: (key: string) => key === "faena",
  machine: (key: string) => key === "maquina",
  code: (key: string) => key.startsWith("codigo"),
  plate: (key: string) => key === "patente",
  soap: (key: string) => key.includes("soap"),
  permit: (key: string) => key.includes("permiso") && key.includes("circulacion"),
  review: (key: string) => key.includes("revision"),
}
const MACHINE_REQUIRED = ["faena", "machine", "plate", "soap", "permit", "review"] as const
const MACHINE_LABELS = {
  faena: "Faena", machine: "Máquina", code: "Código interno", plate: "Patente",
  soap: "Venc. SOAP", permit: "Venc. Permiso de circulación", review: "Venc. Revisión técnica",
}

const WORKER_COLUMNS = {
  faena: (key: string) => key === "faena",
  name: (key: string) => key.startsWith("nombre"),
  rut: (key: string) => key === "rut",
  cargo: (key: string) => key === "cargo",
  classes: (key: string) => key.includes("clase"),
  expires: (key: string) => key.includes("venc") && key.includes("licencia"),
  notes: (key: string) => key.startsWith("observ"),
}
const WORKER_REQUIRED = ["faena", "name", "rut", "cargo", "classes", "expires"] as const
const WORKER_LABELS = {
  faena: "Faena", name: "Nombre trabajador", rut: "RUT", cargo: "Cargo",
  classes: "Clase licencia", expires: "Venc. licencia de conducir", notes: "Observaciones",
}

/** Busca la fila de encabezados entre las primeras (la 1 es una instrucción) y devuelve la columna de cada campo. */
function locateColumns<T extends string>(
  sheet: ExcelJS.Worksheet,
  predicates: Record<T, (key: string) => boolean>,
  required: readonly T[],
  labels: Record<T, string>,
): { headerRow: number; cols: Partial<Record<T, number>> } {
  let bestMissing: T[] = required.slice()
  for (let rowNumber = 1; rowNumber <= Math.min(10, sheet.rowCount); rowNumber++) {
    const cols: Partial<Record<T, number>> = {}
    sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, column) => {
      const key = headerKey(normalizeCellValue(cell.value))
      if (!key) return
      for (const field of Object.keys(predicates) as T[]) {
        if (cols[field] === undefined && predicates[field](key)) { cols[field] = column; break }
      }
    })
    const missing = required.filter((field) => cols[field] === undefined)
    if (missing.length === 0) return { headerRow: rowNumber, cols }
    if (missing.length < bestMissing.length) bestMissing = missing
  }
  throw new Error(`En la hoja «${sheet.name}» no encontré las columnas: ${bestMissing.map((field) => labels[field]).join(", ")}.`)
}

function findSheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const sheet = workbook.worksheets.find((candidate) => headerKey(candidate.name) === headerKey(name))
  if (!sheet) throw new Error(`La planilla no tiene la hoja «${name}».`)
  return sheet
}

function cellText(sheet: ExcelJS.Worksheet, rowNumber: number, column: number | undefined): string | null {
  if (!column) return null
  const value = normalizeCellValue(sheet.getRow(rowNumber).getCell(column).value)
  if (value === null || value === undefined || value instanceof Date) return null
  const text = String(value).replace(/\s+/g, " ").trim()
  return text && !isExcelErrorText(text) ? text : null
}

/**
 * Fecha civil `YYYY-MM-DD` de una celda: fecha de Excel (componentes UTC, sin
 * desfase de zona), serial numérico o texto `dd-mm-aaaa` / `aaaa-mm-dd`.
 * `unreadable` = la celda traía algo, pero no es una fecha.
 */
function cellDate(sheet: ExcelJS.Worksheet, rowNumber: number, column: number | undefined): { date: string | null; unreadable: boolean } {
  if (!column) return { date: null, unreadable: false }
  const value = normalizeCellValue(sheet.getRow(rowNumber).getCell(column).value)
  if (value === null || value === undefined || value === "") return { date: null, unreadable: false }
  let date: string | null = null
  if (value instanceof Date) date = Number.isNaN(value.getTime()) ? null : formatExcelDateUTC(value)
  else if (typeof value === "number" && value > 20_000 && value < 80_000) date = formatExcelDateUTC(new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000))
  else if (typeof value === "string") date = parseSheetDate(value)
  const year = date ? Number(date.slice(0, 4)) : 0
  if (!date || year < 2000 || year > 2100) return { date: null, unreadable: true }
  return { date, unreadable: false }
}

/** Lee las hojas «Máquinas» y «Trabajadores». Las columnas se buscan por su nombre, no por su letra. */
export async function readPlanilla(source: Buffer | ArrayBuffer): Promise<PlanillaData> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(source as never)
  } catch {
    throw new Error("El archivo no es una planilla Excel válida.")
  }
  const skipped: ReviewNote[] = []

  const machineSheet = findSheet(workbook, "Máquinas")
  const machineLayout = locateColumns<keyof typeof MACHINE_COLUMNS>(machineSheet, MACHINE_COLUMNS, MACHINE_REQUIRED, MACHINE_LABELS)
  const machines: MachineRow[] = []
  for (let row = machineLayout.headerRow + 1; row <= machineSheet.rowCount; row++) {
    const cols = machineLayout.cols
    const faena = cellText(machineSheet, row, cols.faena)
    const machine = cellText(machineSheet, row, cols.machine)
    const codeRaw = cellText(machineSheet, row, cols.code)
    const plateRaw = cellText(machineSheet, row, cols.plate)
    const parsedDates = {
      soap: cellDate(machineSheet, row, cols.soap),
      permit: cellDate(machineSheet, row, cols.permit),
      review: cellDate(machineSheet, row, cols.review),
    }
    const anyDate = DATE_FIELDS.some((field) => parsedDates[field.key].date || parsedDates[field.key].unreadable)
    if (!faena && !machine && !codeRaw && !plateRaw && !anyDate) continue
    if (!plateRaw) {
      skipped.push({ kind: "fila_omitida", item: `Máquinas, fila ${row}`, detail: "no trae patente" })
      continue
    }
    const { code, invalid } = normalizeEquipmentCode(codeRaw)
    machines.push({
      row,
      faena,
      machine,
      code,
      codeInvalid: invalid,
      plate: normalizePlate(plateRaw),
      dates: { soap: parsedDates.soap.date, permit: parsedDates.permit.date, review: parsedDates.review.date },
      unreadableDates: DATE_FIELDS.filter((field) => parsedDates[field.key].unreadable).map((field) => field.label),
    })
  }

  const workerSheet = findSheet(workbook, "Trabajadores")
  const workerLayout = locateColumns<keyof typeof WORKER_COLUMNS>(workerSheet, WORKER_COLUMNS, WORKER_REQUIRED, WORKER_LABELS)
  const workerRows: WorkerRow[] = []
  for (let row = workerLayout.headerRow + 1; row <= workerSheet.rowCount; row++) {
    const cols = workerLayout.cols
    const faena = cellText(workerSheet, row, cols.faena)
    const name = cellText(workerSheet, row, cols.name)
    const rutRaw = cellText(workerSheet, row, cols.rut)
    const cargo = cellText(workerSheet, row, cols.cargo)
    const classes = cellText(workerSheet, row, cols.classes)
    const notes = cellText(workerSheet, row, cols.notes)
    const expires = cellDate(workerSheet, row, cols.expires)
    if (!faena && !name && !rutRaw && !cargo && !classes && !notes && !expires.date && !expires.unreadable) continue
    workerRows.push({
      row,
      faena,
      name,
      rut: rutRaw ? cleanRut(rutRaw) : null,
      cargo,
      classes,
      expiresAt: expires.date,
      unreadableDate: expires.unreadable,
      notes,
    })
  }

  return { machines, workers: workerRows, skipped }
}

/* ── Ejecución ────────────────────────────────────────────────────────────── */

const STEP = {
  types: "1 Tipos de equipo",
  worksites: "2 Faenas",
  vehicles: "3 Equipos",
  dates: "4 Vencimientos de equipos",
  positions: "5 Catálogo de cargos",
  workers: "6 Trabajadores y cargos",
  licenses: "7 Licencias de conducir",
} as const

interface Ctx {
  apply: boolean
  actor: Actor
  today: string
  step: string
  report: (outcome: Omit<Outcome, "step">) => void
  note: (note: ReviewNote) => void
  resolveWorksite: (raw: string | null) => { id: string; name: string } | null
  worksiteNameById: Map<string, string>
  /** Slugs de tipos que este mismo plan crea (en dry-run todavía no existen). */
  plannedTypeSlugs: Set<string>
  /** Patentes (`plateMatchKey`) de equipos que este plan crea. */
  plannedPlates: Set<string>
  /** Patentes cuya fila se omitió: ningún paso las toca. */
  omittedPlates: Set<string>
  /** Trabajador de cada fila de la hoja «Trabajadores»; `workerId` nulo = se crea en este plan. */
  workerRefs: Map<number, { workerId: string | null; label: string }>
}

function workerLabel(row: WorkerRow): string {
  return `${initials(row.name)} · fila ${row.row}`
}

async function runEquipmentTypes(ctx: Ctx) {
  ctx.step = STEP.types
  const existingTypes = await db.select().from(fuelEquipmentTypes)
  for (const plan of NEW_EQUIPMENT_TYPES) {
    const action = "crear tipo de equipo"
    const parsed = fuelEquipmentTypeSchema.parse(plan)
    const slug = fuelEquipmentTypeSlug(parsed.name)
    const existing = existingTypes.find((type) => type.slug === slug || headerKey(type.name) === headerKey(plan.name))
    if (existing) {
      ctx.report({ item: plan.name, action, result: existing.isActive ? "ya estaba" : "omitido", ...(existing.isActive ? {} : { detail: "existe inactivo; reactivarlo desde Tipos de equipo" }) })
      continue
    }
    if (!ctx.apply) { ctx.plannedTypeSlugs.add(slug); ctx.report({ item: plan.name, action, result: "dry-run", detail: slug }); continue }
    const id = `fet-${nanoid()}`
    const values = { ...parsed, id, slug }
    await db.transaction(async (tx) => {
      await tx.insert(fuelEquipmentTypes).values(values)
      await recordAudit({ userId: ctx.actor.userId, userEmail: ctx.actor.email, action: "create", entityType: "fuel_equipment_type", entityId: id, newState: values, reason: REASON }, tx)
    })
    ctx.report({ item: plan.name, action, result: "aplicado", detail: slug })
  }
}

/** Resuelve las faenas de la planilla contra las ACTIVAS de Chome. Una faena que no se resuelve omite sus filas. */
function reportWorksites(ctx: Ctx, data: PlanillaData) {
  ctx.step = STEP.worksites
  const counts = new Map<string, number>()
  for (const row of [...data.machines, ...data.workers]) {
    const key = row.faena ?? ""
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const [name, rows] of counts) {
    const action = "resolver faena de la planilla"
    if (!name) { ctx.report({ item: "(vacía)", action, result: "omitido", detail: `${rows} fila(s) sin faena: se omiten` }); continue }
    const found = ctx.resolveWorksite(name)
    if (found) ctx.report({ item: name, action, result: "ya estaba", detail: `→ «${found.name}» (${rows} fila(s))` })
    else ctx.report({ item: name, action, result: "omitido", detail: `no hay una faena activa única con ese nombre: se omiten ${rows} fila(s)` })
  }
}

type VehicleRow = typeof fuelVehicles.$inferSelect

async function runVehicles(ctx: Ctx, machines: MachineRow[]) {
  ctx.step = STEP.vehicles
  const [types, vehicles, settings] = await Promise.all([db.select().from(fuelEquipmentTypes), db.select().from(fuelVehicles), getFleetAdminSettings()])
  const typeBySlug = new Map(types.map((type) => [type.slug, type]))
  const byPlate = new Map(vehicles.map((vehicle) => [plateMatchKey(vehicle.plate), vehicle]))
  const detailsByPlate = new Map(Object.entries(NEW_VEHICLE_DETAILS).map(([plate, details]) => [plateMatchKey(plate), details]))
  const seen = new Set<string>()

  for (const m of machines) {
    const key = plateMatchKey(m.plate)
    if (seen.has(key)) {
      // La primera fila de esa patente sigue valiendo: no se marca como omitida.
      ctx.report({ item: m.plate, action: "equipo de la planilla", result: "omitido", detail: `patente repetida (fila ${m.row}); vale la primera` })
      ctx.note({ kind: "fila_omitida", item: m.plate, detail: `Máquinas, fila ${m.row}: patente repetida en la planilla` })
      continue
    }
    seen.add(key)
    if (m.codeInvalid) ctx.note({ kind: "dato_vacio", item: m.plate, detail: `el código de la planilla no tiene forma de código interno (fila ${m.row}); se ignora` })
    if (m.unreadableDates.length > 0) ctx.note({ kind: "dato_vacio", item: m.plate, detail: `fecha ilegible en ${m.unreadableDates.join(", ")} (fila ${m.row}); se trata como vacía` })

    const worksite = ctx.resolveWorksite(m.faena)
    if (!worksite) {
      ctx.omittedPlates.add(key)
      ctx.report({ item: m.plate, action: "equipo de la planilla", result: "omitido", detail: `faena «${m.faena ?? ""}» sin resolver` })
      ctx.note({ kind: "fila_omitida", item: m.plate, detail: `Máquinas, fila ${m.row}: faena «${m.faena ?? ""}» sin resolver` })
      continue
    }

    const existing = byPlate.get(key)
    if (!existing) await createVehicle(ctx, m, worksite, typeBySlug, detailsByPlate.get(key) ?? null, settings.defaultVehicleStatus)
    else {
      if (!existing.isActive) ctx.note({ kind: "inactivo", item: m.plate, detail: "el equipo está inactivo en Chome; se actualiza pero sigue inactivo" })
      await moveVehicle(ctx, m, existing, worksite)
      await changeVehicleCode(ctx, m, existing)
    }
  }
}

function machineTypeSlug(machine: string | null): string | null {
  if (!machine) return null
  const key = headerKey(machine)
  return MACHINE_TYPE_SLUGS.get(key) ?? fuelEquipmentTypeSlug(machine)
}

async function createVehicle(
  ctx: Ctx,
  m: MachineRow,
  worksite: { id: string; name: string },
  typeBySlug: Map<string, typeof fuelEquipmentTypes.$inferSelect>,
  details: VehicleDetails | null,
  defaultStatus: string,
) {
  const action = `alta${m.code ? ` ${m.code}` : " sin código"} en «${worksite.name}»`
  const key = plateMatchKey(m.plate)
  const slug = machineTypeSlug(m.machine)
  if (!slug) {
    ctx.omittedPlates.add(key)
    ctx.report({ item: m.plate, action, result: "omitido", detail: `la columna Máquina está vacía (fila ${m.row})` })
    ctx.note({ kind: "fila_omitida", item: m.plate, detail: `Máquinas, fila ${m.row}: sin tipo de máquina` })
    return
  }
  const type = typeBySlug.get(slug)
  if (!type?.isActive) {
    const pending = ctx.plannedTypeSlugs.has(slug)
    if (!pending) {
      ctx.omittedPlates.add(key)
      ctx.note({ kind: "fila_omitida", item: m.plate, detail: `Máquinas, fila ${m.row}: el tipo «${m.machine}» no existe o está inactivo` })
    }
    ctx.report({ item: m.plate, action, result: !ctx.apply && pending ? "dry-run" : "omitido", detail: pending ? "el tipo se crea en este mismo plan" : `el tipo «${m.machine}» no existe o está inactivo` })
    if (!ctx.apply && pending) ctx.plannedPlates.add(key)
    return
  }
  if (!ctx.apply) { ctx.plannedPlates.add(key); ctx.report({ item: m.plate, action, result: "dry-run", detail: `tipo ${type.name}${details ? "" : "; sin marca, modelo ni año"}` }); return }

  const id = nanoid()
  const values = {
    plate: m.plate,
    code: m.code,
    type: type.slug,
    equipmentTypeId: type.id,
    meterType: type.defaultMeterType,
    performanceUnit: type.defaultPerformanceUnit,
    brand: details?.brand ?? null,
    model: details?.model ?? null,
    year: details?.year ?? null,
    worksiteId: worksite.id,
    operationalStatus: defaultStatus,
    isActive: true,
    notes: "Alta desde la planilla de vencimientos 2026-11.",
  }
  await db.transaction(async (tx) => {
    await tx.insert(fuelVehicles).values({ id, ...values })
    await tx.insert(fuelVehicleOperationalIntervals).values({
      id: nanoid(),
      vehicleId: id,
      status: defaultStatus,
      startedAt: new Date().toISOString(),
      reason: "Alta inicial del equipo",
      changedBy: ctx.actor.userId,
    })
    const compatibleProductIds = compatibleProductIdsFor(values.meterType)
    if (compatibleProductIds.length > 0) {
      await tx.insert(fuelVehicleProducts).values(compatibleProductIds.map((productId) => ({ vehicleId: id, productId })))
    }
    await recordAudit({
      userId: ctx.actor.userId,
      userEmail: ctx.actor.email,
      action: "create",
      entityType: "fuel_vehicle",
      entityId: id,
      entityCode: m.plate,
      newState: { ...values, compatibleProductIds: compatibleProductIdsFor(values.meterType) },
      reason: REASON,
      worksiteId: worksite.id,
    }, tx)
  })
  ctx.report({ item: m.plate, action, result: "aplicado", detail: `tipo ${type.name}${details ? "" : "; sin marca, modelo ni año"}` })
}

/** Cambio de faena por el mismo camino que la edición: el vehículo, sus asignaciones de proveedor y la auditoría, juntos. */
async function moveVehicle(ctx: Ctx, m: MachineRow, existing: VehicleRow, worksite: { id: string; name: string }) {
  const action = `faena «${worksite.name}»`
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select({ id: fuelVehicles.id, worksiteId: fuelVehicles.worksiteId }).from(fuelVehicles).where(eq(fuelVehicles.id, existing.id))
    if (!current) return { kind: "missing" as const }
    if (current.worksiteId === worksite.id) return { kind: "same" as const }
    const fromName = ctx.worksiteNameById.get(current.worksiteId) ?? current.worksiteId
    if (!ctx.apply) return { kind: "dry" as const, fromName }
    await tx.update(fuelVehicles).set({ worksiteId: worksite.id, updatedAt: new Date().toISOString() }).where(eq(fuelVehicles.id, existing.id))
    const mappings = await moveProviderMappingsWithVehicleTx(tx, { vehicleId: existing.id, worksiteId: worksite.id, actorUserId: ctx.actor.userId, actorEmail: ctx.actor.email })
    await recordAudit({
      userId: ctx.actor.userId,
      userEmail: ctx.actor.email,
      action: "update",
      entityType: "fuel_vehicle",
      entityId: existing.id,
      entityCode: existing.plate,
      oldState: { worksiteId: current.worksiteId, worksite: fromName },
      newState: { worksiteId: worksite.id, worksite: worksite.name },
      reason: `${REASON}: la planilla manda en la faena`,
      worksiteId: worksite.id,
    }, tx)
    return { kind: "moved" as const, fromName, mappings }
  })
  if (result.kind === "missing") ctx.report({ item: m.plate, action, result: "omitido", detail: "el equipo desapareció mientras se aplicaba" })
  else if (result.kind === "same") ctx.report({ item: m.plate, action, result: "ya estaba" })
  else if (result.kind === "dry") ctx.report({ item: m.plate, action, result: "dry-run", detail: `de «${result.fromName}»` })
  else ctx.report({ item: m.plate, action, result: "aplicado", detail: `de «${result.fromName}»${result.mappings > 0 ? `; ${result.mappings} asignación(es) de proveedor` : ""}` })
}

/** El código de la planilla manda si es válido; una celda vacía nunca borra el que ya tiene el equipo. */
async function changeVehicleCode(ctx: Ctx, m: MachineRow, existing: VehicleRow) {
  if (!m.code) {
    if (existing.code) ctx.report({ item: m.plate, action: "código interno", result: "ya estaba", detail: `la planilla no trae código; se conserva ${existing.code}` })
    return
  }
  const action = `código ${m.code}`
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select({ id: fuelVehicles.id, code: fuelVehicles.code }).from(fuelVehicles).where(eq(fuelVehicles.id, existing.id))
    if (!current) return { kind: "missing" as const }
    if ((current.code ?? "").trim().toUpperCase() === m.code) return { kind: "same" as const }
    if (!ctx.apply) return { kind: "dry" as const, before: current.code }
    await tx.update(fuelVehicles).set({ code: m.code, updatedAt: new Date().toISOString() }).where(eq(fuelVehicles.id, existing.id))
    await recordAudit({
      userId: ctx.actor.userId,
      userEmail: ctx.actor.email,
      action: "update",
      entityType: "fuel_vehicle",
      entityId: existing.id,
      entityCode: existing.plate,
      oldState: { code: current.code },
      newState: { code: m.code },
      reason: `${REASON}: la planilla manda en el código`,
      worksiteId: existing.worksiteId,
    }, tx)
    return { kind: "changed" as const, before: current.code }
  })
  const detail = (before: string | null | undefined) => (before ? `antes ${before}` : "no tenía código")
  if (result.kind === "missing") ctx.report({ item: m.plate, action, result: "omitido", detail: "el equipo desapareció mientras se aplicaba" })
  else if (result.kind === "same") ctx.report({ item: m.plate, action, result: "ya estaba" })
  else if (result.kind === "dry") ctx.report({ item: m.plate, action, result: "dry-run", detail: detail(result.before) })
  else ctx.report({ item: m.plate, action, result: "aplicado", detail: detail(result.before) })
}

/** El código no es único en la base (así se pueden intercambiar), pero al terminar no debería quedar repetido. */
async function reviewDuplicateCodes(ctx: Ctx, machines: MachineRow[]) {
  const vehicles = await db.select({ plate: fuelVehicles.plate, code: fuelVehicles.code }).from(fuelVehicles)
  const finalCode = new Map(vehicles.map((vehicle) => [plateMatchKey(vehicle.plate), (vehicle.code ?? "").trim().toUpperCase() || null]))
  const inPlanilla = new Set<string>()
  for (const m of machines) {
    const key = plateMatchKey(m.plate)
    if (ctx.omittedPlates.has(key) || inPlanilla.has(key)) continue
    inPlanilla.add(key)
    if (m.code) finalCode.set(key, m.code)
    else if (!finalCode.has(key)) finalCode.set(key, null)
  }
  const plates = new Map<string, string[]>()
  for (const [plate, code] of finalCode) {
    if (!code) continue
    plates.set(code, [...(plates.get(code) ?? []), plate])
  }
  for (const [code, list] of plates) {
    if (list.length > 1 && list.some((plate) => inPlanilla.has(plate))) {
      ctx.note({ kind: "codigo_duplicado", item: code, detail: `lo llevan ${list.length} equipos: ${list.join(", ")}` })
    }
  }
}

async function runVehicleDates(ctx: Ctx, machines: MachineRow[]) {
  ctx.step = STEP.dates
  const action = "SOAP, permiso de circulación y revisión técnica"
  const seen = new Set<string>()
  // Después del paso 3: ya incluye los equipos nuevos. Cada equipo se vuelve a leer dentro de su transacción.
  const vehicles = await db.select().from(fuelVehicles)
  const byPlate = new Map(vehicles.map((vehicle) => [plateMatchKey(vehicle.plate), vehicle]))
  for (const m of machines) {
    const key = plateMatchKey(m.plate)
    if (ctx.omittedPlates.has(key) || seen.has(key)) continue
    seen.add(key)
    const existing = byPlate.get(key)

    // Qué dice la planilla donde Chome ya tiene fecha y qué queda vacío.
    const missing = DATE_FIELDS.filter((field) => !m.dates[field.key])
    if (missing.length > 0) {
      const kept = existing ? missing.filter((field) => existing[field.column]) : []
      ctx.note({
        kind: "dato_vacio",
        item: m.plate,
        detail: `sin fecha de ${missing.map((field) => field.label).join(", ")} en la planilla (fila ${m.row})${kept.length > 0 ? `; Chome conserva la de ${kept.map((field) => field.label).join(", ")}` : ""}`,
      })
    }
    // Todo vencido hace más de un año: lo que la planilla dice, y donde calla, lo que Chome ya tenía.
    const effective = DATE_FIELDS.map((field) => m.dates[field.key] ?? existing?.[field.column] ?? null).filter((date): date is string => date !== null)
    if (effective.length > 0 && effective.every((date) => civilDaysBetween(date, ctx.today) > 365)) {
      const latest = effective.slice().sort()[effective.length - 1]!
      ctx.note({ kind: "equipo_vencido", item: m.plate, detail: `su último vencimiento fue hace ${civilDaysBetween(latest, ctx.today)} días (${latest})` })
    }

    if (!existing) {
      const planned = ctx.plannedPlates.has(key)
      ctx.report({ item: m.plate, action, result: !ctx.apply && planned ? "dry-run" : "omitido", detail: planned ? "el equipo se crea en este mismo plan" : "el equipo no existe en Chome" })
      continue
    }
    const changes = DATE_FIELDS.filter((field) => m.dates[field.key] && existing[field.column] !== m.dates[field.key])
    if (changes.length === 0) { ctx.report({ item: m.plate, action, result: "ya estaba" }); continue }
    const detail = changes.map((field) => field.label).join(", ")
    if (!ctx.apply) { ctx.report({ item: m.plate, action, result: "dry-run", detail }); continue }
    const applied = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(fuelVehicles).where(eq(fuelVehicles.id, existing.id))
      if (!current) return false
      const set: Partial<Record<(typeof DATE_FIELDS)[number]["column"], string>> = {}
      const before: Record<string, string | null> = {}
      for (const field of changes) {
        set[field.column] = m.dates[field.key]!
        before[field.column] = current[field.column]
      }
      await tx.update(fuelVehicles).set({ ...set, updatedAt: new Date().toISOString() }).where(eq(fuelVehicles.id, existing.id))
      await recordAudit({
        userId: ctx.actor.userId,
        userEmail: ctx.actor.email,
        action: "update",
        entityType: "fuel_vehicle",
        entityId: existing.id,
        entityCode: existing.plate,
        oldState: before,
        newState: set,
        reason: `${REASON}: la planilla manda en las fechas`,
        worksiteId: current.worksiteId,
      }, tx)
      return true
    })
    ctx.report({ item: m.plate, action, result: applied ? "aplicado" : "omitido", detail: applied ? detail : "el equipo desapareció mientras se aplicaba" })
  }
}

/* ── Catálogo de cargos ───────────────────────────────────────────────────── */

type PositionRow = typeof workerPositions.$inferSelect

interface PositionDiff {
  existing: PositionRow | null
  create: boolean
  rename: boolean
  clearReview: boolean
  setClasses: boolean
  /** Capacidades que faltan (nunca se quita una que el cargo ya tenga: el PDTP puede depender de ella). */
  addCapabilities: Array<{ code: CapabilityCode; id: string }>
  currentCapabilityIds: string[]
  addAliases: string[]
  aliasConflicts: Array<{ alias: string; why: string }>
  keptClasses: string[] | null
  blocked: string | null
}

async function diffPosition(client: Client, plan: PositionPlan): Promise<PositionDiff> {
  const [positions, aliases, capabilities] = await Promise.all([
    client.select().from(workerPositions),
    client.select().from(workerPositionAliases),
    plan.capabilities.length === 0
      ? Promise.resolve([] as Array<{ id: string; code: string }>)
      : client.select({ id: workerCapabilities.id, code: workerCapabilities.code }).from(workerCapabilities)
        .where(and(inArray(workerCapabilities.code, [...plan.capabilities]), eq(workerCapabilities.isActive, true))),
  ])
  const planKey = normalizeWorkerPositionKey(plan.name)
  let existing = positions.find((position) => position.normalizedKey === planKey) ?? null
  let rename = false
  if (!existing && plan.renamesFrom) {
    const old = positions.find((position) => position.normalizedKey === normalizeWorkerPositionKey(plan.renamesFrom!))
    if (old) { existing = old; rename = true }
  }
  const blank: PositionDiff = {
    existing, create: false, rename, clearReview: false, setClasses: false,
    addCapabilities: [], currentCapabilityIds: [], addAliases: [], aliasConflicts: [], keptClasses: null, blocked: null,
  }

  if (!existing) {
    const aliasHit = aliases.find((alias) => alias.normalizedKey === planKey)
    if (aliasHit) {
      const owner = positions.find((position) => position.id === aliasHit.positionId)
      return { ...blank, blocked: `«${plan.name}» ya es nombre alternativo de «${owner?.name ?? "otro cargo"}»; quita el alias o fusiona desde Administración › Cargos` }
    }
    const codeOwner = positions.find((position) => position.code === plan.code)
    if (codeOwner) return { ...blank, blocked: `el código ${plan.code} ya lo usa «${codeOwner.name}»` }
  } else {
    if (existing.isSystem) return { ...blank, blocked: "es un cargo de sistema" }
    if (!existing.isActive) return { ...blank, blocked: `«${existing.name}» está inactivo; reactívalo en Administración › Cargos` }
  }

  const missingCapability = plan.capabilities.find((code) => !capabilities.some((capability) => capability.code === code))
  if (missingCapability) return { ...blank, blocked: `la capacidad ${missingCapability} no existe o está inactiva` }

  const currentLinks = existing
    ? await client.select({ capabilityId: workerPositionCapabilities.capabilityId }).from(workerPositionCapabilities).where(eq(workerPositionCapabilities.positionId, existing.id))
    : []
  const currentCapabilityIds = currentLinks.map((link) => link.capabilityId)
  const addCapabilities = plan.capabilities
    .map((code) => ({ code, id: capabilities.find((capability) => capability.code === code)!.id }))
    .filter((capability) => !currentCapabilityIds.includes(capability.id))

  const currentClasses = existing?.requiredLicenseClasses ?? []
  const setClasses = plan.requiredLicenseClasses.length > 0 && currentClasses.length === 0
  const keptClasses = plan.requiredLicenseClasses.length > 0 && currentClasses.length > 0
    && currentClasses.slice().sort().join() !== [...plan.requiredLicenseClasses].sort().join()
    ? currentClasses : null

  const addAliases: string[] = []
  const aliasConflicts: Array<{ alias: string; why: string }> = []
  const seenAliasKeys = new Set<string>([planKey])
  for (const alias of plan.aliases) {
    const key = normalizeWorkerPositionKey(alias)
    if (seenAliasKeys.has(key)) continue
    seenAliasKeys.add(key)
    const aliasRow = aliases.find((row) => row.normalizedKey === key)
    if (aliasRow) {
      if (existing && aliasRow.positionId === existing.id) continue
      const owner = positions.find((position) => position.id === aliasRow.positionId)
      aliasConflicts.push({ alias, why: `ya es nombre alternativo de «${owner?.name ?? "otro cargo"}»` })
      continue
    }
    const canonical = positions.find((position) => position.normalizedKey === key)
    // Renombrar libera la clave vieja: «Chofer Camión» pasa a ser alias del cargo renombrado.
    if (canonical && !(rename && existing && canonical.id === existing.id)) {
      aliasConflicts.push({ alias, why: `existe el cargo «${canonical.name}» con ese nombre; fusiónalo desde Administración › Cargos` })
      continue
    }
    addAliases.push(alias)
  }

  return {
    existing,
    create: !existing,
    rename,
    clearReview: Boolean(existing?.needsReview),
    setClasses,
    addCapabilities,
    currentCapabilityIds,
    addAliases,
    aliasConflicts,
    keptClasses,
    blocked: null,
  }
}

function describeDiff(plan: PositionPlan, diff: PositionDiff): string {
  const parts: string[] = []
  if (diff.create) parts.push("creado")
  if (diff.rename) parts.push(`renombrado desde «${plan.renamesFrom}»`)
  if (diff.clearReview) parts.push("se quita «por revisar»")
  if (diff.addCapabilities.length > 0) parts.push(`capacidades: ${diff.addCapabilities.map((capability) => CAPABILITY_LABEL[capability.code]).join(", ")}`)
  if (diff.create ? plan.requiredLicenseClasses.length > 0 : diff.setClasses) parts.push(`exige ${formatLicenseClassList(plan.requiredLicenseClasses)}`)
  if (diff.addAliases.length > 0) parts.push(`+${diff.addAliases.length} nombre(s) alternativo(s)`)
  return parts.join("; ")
}

async function runPositionCatalog(ctx: Ctx) {
  ctx.step = STEP.positions
  for (const plan of POSITION_PLANS) {
    const action = "cargo del catálogo"
    const outcome = await db.transaction(async (tx) => {
      const diff = await diffPosition(tx, plan)
      if (diff.blocked) return { kind: "blocked" as const, diff }
      const changes = diff.create || diff.rename || diff.clearReview || diff.setClasses || diff.addCapabilities.length > 0 || diff.addAliases.length > 0
      if (!changes) return { kind: "same" as const, diff }
      if (!ctx.apply) return { kind: "dry" as const, diff }

      let position: PositionRow
      if (diff.create) {
        position = await createWorkerPosition({
          code: plan.code, name: plan.name, isActive: true, needsReview: false,
          requiredLicenseClasses: [...plan.requiredLicenseClasses],
        }, tx)
      } else {
        position = diff.existing!
        if (diff.rename || diff.clearReview || diff.setClasses) {
          position = await updateWorkerPosition(position.id, {
            code: position.code,
            name: diff.rename ? plan.name : position.name,
            isActive: position.isActive,
            needsReview: diff.clearReview ? false : position.needsReview,
            requiredLicenseClasses: diff.setClasses ? [...plan.requiredLicenseClasses] : position.requiredLicenseClasses,
          }, tx)
        }
      }
      // Los alias van después del renombre: «Chofer Camión» queda libre recién entonces.
      for (const alias of diff.addAliases) {
        await addWorkerPositionAlias({ positionId: position.id, alias, source: "import", actorUserId: ctx.actor.userId }, tx)
      }
      if (diff.addCapabilities.length > 0) {
        await replaceWorkerPositionCapabilities({
          positionId: position.id,
          capabilityIds: [...diff.currentCapabilityIds, ...diff.addCapabilities.map((capability) => capability.id)],
          actorUserId: ctx.actor.userId,
        }, tx)
      }
      await recordAudit({
        userId: ctx.actor.userId,
        userEmail: ctx.actor.email,
        action: diff.create ? "create" : "update",
        entityType: "worker_position",
        entityId: position.id,
        entityCode: position.code,
        oldState: diff.existing ? { name: diff.existing.name, needsReview: diff.existing.needsReview, requiredLicenseClasses: diff.existing.requiredLicenseClasses } : undefined,
        newState: {
          name: position.name,
          needsReview: position.needsReview,
          requiredLicenseClasses: position.requiredLicenseClasses,
          capabilities: diff.addCapabilities.map((capability) => capability.code),
          aliases: diff.addAliases,
        },
        reason: REASON,
      }, tx)
      return { kind: "applied" as const, diff }
    })

    const { diff } = outcome
    if (outcome.kind === "blocked") ctx.report({ item: plan.name, action, result: "omitido", detail: diff.blocked! })
    else if (outcome.kind === "same") ctx.report({ item: plan.name, action, result: "ya estaba" })
    else ctx.report({ item: plan.name, action, result: outcome.kind === "dry" ? "dry-run" : "aplicado", detail: describeDiff(plan, diff) })
    if (outcome.kind === "blocked") ctx.note({ kind: "conflicto", item: plan.name, detail: diff.blocked! })
    if (diff.keptClasses) ctx.note({ kind: "conflicto", item: plan.name, detail: `ya exige ${formatLicenseClassList(diff.keptClasses)}; el plan proponía ${formatLicenseClassList(plan.requiredLicenseClasses)} y no se pisó` })
    for (const conflict of diff.aliasConflicts) {
      ctx.report({ item: `${plan.name} ← «${conflict.alias}»`, action: "nombre alternativo", result: "omitido", detail: conflict.why })
      ctx.note({ kind: "conflicto", item: plan.name, detail: `el nombre alternativo «${conflict.alias}» ${conflict.why}` })
    }
  }
}

/* ── Trabajadores ─────────────────────────────────────────────────────────── */

type CargoResolution = { ok: true; id: string | null; name: string; isSystem: boolean } | { ok: false; message: string }

/**
 * El cargo al que apunta el texto de la planilla. Aplicando usa `resolveWorkerPosition`
 * de verdad (los alias del paso 5 hacen el calce; un cargo que no calza nace
 * «pendiente de revisión» y se informa). En dry-run no escribe: busca en la
 * base y, si todavía no está, en el plan del paso 5.
 */
async function resolveCargo(ctx: Ctx, text: string, cache: Map<string, CargoResolution>): Promise<CargoResolution> {
  const key = normalizeWorkerPositionKey(text)
  const cached = cache.get(key)
  if (cached) return cached
  let result: CargoResolution
  try {
    if (ctx.apply) {
      const resolved = await db.transaction(async (tx) => {
        const found = await resolveWorkerPosition({ name: text }, {}, tx)
        if (found.created) {
          await recordAudit({
            userId: ctx.actor.userId,
            userEmail: ctx.actor.email,
            action: "create",
            entityType: "worker_position",
            entityId: found.position.id,
            entityCode: found.position.code,
            newState: { name: found.position.name, needsReview: true },
            reason: `${REASON}: cargo de la planilla que no estaba en el catálogo`,
          }, tx)
        }
        return found
      })
      if (resolved.created) ctx.note({ kind: "cargo_pendiente", item: resolved.position.name, detail: "no estaba en el catálogo: se creó pendiente de revisión y sin capacidades; complétalo en Administración › Cargos" })
      result = { ok: true, id: resolved.position.id, name: resolved.position.name, isSystem: resolved.position.isSystem }
    } else {
      try {
        const found = await resolveWorkerPosition({ name: text }, { createIfMissing: false }, db)
        result = { ok: true, id: found.position.id, name: found.position.name, isSystem: found.position.isSystem }
      } catch (error) {
        if (!(error instanceof WorkerPositionDomainError) || error.code !== "NOT_FOUND") throw error
        const planned = planForCargo(text)
        if (planned) result = { ok: true, id: null, name: planned.name, isSystem: false }
        else {
          ctx.note({ kind: "cargo_pendiente", item: text, detail: "no está en el catálogo ni en el plan: al aplicar se crearía pendiente de revisión y sin capacidades" })
          result = { ok: true, id: null, name: text, isSystem: false }
        }
      }
    }
  } catch (error) {
    if (!(error instanceof WorkerPositionDomainError)) throw error
    result = { ok: false, message: error.message }
  }
  cache.set(key, result)
  return result
}

/** Nombre completo como conjunto de palabras: sin tildes, mayúsculas ni orden. */
export function nameKey(name: string): string {
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().split(/[^a-zñ]+/).filter(Boolean).sort().join(" ")
}

async function runWorkers(ctx: Ctx, rows: WorkerRow[]) {
  ctx.step = STEP.workers
  const [dbWorkers, positions] = await Promise.all([
    db.select({ id: workers.id, rut: workers.rut, firstName: workers.firstName, lastName: workers.lastName, worksiteId: workers.worksiteId, positionId: workers.positionId, isActive: workers.isActive }).from(workers),
    db.select().from(workerPositions),
  ])
  const positionById = new Map(positions.map((position) => [position.id, position]))
  const byRut = new Map<string, typeof dbWorkers>()
  for (const worker of dbWorkers) {
    if (!worker.rut) continue
    const key = cleanRut(worker.rut)
    byRut.set(key, [...(byRut.get(key) ?? []), worker])
  }
  // La planilla escribe «APELLIDOS NOMBRES» y Chome guarda nombre y apellido
  // por separado: se compara el conjunto de palabras, sin orden ni tildes.
  const byName = new Map<string, typeof dbWorkers>()
  for (const worker of dbWorkers) {
    const key = nameKey(`${worker.firstName} ${worker.lastName}`)
    if (key) byName.set(key, [...(byName.get(key) ?? []), worker])
  }
  /** Trabajador único con ese nombre completo, o null si no hay o hay más de uno. */
  const uniqueByName = (name: string | null | undefined) => {
    const found = byName.get(nameKey(name ?? "")) ?? []
    return found.length === 1 ? found[0] : null
  }
  const cargoCache = new Map<string, CargoResolution>()
  const seenRuts = new Set<string>()
  const usedWorkerIds = new Set<string>()
  /** Clasificaciones pendientes de aplicar, agrupadas por cargo destino. */
  const toAssign = new Map<string, Array<{ workerId: string; label: string; positionName: string }>>()

  for (const row of rows) {
    const label = workerLabel(row)
    const omit = (action: string, detail: string) => {
      ctx.report({ item: label, action, result: "omitido", detail })
      ctx.note({ kind: "fila_omitida", item: label, detail: `Trabajadores, fila ${row.row}: ${detail}` })
    }
    if (!row.rut) { omit("trabajador de la planilla", "no trae RUT"); continue }
    const repeatedInSheet = seenRuts.has(row.rut)
    seenRuts.add(row.rut)
    const worksite = ctx.resolveWorksite(row.faena)
    if (!worksite) { omit("trabajador de la planilla", `faena «${row.faena ?? ""}» sin resolver`); continue }
    const matches = repeatedInSheet ? [] : (byRut.get(row.rut) ?? [])
    if (matches.length > 1) { omit("trabajador de la planilla", "su RUT está repetido en Chome"); continue }
    let existing = matches[0]
    if (!existing) {
      // RUT repetido en la planilla (error de digitación) o que no calza con
      // Chome: antes de omitir o de crear un duplicado, se busca por nombre.
      const named = uniqueByName(row.name)
      if (named && !usedWorkerIds.has(named.id)) {
        existing = named
        ctx.note({
          kind: "identificado_por_nombre",
          item: label,
          detail: `Trabajadores, fila ${row.row}: ${repeatedInSheet ? "su RUT repite el de otra fila" : "su RUT no está en Chome"}; se identificó por nombre. Corrige el RUT en la planilla.`,
        })
      } else if (repeatedInSheet) {
        omit("trabajador de la planilla", "RUT repetido en la planilla y el nombre no identifica a un único trabajador de Chome")
        continue
      }
    }
    if (existing) usedWorkerIds.add(existing.id)

    if (!existing) {
      const action = "crear trabajador"
      const split = splitFullName(row.name)
      if (!split) { omit(action, "el nombre no se puede separar en nombre y apellido"); continue }
      if (split.firstName.length > 60 || split.lastName.length > 60) { omit(action, "el nombre o el apellido superan los 60 caracteres"); continue }
      if (!validateRut(row.rut)) { omit(action, "el RUT no es válido (dígito verificador)"); continue }
      const cargo = await resolveCargo(ctx, row.cargo ?? "", cargoCache)
      if (!cargo.ok) { omit(action, cargo.message); continue }
      const summary = `nombre de ${split.firstWords} palabra(s), apellidos de ${split.lastWords}; cargo «${cargo.name}»`
      if (!ctx.apply) {
        ctx.workerRefs.set(row.row, { workerId: null, label })
        ctx.report({ item: label, action, result: "dry-run", detail: summary })
        continue
      }
      const id = nanoid()
      await db.transaction(async (tx) => {
        const position = await tx.query.workerPositions.findFirst({ where: eq(workerPositions.id, cargo.id!) })
        if (!position) throw new Error("El cargo resuelto desapareció mientras se aplicaba.")
        await insertWorker({
          id, rut: row.rut, firstName: split.firstName, lastName: split.lastName,
          positionId: position.id, position: position.name, worksiteId: worksite.id, isActive: true,
        }, tx)
        await recordWorkerPositionChange({
          workerId: id, nextPosition: position, source: "import",
          reason: "Cargo asignado al crear el trabajador desde la planilla de vencimientos 2026-11", actorUserId: ctx.actor.userId,
        }, tx)
        await recordAudit({
          userId: ctx.actor.userId,
          userEmail: ctx.actor.email,
          action: "create",
          entityType: "worker",
          entityId: id,
          newState: { firstName: split.firstName, lastName: split.lastName, rut: row.rut, position: position.name },
          reason: REASON,
          worksiteId: worksite.id,
        }, tx)
      })
      ctx.workerRefs.set(row.row, { workerId: id, label })
      ctx.report({ item: label, action, result: "aplicado", detail: summary })
      continue
    }

    if (!existing.isActive) {
      ctx.report({ item: label, action: "trabajador de la planilla", result: "omitido", detail: "está inactivo en Chome: no se clasifica ni se le registra licencia" })
      ctx.note({ kind: "inactivo", item: label, detail: `Trabajadores, fila ${row.row}: reactívalo en Trabajadores y vuelve a correr el script` })
      continue
    }
    ctx.workerRefs.set(row.row, { workerId: existing.id, label })
    if (existing.worksiteId !== worksite.id) {
      ctx.note({ kind: "faena_distinta", item: label, detail: `en Chome está en «${ctx.worksiteNameById.get(existing.worksiteId) ?? existing.worksiteId}» y la planilla dice «${worksite.name}»` })
    }

    const action = "asignar cargo"
    if (!row.cargo) {
      ctx.report({ item: label, action, result: "omitido", detail: "la planilla no trae cargo" })
      ctx.note({ kind: "dato_vacio", item: label, detail: `Trabajadores, fila ${row.row}: sin cargo; sigue sin clasificar` })
      continue
    }
    const cargo = await resolveCargo(ctx, row.cargo, cargoCache)
    if (!cargo.ok) { ctx.report({ item: label, action, result: "omitido", detail: cargo.message }); continue }
    const currentPosition = existing.positionId ? positionById.get(existing.positionId) : undefined
    if (cargo.id !== null && existing.positionId === cargo.id) { ctx.report({ item: label, action: `${action} «${cargo.name}»`, result: "ya estaba" }); continue }
    // Una clasificación hecha a mano no se pisa: sólo se completa lo que está sin clasificar.
    if (existing.positionId && currentPosition && !currentPosition.isSystem) {
      ctx.report({ item: label, action: `${action} «${cargo.name}»`, result: "omitido", detail: `ya tiene el cargo «${currentPosition.name}»; no se cambia` })
      continue
    }
    if (!ctx.apply) { ctx.report({ item: label, action: `${action} «${cargo.name}»`, result: "dry-run" }); continue }
    toAssign.set(cargo.id!, [...(toAssign.get(cargo.id!) ?? []), { workerId: existing.id, label, positionName: cargo.name }])
  }

  for (const [positionId, group] of toAssign) {
    const action = `asignar cargo «${group[0]!.positionName}»`
    try {
      const { changed } = await db.transaction((tx) => bulkAssignWorkerPosition({
        workerIds: group.map((entry) => entry.workerId),
        positionId,
        reason: REASON,
        actorUserId: ctx.actor.userId,
        actorEmail: ctx.actor.email,
        source: "import",
      }, tx))
      const changedIds = new Set(changed)
      for (const entry of group) ctx.report({ item: entry.label, action, result: changedIds.has(entry.workerId) ? "aplicado" : "ya estaba" })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      for (const entry of group) ctx.report({ item: entry.label, action, result: "omitido", detail: message })
    }
  }
}

/* ── Licencias ────────────────────────────────────────────────────────────── */

async function runLicenses(ctx: Ctx, rows: WorkerRow[]) {
  ctx.step = STEP.licenses
  const licenses = await db.select().from(workerDriverLicenses)
  const licenseByWorker = new Map(licenses.map((license) => [license.workerId, license]))

  for (const row of rows) {
    const ref = ctx.workerRefs.get(row.row)
    if (!ref) continue
    const { label } = ref
    const action = "licencia de conducir"
    const { classes, unrecognized } = parseLicenseClasses(row.classes)
    if (unrecognized.length > 0) {
      ctx.note({ kind: "clase_no_reconocida", item: label, detail: `no se reconoció «${unrecognized.join("», «")}» en la columna Clase licencia` })
    }
    if (classes.length === 0) {
      ctx.report({ item: label, action, result: "omitido", detail: row.classes ? "ninguna clase de licencia reconocida" : "la planilla no trae clase de licencia" })
      if (!row.classes) ctx.note({ kind: "dato_vacio", item: label, detail: `Trabajadores, fila ${row.row}: sin clase de licencia` })
      continue
    }
    if (row.unreadableDate) ctx.note({ kind: "dato_vacio", item: label, detail: `Trabajadores, fila ${row.row}: la fecha de la licencia no se pudo leer` })
    else if (!row.expiresAt) ctx.note({ kind: "dato_vacio", item: label, detail: `Trabajadores, fila ${row.row}: licencia sin fecha de vencimiento (se guarda sólo con sus clases)` })

    let notes = row.notes
    if (notes && notes.length > DRIVER_LICENSE_NOTES_MAX) {
      ctx.note({ kind: "dato_vacio", item: label, detail: `la observación supera ${DRIVER_LICENSE_NOTES_MAX} caracteres; se recortó` })
      notes = notes.slice(0, DRIVER_LICENSE_NOTES_MAX)
    }
    const parsed = driverLicenseSchema.safeParse({ workerId: ref.workerId ?? "pendiente", classes, expiresAt: row.expiresAt, notes })
    if (!parsed.success) {
      ctx.report({ item: label, action, result: "omitido", detail: parsed.error.issues[0]?.message ?? "datos de licencia inválidos" })
      continue
    }

    // Lo que hay que revisar sale de la planilla, haya o no escritura.
    if (row.expiresAt && civilDaysBetween(ctx.today, row.expiresAt) < 0) {
      ctx.note({ kind: "licencia_vencida", item: label, detail: `${parsed.data.classes.join("/")} · venció hace ${civilDaysBetween(row.expiresAt, ctx.today)} días (${row.expiresAt})${row.notes ? ` · «${row.notes.slice(0, 60)}»` : ""}` })
    }
    const plan = row.cargo ? planForCargo(row.cargo) : null
    const requiresLicense = plan?.capabilities.some((code) => LICENSE_REQUIRING_CAPABILITY_CODES.includes(code)) ?? false
    if (plan && requiresLicense && plan.requiredLicenseClasses.length > 0 && !licenseSatisfies(parsed.data.classes, plan.requiredLicenseClasses)) {
      ctx.note({ kind: "clase_insuficiente", item: label, detail: `tiene ${formatLicenseClassList(parsed.data.classes, "y")}; el cargo «${plan.name}» exige ${formatLicenseClassList(plan.requiredLicenseClasses)}` })
    }

    const detail = `${parsed.data.classes.join("/")}${parsed.data.expiresAt ? ` · vence ${parsed.data.expiresAt}` : " · sin fecha"}`
    if (ref.workerId === null) { ctx.report({ item: label, action, result: "dry-run", detail: `${detail}; el trabajador se crea en este mismo plan` }); continue }
    if (!ctx.apply) {
      const current = licenseByWorker.get(ref.workerId)
      const same = current
        && current.classes.slice().sort().join() === parsed.data.classes.slice().sort().join()
        && current.expiresAt === parsed.data.expiresAt
        && (current.notes ?? null) === (parsed.data.notes ?? null)
      ctx.report({ item: label, action, result: same ? "ya estaba" : "dry-run", ...(same ? {} : { detail }) })
      continue
    }
    const outcome = await db.transaction((tx) => writeDriverLicense(tx, parsed.data, { userId: ctx.actor.userId, userEmail: ctx.actor.email }, REASON))
    ctx.report({ item: label, action, result: outcome === "unchanged" ? "ya estaba" : "aplicado", ...(outcome === "unchanged" ? {} : { detail: `${outcome === "created" ? "registrada" : "actualizada"}: ${detail}` }) })
  }
}

/* ── Orquestación ─────────────────────────────────────────────────────────── */

export interface VencimientosOptions {
  actorEmail: string
  apply?: boolean
  /** Ruta de la planilla. */
  file?: string
  /** O su contenido (para pruebas). */
  buffer?: Buffer | ArrayBuffer
}

/** Aplica el plan completo (o sólo informa, sin `apply`). */
export async function applyVencimientosPlanilla202611(options: VencimientosOptions): Promise<VencimientosReport> {
  const apply = options.apply ?? false
  if (!options.file && !options.buffer) throw new Error("Falta la planilla: --file <ruta del .xlsx>.")
  const actorRow = await db.query.users.findFirst({ where: and(eq(users.email, options.actorEmail), eq(users.isActive, true)), columns: { id: true, email: true } })
  if (!actorRow) throw new Error(`No hay un usuario activo con el correo ${options.actorEmail}: la bitácora necesita un responsable.`)
  const source = options.buffer ?? await readFile(path.resolve(options.file!))
  const data = await readPlanilla(source)

  const allWorksites = await db.select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive }).from(worksites)
  const activeWorksites = allWorksites.filter((worksite) => worksite.isActive)
  const outcomes: Outcome[] = []
  const review: ReviewNote[] = [...data.skipped]
  const ctx: Ctx = {
    apply,
    actor: { userId: actorRow.id, email: actorRow.email },
    today: todayInChile(),
    step: "",
    report: (outcome) => { outcomes.push({ step: ctx.step, ...outcome }) },
    note: (note) => { review.push(note) },
    resolveWorksite: (raw) => {
      if (!raw) return null
      const target = WORKSITE_ALIASES.get(worksiteKey(raw)) ?? raw
      const matches = activeWorksites.filter((worksite) => worksiteKey(worksite.name) === worksiteKey(target))
      return matches.length === 1 ? { id: matches[0]!.id, name: matches[0]!.name } : null
    },
    worksiteNameById: new Map(allWorksites.map((worksite) => [worksite.id, worksite.name])),
    plannedTypeSlugs: new Set(),
    plannedPlates: new Set(),
    omittedPlates: new Set(),
    workerRefs: new Map(),
  }

  await runEquipmentTypes(ctx)
  reportWorksites(ctx, data)
  await runVehicles(ctx, data.machines)
  await reviewDuplicateCodes(ctx, data.machines)
  await runVehicleDates(ctx, data.machines)
  await runPositionCatalog(ctx)
  await runWorkers(ctx, data.workers)
  await runLicenses(ctx, data.workers)

  return { outcomes, review }
}

export function printVencimientosReport(report: VencimientosReport, apply: boolean) {
  const steps = [...new Set(report.outcomes.map((outcome) => outcome.step))]
  for (const step of steps) {
    console.log(`\n[${step}]`)
    const own = report.outcomes.filter((outcome) => outcome.step === step)
    // Lo que no cambió y no dice nada se cuenta; imprimirlo tapa lo importante.
    const quiet = own.filter((outcome) => outcome.result === "ya estaba" && !outcome.detail)
    for (const o of own.filter((outcome) => !quiet.includes(outcome))) {
      console.log(`  ${o.item.padEnd(22)} ${o.action.padEnd(48)} ${o.result}${o.detail ? ` — ${o.detail}` : ""}`)
    }
    const byAction = new Map<string, number>()
    for (const o of quiet) byAction.set(o.action, (byAction.get(o.action) ?? 0) + 1)
    for (const [action, count] of byAction) console.log(`  ${count} ya estaban: ${action}`)
  }

  const count = (result: Result) => report.outcomes.filter((outcome) => outcome.result === result).length
  console.log(
    `\n${apply ? `${count("aplicado")} aplicada(s)` : `${count("dry-run")} por aplicar (dry-run)`}, ` +
    `${count("ya estaba")} ya estaban, ${count("omitido")} omitida(s).`,
  )

  console.log(`\nA revisar (${report.review.length}):`)
  if (report.review.length === 0) console.log("  nada")
  for (const kind of Object.keys(REVIEW_TITLES) as ReviewKind[]) {
    const notes = report.review.filter((note) => note.kind === kind)
    if (notes.length === 0) continue
    console.log(`\n  ${REVIEW_TITLES[kind]} (${notes.length})`)
    for (const note of notes) console.log(`    - ${note.item}: ${note.detail}`)
  }
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  const value = index >= 0 ? argv[index + 1] : undefined
  return value && !value.startsWith("--") ? value : undefined
}

export async function main(argv = process.argv) {
  const apply = argv.includes("--apply")
  const file = argValue(argv, "--file")
  const actorEmail = argValue(argv, "--actor-email")
  if (!file) throw new Error("Falta --file <ruta del .xlsx>.")
  if (!actorEmail) throw new Error("Falta --actor-email <correo>: la bitácora necesita un responsable.")
  console.log(`Planilla de vencimientos 2026-11 — ${apply ? "escribiendo" : "dry-run"}`)
  printVencimientosReport(await applyVencimientosPlanilla202611({ actorEmail, file, apply }), apply)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}
