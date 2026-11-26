import { currentReading, daysBetween } from "./readings"
import { baseInterval, suggestInterval } from "./schedule"
import type { MantEquipmentState, MantEquipmentStatus, MantPreventiveSummary, MantReading } from "./types"

/**
 * Estado de mantención, preventivas duplicadas y equipos en taller (reglas 6, 7
 * y 11). Todo recibe sólo registros VIGENTES.
 */

/** Umbral de «Próxima»: falta ≤ 15 % del intervalo base. */
export const NEXT_THRESHOLD = 0.15

export interface StatusInput {
  retired: boolean
  /** Intervalos activos de la pauta asignada; `null` = sin pauta. */
  intervals: readonly number[] | null
  /** Pauta cíclica (ver `suggestInterval`). */
  cyclic?: boolean
  readings: readonly MantReading[]
  initial: MantReading | null
  /**
   * La preventiva más reciente entre la última firmada vigente y la declarada anterior a la
   * plataforma (`newerPreventive`).
   */
  lastPreventive: MantPreventiveSummary | null
}

/**
 * La más reciente de dos preventivas: por fecha y, si empatan, por lectura. La misma regla para la
 * firmada contra la declarada (servidor) y para la de la cola de la app contra la del catálogo.
 */
export function newerPreventive<T extends { date: string; reading: number }>(a: T | null, b: T | null): T | null {
  if (!a) return b
  if (!b) return a
  return b.date > a.date || (b.date === a.date && b.reading > a.reading) ? b : a
}

/**
 * Regla 6.
 * - próxima = punto sugerido de la última preventiva (firmada o declarada) + base;
 * - sin ninguna preventiva: si la lectura todavía no llega al primer servicio (equipo nuevo), la
 *   próxima es la base; si ya pasó, el estado es `sin_preventiva` y no se calcula la próxima. Antes
 *   se suponía (piso(lectura / base) + 1) × base, un «al día» sin respaldo (Trinorma, 2026-11-21);
 * - falta = próxima − lectura; vencida si ≤ 0, próxima si ≤ 15 % de la base.
 */
export function equipmentStatus(input: StatusInput): MantEquipmentStatus {
  const current = currentReading(input.readings, input.initial)
  const empty = { currentReading: current, nextReading: null, remaining: null, nextIntervalValue: null, lastPreventive: input.lastPreventive }
  if (input.retired) return { state: "baja", ...empty }
  if (!input.intervals || input.intervals.length === 0) return { state: "sin_pauta", ...empty }
  if (!current) return { state: "sin_lecturas", ...empty }

  const base = baseInterval(input.intervals)
  if (!input.lastPreventive && current.value >= base) return { state: "sin_preventiva", ...empty }
  const nextReading = input.lastPreventive
    ? suggestInterval(input.intervals, input.lastPreventive.reading, input.cyclic).point + base
    : base
  const remaining = nextReading - current.value
  const state: MantEquipmentState = remaining <= 0 ? "vencida" : remaining <= base * NEXT_THRESHOLD ? "proxima" : "al_dia"
  return {
    state,
    currentReading: current,
    nextReading,
    remaining,
    nextIntervalValue: suggestInterval(input.intervals, nextReading, input.cyclic).intervalValue,
    lastPreventive: input.lastPreventive,
  }
}

/** Orden por defecto de la lista de equipos (§10): vencida → próxima → sin preventiva → al día → sin lecturas → sin pauta → baja. */
export function stateRank(state: MantEquipmentState): number {
  return ["vencida", "proxima", "sin_preventiva", "al_dia", "sin_lecturas", "sin_pauta", "baja"].indexOf(state)
}

export interface PreventiveRef {
  id: string
  folio: string | null
  reading: number
  date: string
  intervalValue: number
}

/**
 * Regla 7: hay otra preventiva vigente del mismo equipo y el mismo intervalo
 * hace 7 días o menos, o a menos del 10 % de la base en lectura. Devuelve la
 * anterior para enlazarla; el mecánico puede continuar.
 */
export function findDuplicatePreventive(input: {
  previous: readonly PreventiveRef[]
  intervalValue: number
  reading: number
  workDate: string
  base: number
  excludeId?: string
}): PreventiveRef | null {
  for (const record of input.previous) {
    if (record.id === input.excludeId || record.intervalValue !== input.intervalValue) continue
    const closeInTime = Math.abs(daysBetween(record.date, input.workDate)) <= 7
    const closeInReading = Math.abs(record.reading - input.reading) < input.base * 0.1
    if (closeInTime || closeInReading) return record
  }
  return null
}

/** Cada cuántos días se pide actualizar el estado de un equipo en taller (regla 11). */
export const WORKSHOP_UPDATE_DAYS = 2

export interface WorkshopInput {
  inWorkshop: boolean
  entryDate: string | null
  /** Fecha del trabajo de la correctiva. */
  workDate: string
  /** Actualizaciones ordenadas o no; se usan las fechas `YYYY-MM-DD` de creación. */
  updates: ReadonlyArray<{ kind: "sigue" | "salio"; createdDate: string; exitDate: string | null }>
}

export interface WorkshopState {
  inWorkshop: boolean
  /** Sigue en taller y su última novedad tiene más de 2 días. */
  stale: boolean
  lastActivityDate: string
  exitDate: string | null
  /** Ingreso → salida, o hasta hoy si sigue en taller; `null` sin fecha de ingreso. */
  daysStopped: number | null
}

/** Regla 11. `today` es `todayInChile()` del llamador, para que la función sea pura. */
export function workshopState(input: WorkshopInput, today: string): WorkshopState {
  // Gana la salida MÁS ANTIGUA: con dos filas `salio` (corrección manual o
  // importación) la fecha no puede depender del orden en que llegan las filas.
  // El `sort` es estable, así que en el mismo día decide el orden de inserción.
  const exit = [...input.updates]
    .sort((a, b) => (a.createdDate < b.createdDate ? -1 : a.createdDate > b.createdDate ? 1 : 0))
    .find((update) => update.kind === "salio")
  const lastActivityDate = input.updates.reduce((max, update) => (update.createdDate > max ? update.createdDate : max), input.workDate)
  const inWorkshop = input.inWorkshop && !exit
  const exitDate = exit?.exitDate ?? null
  const end = inWorkshop ? today : exitDate ?? (input.inWorkshop ? null : input.workDate)
  const daysStopped = input.entryDate && end ? Math.max(0, daysBetween(input.entryDate, end)) : null
  return {
    inWorkshop,
    stale: inWorkshop && daysBetween(lastActivityDate, today) > WORKSHOP_UPDATE_DAYS,
    lastActivityDate,
    exitDate,
    daysStopped,
  }
}
