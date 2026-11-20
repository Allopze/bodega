import { and, asc, between, eq, gt, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  fleetOperationDayMarks,
  fleetOperationShifts,
  fuelTelemetryDaily,
  fuelVehicleOperationalIntervals,
  fuelVehicleWorksiteIntervals,
  fuelVehicles,
  workerPositions,
  workers,
} from "@/db/schema"
import {
  rankOperators,
  summarizeEquipmentDay,
  summarizeShift,
  type VehicleTelemetry,
} from "@/lib/fleet/shifts/calc"
import { HOURLY_SOURCE, shiftPresetLabel } from "@/lib/fleet/shifts/constants"
import { daysBetween } from "@/lib/fleet/shifts/hours"
import { loadVehicleTelemetry } from "@/lib/fleet/shifts/telemetry-loader"
import type { PlainDate, ShiftWindow } from "@/lib/fleet/shifts/types"
import { stayWorksiteOnDaySql } from "@/lib/fleet/stays-sql"
import { getIdleTarget } from "@/lib/services/fleet-shifts"
import { addDaysToPlainDate, chileDayStartInstant } from "@/lib/utils"

/**
 * Lecturas de las tres vistas de «Turnos y ralentí» (día, operadores y equipos).
 *
 * Reglas que comparten:
 * - Alcance: la faena de un equipo es la de su estadía ESE día. Un turno o una marca se ven
 *   si la faena del equipo en su fecha está en el alcance (`[]` no ve nada).
 * - Un turno anulado no cuenta ni se muestra.
 * - Ninguna cifra se calcula aquí: salen de `summarizeShift`, `summarizeEquipmentDay` y
 *   `rankOperators`, que suman las mismas filas por hora.
 * - El número de consultas no depende del número de equipos ni de días.
 */

export type ShiftScope = string[] | "all"

type ShiftSummary = ReturnType<typeof summarizeShift>
type EquipmentDaySummary = ReturnType<typeof summarizeEquipmentDay>
type OperationalState = "mantencion" | "fuera_servicio"

export interface ShiftRow {
  id: string
  vehicleId: string
  vehicleCode: string
  shiftDate: string
  startHour: number
  endHour: number
  presetLabel: string | null
  operatorWorkerId: string
  operatorName: string
  notes: string
  summary: ShiftSummary
}

export interface EquipmentDayRow {
  vehicleId: string
  vehicleCode: string
  hasVisionLink: boolean
  operationalStatus: "operativo" | "mantencion" | "fuera_servicio"
  dayMark: { reason: string; notes: string } | null
  shiftsCount: number
  summary: EquipmentDaySummary
}

export interface GridCell {
  day: string
  kind: "pct" | "detenido" | "fs" | "sp" | "ss" | "vacio"
  pct: number | null
  engineHours: number
}

export interface GridRow {
  vehicleId: string
  vehicleCode: string
  cells: GridCell[]
  engineHours: number
  idlePct: number | null
}

export interface StoppedDay {
  day: string
  vehicleCode: string
  source: "estado" | "marca"
  label: string
  notes: string
  engineHours: number
}

export interface IdleLitersRow {
  vehicleCode: string
  byDay: Record<string, number | null>
  idleLiters: number
  totalLiters: number
  idleShare: number | null
}

/** Una vista de equipos no pasa de dos meses: una grilla más ancha no se lee y pesa. */
export const MAX_GRID_DAYS = 62

const STATE_LABEL: Record<OperationalState, string> = {
  mantencion: "En mantención",
  fuera_servicio: "Fuera de servicio",
}

const MARK_LABEL: Record<string, string> = {
  sin_operacion_programada: "Sin operación programada",
  otro: "Otro motivo",
}

const MACHINE_OPERATOR_POSITION = "operador de maquinaria"

/* ── Auxiliares ─────────────────────────────────────────────────────────── */

const hasNoScope = (scope: ShiftScope) => scope !== "all" && scope.length === 0

