import { bucketLabel, resolveIndicatorPeriod, type IndicatorPeriod } from "@/lib/indicators/period"
import { MONTH_NAMES, formatQty, todayInChile } from "@/lib/utils"
import type { MantUnit } from "@/lib/mantencion/types"
import {
  isLookerTab,
  type CrossDimension,
  type FilterChip,
  type LookerEquipmentOption,
  type LookerFilters,
  type LookerFrequencyOption,
  type LookerOptions,
  type LookerTab,
  type QueryFilters,
  type RawCrossFilters,
  type ResolvedCrossFilters,
} from "./types"

/**
 * Parseo y construcción de los filtros del tablero Looker. Módulo PURO: lo usan el servidor
 * (para consultar) y el cliente (para armar la URL del siguiente clic). No toca la base.
 */

type Raw = Record<string, string | string[] | undefined>

function first(raw: Raw, key: string): string | undefined {
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

export function parseLookerTab(raw: Raw): LookerTab {
  const value = first(raw, "pestana")
  return isLookerTab(value) ? value : "hoy"
}

export function parseLookerFilters(raw: Raw, today: string = todayInChile()): LookerFilters {
  const period: IndicatorPeriod = resolveIndicatorPeriod({ desde: raw.desde, hasta: raw.hasta }, today)
  const pageText = first(raw, "page")
  const page = pageText ? Number.parseInt(pageText, 10) : 1
  return {
    tab: parseLookerTab(raw),
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
 * Parámetros de la URL que cambian lo que muestra una pestaña: el período, los filtros manuales y los
 * cruzados. No son `pestana` (la fija quien la elige) ni `page` (la exportación no pagina).
 */
export const LOOKER_FILTER_PARAMS = [
  "desde", "hasta", "faena", "equipo", "frecuencia",
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

export function hasCrossFilters(cross: RawCrossFilters): boolean {
  return Object.values(cross).some((value) => value !== undefined)
}

export function hasManualFilters(filters: LookerFilters): boolean {
  return filters.worksiteIds.length > 0 || filters.equipmentIds.length > 0 || filters.frequencies.length > 0
}

/** La pestaña fija la unidad; Planificación la deriva de cada fila. */
export function tabUnit(tab: LookerTab): MantUnit | null {
  if (tab === "camiones") return "km"
  if (tab === "maquinas") return "h"
  return null
}

/**
 * Filtros efectivos de una consulta. Un filtro cruzado reemplaza al manual de su misma
 * dimensión; el bloque que emitió la dimensión pasa `ignore` y no la aplica.
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
  let unit = tabUnit(filters.tab)

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
      unit = cross.equipment.unit
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

export interface CrossFilterAction {
  /** Parámetros que se fijan al activar el filtro. */
  values: Record<string, string>
  /** `true` = el clic quita el filtro. */
  active: boolean
  /** Parámetros que se quitan siempre (las alternativas de nivel equipo). */
  clear?: string[]
}

export function crossFilterActive(params: URLSearchParams, values: Record<string, string>): boolean {
  return Object.entries(values).every(([key, value]) => params.get(key) === value)
}

export function buildCrossFilterHref(pathname: string, current: URLSearchParams, action: CrossFilterAction): string {
  const params = new URLSearchParams(Array.from(current.entries()))
  const toggle = { ...action.values }
  if (action.active) {
    for (const key of Object.keys(toggle)) params.delete(key)
  } else {
    for (const [key, value] of Object.entries(toggle)) params.set(key, value)
  }
  for (const key of action.clear ?? []) params.delete(key)
  params.delete("page")
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function equipmentAction(equipmentId: string, active: boolean): CrossFilterAction {
  return { values: { x_equipo: equipmentId }, active, clear: ["x_ot", "x_check"] }
}

export function workAction(workId: string, active: boolean): CrossFilterAction {
  return { values: { x_ot: workId }, active, clear: ["x_equipo", "x_check"] }
}

export function checkAction(checkId: string, active: boolean): CrossFilterAction {
  return { values: { x_check: checkId }, active, clear: ["x_equipo", "x_ot"] }
}

export function conductorAction(label: string, active: boolean): CrossFilterAction {
  // La URL guarda el nombre legible: el `nameKey` se deriva al resolver y el chip
  // muestra «Conductor: CID SOTO NORA DEL C.», no la clave en minúsculas.
  return { values: { x_conductor: label }, active }
}

export function monthAction(key: string, active: boolean): CrossFilterAction {
  return { values: { x_mes: key }, active }
}

export function worksiteAction(worksiteId: string, active: boolean): CrossFilterAction {
  return { values: { x_faena: worksiteId }, active }
}

export function mechanicAction(worksiteId: string, mechanicLabel: string, active: boolean): CrossFilterAction {
  return { values: { x_faena: worksiteId, x_mecanico: mechanicLabel }, active }
}

/** Href para quitar un chip: los filtros múltiples quitan sólo su valor. */
export function removeChipHref(pathname: string, current: URLSearchParams, chip: FilterChip): string {
  const params = new URLSearchParams(Array.from(current.entries()))
  if (["faena", "equipo", "frecuencia"].includes(chip.param)) {
    const values = multiValue(Object.fromEntries(params.entries()), chip.param).filter((value) => value !== chip.value)
    if (values.length) params.set(chip.param, values.join(","))
    else params.delete(chip.param)
  } else {
    params.delete(chip.param)
  }
  params.delete("page")
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function clearFiltersHref(pathname: string, tab: LookerTab): string {
  return tab === "planificacion" || tab === "camiones" || tab === "maquinas" ? `${pathname}?pestana=${tab}` : pathname
}

export function tabHref(pathname: string, tab: LookerTab): string {
  return tab === "hoy" ? pathname : `${pathname}?pestana=${tab}`
}

/** «oct 2026» a partir de `YYYY-MM`. */
export function monthLabel(key: string): string {
  const month = Number(key.slice(5, 7))
  return `${MONTH_NAMES[month - 1] ?? ""} ${key.slice(0, 4)}`
}

export function frequencyLabel(value: number, unit: MantUnit): string {
  return `${formatQty(value)} ${unit === "km" ? "km" : "h"}`
}

/** Chips de la barra. Un valor manual y su equivalente cruzado se muestran una sola vez. */
export function filterChips(filters: LookerFilters, options: LookerOptions, cross: ResolvedCrossFilters): FilterChip[] {
  const chips: FilterChip[] = []
  const seen = new Set<string>()
  const push = (chip: FilterChip, dedupeKey: string) => {
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    chips.push(chip)
  }
  const worksiteName = (id: string) => options.worksites.find((site) => site.id === id)?.name ?? id
  const equipmentLabel = (id: string) => options.equipment.find((equipment) => equipment.id === id)?.label ?? id

  for (const id of filters.worksiteIds) {
    push({ key: `faena:${id}`, label: "Faena", value: id, displayValue: worksiteName(id), param: "faena" }, `faena:${id}`)
  }
  for (const id of filters.equipmentIds) {
    push({ key: `equipo:${id}`, label: "Código", value: id, displayValue: equipmentLabel(id), param: "equipo" }, `equipo:${id}`)
  }
  for (const value of filters.frequencies) {
    const option = options.frequencies.find((frequency) => frequency.value === value)
    const label = option?.label ?? String(value)
    push({ key: `frecuencia:${value}`, label: "Frecuencia", value: String(value), displayValue: label, param: "frecuencia" }, `frecuencia:${value}`)
  }
  if (cross.equipment && !cross.equipment.derivedFrom) {
    const shown = cross.equipment.plate && cross.equipment.plate !== cross.equipment.code ? cross.equipment.plate : cross.equipment.code
    push({ key: `x_equipo:${cross.equipment.id}`, label: cross.equipment.plate ? "Patente" : "Código", value: cross.equipment.id, displayValue: shown, param: "x_equipo" }, `equipo:${cross.equipment.id}`)
  }
  if (cross.work) {
    push({ key: `x_ot:${cross.work.id}`, label: cross.work.id.startsWith("ot:") ? "OT" : "Trabajo", value: cross.work.id, displayValue: cross.work.label, param: "x_ot" }, `work:${cross.work.id}`)
  }
  if (cross.check) {
    push({ key: `x_check:${cross.check.id}`, label: "Mantención", value: cross.check.id, displayValue: cross.check.label, param: "x_check" }, `check:${cross.check.id}`)
  }
  if (cross.conductor) {
    push({ key: `x_conductor:${cross.conductor.key}`, label: "Conductor", value: cross.conductor.key, displayValue: cross.conductor.label, param: "x_conductor" }, `conductor:${cross.conductor.key}`)
  }
  if (cross.month) {
    push({ key: `x_mes:${cross.month.key}`, label: "Mes", value: cross.month.key, displayValue: monthLabel(cross.month.key), param: "x_mes" }, `mes:${cross.month.key}`)
  }
  if (cross.worksite) {
    push({ key: `x_faena:${cross.worksite.id}`, label: "Faena", value: cross.worksite.id, displayValue: cross.worksite.name, param: "x_faena" }, `faena:${cross.worksite.id}`)
  }
  if (cross.mechanic) {
    push({ key: `x_mecanico:${cross.mechanic.key}`, label: "Mecánico", value: cross.mechanic.key, displayValue: cross.mechanic.label, param: "x_mecanico" }, `mechanic:${cross.mechanic.key}`)
  }
  return chips
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
