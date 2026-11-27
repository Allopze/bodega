import { bucketLabel, isPlainDate, resolveIndicatorPeriod, type IndicatorPeriod } from "@/lib/indicators/period"
import { MONTH_NAMES, formatQty, todayInChile } from "@/lib/utils"
import type { MantUnit } from "@/lib/mantencion/types"
import {
  isLegacyLookerTab,
  isLookerTab,
  LEGACY_LOOKER_TABS,
  PLANNING_STATES,
  type CrossDimension,
  type LookerEquipmentOption,
  type LookerFilters,
  type LookerFrequencyOption,
  type LookerOptions,
  type LookerTab,
  type PlanningState,
  type QueryFilters,
  type RawCrossFilters,
  type ResolvedCrossFilters,
} from "./types"

/**
 * Parseo de los filtros del tablero Looker. Módulo PURO: lo usan el servidor (para consultar) y el
 * cliente (para armar la URL del siguiente clic). No toca la base. Los enlaces viven en
 * `filter-hrefs.ts` y los chips en `filter-chips.ts`.
 */

export type Raw = Record<string, string | string[] | undefined>

export function first(raw: Raw, key: string): string | undefined {
  const value = raw[key]
  const text = Array.isArray(value) ? value[0] : value
  return text?.trim() ? text.trim() : undefined
}

/** Acepta valores repetidos (`?faena=a&faena=b`) y separados por coma (`?faena=a,b`). */
export function multiValue(raw: Raw, key: string): string[] {
  const value = raw[key]
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value]
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of list) {
    for (const part of item.split(",")) {
      const text = part.trim()
      if (!text || seen.has(text)) continue
      seen.add(text)
      result.push(text)
    }
  }
  return result
}

/** `pestana`. Los valores anteriores al reajuste (`camiones`, `maquinas`) se leen como Correctivo. */
export function parseLookerTab(raw: Raw): LookerTab {
  const value = first(raw, "pestana")
  if (isLegacyLookerTab(value)) return "correctivo"
  return isLookerTab(value) ? value : "hoy"
}

/**
 * `unidad` (`km` por defecto). Un enlace viejo con `pestana=maquinas` lleva la unidad en la pestaña: manda
 * sobre `unidad`, porque es lo único que ese enlace decía.
 */
export function parseLookerUnit(raw: Raw): MantUnit {
  const legacy = first(raw, "pestana")
  if (isLegacyLookerTab(legacy)) return LEGACY_LOOKER_TABS[legacy]
  return first(raw, "unidad") === "h" ? "h" : "km"
}

/**
 * La URL canónica de un enlace guardado con `pestana=camiones|maquinas`: `pestana=correctivo` y su unidad,
 * con el resto de los parámetros tal cual. `null` si la URL ya es canónica. La página redirige con esto, así
 * las pestañas, los chips y el botón de exportar ven siempre el valor nuevo.
 */
export function legacyTabRedirect(pathname: string, raw: Raw): string | null {
  const legacy = first(raw, "pestana")
  if (!isLegacyLookerTab(legacy)) return null
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) {
    if (key === "pestana" || key === "unidad") continue
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item)
  }
  params.set("pestana", "correctivo")
  if (LEGACY_LOOKER_TABS[legacy] === "h") params.set("unidad", "h")
  return `${pathname}?${params.toString()}`
}

function parsePlanningState(raw: Raw): PlanningState | null {
  const value = first(raw, "estado")
  return value && (PLANNING_STATES as readonly string[]).includes(value) ? value as PlanningState : null
}

/** Un extremo del rango de Planificación: `undefined` si no vino, `null` si vino inválido. */
function parseDateBound(raw: Raw, key: string): string | null | undefined {
  const value = first(raw, key)
  if (value === undefined) return undefined
  return isPlainDate(value) ? value : null
}