const vehicleLabel = (vehicle: { code: string | null; plate: string }) => vehicle.code?.trim() || vehicle.plate

const byLabel = new Intl.Collator("es", { numeric: true, sensitivity: "base" })

/** Columna calificada: dentro de la subconsulta de la estadía, `shift_date` sin calificar sería ambiguo. */
const qualified = (table: string, column: string): SQL => sql`${sql.identifier(table)}.${sql.identifier(column)}`

/** Equipo con serie de VisionLink vinculada (la misma regla que `loadVehicleTelemetry`). */
const hasSerialSql = sql`coalesce(btrim(${fuelVehicles.serialNumber}), '') <> ''`

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
}

const unique = <T,>(values: Iterable<T>): T[] => [...new Set(values)]

/** Filtra por la faena de la estadía del día; con alcance total no filtra. */
function scopeCondition(scope: ShiftScope, stay: SQL<string | null>): SQL | undefined {
  return scope === "all" ? undefined : inArray(stay, scope)
}

interface Stay {
  worksiteId: string
  startedOn: string | null
  endedOn: string | null
}

/**
 * Estadías de varios equipos en una sola consulta. Es la misma tabla y la misma regla que
 * `stayWorksiteOnDaySql` (inicio nulo = desde siempre, término nulo = abierta); se usa para
 * resolver la faena de cada celda de la grilla sin una consulta por equipo y día.
 */
async function loadStays(vehicleIds: string[]): Promise<Map<string, Stay[]>> {
  const result = new Map<string, Stay[]>()
  if (vehicleIds.length === 0) return result
  const rows = await db.select({
    vehicleId: fuelVehicleWorksiteIntervals.vehicleId,
    worksiteId: fuelVehicleWorksiteIntervals.worksiteId,
    startedOn: fuelVehicleWorksiteIntervals.startedOn,
    endedOn: fuelVehicleWorksiteIntervals.endedOn,
  }).from(fuelVehicleWorksiteIntervals).where(inArray(fuelVehicleWorksiteIntervals.vehicleId, vehicleIds))
  for (const row of rows) {
    const list = result.get(row.vehicleId) ?? []
    list.push(row)
    result.set(row.vehicleId, list)
  }
  return result
}

function stayOnDay(stays: Stay[] | undefined, day: PlainDate): string | null {
  const stay = stays?.find((item) => (item.startedOn === null || item.startedOn <= day) && (item.endedOn === null || item.endedOn >= day))
  return stay?.worksiteId ?? null
}

interface ShiftRecord extends ShiftWindow {
  id: string
  vehicleId: string
  vehicleCode: string
  operatorWorkerId: string
  operatorName: string
  notes: string
}

/** Turnos vigentes de `from` a `to` (por su fecha de inicio) cuyo equipo estaba en el alcance ese día. */
async function loadShifts(scope: ShiftScope, q: { from: PlainDate; to: PlainDate; vehicleId?: string }): Promise<ShiftRecord[]> {
  const stay = stayWorksiteOnDaySql(fleetOperationShifts.vehicleId, qualified("fleet_operation_shifts", "shift_date"))
  const rows = await db.select({
    id: fleetOperationShifts.id,
    vehicleId: fleetOperationShifts.vehicleId,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    shiftDate: fleetOperationShifts.shiftDate,
    startHour: fleetOperationShifts.startHour,
    endHour: fleetOperationShifts.endHour,
    operatorWorkerId: fleetOperationShifts.operatorWorkerId,
    operatorName: fleetOperationShifts.operatorNameSnapshot,
    notes: fleetOperationShifts.notes,
  })
    .from(fleetOperationShifts)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, fleetOperationShifts.vehicleId))
    .where(and(
      isNull(fleetOperationShifts.voidedAt),
      between(fleetOperationShifts.shiftDate, q.from, q.to),
      q.vehicleId ? eq(fleetOperationShifts.vehicleId, q.vehicleId) : undefined,
      scopeCondition(scope, stay),
    ))
    .orderBy(asc(fleetOperationShifts.shiftDate), asc(fleetOperationShifts.startHour), asc(fleetOperationShifts.id))
  return rows.map((row) => ({
    id: row.id,
    vehicleId: row.vehicleId,
    vehicleCode: vehicleLabel(row),
    shiftDate: row.shiftDate,
    startHour: row.startHour,
    endHour: row.endHour,
    operatorWorkerId: row.operatorWorkerId,
    operatorName: row.operatorName,
    notes: row.notes,
  }))
}

