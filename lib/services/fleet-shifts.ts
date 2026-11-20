import { and, between, eq, ne, or, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { fleetOperationDayMarks, fleetOperationShifts, fuelVehicles, systemSettings, workers } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { IDLE_TARGET_DEFAULT } from "@/lib/fleet/shifts/constants"
import { hourKeyId, shiftHourKeys } from "@/lib/fleet/shifts/hours"
import type { ShiftInput } from "@/lib/fleet/shifts/types"
import { stayWorksiteOnDaySql } from "@/lib/fleet/stays-sql"
import { nanoid } from "@/lib/id"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"

/**
 * Registro de turnos de operación y marcas de día de un equipo. Nunca escribe la
 * faena del equipo: la lee con `stayWorksiteOnDaySql` (el día del turno) para
 * validar el alcance de quien registra.
 */

export type { ShiftInput }

export interface ShiftActor {
  userId: string
  email: string | null
  scope: string[] | "all"
}

export type ShiftResult = { ok: true; shiftId: string } | { ok: false; message: string }
type SimpleResult = { ok: true } | { ok: false; message: string }

export type DayMarkReason = "sin_operacion_programada" | "otro"

export const IDLE_TARGET_SETTING_KEY = "fleet.shifts.idle_target"

const MIN_SHIFT_DATE = "2024-01-01"
const MAX_DAYS_AHEAD = 31
const MAX_NOTES_LENGTH = 500
const MIN_VOID_REASON_LENGTH = 5

const NO_ACCESS_MESSAGE = "No tienes acceso a la faena de ese equipo ese día."
const SAME_HOURS_MESSAGE = "La hora de inicio y la de fin no pueden ser iguales."
const ALREADY_VOIDED_MESSAGE = "El turno ya está anulado."
const VEHICLE_NOT_FOUND_MESSAGE = "El equipo no existe."
const OPERATOR_MESSAGE = "El operador no existe, está inactivo o no pertenece a tus faenas."
const SHIFT_NOT_FOUND_MESSAGE = "El turno no existe."

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message })

function inScope(scope: string[] | "all", worksiteId: string | null): boolean {
  return worksiteId !== null && (scope === "all" || scope.includes(worksiteId))
}

function isPlainDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split("-").map(Number) as [number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function dateError(value: string): string | null {
  if (!isPlainDate(value)) return "La fecha no es válida."
  if (value < MIN_SHIFT_DATE) return "La fecha no puede ser anterior al 01-01-2024."
  if (value > addDaysToPlainDate(todayInChile(), MAX_DAYS_AHEAD)) return "La fecha no puede ir más de 31 días en el futuro."
  return null
}

function vehicleLabel(vehicle: { code: string | null; plate: string }): string {
  return vehicle.code?.trim() || vehicle.plate
}

const two = (n: number) => String(n).padStart(2, "0")
const ddmm = (day: string) => `${day.slice(8, 10)}-${day.slice(5, 7)}`

function auditActor(actor: ShiftActor) {
  return { userId: actor.userId, userEmail: actor.email ?? undefined }
}

/** Bloquea la fila del equipo y devuelve su rótulo y su faena del día (la de la estadía, no la actual). */
async function lockVehicle(tx: Tx, vehicleId: string, day: string) {
  const [vehicle] = await tx.select({
    id: fuelVehicles.id,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    worksiteOnDay: stayWorksiteOnDaySql(fuelVehicles.id, sql`${day}`),
  }).from(fuelVehicles).where(eq(fuelVehicles.id, vehicleId)).for("update", { of: fuelVehicles })
  return vehicle ?? null
}

async function lockedShift(tx: Tx, shiftId: string) {
  const [shift] = await tx.select().from(fleetOperationShifts)
    .where(eq(fleetOperationShifts.id, shiftId)).for("update")
  return shift ?? null
}

function shiftSnapshot(shift: typeof fleetOperationShifts.$inferSelect) {
  return {
    vehicleId: shift.vehicleId,
    shiftDate: shift.shiftDate,
    startHour: shift.startHour,
    endHour: shift.endHour,
    operatorWorkerId: shift.operatorWorkerId,
    operatorName: shift.operatorNameSnapshot,
    notes: shift.notes,
  }
}

async function saveShift(
  tx: Tx,
  actor: ShiftActor,
  mode: { kind: "create" } | { kind: "update"; shiftId: string },
  input: ShiftInput,
): Promise<ShiftResult> {
  const notes = input.notes.trim()
  if (input.startHour === input.endHour) return fail(SAME_HOURS_MESSAGE)
  for (const hour of [input.startHour, input.endHour]) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return fail("Las horas deben ser enteras entre 0 y 23.")
  }
  const badDate = dateError(input.shiftDate)
  if (badDate) return fail(badDate)
  if (notes.length > MAX_NOTES_LENGTH) return fail(`Las observaciones no pueden pasar de ${MAX_NOTES_LENGTH} caracteres.`)

  let before: typeof fleetOperationShifts.$inferSelect | null = null
  if (mode.kind === "update") {
    before = await lockedShift(tx, mode.shiftId)
    if (!before) return fail(SHIFT_NOT_FOUND_MESSAGE)
    if (before.voidedAt) return fail("No se puede editar un turno anulado.")
    // Quien edita debe poder ver el turno tal como estaba.
    const previousVehicle = await lockVehicle(tx, before.vehicleId, before.shiftDate)
    if (!previousVehicle || !inScope(actor.scope, previousVehicle.worksiteOnDay)) return fail(NO_ACCESS_MESSAGE)
  }

  // Orden de bloqueo fijo (equipo, luego operador): dos registros concurrentes no se traban entre sí.
  const vehicle = await lockVehicle(tx, input.vehicleId, input.shiftDate)
  if (!vehicle) return fail(VEHICLE_NOT_FOUND_MESSAGE)
  if (!inScope(actor.scope, vehicle.worksiteOnDay)) return fail(NO_ACCESS_MESSAGE)

  const [operator] = await tx.select({
    id: workers.id,
    firstName: workers.firstName,
    lastName: workers.lastName,
    worksiteId: workers.worksiteId,
    isActive: workers.isActive,
  }).from(workers).where(eq(workers.id, input.operatorWorkerId))
  if (!operator || !operator.isActive || !inScope(actor.scope, operator.worksiteId)) return fail(OPERATOR_MESSAGE)
  const operatorName = `${operator.firstName} ${operator.lastName}`.trim()

  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`shift-operator:${operator.id}`}))`)

  const wanted = new Set(shiftHourKeys(input).map(hourKeyId))
  const neighbours = await tx.select({
    id: fleetOperationShifts.id,
    vehicleId: fleetOperationShifts.vehicleId,
    shiftDate: fleetOperationShifts.shiftDate,
    startHour: fleetOperationShifts.startHour,
    endHour: fleetOperationShifts.endHour,
    operatorWorkerId: fleetOperationShifts.operatorWorkerId,
    operatorName: fleetOperationShifts.operatorNameSnapshot,
    vehicleCode: fuelVehicles.code,
    vehiclePlate: fuelVehicles.plate,
  }).from(fleetOperationShifts)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, fleetOperationShifts.vehicleId))
    .where(and(
      sql`${fleetOperationShifts.voidedAt} IS NULL`,
      between(fleetOperationShifts.shiftDate, addDaysToPlainDate(input.shiftDate, -1), addDaysToPlainDate(input.shiftDate, 1)),
      or(eq(fleetOperationShifts.vehicleId, input.vehicleId), eq(fleetOperationShifts.operatorWorkerId, operator.id)),
      mode.kind === "update" ? ne(fleetOperationShifts.id, mode.shiftId) : undefined,
    ))
    .orderBy(fleetOperationShifts.shiftDate, fleetOperationShifts.startHour)
  type Neighbour = (typeof neighbours)[number]
  const overlaps = (other: Neighbour) => shiftHourKeys(other).some((key) => wanted.has(hourKeyId(key)))
  const when = (other: Neighbour) => `${ddmm(other.shiftDate)} ${two(other.startHour)}–${two(other.endHour)}`
  const otherLabel = (other: Neighbour) => vehicleLabel({ code: other.vehicleCode, plate: other.vehiclePlate })

  const sameVehicle = neighbours.find((other) => other.vehicleId === input.vehicleId && overlaps(other))
  if (sameVehicle) {
    return fail(`Se cruza con el turno de ${sameVehicle.operatorName} en ${otherLabel(sameVehicle)} (${when(sameVehicle)}). Corrige el horario o edita ese turno.`)
  }
  const sameOperator = neighbours.find((other) => other.operatorWorkerId === operator.id && overlaps(other))
  if (sameOperator) {
    return fail(`${operatorName} ya tiene un turno en ${otherLabel(sameOperator)} (${when(sameOperator)}).`)
  }

  const values = {
    vehicleId: input.vehicleId,
    shiftDate: input.shiftDate,
    startHour: input.startHour,
    endHour: input.endHour,
    operatorWorkerId: operator.id,
    operatorNameSnapshot: operatorName,
    notes,
  }
  const label = vehicleLabel(vehicle)
  if (mode.kind === "create") {
    const shiftId = nanoid()
    await tx.insert(fleetOperationShifts).values({ id: shiftId, ...values, createdBy: actor.userId, updatedBy: actor.userId })
    await recordAudit({
      ...auditActor(actor),
      action: "create",
      entityType: "fleet_operation_shift",
      entityId: shiftId,
      entityCode: label,
      newState: { ...values, operatorName },
      worksiteId: vehicle.worksiteOnDay,
    }, tx)
    return { ok: true, shiftId }
  }
  await tx.update(fleetOperationShifts)
    .set({ ...values, updatedBy: actor.userId, updatedAt: sql`now()` as unknown as string })
    .where(eq(fleetOperationShifts.id, mode.shiftId))
  await recordAudit({
    ...auditActor(actor),
    action: "update",
    entityType: "fleet_operation_shift",
    entityId: mode.shiftId,
    entityCode: label,
    oldState: before ? shiftSnapshot(before) : undefined,
    newState: { ...values, operatorName },
    worksiteId: vehicle.worksiteOnDay,
  }, tx)
  return { ok: true, shiftId: mode.shiftId }
}

export function createShift(actor: ShiftActor, input: ShiftInput): Promise<ShiftResult> {
  return db.transaction((tx) => saveShift(tx, actor, { kind: "create" }, input))
}

export function updateShift(actor: ShiftActor, shiftId: string, input: ShiftInput): Promise<ShiftResult> {
  return db.transaction((tx) => saveShift(tx, actor, { kind: "update", shiftId }, input))
}

export function voidShift(actor: ShiftActor, shiftId: string, reason: string): Promise<SimpleResult> {
  const text = reason.trim()
  if (text.length < MIN_VOID_REASON_LENGTH) {
    return Promise.resolve(fail(`Escribe el motivo de la anulación (al menos ${MIN_VOID_REASON_LENGTH} caracteres).`))
  }
  return db.transaction(async (tx): Promise<SimpleResult> => {
    const shift = await lockedShift(tx, shiftId)
    if (!shift) return fail(SHIFT_NOT_FOUND_MESSAGE)
    if (shift.voidedAt) return fail(ALREADY_VOIDED_MESSAGE)
    const vehicle = await lockVehicle(tx, shift.vehicleId, shift.shiftDate)
    if (!vehicle || !inScope(actor.scope, vehicle.worksiteOnDay)) return fail(NO_ACCESS_MESSAGE)
    await tx.update(fleetOperationShifts)
      .set({
        voidedAt: sql`now()` as unknown as string,
        voidedBy: actor.userId,
        voidReason: text,
        updatedBy: actor.userId,
        updatedAt: sql`now()` as unknown as string,
      })
      .where(eq(fleetOperationShifts.id, shiftId))
    await recordAudit({
      ...auditActor(actor),
      action: "cancel",
      entityType: "fleet_operation_shift",
      entityId: shiftId,
      entityCode: vehicleLabel(vehicle),
      oldState: shiftSnapshot(shift),
      newState: { voided: true },
      reason: text,
      worksiteId: vehicle.worksiteOnDay,
    }, tx)
    return { ok: true }
  })
}

export function setDayMark(
  actor: ShiftActor,
  input: { vehicleId: string; day: string; reason: DayMarkReason; notes: string },
): Promise<SimpleResult> {
  const notes = input.notes.trim()
  if (input.reason !== "sin_operacion_programada" && input.reason !== "otro") {
    return Promise.resolve(fail("El motivo de la marca no es válido."))
  }
  const badDate = dateError(input.day)
  if (badDate) return Promise.resolve(fail(badDate))
  if (notes.length > MAX_NOTES_LENGTH) {
    return Promise.resolve(fail(`Las observaciones no pueden pasar de ${MAX_NOTES_LENGTH} caracteres.`))
  }
  return db.transaction(async (tx): Promise<SimpleResult> => {
    const vehicle = await lockVehicle(tx, input.vehicleId, input.day)
    if (!vehicle) return fail(VEHICLE_NOT_FOUND_MESSAGE)
    if (!inScope(actor.scope, vehicle.worksiteOnDay)) return fail(NO_ACCESS_MESSAGE)
    const [existing] = await tx.select().from(fleetOperationDayMarks)
      .where(and(eq(fleetOperationDayMarks.vehicleId, input.vehicleId), eq(fleetOperationDayMarks.day, input.day)))
    const markId = existing?.id ?? nanoid()
    await tx.insert(fleetOperationDayMarks)
      .values({ id: markId, vehicleId: input.vehicleId, day: input.day, reason: input.reason, notes, createdBy: actor.userId })
      .onConflictDoUpdate({
        target: [fleetOperationDayMarks.vehicleId, fleetOperationDayMarks.day],
        set: { reason: input.reason, notes, updatedAt: sql`now()` as unknown as string },
      })
    await recordAudit({
      ...auditActor(actor),
      action: existing ? "update" : "create",
      entityType: "fleet_operation_day_mark",
      entityId: markId,
      entityCode: `${vehicleLabel(vehicle)} ${input.day}`,
      oldState: existing ? { reason: existing.reason, notes: existing.notes } : undefined,
      newState: { vehicleId: input.vehicleId, day: input.day, reason: input.reason, notes },
      worksiteId: vehicle.worksiteOnDay,
    }, tx)
    return { ok: true }
  })
}

export function clearDayMark(actor: ShiftActor, input: { vehicleId: string; day: string }): Promise<SimpleResult> {
  if (!isPlainDate(input.day)) return Promise.resolve(fail("La fecha no es válida."))
  return db.transaction(async (tx): Promise<SimpleResult> => {
    const vehicle = await lockVehicle(tx, input.vehicleId, input.day)
    if (!vehicle) return fail(VEHICLE_NOT_FOUND_MESSAGE)
    if (!inScope(actor.scope, vehicle.worksiteOnDay)) return fail(NO_ACCESS_MESSAGE)
    const [existing] = await tx.select().from(fleetOperationDayMarks)
      .where(and(eq(fleetOperationDayMarks.vehicleId, input.vehicleId), eq(fleetOperationDayMarks.day, input.day)))
    if (!existing) return fail("Ese día no tiene marca.")
    await tx.delete(fleetOperationDayMarks).where(eq(fleetOperationDayMarks.id, existing.id))
    await recordAudit({
      ...auditActor(actor),
      action: "delete",
      entityType: "fleet_operation_day_mark",
      entityId: existing.id,
      entityCode: `${vehicleLabel(vehicle)} ${input.day}`,
      oldState: { reason: existing.reason, notes: existing.notes },
      worksiteId: vehicle.worksiteOnDay,
    }, tx)
    return { ok: true }
  })
}

/** Meta de ralentí como fracción (0,30 = 30 %). Sin clave o con un valor ajeno, la de fábrica. */
export async function getIdleTarget(): Promise<number> {
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings)
    .where(eq(systemSettings.key, IDLE_TARGET_SETTING_KEY))
  const parsed = row ? Number(row.value) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : IDLE_TARGET_DEFAULT
}

/** Fija la meta con un entero de 1 a 99 (porcentaje); se guarda como fracción en texto. */
export async function setIdleTarget(actor: ShiftActor, pct: number): Promise<SimpleResult> {
  if (!Number.isInteger(pct) || pct < 1 || pct > 99) return fail("La meta debe ser un porcentaje entero entre 1 y 99.")
  const value = String(pct / 100)
  await db.transaction(async (tx) => {
    const [before] = await tx.select({ value: systemSettings.value }).from(systemSettings)
      .where(eq(systemSettings.key, IDLE_TARGET_SETTING_KEY))
    await tx.insert(systemSettings).values({ key: IDLE_TARGET_SETTING_KEY, value })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: sql`now()` as unknown as string } })
    await recordAudit({
      ...auditActor(actor),
      action: "update",
      entityType: "system_setting",
      entityId: IDLE_TARGET_SETTING_KEY,
      entityCode: IDLE_TARGET_SETTING_KEY,
      oldState: before ? { value: before.value } : undefined,
      newState: { value },
    }, tx)
  })
  return { ok: true }
}
