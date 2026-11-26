import { CHART_COLORS } from "@/lib/chart-palette"
import { bucketLabel, listBuckets } from "@/lib/indicators/period"
import { ACTION_TYPES, SPECIALTIES, type ActionTypeOrUnknown, type Specialty } from "@/lib/mantencion/action-type"
import { nameKey } from "@/lib/mantencion/normalize"
import type { MaintenanceHistoryRow, WorkSource } from "@/lib/services/mantencion/maintenance-work"

/**
 * El «Historial de mantenciones»: lo que la lista, el resumen, la matriz y el Excel comparten. Funciones PURAS
 * sobre las filas que entrega `loadMaintenanceHistory`: se carga una vez y de ese mismo arreglo salen la tabla,
 * las cifras y los gráficos, así que no pueden contradecirse. Los filtros de período, faena y equipo se aplican en
 * la consulta (son los que cambian qué se lee); el resto —búsqueda, origen, tipo, taller y especialidad— se aplican
 * aquí, sobre lo ya leído.
 */

export const HISTORY_PATH = "/mantencion/registros/historicos"

export type HistoryView = "historial" | "matriz" | "formularios"
export const HISTORY_VIEWS: readonly HistoryView[] = ["historial", "matriz", "formularios"]

export const HISTORY_SOURCES: readonly WorkSource[] = ["historial", "ot", "registro"]
/** Cómo se dice el origen de un trabajo en pantalla (el Excel del Panel conserva su propio rótulo). */
export const HISTORY_SOURCE_LABELS: Record<WorkSource, string> = {
  historial: "Formulario",
  ot: "Orden de trabajo",
  registro: "Registro firmado",
}

/** Color de cada tipo en los gráficos, la matriz y la línea de tiempo: el mismo de `WorkTypeChart` del Panel. Nunca va solo: siempre con la etiqueta. */
export const ACTION_TYPE_COLORS: Record<ActionTypeOrUnknown, string> = {
  preventiva: CHART_COLORS.brand,
  correctiva: CHART_COLORS.blue,
  predictiva: CHART_COLORS.teal,
  sin_clasificar: CHART_COLORS.neutral,
}

/** Variante de `Badge` de cada tipo (texto `-ink` sobre `-tint`). */
export const ACTION_TYPE_BADGE: Record<ActionTypeOrUnknown, "primary" | "info" | "success" | "neutral"> = {
  preventiva: "primary",
  correctiva: "info",
  predictiva: "success",
  sin_clasificar: "neutral",
}

export const HISTORY_SORTS = ["fecha", "equipo", "tipo", "dias", "horas"] as const
export type HistorySort = (typeof HISTORY_SORTS)[number]
export type HistoryGroup = "equipo" | "mes"
export type HistoryWorkshop = "interno" | "externo"
export type HistoryPeriodKind = "12m" | "todo" | "personalizado"

export const HISTORY_PAGE_SIZE = 25
/** Tope de filas de un libro de Excel (el mismo del Excel del Panel). La lista lee todas las del período: hoy son unos pocos miles. */
export const HISTORY_MAX_ROWS = 20_000
/** Equipos que dibuja la matriz; el resto se alcanza filtrando por faena. */
export const MATRIX_MAX_ROWS = 60
/** Meses que dibuja la matriz y el gráfico por mes. */
export const MATRIX_MAX_MONTHS = 14

type RawParams = Record<string, string | string[] | undefined>

