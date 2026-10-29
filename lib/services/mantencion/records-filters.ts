/**
 * Filtros, orden y paginación de «Registros» (§10), tal como viajan en la URL.
 *
 * Módulo PURO (sin `@/db` ni `next/*`): lo importan la página (servidor), la
 * barra de filtros (cliente) y las exportaciones, para que la lista, los
 * indicadores y el Excel lean EXACTAMENTE los mismos parámetros. Un valor fuera
 * de las listas cerradas se descarta en vez de filtrar por algo que no existe:
 * un filtro inválido que da «cero registros» se lee como «no hay», no como
 * «la URL está mal».
 */

export const RECORD_SORT_KEYS = ["fecha", "folio", "equipo", "faena", "lectura"] as const
export type RecordSortKey = (typeof RECORD_SORT_KEYS)[number]
export type SortDirection = "asc" | "desc"

export const RECORD_ALERTS = ["salto", "fuera", "pauta", "duplicado"] as const
export type RecordAlertFilter = (typeof RECORD_ALERTS)[number]

export const RECORD_SITUATIONS = ["en_taller", "paso_taller", "no_realizados"] as const
export type RecordSituationFilter = (typeof RECORD_SITUATIONS)[number]

export const RECORD_ALERT_LABEL: Record<RecordAlertFilter, string> = {
  salto: "Salto de lectura",
  fuera: "Fuera de faena",
  pauta: "Pauta elegida a mano",
  duplicado: "Preventiva duplicada",
}

export const RECORD_SITUATION_LABEL: Record<RecordSituationFilter, string> = {
  en_taller: "Equipo aún en taller",
  paso_taller: "Pasó por taller",
  no_realizados: "Con ítems no realizados",
}

/**
 * Regla 8: diferencia máxima, en horas, entre el sello (o la firma) y la recepción
 * antes de advertirlo en el detalle. Vive aquí, en un módulo puro, porque lo leen
 * el servicio del detalle y las etiquetas de alerta (que también corren en el PDF).
 */
export const STAMP_GAP_LIMIT_HOURS = 72

/** Registros por página. Misma constante para la consulta y para el paginador. */
export const RECORDS_PAGE_SIZE = 25

export interface RecordFilters {
  worksiteId?: string
  kind?: "P" | "C"
  /** Código o patente del equipo (texto parcial). */
  equipment?: string
  /** Quién hizo el trabajo: `u:<userId>` (mecánico) o `w:<workshopId>` (taller externo). */
  executor?: string
  /** Quién registró en el sistema (id de usuario). */
  registeredBy?: string
  /** Fecha del trabajo, `YYYY-MM-DD`, ambos extremos incluidos. */
  from?: string
  to?: string
  status?: "vigente" | "anulado"
  review?: "pendiente" | "observado" | "revisado"
  alert?: RecordAlertFilter
  situation?: RecordSituationFilter
}

export interface RecordListQuery {
  filters: RecordFilters
  sort: RecordSortKey
  dir: SortDirection
  page: number
}

export type RawSearchParams = Record<string, string | string[] | undefined>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const EXECUTOR = /^(u|w):[\w-]{1,64}$/

function one(raw: RawSearchParams, key: string): string {
  const value = raw[key]
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | undefined {
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}

export function parseRecordFilters(raw: RawSearchParams): RecordFilters {
  const filters: RecordFilters = {}
  const worksite = one(raw, "faena")
  if (worksite && worksite.length <= 64) filters.worksiteId = worksite
  const kind = oneOf(one(raw, "tipo"), ["P", "C"] as const)
  if (kind) filters.kind = kind
  const equipment = one(raw, "equipo").slice(0, 60)
  if (equipment) filters.equipment = equipment
  const executor = one(raw, "hecho")
  if (EXECUTOR.test(executor)) filters.executor = executor
  const registeredBy = one(raw, "registro")
  if (registeredBy && registeredBy.length <= 64) filters.registeredBy = registeredBy
  const from = one(raw, "desde")
  if (ISO_DATE.test(from)) filters.from = from
  const to = one(raw, "hasta")
  if (ISO_DATE.test(to)) filters.to = to
  const status = oneOf(one(raw, "estado"), ["vigente", "anulado"] as const)
  if (status) filters.status = status
  const review = oneOf(one(raw, "revision"), ["pendiente", "observado", "revisado"] as const)
  if (review) filters.review = review
  const alert = oneOf(one(raw, "alerta"), RECORD_ALERTS)
  if (alert) filters.alert = alert
  const situation = oneOf(one(raw, "situacion"), RECORD_SITUATIONS)
  if (situation) filters.situation = situation
  return filters
}

export function parseRecordQuery(raw: RawSearchParams): RecordListQuery {
  const sort = oneOf(one(raw, "orden"), RECORD_SORT_KEYS) ?? "fecha"
  const dirRaw = oneOf(one(raw, "dir"), ["asc", "desc"] as const)
  // La fecha parte de lo más reciente; el resto de las columnas, de la A a la Z.
  const dir: SortDirection = dirRaw ?? (sort === "fecha" ? "desc" : "asc")
  const page = Number.parseInt(one(raw, "page"), 10)
  return { filters: parseRecordFilters(raw), sort, dir, page: Number.isFinite(page) && page > 0 ? page : 1 }
}

/** Filtros → parámetros de URL (la inversa de `parseRecordFilters`). */
export function recordFiltersToParams(filters: RecordFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.worksiteId) params.set("faena", filters.worksiteId)
  if (filters.kind) params.set("tipo", filters.kind)
  if (filters.equipment) params.set("equipo", filters.equipment)
  if (filters.executor) params.set("hecho", filters.executor)
  if (filters.registeredBy) params.set("registro", filters.registeredBy)
  if (filters.from) params.set("desde", filters.from)
  if (filters.to) params.set("hasta", filters.to)
  if (filters.status) params.set("estado", filters.status)
  if (filters.review) params.set("revision", filters.review)
  if (filters.alert) params.set("alerta", filters.alert)
  if (filters.situation) params.set("situacion", filters.situation)
  return params
}

/** Cuántos filtros de «Más filtros» están activos (el contador del botón). */
export function advancedFilterCount(filters: RecordFilters): number {
  return [filters.registeredBy, filters.status, filters.review, filters.alert, filters.situation].filter(Boolean).length
}

export function hasRecordFilters(filters: RecordFilters): boolean {
  return Object.values(filters).some(Boolean)
}
