/**
 * Parámetros de URL de «Cargas a equipos» → filtros de la consulta. Módulo
 * puro (sin base de datos): lo usan la página, el exportador y las pruebas.
 *
 * El período (`periodo`, `desde`, `hasta`) NO se lee aquí: lo resuelve
 * `resolveFuelPeriodForPage` y la pantalla lo pasa como `period`. Aceptamos los
 * nombres de la bitácora y de la lista TAE de antes del rediseño (`punto`,
 * `sello=faltante`, `evidencia=faltante`, `page`) porque las páginas puente los
 * conservan al redirigir.
 */
import { ANOMALY_RULE_SEVERITIES, FUEL_VEHICLE_STATUSES } from "@/lib/combustibles/validation"
import { parseFuelLoadOrigins, parseFuelLoadState, type FuelLogFilters, type FuelLogSource } from "@/lib/combustibles/fuel-log-shared"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

export type CargasSearchParams = Record<string, string | string[] | undefined>

export const CARGAS_PAGE_SIZE = 50

/** Filtros que viven en «Más filtros»: su cuenta rotula el botón. */
export const CARGAS_ADVANCED_FILTER_KEYS = [
  "tipo", "marca", "modelo", "estado_operativo", "unidad_rendimiento",
  "conductor", "supervisor",
  "sello_retirado", "sello_instalado", "sello", "evidencia", "evidencia_tipo",
  "proveedor", "producto", "punto_carga", "observaciones", "mias",
  "anomalia", "anomalia_tipo", "anomalia_severidad", "anomalia_responsable", "revision",
] as const

/** Los cuatro tipos de foto de un registro en terreno. */
export const CARGAS_EVIDENCE_KINDS = ["odometer", "liter_meter", "removed_seal", "installed_seal"] as const

function first(sp: CargasSearchParams, key: string): string | undefined {
  const raw = sp[key]
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
  return value || undefined
}

export interface ParsedCargasParams {
  filters: FuelLogFilters
  sort: "asc" | "desc"
  page: number
}

export function parseCargasSearchParams(
  sp: CargasSearchParams,
  options: { canViewPersonal: boolean; period: { from: string; to: string }; currentUserId?: string },
): ParsedCargasParams {
  const { canViewPersonal, period, currentUserId } = options
  const origins = parseFuelLoadOrigins(sp.como)
  const performanceUnit = first(sp, "unidad_rendimiento")
  const operationalStatus = first(sp, "estado_operativo")
  const evidenceKind = first(sp, "evidencia_tipo")
  const severity = first(sp, "anomalia_severidad")
  const loadingPoint = first(sp, "punto_carga") ?? first(sp, "punto")
  const rawPage = Number.parseInt(first(sp, "pagina") ?? first(sp, "page") ?? "1", 10)

  const filters: FuelLogFilters = {
    q: first(sp, "q")?.slice(0, 120),
    worksiteId: first(sp, "faena"),
    origins: origins.length > 0 ? origins : undefined,
    stateSlug: parseFuelLoadState(sp.estado),
    onlyPending: first(sp, "pendiente") === "si" ? true : undefined,
    vehicleId: first(sp, "equipo"),
    // `mias=si`: las que registró quien mira (el Panel enlaza así sus conteos de «tus cargas»).
    registeredBy: first(sp, "mias") === "si" ? currentUserId : undefined,
    from: period.from,
    to: period.to,
    supplierId: first(sp, "proveedor"),
    productId: first(sp, "producto"),
    equipmentTypeId: first(sp, "tipo"),
    hasNotes: first(sp, "observaciones") === "si" ? true : undefined,
    brand: first(sp, "marca"),
    model: first(sp, "modelo"),
    // D-10: sin `view_personal` no hay filtros por nombre. El servidor igualmente los ignora; esto sólo evita ofrecerlos.
    driverName: canViewPersonal ? first(sp, "conductor") : undefined,
    supervisorName: canViewPersonal ? first(sp, "supervisor") : undefined,
    loadingPointId: loadingPoint,
    performanceUnit: performanceUnit === "km_per_liter" || performanceUnit === "liters_per_hour" ? performanceUnit : undefined,
    // Un valor fuera del enum se descarta en vez de filtrar por un estado que no existe
    // (que se lee como «no hay cargas», no como «filtro inválido»).
    operationalStatus: operationalStatus && (FUEL_VEHICLE_STATUSES as readonly string[]).includes(operationalStatus) ? operationalStatus : undefined,
    sealRemoved: first(sp, "sello_retirado"),
    sealInstalled: first(sp, "sello_instalado"),
    sealIncomplete: first(sp, "sello") === "faltante" ? true : undefined,
    photosIncomplete: first(sp, "evidencia") === "faltante" ? true : undefined,
    evidenceKind: evidenceKind && (CARGAS_EVIDENCE_KINDS as readonly string[]).includes(evidenceKind) ? evidenceKind : undefined,
    hasAnomaly: first(sp, "anomalia") === "si" ? true : undefined,
    hasReviewMark: first(sp, "revision") === "si" ? true : undefined,
    anomalyRuleCode: first(sp, "anomalia_tipo"),
    anomalySeverity: severity && (ANOMALY_RULE_SEVERITIES as readonly string[]).includes(severity) ? severity : undefined,
    anomalyAssigneeId: first(sp, "anomalia_responsable"),
  }

  return {
    filters,
    sort: first(sp, "orden") === "asc" ? "asc" : "desc",
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
  }
}