export function parseLookerFilters(raw: Raw, today: string = todayInChile()): LookerFilters {
  const period: IndicatorPeriod = resolveIndicatorPeriod({ desde: raw.desde, hasta: raw.hasta }, today)
  const pageText = first(raw, "page")
  const page = pageText ? Number.parseInt(pageText, 10) : 1
  const rawFrom = parseDateBound(raw, "fecha_desde")
  const rawTo = parseDateBound(raw, "fecha_hasta")
  // Un rango al revés tampoco es válido: se ignoran los dos extremos y se avisa, como con el período.
  const reversed = typeof rawFrom === "string" && typeof rawTo === "string" && rawFrom > rawTo
  return {
    tab: parseLookerTab(raw),
    unit: parseLookerUnit(raw),
    from: period.from,
    to: period.to,
    requestedFrom: period.requested.from,
    requestedTo: period.requested.to,
    invalidPeriod: period.invalid,
    worksiteIds: multiValue(raw, "faena"),
    equipmentIds: multiValue(raw, "equipo"),
    frequencies: multiValue(raw, "frecuencia")
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    cross: parseCrossFilters(raw),
    planningState: parsePlanningState(raw),
    dateField: first(raw, "fecha") === "ultima" ? "ultima" : "proxima",
    dateFrom: reversed ? null : rawFrom ?? null,
    dateTo: reversed ? null : rawTo ?? null,
    invalidDateRange: rawFrom === null || rawTo === null || reversed,
    sheetVehicleId: first(raw, "ficha") ?? null,
    // Una pauta sin ficha no abre nada.
    sheetCheckId: first(raw, "ficha") ? first(raw, "pauta") ?? null : null,
  }
}

function parseCrossFilters(raw: Raw): RawCrossFilters {
  const month = first(raw, "x_mes")
  return {
    equipment: first(raw, "x_equipo"),
    work: first(raw, "x_ot"),
    check: first(raw, "x_check"),
    conductor: first(raw, "x_conductor"),
    month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined,
    worksite: first(raw, "x_faena"),
    mechanic: first(raw, "x_mecanico"),
  }
}

/**
 * Parámetros de la URL que cambian lo que muestra una pestaña: la unidad, el período, los filtros manuales,
 * los de Planificación y los cruzados. No son `pestana` (la fija quien la elige), `page` (la exportación no
 * pagina) ni `ficha`/`pauta` (abren una ficha, no filtran).
 */
export const LOOKER_FILTER_PARAMS = [
  "unidad", "desde", "hasta", "faena", "equipo", "frecuencia",
  "estado", "fecha", "fecha_desde", "fecha_hasta",
  "x_equipo", "x_ot", "x_check", "x_conductor", "x_mes", "x_faena", "x_mecanico",
] as const

/** De los parámetros de la URL, sólo los que mueven la pestaña, sin claves vacías: es lo que viaja a «Exportar Excel». */
export function pickFilterParams(raw: Raw): Record<string, string | string[]> {
  const picked: Record<string, string | string[]> = {}
  for (const key of LOOKER_FILTER_PARAMS) {
    const value = raw[key]
    if (Array.isArray(value)) {
      const list = value.filter((item) => item.trim() !== "")
      if (list.length > 0) picked[key] = list
    } else if (value !== undefined && value.trim() !== "") {
      picked[key] = value
    }
  }
  return picked
}

/** Filtros que aceptan varios valores (repetidos o separados por coma): cada valor llega a un `IN (...)` de la consulta. */
export const LOOKER_MULTI_VALUE_PARAMS = ["faena", "equipo", "frecuencia"] as const

/** Tope de valores de un filtro múltiple: bajo el límite de parámetros de Postgres y de lo que cabe en una auditoría. */
export const LOOKER_MAX_FILTER_VALUES = 100

/**
 * Cuántos valores trae un filtro múltiple, contados DESPUÉS de partir por comas (los vacíos no cuentan) y sin quitar
 * repetidos: lo que se acota es lo que viaja, no sólo lo que sobrevive a la deduplicación de `multiValue`.
 */
export function countFilterValues(value: string | string[] | undefined): number {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value]
  return list.reduce((total, item) => total + item.split(",").filter((part) => part.trim() !== "").length, 0)
}