interface MarkRecord {
  vehicleId: string
  vehicleCode: string
  day: PlainDate
  reason: string
  notes: string
}

/** Marcas de día de `from` a `to` cuyo equipo estaba en el alcance ese día. */
async function loadMarks(scope: ShiftScope, q: { from: PlainDate; to: PlainDate }): Promise<MarkRecord[]> {
  const stay = stayWorksiteOnDaySql(fleetOperationDayMarks.vehicleId, qualified("fleet_operation_day_marks", "day"))
  const rows = await db.select({
    vehicleId: fleetOperationDayMarks.vehicleId,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    day: fleetOperationDayMarks.day,
    reason: fleetOperationDayMarks.reason,
    notes: fleetOperationDayMarks.notes,
  })
    .from(fleetOperationDayMarks)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, fleetOperationDayMarks.vehicleId))
    .where(and(between(fleetOperationDayMarks.day, q.from, q.to), scopeCondition(scope, stay)))
    .orderBy(asc(fleetOperationDayMarks.day), asc(fleetOperationDayMarks.id))
  return rows.map((row) => ({
    vehicleId: row.vehicleId,
    vehicleCode: vehicleLabel(row),
    day: row.day,
    reason: row.reason,
    notes: row.notes,
  }))
}

interface StateInterval {
  status: OperationalState
  startMs: number
  endMs: number | null
  reason: string
}

/** Instantes (ms) en que empieza y termina un día calendario en Chile. */
function dayBoundsMs(day: PlainDate): { start: number; end: number } {
  return {
    start: Date.parse(chileDayStartInstant(day)),
    end: Date.parse(chileDayStartInstant(addDaysToPlainDate(day, 1))),
  }
}

/** Intervalos de mantención o fuera de servicio que tocan de `fromDay` a `toDay` (hora de Chile). */
async function loadStateIntervals(vehicleIds: string[], fromDay: PlainDate, toDay: PlainDate): Promise<Map<string, StateInterval[]>> {
  const result = new Map<string, StateInterval[]>()
  if (vehicleIds.length === 0) return result
  const rangeStart = chileDayStartInstant(fromDay)
  const rangeEnd = chileDayStartInstant(addDaysToPlainDate(toDay, 1))
  const rows = await db.select({
    vehicleId: fuelVehicleOperationalIntervals.vehicleId,
    status: fuelVehicleOperationalIntervals.status,
    startedAt: fuelVehicleOperationalIntervals.startedAt,
    endedAt: fuelVehicleOperationalIntervals.endedAt,
    reason: fuelVehicleOperationalIntervals.reason,
  })
    .from(fuelVehicleOperationalIntervals)
    .where(and(
      inArray(fuelVehicleOperationalIntervals.vehicleId, vehicleIds),
      inArray(fuelVehicleOperationalIntervals.status, ["mantencion", "fuera_servicio"]),
      lt(fuelVehicleOperationalIntervals.startedAt, rangeEnd),
      or(isNull(fuelVehicleOperationalIntervals.endedAt), gt(fuelVehicleOperationalIntervals.endedAt, rangeStart)),
    ))
  for (const row of rows) {
    const list = result.get(row.vehicleId) ?? []
    list.push({
      status: row.status as OperationalState,
      startMs: Date.parse(row.startedAt),
      endMs: row.endedAt ? Date.parse(row.endedAt) : null,
      reason: row.reason?.trim() ?? "",
    })
    result.set(row.vehicleId, list)
  }
  return result
}

