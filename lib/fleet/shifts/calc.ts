import { IDLE_TARGET_DEFAULT, KNOWN_HOUR_MARGIN_MS, MIN_ENGINE_HOURS, UNASSIGNED_WARNING_HOURS } from "./constants"
import { hourEndInstant, hourKeyId, shiftHourKeys } from "./hours"
import type { HourKey, HourSeconds, PlainDate, ShiftWindow } from "./types"

/**
 * Cálculo de turnos, equipo-día y ranking de operadores (puro).
 *
 * Todas las cifras salen de sumar las mismas filas por hora con `sumHours`: por
 * eso, para un equipo y un día, las horas cubiertas por turnos más las que no
 * tienen turno dan el total del día (ver el diseño, § Reglas de cálculo).
 */

/** Lo que se sabe de un equipo: sus filas por hora y cuándo se consultó cada día. */
export interface VehicleTelemetry {
  /** El equipo tiene serie de VisionLink vinculada. */
  linked: boolean
  /** Segundos por hora, indexados por `hourKeyId`; una hora conocida sin entrada vale 0 s. */
  hours: Map<string, HourSeconds>
  /** Cuándo se consultaron los tramos de cada día (texto de fecha-hora). */
  segmentsFetchedAt: Map<PlainDate, string>
  /** Cuándo se consultó el resumen diario de cada día. */
  dailyFetchedAt: Map<PlainDate, string>
  /** Días con fila en el resumen diario (con 0 h = detenido; sin fila = no transmitió). */
  dailyRowDays: Set<PlainDate>
}

/** Una hora es conocida si se consultó después de que terminó, más un margen. */
export function isHourKnown(key: HourKey, segmentsFetchedAt: string | undefined): boolean {
  if (!segmentsFetchedAt) return false
  const fetchedAt = Date.parse(segmentsFetchedAt)
  if (!Number.isFinite(fetchedAt)) return false
  return fetchedAt >= hourEndInstant(key) + KNOWN_HOUR_MARGIN_MS
}

export type ShiftStatus = "sin_telemetria" | "pendiente" | "sin_senal" | "sin_uso" | "sin_dato_ralenti" | "sobre_meta" | "en_meta"

export const SHIFT_STATUS_LABEL: Record<ShiftStatus, string> = {
  sin_telemetria: "Sin telemetría",
  pendiente: "Pendiente de datos",
  sin_senal: "Sin señal",
  sin_uso: "Sin uso",
  sin_dato_ralenti: "Sin dato de ralentí",
  sobre_meta: "Sobre meta",
  en_meta: "En meta",
}

export interface HoursTotals {
  idleHours: number
  workingHours: number
  runningHours: number
  /** Ralentí + trabajo + running. */
  engineHours: number
  /** Ralentí ÷ (ralentí + trabajo); `null` si el divisor es 0. */
  idlePct: number | null
}

const SECONDS_PER_HOUR = 3600

function sumHours(keys: readonly HourKey[], tele: VehicleTelemetry): HoursTotals {
  let idle = 0
  let working = 0
  let running = 0
  for (const key of keys) {
    const seconds = tele.hours.get(hourKeyId(key))
    if (!seconds) continue
    idle += seconds.idle
    working += seconds.working
    running += seconds.running
  }
  return {
    idleHours: idle / SECONDS_PER_HOUR,
    workingHours: working / SECONDS_PER_HOUR,
    runningHours: running / SECONDS_PER_HOUR,
    engineHours: (idle + working + running) / SECONDS_PER_HOUR,
    idlePct: idle + working > 0 ? idle / (idle + working) : null,
  }
}

const ZERO_TOTALS: HoursTotals = { idleHours: 0, workingHours: 0, runningHours: 0, engineHours: 0, idlePct: null }

function uniqueDays(keys: readonly HourKey[]): PlainDate[] {
  return [...new Set(keys.map((key) => key.day))]
}

function allHoursKnown(keys: readonly HourKey[], tele: VehicleTelemetry): boolean {
  return keys.every((key) => isHourKnown(key, tele.segmentsFetchedAt.get(key.day)))
}

export function summarizeShift(shift: ShiftWindow, tele: VehicleTelemetry, target: number = IDLE_TARGET_DEFAULT): HoursTotals & { status: ShiftStatus } {
  if (!tele.linked) return { ...ZERO_TOTALS, status: "sin_telemetria" }
  const keys = shiftHourKeys(shift)
  const totals = sumHours(keys, tele)
  const days = uniqueDays(keys)
  const noEngine = totals.engineHours === 0

  let status: ShiftStatus
  if (!allHoursKnown(keys, tele) || (noEngine && days.some((day) => !tele.dailyFetchedAt.has(day)))) status = "pendiente"
  else if (noEngine && days.some((day) => !tele.dailyRowDays.has(day))) status = "sin_senal"
  else if (totals.engineHours < MIN_ENGINE_HOURS) status = "sin_uso"
  else if (totals.idlePct === null) status = "sin_dato_ralenti"
  else status = totals.idlePct > target ? "sobre_meta" : "en_meta"
  return { ...totals, status }
}

