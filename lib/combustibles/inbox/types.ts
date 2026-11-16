/**
 * Bandeja única «Por revisar» (rediseño 2026-10-31). Junta en una lista lo que
 * espera la decisión de una persona y que antes vivía en dos colas y una marca
 * suelta de la bitácora:
 *   - `carga`   cargas de `fuel_equipment_loads` en `review_status='flagged'` (por decidir);
 *   - `caso`    casos de anomalía vigentes (`open`, `in_review`, `reopened`);
 *   - `patente` patentes o equipos de una importación que no están en la flota;
 *   - `pedido`  pedidos de revisión con nota (`fuel_review_marks` en `status='open'`).
 *
 * Módulo puro: lo usan la página, la hoja de decisión (cliente) y el Panel.
 */
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"

export const FUEL_INBOX_KINDS = ["carga", "caso", "patente", "pedido"] as const
export type FuelInboxKind = (typeof FUEL_INBOX_KINDS)[number]

/**
 * Lo que una persona decide ahora: una carga cuenta o no, una patente se
 * vincula, un pedido se revisa. Los casos abiertos son **seguimiento**: en prod
 * son mayormente de meses cerrados, y sumarlos escondía las cargas del mes
 * detrás de un total casi todo histórico (auditoría 2026-11-13, P2).
 *
 * Es la definición de «por revisar» en toda el área (decisión del usuario,
 * crítica 2026-11-15): el tile del Panel operacional, el contador del menú, el
 * paso 2 del Panel de combustible y la pestaña «Por decidir» de la bandeja
 * cuentan exactamente estos tipos.
 */
export const FUEL_INBOX_ACTION_KINDS = ["carga", "patente", "pedido"] as const satisfies readonly FuelInboxKind[]

/** Suma de lo que se decide ahora; `null` si la consulta de uno de esos tipos falló (nunca un total parcial). */
export function fuelInboxToDecide(byKind: Record<FuelInboxKind, number | null>): number | null {
  let sum = 0
  for (const kind of FUEL_INBOX_ACTION_KINDS) {
    const n = byKind[kind]
    if (n === null) return null
    sum += n
  }
  return sum
}

export const FUEL_INBOX_KIND_LABELS: Record<FuelInboxKind, string> = {
  carga: "Cargas por decidir",
  caso: "Casos",
  patente: "Patentes sin vincular",
  pedido: "Pedidas por una persona",
}

export interface FuelInboxDecided {
  /** «Cuenta», «No cuenta», «Resuelto», «Descartado», «Vinculada», «Revisado». */
  outcome: string
  byName: string | null
  at: string
  note: string | null
}

export interface FuelInboxRow {
  /** `${kind}:${id}`; el `id` de una patente es `${batchKind}:${batchId}:${plate}`. */
  key: string
  kind: FuelInboxKind
  id: string
  worksiteId: string | null
  worksiteName: string | null
  /** «CA-14 · KPRT·14», o la patente cuando no hay equipo. */
  equipmentLabel: string
  vehicleId: string | null
  /** Qué pasó, en palabras: «Lectura menor a la anterior», «Caso · Sello repetido». */
  title: string
  reasonCodes: string[]
  reasonLabel: string
  /** El dato que lo explica: «182.310 km; la carga anterior marcó 182.900 km». */
  datum: string
  /** Mes del dato ("YYYY-MM"): define la fecha límite. */
  dataMonth: string
  /** Fecha límite (`inboxDueDate`): fin de `dataMonth` si se detectó en él; detección + 7 días si ya había cerrado. */
  dueDate: string
  /** Desde cuándo espera (instante ISO). */
  waitingSince: string
  severity?: "low" | "medium" | "high" | "critical" | null
  assignee?: { id: string; name: string | null } | null
  decided?: FuelInboxDecided | null
  /** Ficha de la carga, del equipo o del lote al que se refiere. */
  href: string | null
  /** La sesión puede decidirlo (permiso + alcance). */
  canAct: boolean
}

/** Estado de un caso que todavía espera a una persona. */
export type FuelInboxOpenCaseStatus = "open" | "in_review" | "reopened"

/** Un caso dentro de un grupo de «En seguimiento»: su fila de siempre y lo que el lote necesita para no pisar un cambio ajeno. */
export interface FuelInboxCaseMember {
  row: FuelInboxRow
  status: FuelInboxOpenCaseStatus
  assigneeId: string | null
}

/**
 * «En seguimiento» por equipo y causa (crítica 2026-11-15, paso 4c): los casos abiertos de un
 * equipo por una misma regla, en una faena. En bodega_dev eran 330 casos en 123 grupos, con
 * hasta 14 casos del mismo equipo por la misma causa: decidirlos de a uno era repetir lo mismo.
 */
export interface FuelInboxCaseGroup {
  /** `caseGroupKey(faena, equipo, regla)`. */
  key: string
  ruleCode: string
  ruleLabel: string
  equipmentLabel: string
  vehicleId: string | null
  worksiteName: string | null
  /** La más alta del grupo. */
  severity: "low" | "medium" | "high" | "critical" | null
  /** La fecha límite más próxima del grupo y desde cuándo espera el más antiguo. */
  dueDate: string
  waitingSince: string
  /** Primer y último mes ("YYYY-MM") de los datos del grupo. */
  firstMonth: string
  lastMonth: string
  /** Ordenados como la lista de siempre: fecha límite y, a igual fecha, lo que más espera. */
  members: FuelInboxCaseMember[]
}

export interface FuelInboxCaseGroupPage {
  groups: FuelInboxCaseGroup[]
  totalGroups: number
  totalCases: number
  page: number
  pageSize: number
}

