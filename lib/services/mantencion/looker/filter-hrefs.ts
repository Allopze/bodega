import { addDaysToPlainDate } from "@/lib/utils"
import type { MantUnit } from "@/lib/mantencion/types"
import { multiValue, type Raw } from "./filters"
import type { FilterChip, LookerTab, PlanningState } from "./types"

/**
 * Enlaces del tablero Looker: el clic de un filtro cruzado, quitar un chip, «Borrar filtros», cambiar de
 * pestaña o de unidad, la tira de estados y los atajos de fecha de Planificación, y abrir o cerrar la ficha
 * de Preventivo. Módulo PURO (lo usan el servidor y el cliente).
 */

function hrefOf(pathname: string, params: URLSearchParams): string {
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

function copy(current: URLSearchParams): URLSearchParams {
  return new URLSearchParams(Array.from(current.entries()))
}

/* ── Filtro cruzado ──────────────────────────────────────────────────────── */

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
  const params = copy(current)
  const toggle = { ...action.values }
  if (action.active) {
    for (const key of Object.keys(toggle)) params.delete(key)
  } else {
    for (const [key, value] of Object.entries(toggle)) params.set(key, value)
  }
  for (const key of action.clear ?? []) params.delete(key)
  params.delete("page")
  return hrefOf(pathname, params)
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

/* ── Chips y «Borrar filtros» ────────────────────────────────────────────── */

/** Parámetros que un chip quita junto con el suyo: el rango de Planificación es un solo filtro. */
const CHIP_COMPANIONS: Record<string, string[]> = {
  fecha_hasta: ["fecha_desde", "fecha"],
  fecha_desde: ["fecha_hasta", "fecha"],
}

/** Href para quitar un chip: los filtros múltiples quitan sólo su valor. */
export function removeChipHref(pathname: string, current: URLSearchParams, chip: FilterChip): string {
  const params = copy(current)
  if (["faena", "equipo", "frecuencia"].includes(chip.param)) {
    const values = multiValue(Object.fromEntries(params.entries()), chip.param).filter((value) => value !== chip.value)
    if (values.length) params.set(chip.param, values.join(","))
    else params.delete(chip.param)
  } else {
    params.delete(chip.param)
    for (const key of CHIP_COMPANIONS[chip.param] ?? []) params.delete(key)
  }
  params.delete("page")
  return hrefOf(pathname, params)
}

/** «Borrar filtros»: quedan la pestaña y la unidad (que no es un filtro sino la vista de la pestaña). */
export function clearFiltersHref(pathname: string, tab: LookerTab, unit: MantUnit = "km"): string {
  if (tab === "hoy") return pathname
  const params = new URLSearchParams({ pestana: tab })
  if (unit === "h") params.set("unidad", "h")
  return hrefOf(pathname, params)
}

/* ── Pestañas y unidad ───────────────────────────────────────────────────── */

/**
 * Parámetros que viajan al cambiar de pestaña: la unidad, el período y la faena son el contexto del Panel entero
 * (los mismos nombres en todas las pestañas). Todo lo demás pertenece a la pestaña que se deja: el equipo, la
 * frecuencia, los filtros cruzados `x_*`, la página, el estado y las fechas de Planificación y la ficha.
 */
export const TAB_CARRY_PARAMS = ["unidad", "desde", "hasta", "faena"] as const

/**
 * Enlace a una pestaña del Panel. `current` son los parámetros de la URL donde se está: de ellos sólo se conservan
 * los de `TAB_CARRY_PARAMS`. Sin `current` lleva sólo `pestana` (la pestaña «Hoy» es la página sin parámetro).
 */
export function tabHref(pathname: string, tab: LookerTab, current: Raw = {}): string {
  const params = new URLSearchParams()
  if (tab !== "hoy") params.set("pestana", tab)
  for (const key of TAB_CARRY_PARAMS) {
    const value = current[key]
    const list = Array.isArray(value) ? value : value === undefined ? [] : [value]
    for (const item of list) {
      if (item.trim() === "") continue
      // `km` es el valor por defecto: no se escribe.
      if (key === "unidad" && item !== "h") continue
      params.append(key, item)
    }
  }
  return hrefOf(pathname, params)
}

/**
 * Parámetros que se sueltan al cambiar la unidad: todo lo que nombra un equipo (los de una unidad no existen en la
 * otra), sus frecuencias, el estado de Planificación, la ficha y la página.
 */
export const UNIT_DROP_PARAMS = ["equipo", "frecuencia", "x_equipo", "x_ot", "x_check", "estado", "ficha", "pauta", "page"] as const

export function unitHref(pathname: string, current: URLSearchParams, unit: MantUnit): string {
  const params = copy(current)
  for (const key of UNIT_DROP_PARAMS) params.delete(key)
  if (unit === "h") params.set("unidad", "h")
  else params.delete("unidad")
  return hrefOf(pathname, params)
}

/* ── Planificación ───────────────────────────────────────────────────────── */

/** Clic en una cifra de la tira: fija el estado; un segundo clic sobre la vigente lo quita. `null` = «Equipos controlados». */
export function planningStateHref(pathname: string, current: URLSearchParams, state: PlanningState | null): string {
  const params = copy(current)
  if (state === null || params.get("estado") === state) params.delete("estado")
  else params.set("estado", state)
  params.delete("page")
  return hrefOf(pathname, params)
}

/** Atajos de la próxima mantención. Fijan sólo el término, sin `fecha_desde`, para que entren las vencidas. */
export const DATE_SHORTCUT_DAYS = [7, 30, 90] as const

export function dateShortcutTo(today: string, days: number): string {
  return addDaysToPlainDate(today, days)
}

/** El atajo vigente: `fecha=proxima`, sin inicio y con el término en hoy + N. */
export function activeDateShortcut(current: URLSearchParams, today: string): number | null {
  if (current.get("fecha") === "ultima" || current.get("fecha_desde")) return null
  const to = current.get("fecha_hasta")
  return DATE_SHORTCUT_DAYS.find((days) => dateShortcutTo(today, days) === to) ?? null
}

export function dateShortcutHref(pathname: string, current: URLSearchParams, today: string, days: number): string {
  const params = copy(current)
  const active = activeDateShortcut(current, today) === days
  params.delete("fecha")
  params.delete("fecha_desde")
  if (active) params.delete("fecha_hasta")
  else params.set("fecha_hasta", dateShortcutTo(today, days))
  params.delete("page")
  return hrefOf(pathname, params)
}

/** Cambiar qué fecha filtra: el rango anterior pertenece a la otra fecha y se suelta. */
export function dateFieldHref(pathname: string, current: URLSearchParams, field: "proxima" | "ultima"): string {
  const params = copy(current)
  params.delete("fecha_desde")
  params.delete("fecha_hasta")
  if (field === "ultima") params.set("fecha", "ultima")
  else params.delete("fecha")
  params.delete("page")
  return hrefOf(pathname, params)
}

/* ── Ficha de Preventivo ─────────────────────────────────────────────────── */

/** Abre la ficha de un equipo (y, si se pide, en una pauta). Conserva los filtros: cerrar vuelve a la misma vista. */
export function sheetHref(pathname: string, current: URLSearchParams, vehicleId: string, checkId?: string | null): string {
  const params = copy(current)
  params.set("ficha", vehicleId)
  if (checkId) params.set("pauta", checkId)
  else params.delete("pauta")
  return hrefOf(pathname, params)
}

export function closeSheetHref(pathname: string, current: URLSearchParams): string {
  const params = copy(current)
  params.delete("ficha")
  params.delete("pauta")
  return hrefOf(pathname, params)
}