/** El intervalo de estado que toca el día (el que empezó más tarde si hubiera dos). */
function stateOnDay(intervals: StateInterval[] | undefined, bounds: { start: number; end: number }): StateInterval | null {
  let found: StateInterval | null = null
  for (const interval of intervals ?? []) {
    if (interval.startMs >= bounds.end) continue
    if (interval.endMs !== null && interval.endMs <= bounds.start) continue
    if (!found || interval.startMs > found.startMs) found = interval
  }
  return found
}

function teleOf(map: Map<string, VehicleTelemetry>, vehicleId: string): VehicleTelemetry {
  return map.get(vehicleId) ?? { linked: false, hours: new Map(), segmentsFetchedAt: new Map(), dailyFetchedAt: new Map(), dailyRowDays: new Set() }
}

const EMPTY_DAY_VIEW = (day: string, target: number) => ({ day, target, vehicles: [] as EquipmentDayRow[], shifts: [] as ShiftRow[] })

/* ── Turnos del día ─────────────────────────────────────────────────────── */

export async function getShiftDayView(
  scope: ShiftScope,
  day: PlainDate,
): Promise<{ day: string; target: number; vehicles: EquipmentDayRow[]; shifts: ShiftRow[] }> {
  const target = await getIdleTarget()
  if (hasNoScope(scope)) return EMPTY_DAY_VIEW(day, target)

  // Los turnos del día anterior entran sólo para cubrir las horas que se extienden a este día (22–06).
  const [windowShifts, marks] = await Promise.all([
    loadShifts(scope, { from: addDaysToPlainDate(day, -1), to: day }),
    loadMarks(scope, { from: day, to: day }),
  ])
  const dayShifts = windowShifts.filter((shift) => shift.shiftDate === day)
  const extraIds = unique([...dayShifts.map((shift) => shift.vehicleId), ...marks.map((mark) => mark.vehicleId)])

  const stay = stayWorksiteOnDaySql(fuelVehicles.id, sql`${day}`)
  const listed = and(eq(fuelVehicles.isActive, true), hasSerialSql, scopeCondition(scope, stay))
  const vehicleRows = await db.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate })
    .from(fuelVehicles)
    .where(extraIds.length > 0 ? or(listed, inArray(fuelVehicles.id, extraIds)) : listed)
  vehicleRows.sort((a, b) => byLabel.compare(vehicleLabel(a), vehicleLabel(b)))

  const ids = vehicleRows.map((vehicle) => vehicle.id)
  const [telemetry, intervals] = await Promise.all([
    loadVehicleTelemetry(ids, day, day),
    loadStateIntervals(ids, day, day),
  ])
  const bounds = dayBoundsMs(day)
  const markByVehicle = new Map(marks.map((mark) => [mark.vehicleId, mark]))
  const windowByVehicle = Map.groupBy(windowShifts, (shift) => shift.vehicleId)
  const countByVehicle = Map.groupBy(dayShifts, (shift) => shift.vehicleId)

  const vehicles: EquipmentDayRow[] = vehicleRows.map((vehicle) => {
    const tele = teleOf(telemetry, vehicle.id)
    const state = stateOnDay(intervals.get(vehicle.id), bounds)
    const mark = markByVehicle.get(vehicle.id)
    return {
      vehicleId: vehicle.id,
      vehicleCode: vehicleLabel(vehicle),
      hasVisionLink: tele.linked,
      operationalStatus: state?.status ?? "operativo",
      dayMark: mark ? { reason: mark.reason, notes: mark.notes } : null,
      shiftsCount: countByVehicle.get(vehicle.id)?.length ?? 0,
      summary: summarizeEquipmentDay(day, windowByVehicle.get(vehicle.id) ?? [], tele, { outOfService: state !== null }),
    }
  })

  const shifts: ShiftRow[] = dayShifts
    .map((shift) => ({
      id: shift.id,
      vehicleId: shift.vehicleId,
      vehicleCode: shift.vehicleCode,
      shiftDate: shift.shiftDate,
      startHour: shift.startHour,
      endHour: shift.endHour,
      presetLabel: shiftPresetLabel(shift.startHour, shift.endHour),
      operatorWorkerId: shift.operatorWorkerId,
      operatorName: shift.operatorName,
      notes: shift.notes,
      summary: summarizeShift(shift, teleOf(telemetry, shift.vehicleId), target),
    }))
    .sort((a, b) => byLabel.compare(a.vehicleCode, b.vehicleCode) || a.startHour - b.startHour || a.id.localeCompare(b.id))

  return { day, target, vehicles, shifts }
}