export function hasCrossFilters(cross: RawCrossFilters): boolean {
  return Object.values(cross).some((value) => value !== undefined)
}

export function hasManualFilters(filters: LookerFilters): boolean {
  return filters.worksiteIds.length > 0 || filters.equipmentIds.length > 0 || filters.frequencies.length > 0
}

/**
 * Filtros efectivos de una consulta. Un filtro cruzado reemplaza al manual de su misma
 * dimensión; el bloque que emitió la dimensión pasa `ignore` y no la aplica. La unidad es la de la
 * pestaña (`unidad`): las opciones ya vienen acotadas a ella, así que un equipo de la otra no se resuelve.
 */
export function queryFilters(
  filters: LookerFilters,
  cross: ResolvedCrossFilters,
  ignore: readonly CrossDimension[] = [],
): QueryFilters {
  const ignored = new Set(ignore)
  let worksiteIds = [...filters.worksiteIds]
  let equipmentIds = [...filters.equipmentIds]
  let frequencies = [...filters.frequencies]
  let month: string | null = null
  const unit: MantUnit | null = filters.tab === "hoy" ? null : filters.unit

  if (cross.work && !ignored.has("work")) {
    if (cross.work.equipmentId) equipmentIds = [cross.work.equipmentId]
    if (cross.work.worksiteId) worksiteIds = [cross.work.worksiteId]
  } else if (cross.check && !ignored.has("check")) {
    if (cross.check.equipmentId) equipmentIds = [cross.check.equipmentId]
    if (cross.check.worksiteId) worksiteIds = [cross.check.worksiteId]
    if (cross.check.month && !ignored.has("month")) month = cross.check.month
  } else if (cross.equipment && !ignored.has("equipment")) {
    // El equipo derivado de una OT o de una mantención no se aplica al bloque que
    // justamente está ignorando esa dimensión: la tabla de OT no se filtra por su
    // propio equipo, y la matriz conserva todas sus columnas al pulsar una.
    const derivedFromIgnored = (cross.equipment.derivedFrom === "work" && ignored.has("work"))
      || (cross.equipment.derivedFrom === "check" && ignored.has("check"))
    if (!derivedFromIgnored) {
      equipmentIds = [cross.equipment.id]
      worksiteIds = [cross.equipment.worksiteId]
      frequencies = []
    }
  }

  if (cross.worksite && !ignored.has("worksite")) worksiteIds = [cross.worksite.id]
  if (cross.month && !ignored.has("month")) month = cross.month.key
  if (cross.month && ignored.has("month")) month = null

  return {
    worksiteIds,
    equipmentIds,
    frequencies,
    month,
    conductorKey: cross.conductor && !ignored.has("conductor") ? cross.conductor.key : null,
    mechanicKey: cross.mechanic && !ignored.has("mechanic") ? cross.mechanic.key : null,
    workId: cross.work && !ignored.has("work") ? cross.work.id : null,
    checkId: cross.check && !ignored.has("check") ? cross.check.id : null,
    unit,
  }
}

/** «oct 2026» a partir de `YYYY-MM`. */
export function monthLabel(key: string): string {
  const month = Number(key.slice(5, 7))
  return `${MONTH_NAMES[month - 1] ?? ""} ${key.slice(0, 4)}`
}

export function frequencyLabel(value: number, unit: MantUnit): string {
  return `${formatQty(value)} ${unit === "km" ? "km" : "h"}`
}

/** Etiqueta corta de una fila del eje de meses. */
export function monthAxisLabel(key: string): string {
  return bucketLabel(key, "month")
}

/** Frecuencia de un equipo como opción, para los controles reflejados. */
export function optionFrequency(options: LookerOptions, value: number | null): LookerFrequencyOption | null {
  return value == null ? null : options.frequencies.find((option) => option.value === value) ?? null
}

/** Equipo de una opción por id. */
export function optionEquipment(options: LookerOptions, id: string | null | undefined): LookerEquipmentOption | null {
  return id ? options.equipment.find((equipment) => equipment.id === id) ?? null : null
}