export function caseGroupKey(worksiteId: string | null, vehicleId: string | null, ruleCode: string): string {
  return `${worksiteId ?? "-"}|${vehicleId ?? "-"}|${ruleCode}`
}

export type FuelInboxView = "pendientes" | "decididas"

export interface FuelInboxFilters {
  view: FuelInboxView
  kind?: FuelInboxKind
  /** Sin `kind`, los tipos que entran (la pestaña «Por decidir» pasa `FUEL_INBOX_ACTION_KINDS`); sin ninguno de los dos, todos. */
  kinds?: readonly FuelInboxKind[]
  worksiteId?: string
  /** En «Decididas»: `cuenta` / `no-cuenta` para cargas. */
  decision?: string
  page: number
  pageSize?: number
}

export interface FuelInboxPage {
  rows: FuelInboxRow[]
  total: number
  page: number
  pageSize: number
}

export interface FuelInboxSummary {
  /** `null` cuando una consulta falló: nunca se afirma un cero falso. */
  total: number | null
  byKind: Record<FuelInboxKind, number | null>
  /** Instante ISO del pendiente más antiguo. */
  oldestWaitingSince: string | null
  /** Lo mismo por tipo: «lo más antiguo por decidir» no debe ser un caso de hace tres meses. */
  oldestByKind: Record<FuelInboxKind, string | null>
  /** Conteo por regla y producto; `null` indica que no se pudo calcular. */
  caseBreakdown?: FuelInboxCaseBreakdownItem[] | null
}

export type FuelInboxCaseProduct = "diesel" | "bluemax" | "gasoline" | "kerosene" | "historical_unattributed" | "unclassified" | "not_applicable"

export interface FuelInboxCaseBreakdownItem {
  ruleCode: string
  product: FuelInboxCaseProduct
  count: number
}

/** Casos pendientes de una regla: una fila de «Pendientes por regla». `ruleName` es `null` si la regla ya no tiene ficha. */
export interface FuelInboxCaseRule {
  ruleCode: string
  ruleName: string | null
  count: number
}

/** El dato que explica cada caso, para la hoja de decisión. */
export type FuelInboxEvidence =
  | { type: "readings"; unit: "km" | "h"; points: { at: string; reading: number; current: boolean }[] }
  | { type: "duplicate"; loads: { at: string; liters: number; reading: number | null; originLabel: string; href: string | null }[]; windowMinutes: number; litersTolerance: number }
  | { type: "capacity"; liters: number; capacity: number }
  | { type: "range"; value: number; unit: string; low: number; high: number; samples: number; lowerIsBetter: boolean }
  | { type: "late_entry"; loadedAt: string; registeredAt: string; reason: string }
  | { type: "text"; text: string }

export interface FuelInboxItemDetail {
  row: FuelInboxRow
  evidence: FuelInboxEvidence[]
  /** Comentarios de un caso o la nota de un pedido. */
  history: { at: string; byName: string | null; text: string }[]
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

/** Días de plazo de lo que se detecta cuando el mes de su dato ya cerró (decisión de producto 2026-11-13). */
export const INBOX_LATE_DETECTION_DAYS = 7

/** Último día del mes "YYYY-MM". */
export function lastDayOfMonth(dataMonth: string): string {
  const [year = 0, month = 1] = dataMonth.split("-").map(Number)
  return `${dataMonth}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`
}

/**
 * Fecha límite de un pendiente.
 *
 *  - Detectado dentro del mes de su dato (o sin fecha de detección): el último día de ese mes.
 *  - Detectado cuando su mes ya cerró (un caso histórico que aparece tarde): detección + 7 días.
 *
 * Sin la segunda regla, 482 casos de enero decían «venció el 31-01» y encabezaban la bandeja
 * sobre las cargas del mes, aunque nadie los conocía hasta ayer. `detectedAt` es el instante
 * en que el sistema supo del pendiente: `detectedAt` en un caso, `createdAt` en una carga, un
 * pedido o los registros de una patente; el día se mide en hora de Chile.
 *
 * `dueDateSql()` (queries.ts) repite esta misma regla en SQL: si se cambia una, se cambia la otra.
 */
export function inboxDueDate(dataMonth: string, detectedAt?: string | null): string {
  const monthEnd = lastDayOfMonth(dataMonth)
  if (!detectedAt) return monthEnd
  const ms = Date.parse(detectedAt)
  if (!Number.isFinite(ms)) return monthEnd
  const detectedDay = todayInChile(new Date(ms))
  return detectedDay.slice(0, 7) > dataMonth ? addDaysToPlainDate(detectedDay, INBOX_LATE_DETECTION_DAYS) : monthEnd
}

/** Fecha límite ascendente y, a igual fecha, lo que lleva más tiempo esperando primero. */
export function compareInboxRows(a: Pick<FuelInboxRow, "dueDate" | "waitingSince" | "key">, b: Pick<FuelInboxRow, "dueDate" | "waitingSince" | "key">): number {
  return a.dueDate.localeCompare(b.dueDate) || a.waitingSince.localeCompare(b.waitingSince) || a.key.localeCompare(b.key)
}

export function inboxRowKey(kind: FuelInboxKind, id: string): string {
  return `${kind}:${id}`
}

export function parseInboxRowKey(key: string | undefined | null): { kind: FuelInboxKind; id: string } | null {
  if (!key) return null
  const index = key.indexOf(":")
  if (index < 0) return null
  const kind = key.slice(0, index) as FuelInboxKind
  const id = key.slice(index + 1)
  return (FUEL_INBOX_KINDS as readonly string[]).includes(kind) && id ? { kind, id } : null
}