/* ── Ranking de operadores ──────────────────────────────────────────────── */

export async function getOperatorRankingView(
  scope: ShiftScope,
  q: { from: PlainDate; to: PlainDate; vehicleId?: string },
): Promise<{ target: number; ranking: ReturnType<typeof rankOperators> }> {
  const target = await getIdleTarget()
  if (hasNoScope(scope)) return { target, ranking: rankOperators([]) }

  // Un turno cuenta por su fecha de inicio: un 22–06 del último día entra entero aunque sus horas pasen al siguiente.
  const shifts = await loadShifts(scope, q)
  const telemetry = await loadVehicleTelemetry(unique(shifts.map((shift) => shift.vehicleId)), q.from, q.to)
  const ranking = rankOperators(shifts.map((shift) => ({
    operatorWorkerId: shift.operatorWorkerId,
    operatorName: shift.operatorName,
    summary: summarizeShift(shift, teleOf(telemetry, shift.vehicleId), target),
  })))
  return { target, ranking }
}

/* ── Grilla de equipos ──────────────────────────────────────────────────── */

export async function getEquipmentGridView(
  scope: ShiftScope,
  q: { from: PlainDate; to: PlainDate },
): Promise<{
  target: number
  days: string[]
  rows: GridRow[]
  stoppedDays: StoppedDay[]
  idleLiters: IdleLitersRow[]
}> {
  const target = await getIdleTarget()
  const empty = { target, days: [] as string[], rows: [] as GridRow[], stoppedDays: [] as StoppedDay[], idleLiters: [] as IdleLitersRow[] }
  if (hasNoScope(scope) || q.to < q.from) return empty

  const days = daysBetween(q.from, q.to).slice(0, MAX_GRID_DAYS)
  const first = days[0]!
  const last = days[days.length - 1]!

  const [windowShifts, marks, candidates] = await Promise.all([
    loadShifts(scope, { from: addDaysToPlainDate(first, -1), to: last }),
    loadMarks(scope, { from: first, to: last }),
    db.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate })
      .from(fuelVehicles)
      .where(and(eq(fuelVehicles.isActive, true), hasSerialSql)),
  ])

  // Equipos con turnos o marcas en el período aunque no sean de VisionLink ni estén activos.
  const extra = [
    ...windowShifts.filter((shift) => shift.shiftDate >= first).map((shift) => ({ id: shift.vehicleId, code: shift.vehicleCode })),
    ...marks.map((mark) => ({ id: mark.vehicleId, code: mark.vehicleCode })),
  ]
  const vehicleById = new Map<string, { id: string; label: string }>()
  for (const vehicle of candidates) vehicleById.set(vehicle.id, { id: vehicle.id, label: vehicleLabel(vehicle) })
  const forced = new Set<string>()
  for (const item of extra) {
    forced.add(item.id)
    if (!vehicleById.has(item.id)) vehicleById.set(item.id, { id: item.id, label: item.code })
  }

  const stays = scope === "all" ? new Map<string, Stay[]>() : await loadStays([...vehicleById.keys()])
  const visible = (vehicleId: string, day: PlainDate) => scope === "all" || (() => {
    const worksiteId = stayOnDay(stays.get(vehicleId), day)
    return worksiteId !== null && scope.includes(worksiteId)
  })()

  const shown = [...vehicleById.values()]
    .filter((vehicle) => forced.has(vehicle.id) || days.some((day) => visible(vehicle.id, day)))
    .sort((a, b) => byLabel.compare(a.label, b.label))
  const ids = shown.map((vehicle) => vehicle.id)
  if (ids.length === 0) return { ...empty, days }

  const [telemetry, intervals, dailyRows] = await Promise.all([
    loadVehicleTelemetry(ids, first, last),
    loadStateIntervals(ids, first, last),
    db.select({
      vehicleId: fuelTelemetryDaily.vehicleId,
      day: fuelTelemetryDaily.day,
      litersIdle: fuelTelemetryDaily.litersIdle,
      litersWorking: fuelTelemetryDaily.litersWorking,
    })
      .from(fuelTelemetryDaily)
      .where(and(
        inArray(fuelTelemetryDaily.vehicleId, ids),
        eq(fuelTelemetryDaily.source, HOURLY_SOURCE),
        between(fuelTelemetryDaily.day, first, last),
      )),
  ])

  const boundsByDay = new Map(days.map((day) => [day, dayBoundsMs(day)]))
  const shiftsByVehicle = Map.groupBy(windowShifts, (shift) => shift.vehicleId)
  const markByVehicleDay = new Map(marks.map((mark) => [`${mark.vehicleId}|${mark.day}`, mark]))

  const rows: GridRow[] = []
  const stoppedDays: StoppedDay[] = []

  for (const vehicle of shown) {
    const tele = teleOf(telemetry, vehicle.id)
    const vehicleShifts = shiftsByVehicle.get(vehicle.id) ?? []
    let engineHours = 0
    let idleHours = 0
    let workingHours = 0
    const cells: GridCell[] = []

    for (const day of days) {
      if (!visible(vehicle.id, day)) {
        cells.push({ day, kind: "vacio", pct: null, engineHours: 0 })
        continue
      }
      const state = stateOnDay(intervals.get(vehicle.id), boundsByDay.get(day)!)
      const mark = markByVehicleDay.get(`${vehicle.id}|${day}`)
      const summary = summarizeEquipmentDay(day, vehicleShifts, tele, { outOfService: state !== null })
      engineHours += summary.engineHours
      idleHours += summary.idleHours
      workingHours += summary.workingHours

      // Estado y marca van antes que «sin señal»: un equipo en taller o sin operación programada no
      // transmite, y esa es la explicación, no una falla de la telemetría.
      let kind: GridCell["kind"]
      if (!tele.linked) kind = "vacio"
      else if (state && summary.idlePct === null) kind = "fs"
      else if (mark && summary.idlePct === null) kind = "sp"
      else if (summary.signal === "sin_senal") kind = "ss"
      else if (summary.signal === "pendiente" && summary.engineHours === 0) kind = "vacio"
      else if (summary.engineHours === 0 || summary.idlePct === null) kind = "detenido"
      else kind = "pct"
      cells.push({ day, kind, pct: kind === "pct" ? summary.idlePct : null, engineHours: summary.engineHours })

      if (state) {
        stoppedDays.push({ day, vehicleCode: vehicle.label, source: "estado", label: STATE_LABEL[state.status], notes: state.reason, engineHours: summary.engineHours })
      }
      if (mark) {
        stoppedDays.push({ day, vehicleCode: vehicle.label, source: "marca", label: MARK_LABEL[mark.reason] ?? "Otro motivo", notes: mark.notes, engineHours: summary.engineHours })
      }
    }

    rows.push({
      vehicleId: vehicle.id,
      vehicleCode: vehicle.label,
      cells,
      engineHours,
      idlePct: idleHours + workingHours > 0 ? idleHours / (idleHours + workingHours) : null,
    })
  }

  stoppedDays.sort((a, b) => b.day.localeCompare(a.day) || byLabel.compare(a.vehicleCode, b.vehicleCode) || a.source.localeCompare(b.source))

  // Litros en vacío: del resumen diario (por día, no se reparte por turno). Sólo equipos con algún dato.
  const labelById = new Map(shown.map((vehicle) => [vehicle.id, vehicle.label]))
  const dailyByVehicle = Map.groupBy(dailyRows, (row) => row.vehicleId)
  const idleLiters: IdleLitersRow[] = []
  for (const vehicle of shown) {
    const vehicleDaily = new Map((dailyByVehicle.get(vehicle.id) ?? []).map((row) => [row.day, row]))
    const byDay: Record<string, number | null> = {}
    let idleTotal = 0
    let litersTotal = 0
    let hasData = false
    for (const day of days) {
      const row = visible(vehicle.id, day) ? vehicleDaily.get(day) : undefined
      if (!row || row.litersIdle === null) {
        byDay[day] = null
        continue
      }
      hasData = true
      byDay[day] = row.litersIdle
      idleTotal += row.litersIdle
      litersTotal += row.litersIdle + (row.litersWorking ?? 0)
    }
    if (!hasData) continue
    idleLiters.push({
      vehicleCode: labelById.get(vehicle.id) ?? vehicle.label,
      byDay,
      idleLiters: idleTotal,
      totalLiters: litersTotal,
      idleShare: litersTotal > 0 ? idleTotal / litersTotal : null,
    })
  }

  return { target, days, rows, stoppedDays, idleLiters }
}

