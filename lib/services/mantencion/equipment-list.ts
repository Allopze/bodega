import { nameKey } from "@/lib/mantencion/normalize"
import { stateRank } from "@/lib/mantencion/status"
import { MANT_EQUIPMENT_STATES, type MantEquipmentState, type MantUnit } from "@/lib/mantencion/types"
import type { FleetRow } from "./fleet"

/**
 * Lista de equipos (§10): filtros de la URL, orden por defecto y la fila liviana
 * que viaja al cliente. Módulo PURO (sólo tipos de `fleet.ts`): lo importan la
 * página de servidor, la tabla del cliente y la exportación a Excel, así los tres
 * hablan de «los equipos que se ven» con la misma definición.
 */

/** Valor del filtro de pauta que significa «equipos sin pauta». */
export const NO_SCHEDULE = "sin"

export interface EquipmentListFilters {
  /** Id de la faena. */
  worksiteId?: string
  /** Id del tipo de equipo. */
  typeId?: string
  /** Id de la pauta, o `NO_SCHEDULE`. */
  scheduleId?: string
  state?: MantEquipmentState
  /** «Mostrar dados de baja»: los incluye junto a los activos. */
  includeRetired: boolean
}

export type RawSearchParams = Record<string, string | string[] | undefined>

function first(raw: RawSearchParams, key: string): string | undefined {
  const value = raw[key]
  const text = Array.isArray(value) ? value[0] : value
  return text?.trim() ? text.trim() : undefined
}

/** Lee los parámetros de la URL; un valor que no es de la lista se ignora en vez de romper la página. */
export function parseEquipmentListFilters(raw: RawSearchParams): EquipmentListFilters {
  const state = first(raw, "estado")
  const knownState = (MANT_EQUIPMENT_STATES as readonly string[]).includes(state ?? "") ? (state as MantEquipmentState) : undefined
  return {
    worksiteId: first(raw, "faena"),
    typeId: first(raw, "tipo"),
    scheduleId: first(raw, "pauta"),
    state: knownState,
    // Pedir «Dado de baja» sin marcar la casilla igual tiene que mostrar las bajas.
    includeRetired: first(raw, "bajas") === "1" || knownState === "baja",
  }
}

export function hasEquipmentListFilters(filters: EquipmentListFilters): boolean {
  return !!(filters.worksiteId || filters.typeId || filters.scheduleId || filters.state || filters.includeRetired)
}

export function filterFleet(rows: readonly FleetRow[], filters: EquipmentListFilters): FleetRow[] {
  return rows.filter((row) => {
    if (row.retired && !filters.includeRetired) return false
    if (filters.worksiteId && row.worksiteId !== filters.worksiteId) return false
    if (filters.typeId && row.typeId !== filters.typeId) return false
    if (filters.scheduleId === NO_SCHEDULE ? row.scheduleId !== null : filters.scheduleId && row.scheduleId !== filters.scheduleId) return false
    if (filters.state && row.status.state !== filters.state) return false
    return true
  })
}

/** Fracción del intervalo base que falta: ordena dentro de un mismo estado a los más urgentes primero. */
function urgency(row: FleetRow): number {
  const base = row.intervals[0]
  return row.status.remaining == null || !base ? Number.POSITIVE_INFINITY : row.status.remaining / base
}

const byCode = (a: FleetRow, b: FleetRow) => a.code.localeCompare(b.code, "es", { numeric: true })

/** Orden por defecto (§10): vencida → próxima → al día → sin lecturas → sin pauta → baja; luego el más urgente. */
export function sortFleetByState(rows: readonly FleetRow[]): FleetRow[] {
  return [...rows].sort((a, b) => stateRank(a.status.state) - stateRank(b.status.state) || urgency(a) - urgency(b) || byCode(a, b))
}

/** La fila que viaja al cliente: sólo lo que la tabla muestra, ordena o busca. */
export interface EquipmentListRow extends Record<string, unknown> {
  id: string
  code: string
  plate: string
  /** La patente se muestra aparte sólo si es distinta del código (regla 16). */
  showPlate: boolean
  noPlate: boolean
  typeName: string
  brandName: string
  model: string
  year: number | null
  worksiteName: string
  scheduleName: string
  hasSchedule: boolean
  unit: MantUnit
  state: MantEquipmentState
  /** Posición en el orden por defecto de estados; la columna «Estado» ordena por esto. */
  stateOrder: number
  reading: number | null
  readingDate: string | null
  nextReading: number | null
  remaining: number | null
  /** Lo que falta como fracción del intervalo base: ordena «Próxima mantención» sin mezclar km con h. */
  urgency: number | null
  nextIntervalValue: number | null
  inWorkshop: boolean
  /** Días corridos detenido (`null` si la correctiva no trae fecha de ingreso). Sólo con `inWorkshop`. */
  workshopDays: number | null
  /** En taller y sin novedades hace más de 2 días (C4: se muestra como «Sin actualizar»). */
  workshopStale: boolean
}

export function toEquipmentListRow(row: FleetRow): EquipmentListRow {
  const { status } = row
  return {
    id: row.vehicleId,
    code: row.code,
    plate: row.plate,
    showPlate: !row.noPlate && row.plate !== row.code,
    noPlate: row.noPlate,
    typeName: row.typeName,
    brandName: row.brandName,
    model: row.model ?? "",
    year: row.year,
    worksiteName: row.worksiteName,
    scheduleName: row.scheduleName ?? "",
    hasSchedule: row.scheduleId !== null,
    unit: row.unit,
    state: status.state,
    stateOrder: stateRank(status.state),
    reading: status.currentReading?.value ?? null,
    readingDate: status.currentReading?.date ?? null,
    nextReading: status.nextReading,
    remaining: status.remaining,
    urgency: Number.isFinite(urgency(row)) ? urgency(row) : null,
    nextIntervalValue: status.nextIntervalValue,
    inWorkshop: row.workshop !== null,
    workshopDays: row.workshop?.daysStopped ?? null,
    workshopStale: row.workshop?.stale ?? false,
  }
}

/** Búsqueda del TopBar sobre la fila: código, patente, tipo, marca, modelo, faena y pauta, sin tildes ni mayúsculas. */
export function matchesEquipmentSearch(row: EquipmentListRow, query: string): boolean {
  const needle = nameKey(query)
  if (!needle) return true
  const haystack = nameKey([row.code, row.plate, row.typeName, row.brandName, row.model, row.worksiteName, row.scheduleName].join(" "))
  return needle.split(" ").every((part) => haystack.includes(part))
}