export type EquipmentDaySignal = "ok" | "pendiente" | "sin_senal" | "sin_telemetria"

export function summarizeEquipmentDay(
  day: PlainDate,
  shifts: readonly ShiftWindow[],
  tele: VehicleTelemetry,
  opts: { outOfService: boolean },
): HoursTotals & { assignedEngineHours: number; unassignedEngineHours: number; warnUnassigned: boolean; signal: EquipmentDaySignal } {
  const dayKeys: HourKey[] = Array.from({ length: 24 }, (_, hour) => ({ day, hour }))
  const covered = new Set(shifts.flatMap((shift) => shiftHourKeys(shift)).map(hourKeyId))
  const assignedKeys = dayKeys.filter((key) => covered.has(hourKeyId(key)))
  const unassignedKeys = dayKeys.filter((key) => !covered.has(hourKeyId(key)))

  const totals = sumHours(dayKeys, tele)
  const assignedEngineHours = sumHours(assignedKeys, tele).engineHours
  const unassignedEngineHours = sumHours(unassignedKeys, tele).engineHours

  let signal: EquipmentDaySignal
  if (!tele.linked) signal = "sin_telemetria"
  else if (!allHoursKnown(dayKeys, tele)) signal = "pendiente"
  else if (totals.engineHours === 0 && tele.dailyFetchedAt.has(day) && !tele.dailyRowDays.has(day)) signal = "sin_senal"
  else signal = "ok"

  return {
    ...totals,
    assignedEngineHours,
    unassignedEngineHours,
    warnUnassigned: unassignedEngineHours >= UNASSIGNED_WARNING_HOURS && !opts.outOfService,
    signal,
  }
}

export interface OperatorRankingRow {
  rank: number | null
  operatorWorkerId: string
  operatorName: string
  shifts: number
  engineHours: number
  workingHours: number
  idleHours: number
  idlePct: number | null
  overTarget: number
  pending: number
}

type RankingTotals = Omit<OperatorRankingRow, "rank" | "operatorWorkerId" | "operatorName">

/** Un turno entra al porcentaje sólo si quedó «En meta» o «Sobre meta». */
function aggregate(summaries: ReadonlyArray<ReturnType<typeof summarizeShift>>): RankingTotals {
  let engineHours = 0
  let workingHours = 0
  let idleHours = 0
  let overTarget = 0
  let pending = 0
  for (const summary of summaries) {
    if (summary.status === "pendiente") pending += 1
    if (summary.status === "sobre_meta") overTarget += 1
    if (summary.status !== "sobre_meta" && summary.status !== "en_meta") continue
    engineHours += summary.engineHours
    workingHours += summary.workingHours
    idleHours += summary.idleHours
  }
  return {
    shifts: summaries.length,
    engineHours,
    workingHours,
    idleHours,
    idlePct: idleHours + workingHours > 0 ? idleHours / (idleHours + workingHours) : null,
    overTarget,
    pending,
  }
}

export function rankOperators(rows: ReadonlyArray<{ operatorWorkerId: string; operatorName: string; summary: ReturnType<typeof summarizeShift> }>): {
  rows: OperatorRankingRow[]
  total: RankingTotals
} {
  const byOperator = new Map<string, { operatorName: string; summaries: Array<ReturnType<typeof summarizeShift>> }>()
  for (const row of rows) {
    const entry = byOperator.get(row.operatorWorkerId)
    if (entry) entry.summaries.push(row.summary)
    else byOperator.set(row.operatorWorkerId, { operatorName: row.operatorName, summaries: [row.summary] })
  }

  const unranked = [...byOperator.entries()].map(([operatorWorkerId, { operatorName, summaries }]) => ({
    operatorWorkerId,
    operatorName,
    ...aggregate(summaries),
  }))
  unranked.sort((a, b) => {
    if (a.idlePct === null && b.idlePct !== null) return 1
    if (a.idlePct !== null && b.idlePct === null) return -1
    if (a.idlePct !== null && b.idlePct !== null && a.idlePct !== b.idlePct) return a.idlePct - b.idlePct
    return a.operatorName.localeCompare(b.operatorName, "es")
  })

  let nextRank = 1
  return {
    rows: unranked.map((row) => ({ rank: row.idlePct === null ? null : nextRank++, ...row })),
    total: aggregate(rows.map((row) => row.summary)),
  }
}