/* ── Opciones del formulario ────────────────────────────────────────────── */

export async function listShiftFormOptions(
  scope: ShiftScope,
  day: PlainDate,
): Promise<{
  vehicles: Array<{ id: string; code: string; hasVisionLink: boolean }>
  operators: Array<{ id: string; name: string; isMachineOperator: boolean }>
}> {
  if (hasNoScope(scope)) return { vehicles: [], operators: [] }

  const stay = stayWorksiteOnDaySql(fuelVehicles.id, sql`${day}`)
  const [vehicleRows, workerRows] = await Promise.all([
    db.select({
      id: fuelVehicles.id,
      code: fuelVehicles.code,
      plate: fuelVehicles.plate,
      linked: sql<boolean>`${hasSerialSql}`,
    })
      .from(fuelVehicles)
      .where(and(eq(fuelVehicles.isActive, true), scopeCondition(scope, stay))),
    db.select({
      id: workers.id,
      firstName: workers.firstName,
      lastName: workers.lastName,
      positionName: workerPositions.name,
      legacyPosition: workers.position,
    })
      .from(workers)
      .leftJoin(workerPositions, eq(workerPositions.id, workers.positionId))
      .where(and(
        eq(workers.isActive, true),
        isNotNull(workers.worksiteId),
        scope === "all" ? undefined : inArray(workers.worksiteId, scope),
      )),
  ])

  const vehicles = vehicleRows
    .map((vehicle) => ({ id: vehicle.id, code: vehicleLabel(vehicle), hasVisionLink: Boolean(vehicle.linked) }))
    .sort((a, b) => Number(b.hasVisionLink) - Number(a.hasVisionLink) || byLabel.compare(a.code, b.code))

  const operators = workerRows
    .map((worker) => ({
      id: worker.id,
      name: `${worker.firstName} ${worker.lastName}`,
      isMachineOperator: normalizeText(worker.positionName ?? worker.legacyPosition ?? "").startsWith(MACHINE_OPERATOR_POSITION),
    }))
    .sort((a, b) => Number(b.isMachineOperator) - Number(a.isMachineOperator) || byLabel.compare(a.name, b.name))

  return { vehicles, operators }
}