export interface HistoryParams {
  view: HistoryView
  /** Búsqueda de texto (la ruta tiene su propio campo: está en `ROUTES_WITH_OWN_SEARCH`). */
  q: string
  vehicleId: string
  worksiteId: string
  from: string
  to: string
  period: HistoryPeriodKind
  /** La URL pidió un rango imposible (fecha inexistente, inicio posterior al término): se usó el por defecto y la página lo dice. */
  periodInvalid: boolean
  source: WorkSource | null
  type: ActionTypeOrUnknown | null
  workshop: HistoryWorkshop | null
  specialty: Specialty | null
  sort: HistorySort
  dir: "asc" | "desc"
  group: HistoryGroup | null
  page: number
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? ""
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/

function isPlainDate(value: string): boolean {
  if (!PLAIN_DATE.test(value)) return false
  const [y = 0, m = 0, d = 0] = value.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** Primer día del mes de `plainDate`, corrido `months` meses (negativo: hacia atrás). */
export function monthStart(plainDate: string, months = 0): string {
  const [y = 0, m = 1] = plainDate.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10)
}

/** `{ from, to }` del mes `YYYY-MM`. */
export function monthRange(monthKey: string): { from: string; to: string } {
  const [y = 0, m = 1] = monthKey.split("-").map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${monthKey}-01`, to: `${monthKey}-${String(last).padStart(2, "0")}` }
}

const ALL_FROM = "2000-01-01"
/** Para ordenar «sin faena» al final. */
const LAST_SORT = "\uffff"

/**
 * El período de la vista. Sin parámetros: los últimos 12 meses (los que se miran en una auditoría anual).
 * `periodo=todo`: todo el historial. `desde`/`hasta` válidos: ese rango. Nada pasa de hoy: una fecha futura es un
 * error de digitación del formulario, no trabajo por venir. Un rango imposible vuelve al período por defecto.
 */
export function resolveHistoryPeriod(raw: RawParams, today: string): { from: string; to: string; period: HistoryPeriodKind; invalid: boolean } {
  const fallback = { from: monthStart(today, -11), to: today }
  if (first(raw.periodo) === "todo") return { from: ALL_FROM, to: today, period: "todo", invalid: false }
  const rawFrom = first(raw.desde).slice(0, 10)
  const rawTo = first(raw.hasta).slice(0, 10)
  if (!rawFrom && !rawTo) return { ...fallback, period: "12m", invalid: false }
  const badInput = (rawFrom !== "" && !isPlainDate(rawFrom)) || (rawTo !== "" && !isPlainDate(rawTo))
  const from = isPlainDate(rawFrom) ? rawFrom : ALL_FROM
  const to = isPlainDate(rawTo) ? (rawTo > today ? today : rawTo) : today
  if (badInput || from > to) return { ...fallback, period: "12m", invalid: true }
  return { from, to, period: "personalizado", invalid: false }
}

const oneOf = <T extends string>(value: string, options: readonly T[]): T | null => (options as readonly string[]).includes(value) ? (value as T) : null

export function parseHistoryParams(raw: RawParams, today: string): HistoryParams {
  const period = resolveHistoryPeriod(raw, today)
  const pageNumber = Number(first(raw.page))
  // Un enlace anterior al rediseño con `vinculo` es de la conciliación: va a «Respuestas de formularios».
  const view = oneOf(first(raw.vista), HISTORY_VIEWS) ?? (first(raw.vinculo) ? "formularios" : "historial")
  const sort = oneOf(first(raw.orden), HISTORY_SORTS) ?? "fecha"
  return {
    view,
    q: first(raw.q).trim().slice(0, 100),
    vehicleId: first(raw.equipo).slice(0, 64),
    worksiteId: first(raw.faena).slice(0, 64),
    from: period.from,
    to: period.to,
    period: period.period,
    periodInvalid: period.invalid,
    source: oneOf(first(raw.origen), HISTORY_SOURCES),
    type: oneOf(first(raw.tipo), [...ACTION_TYPES, "sin_clasificar"] as const),
    workshop: oneOf(first(raw.taller), ["interno", "externo"] as const),
    specialty: oneOf(first(raw.especialidad), SPECIALTIES),
    sort,
    dir: first(raw.dir) === "asc" ? "asc" : first(raw.dir) === "desc" ? "desc" : sort === "fecha" ? "desc" : "asc",
    group: oneOf(first(raw.agrupar), ["equipo", "mes"] as const),
    page: Number.isInteger(pageNumber) && pageNumber > 0 ? Math.min(pageNumber, 100_000) : 1,
  }
}

/** Lo que se puede cambiar de una vista a otra al armar un enlace. `null` quita el filtro. */
export type HistoryOverrides = Partial<{
  view: HistoryView
  q: string | null
  vehicleId: string | null
  worksiteId: string | null
  from: string | null
  to: string | null
  period: HistoryPeriodKind
  source: WorkSource | null
  type: ActionTypeOrUnknown | null
  workshop: HistoryWorkshop | null
  specialty: Specialty | null
  sort: HistorySort
  dir: "asc" | "desc"
  group: HistoryGroup | null
  page: number
}>

/**
 * El enlace de una vista con unos parámetros cambiados. Omite lo que es el valor por defecto (los últimos 12 meses,
 * orden por fecha descendente, vista Historial, página 1) y vuelve a la página 1 al cambiar un filtro.
 */
export function historyHref(params: HistoryParams, overrides: HistoryOverrides = {}): string {
  const next = { ...params, ...overrides } as HistoryParams
  // Al elegir otra columna, el sentido vuelve al de esa columna (la fecha baja; el resto sube), salvo que se pida uno.
  if (overrides.sort !== undefined && overrides.dir === undefined) next.dir = next.sort === "fecha" ? "desc" : "asc"
  const resetsPage = Object.keys(overrides).some((key) => key !== "page")
  const query = new URLSearchParams()
  const set = (key: string, value: string | null | undefined) => { if (value) query.set(key, value) }
  if (next.view !== "historial") set("vista", next.view)
  set("q", next.q)
  set("equipo", next.vehicleId)
  set("faena", next.worksiteId)
  if (next.period === "todo") query.set("periodo", "todo")
  else if (next.period === "personalizado") { set("desde", next.from); set("hasta", next.to) }
  set("origen", next.source)
  set("tipo", next.type)
  set("taller", next.workshop)
  set("especialidad", next.specialty)
  if (next.sort !== "fecha") set("orden", next.sort)
  const defaultDir = next.sort === "fecha" ? "desc" : "asc"
  if (next.dir !== defaultDir) set("dir", next.dir)
  set("agrupar", next.group)
  const page = overrides.page ?? (resetsPage ? 1 : next.page)
  if (page > 1) query.set("page", String(page))
  const text = query.toString()
  return text ? `${HISTORY_PATH}?${text}` : HISTORY_PATH
}

// ── Filtros, orden y grupos sobre lo ya leído ──────────────────────────────

const rowSearchText = (row: MaintenanceHistoryRow) => nameKey([
  row.equipmentLabel, row.worksiteName ?? "", row.reference, row.detail.orderText ?? "", row.detail.description,
  row.detail.responsible ?? "", row.detail.contract ?? "", row.detail.reading ?? "",
].join(" "))

/**
 * Aplica la búsqueda, el origen, el tipo, el taller y la especialidad. `skip` deja sin aplicar uno de ellos: así los
 * conteos del selector de tipo se calculan con todos los demás filtros puestos.
 */
export function filterHistoryRows(rows: readonly MaintenanceHistoryRow[], params: HistoryParams, skip?: "type"): MaintenanceHistoryRow[] {
  const query = params.q ? nameKey(params.q) : ""
  return rows.filter((row) => {
    if (params.source && row.source !== params.source) return false
    if (skip !== "type" && params.type && row.actionType !== params.type) return false
    if (params.workshop && row.external !== (params.workshop === "externo")) return false
    if (params.specialty && !row.detail.specialties.includes(params.specialty)) return false
    return !query || rowSearchText(row).includes(query)
  })
}

const TYPE_ORDER: Record<ActionTypeOrUnknown, number> = { correctiva: 0, preventiva: 1, predictiva: 2, sin_clasificar: 3 }

/**
 * Un criterio de orden por la URL; el empate se resuelve siempre igual (fecha más reciente, equipo, id). En las columnas
 * numéricas (horas y días) lo «sin dato» va siempre al final, suba o baje el orden: no es un cero ni el menor valor.
 */
export function sortHistoryRows(rows: readonly MaintenanceHistoryRow[], sort: HistorySort, dir: "asc" | "desc"): MaintenanceHistoryRow[] {
  const sign = dir === "asc" ? 1 : -1
  const tie = (a: MaintenanceHistoryRow, b: MaintenanceHistoryRow) =>
    b.date.localeCompare(a.date) || a.equipmentLabel.localeCompare(b.equipmentLabel, "es", { numeric: true }) || a.id.localeCompare(b.id)
  const numeric = (pick: (row: MaintenanceHistoryRow) => number | null) => (a: MaintenanceHistoryRow, b: MaintenanceHistoryRow): number => {
    const va = pick(a)
    const vb = pick(b)
    if (va === null || vb === null) return va === vb ? tie(a, b) : va === null ? 1 : -1
    return sign * (va - vb) || tie(a, b)
  }
  const text = (compare: (a: MaintenanceHistoryRow, b: MaintenanceHistoryRow) => number) => (a: MaintenanceHistoryRow, b: MaintenanceHistoryRow): number => sign * compare(a, b) || tie(a, b)
  const comparator =
    sort === "horas" ? numeric((row) => row.laborHours)
    : sort === "dias" ? numeric((row) => row.workshopDays)
    : sort === "equipo" ? text((a, b) => a.equipmentLabel.localeCompare(b.equipmentLabel, "es", { numeric: true }))
    : sort === "tipo" ? text((a, b) => TYPE_ORDER[a.actionType] - TYPE_ORDER[b.actionType])
    : text((a, b) => a.date.localeCompare(b.date))
  return [...rows].sort(comparator)
}

export interface HistoryGroupBlock {
  key: string
  label: string
  rows: MaintenanceHistoryRow[]
}

export const NO_EQUIPMENT_KEY = "__sin_equipo__"

/** Agrupa las filas ya ordenadas (conservan su orden dentro de cada grupo; los grupos, el de su primera fila). */
export function groupHistoryRows(rows: readonly MaintenanceHistoryRow[], by: HistoryGroup): HistoryGroupBlock[] {
  const groups = new Map<string, HistoryGroupBlock>()
  for (const row of rows) {
    const key = by === "equipo" ? row.vehicleId ?? NO_EQUIPMENT_KEY : row.date.slice(0, 7)
    const label = by === "equipo" ? row.vehicleId ? row.equipmentLabel : "Equipo sin identificar" : bucketLabel(key, "month")
    const group = groups.get(key) ?? { key, label, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  return [...groups.values()]
}

/** Trabajos por tipo, para los conteos del selector. */
export function countByType(rows: readonly MaintenanceHistoryRow[]): Record<ActionTypeOrUnknown, number> {
  const counts: Record<ActionTypeOrUnknown, number> = { correctiva: 0, preventiva: 0, predictiva: 0, sin_clasificar: 0 }
  for (const row of rows) counts[row.actionType] += 1
  return counts
}

// ── Ventana de los gráficos y matriz equipos × meses ───────────────────────

/** Meses que dibujan el gráfico y la matriz: los del período, con un mínimo de 6 y un tope de 14 (los más recientes). */
export function historyMonths(from: string, to: string): string[] {
  const start = monthStart(to, -(MATRIX_MAX_MONTHS - 1))
  const floor = monthStart(to, -5)
  const requested = monthStart(from)
  const chosen = requested > floor ? floor : requested < start ? start : requested
  return listBuckets(chosen, to, "month")
}

export interface MatrixCell {
  total: number
  correctiva: number
  preventiva: number
  predictiva: number
  sin_clasificar: number
}

export interface MatrixRow {
  vehicleId: string
  label: string
  worksiteName: string | null
  total: number
  correctives: number
  /** Por mes `YYYY-MM`; un mes sin trabajo no tiene celda. */
  cells: Record<string, MatrixCell>
}

export interface WorkMatrix {
  months: string[]
  rows: MatrixRow[]
  /** Equipos con trabajo que no caben en `rows`. */
  hiddenRows: number
  /** Trabajos del período sin equipo vinculado: no tienen fila. */
  withoutEquipment: number
  /** El conteo más alto de una celda (escala de la intensidad). */
  maxCell: number
}

/** De qué se pinta una celda: un solo tipo con su color, o «mixta» cuando hay dos o más tipos distintos en el mes. */
export type MatrixCellKind = ActionTypeOrUnknown | "mixta"

export function matrixCellKind(cell: MatrixCell): MatrixCellKind {
  const present = (["correctiva", "preventiva", "predictiva", "sin_clasificar"] as const).filter((type) => cell[type] > 0)
  return present.length === 1 ? present[0]! : "mixta"
}

/**
 * Equipos × meses: cuántos trabajos tuvo cada equipo en cada mes, y de qué tipo. Los equipos van agrupados por
 * faena y, dentro de ella, el que más correctivas tuvo primero. Las filas que caen fuera de `months` no cuentan.
 */
export function buildWorkMatrix(
  rows: ReadonlyArray<Pick<MaintenanceHistoryRow, "vehicleId" | "equipmentLabel" | "worksiteName" | "date" | "actionType">>,
  months: readonly string[],
  limit = MATRIX_MAX_ROWS,
): WorkMatrix {
  const wanted = new Set(months)
  const byVehicle = new Map<string, MatrixRow>()
  let withoutEquipment = 0
  for (const row of rows) {
    const month = row.date.slice(0, 7)
    if (!wanted.has(month)) continue
    if (!row.vehicleId) { withoutEquipment += 1; continue }
    const item = byVehicle.get(row.vehicleId) ?? { vehicleId: row.vehicleId, label: row.equipmentLabel, worksiteName: row.worksiteName, total: 0, correctives: 0, cells: {} }
    const cell = item.cells[month] ?? { total: 0, correctiva: 0, preventiva: 0, predictiva: 0, sin_clasificar: 0 }
    cell.total += 1
    cell[row.actionType] += 1
    item.cells[month] = cell
    item.total += 1
    if (row.actionType === "correctiva") item.correctives += 1
    byVehicle.set(row.vehicleId, item)
  }
  const all = [...byVehicle.values()].sort((a, b) =>
    (a.worksiteName ?? LAST_SORT).localeCompare(b.worksiteName ?? LAST_SORT, "es")
    || b.correctives - a.correctives || b.total - a.total || a.label.localeCompare(b.label, "es", { numeric: true }))
  // Con tope, se conservan los de más correctivas y recién después se ordenan por faena.
  const kept = all.length > limit
    ? [...all].sort((a, b) => b.correctives - a.correctives || b.total - a.total || a.label.localeCompare(b.label, "es", { numeric: true })).slice(0, limit)
      .sort((a, b) => (a.worksiteName ?? LAST_SORT).localeCompare(b.worksiteName ?? LAST_SORT, "es") || b.correctives - a.correctives || b.total - a.total || a.label.localeCompare(b.label, "es", { numeric: true }))
    : all
  const maxCell = kept.reduce((max, row) => Math.max(max, ...Object.values(row.cells).map((cell) => cell.total)), 0)
  return { months: [...months], rows: kept, hiddenRows: all.length - kept.length, withoutEquipment, maxCell }
}