/** Parámetros de paginación de Cargas (`pagina`, y `page` de la lista de antes del rediseño). */
const CARGAS_PAGE_PARAMS = ["pagina", "page"] as const

/**
 * `/combustibles/cargas?…` con los parámetros de la URL actual y `patch` encima: un valor
 * lo fija; `null`, `undefined` o vacío lo quita. Siempre suelta la página: al cambiar lo que
 * se filtra, la página 3 de antes ya no existe. Es lo que usan los atajos que aplican un
 * filtro desde fuera de la barra de filtros (las cifras de la tira de señales de terreno),
 * para que el período, la faena y los demás filtros sigan donde estaban.
 */
export function withCargasParams(searchParams: CargasSearchParams, patch: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item)
    } else {
      params.set(key, value)
    }
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value)
    else params.delete(key)
  }
  for (const key of CARGAS_PAGE_PARAMS) params.delete(key)
  const query = params.toString()
  return query ? `${FUEL_PATHS.cargas}?${query}` : FUEL_PATHS.cargas
}

/** ¿Cuántos filtros de «Más filtros» hay activos? (Los que no corresponden al permiso no cuentan.) */
export function countActiveAdvancedFilters(sp: CargasSearchParams, canViewPersonal: boolean): number {
  return CARGAS_ADVANCED_FILTER_KEYS
    .filter((key) => canViewPersonal || (key !== "conductor" && key !== "supervisor"))
    .filter((key) => Boolean(first(sp, key))).length
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const FUEL_LOG_SOURCES: readonly FuelLogSource[] = ["tae_pwa", "invoiced", "operation_manual"]

/**
 * Los filtros que llegan a una Server Action vienen del navegador y se pueden
 * armar a mano: aquí se vuelven a validar los de valor enumerado y las fechas,
 * que de otro modo llegarían a la consulta tal cual (un estado que no existe
 * rompía la consulta en vez de ignorarse). Los textos libres van parametrizados
 * en la consulta; aquí sólo se acotan.
 */
export function sanitizeFuelLogFilters(raw: FuelLogFilters | null | undefined): FuelLogFilters {
  if (!raw || typeof raw !== "object") return {}
  const text = (value: unknown, max = 120) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined)
  const bool = (value: unknown) => (value === true ? true : undefined)
  const performanceUnit = text(raw.performanceUnit)
  const operationalStatus = text(raw.operationalStatus)
  const evidenceKind = text(raw.evidenceKind)
  const severity = text(raw.anomalySeverity)
  const origins = parseFuelLoadOrigins(Array.isArray(raw.origins) ? raw.origins.join(",") : undefined)
  return {
    q: text(raw.q),
    worksiteId: text(raw.worksiteId),
    source: raw.source && FUEL_LOG_SOURCES.includes(raw.source) ? raw.source : undefined,
    origins: origins.length > 0 ? origins : undefined,
    stateSlug: parseFuelLoadState(typeof raw.stateSlug === "string" ? raw.stateSlug : undefined),
    onlyPending: bool(raw.onlyPending),
    vehicleId: text(raw.vehicleId),
    registeredBy: text(raw.registeredBy),
    from: typeof raw.from === "string" && ISO_DATE.test(raw.from) ? raw.from : undefined,
    to: typeof raw.to === "string" && ISO_DATE.test(raw.to) ? raw.to : undefined,
    supplierId: text(raw.supplierId),
    productId: text(raw.productId),
    equipmentTypeId: text(raw.equipmentTypeId),
    hasNotes: bool(raw.hasNotes),
    brand: text(raw.brand),
    model: text(raw.model),
    driverName: text(raw.driverName),
    supervisorName: text(raw.supervisorName),
    loadingPointId: text(raw.loadingPointId),
    performanceUnit: performanceUnit === "km_per_liter" || performanceUnit === "liters_per_hour" ? performanceUnit : undefined,
    operationalStatus: operationalStatus && (FUEL_VEHICLE_STATUSES as readonly string[]).includes(operationalStatus) ? operationalStatus : undefined,
    sealRemoved: text(raw.sealRemoved),
    sealInstalled: text(raw.sealInstalled),
    sealIncomplete: bool(raw.sealIncomplete),
    photosIncomplete: bool(raw.photosIncomplete),
    evidenceKind: evidenceKind && (CARGAS_EVIDENCE_KINDS as readonly string[]).includes(evidenceKind) ? evidenceKind : undefined,
    hasAnomaly: bool(raw.hasAnomaly),
    hasReviewMark: bool(raw.hasReviewMark),
    anomalyRuleCode: text(raw.anomalyRuleCode),
    anomalySeverity: severity && (ANOMALY_RULE_SEVERITIES as readonly string[]).includes(severity) ? severity : undefined,
    anomalyAssigneeId: text(raw.anomalyAssigneeId),
  }
}
