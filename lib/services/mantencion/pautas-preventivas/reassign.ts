import { and, eq, inArray, isNull } from "drizzle-orm"
import type { DB } from "@/db"
import { fuelEquipmentTypes, fuelVehicles, mantEquipmentProfiles, mantSchedules, users } from "@/db/schema"
import { assignEquipment } from "../schedule-assign"
import { deleteSchedule } from "../schedules"
import { effectiveMeterSql } from "../unit-sql"
import { PREVENTIVE_PAUTAS } from "./seed"

/**
 * Reasignación de equipos a las pautas preventivas de los formularios (decisión del usuario,
 * 2026-11-27) y retiro de las pautas viejas que queden vacías:
 *
 * - camión/tractocamión medido en km (los que cargan en Copec, en ruta) → camiones/tractos — km;
 * - camión/tractocamión medido en horas → camiones/tractos — horas;
 * - el resto medido en horas (maquinaria, cargadores, grúas horquilla) → maquinaria — horas;
 * - lo medido en km que no es camión (camionetas) no cambia: no hay formulario para ellas.
 *
 * Usa los servicios de la pantalla (`assignEquipment`, `deleteSchedule`), que escriben la
 * historia del equipo y la bitácora con el actor. Una pauta vieja sólo se retira si quedó sin
 * equipos; si no, se informa y se deja.
 */

export const OLD_PAUTAS = ["Pauta Mantención Camión (KM)", "Camiones y tractos", "Maquinaria pesada"] as const
const TRUCKS = "camiones"
const [MAQUINARIA_H, CAMIONES_KM, CAMIONES_H] = PREVENTIVE_PAUTAS.map((spec) => spec.name) as [string, string, string]

export interface PlannedEquipment { vehicleId: string; code: string; family: string | null; meter: string; from: string | null; hasBrand: boolean }
export interface ReassignPlan {
  targets: Array<{ schedule: string; scheduleId: string; equipment: PlannedEquipment[] }>
  untouched: PlannedEquipment[]
  /** Equipos sin marca: la pantalla de asignación no los ofrece, así que quedarían fuera. */
  withoutBrand: string[]
}

export function targetFor(row: Pick<PlannedEquipment, "family" | "meter">): string | null {
  if (row.family === TRUCKS) return row.meter === "odometer" ? CAMIONES_KM : row.meter === "hour_meter" ? CAMIONES_H : null
  return row.meter === "hour_meter" ? MAQUINARIA_H : null
}

export async function planReassignment(client: DB): Promise<ReassignPlan> {
  const schedules = await client.select({ id: mantSchedules.id, name: mantSchedules.name }).from(mantSchedules).where(isNull(mantSchedules.deletedAt))
  const idByName = new Map(schedules.map((row) => [row.name, row.id]))
  const nameById = new Map(schedules.map((row) => [row.id, row.name]))
  for (const name of [MAQUINARIA_H, CAMIONES_KM, CAMIONES_H]) {
    if (!idByName.has(name)) throw new Error(`Falta la pauta «${name}»: corre antes el seed de pautas preventivas.`)
  }
  const rows = await client
    .select({
      vehicleId: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, family: fuelEquipmentTypes.performanceFamily,
      meter: effectiveMeterSql, scheduleId: mantEquipmentProfiles.scheduleId, brandId: mantEquipmentProfiles.brandId,
    })
    .from(mantEquipmentProfiles)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantEquipmentProfiles.vehicleId))
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .where(eq(fuelVehicles.isActive, true))
  const plan: ReassignPlan = {
    targets: [MAQUINARIA_H, CAMIONES_KM, CAMIONES_H].map((schedule) => ({ schedule, scheduleId: idByName.get(schedule)!, equipment: [] })),
    untouched: [],
    withoutBrand: [],
  }
  for (const row of rows) {
    const item: PlannedEquipment = {
      vehicleId: row.vehicleId, code: row.code ?? row.plate, family: row.family, meter: row.meter,
      from: row.scheduleId ? nameById.get(row.scheduleId) ?? null : null, hasBrand: row.brandId !== null,
    }
    const target = targetFor(item)
    if (!target) { plan.untouched.push(item); continue }
    if (!item.hasBrand) plan.withoutBrand.push(item.code)
    plan.targets.find((entry) => entry.schedule === target)!.equipment.push(item)
  }
  for (const entry of plan.targets) entry.equipment.sort((a, b) => a.code.localeCompare(b.code))
  return plan
}

export interface ReassignResult {
  assigned: Array<{ schedule: string; message: string }>
  retired: string[]
  kept: Array<{ schedule: string; holders: number }>
}

/** Aplica el plan con el actor (usuario real de la plataforma, por correo). */
export async function applyReassignment(client: DB, actorEmail: string): Promise<ReassignResult> {
  const [actor] = await client.select({ id: users.id, email: users.email }).from(users).where(and(eq(users.email, actorEmail), eq(users.isActive, true)))
  if (!actor) throw new Error(`No hay un usuario activo con el correo ${actorEmail}.`)
  const plan = await planReassignment(client)
  if (plan.withoutBrand.length) throw new Error(`Equipos sin marca, la asignación los dejaría fuera: ${plan.withoutBrand.join(", ")}.`)
  const result: ReassignResult = { assigned: [], retired: [], kept: [] }
  for (const entry of plan.targets) {
    const outcome = await assignEquipment({ userId: actor.id, email: actor.email }, { scheduleId: entry.scheduleId, vehicleIds: entry.equipment.map((item) => item.vehicleId) })
    if (!outcome.ok) throw new Error(`«${entry.schedule}»: ${outcome.message}`)
    result.assigned.push({ schedule: entry.schedule, message: outcome.message })
  }
  const old = await client.select({ id: mantSchedules.id, name: mantSchedules.name }).from(mantSchedules)
    .where(and(inArray(mantSchedules.name, [...OLD_PAUTAS]), isNull(mantSchedules.deletedAt)))
  for (const schedule of old) {
    const holders = await client.select({ vehicleId: mantEquipmentProfiles.vehicleId }).from(mantEquipmentProfiles)
      .where(eq(mantEquipmentProfiles.scheduleId, schedule.id))
    if (holders.length) { result.kept.push({ schedule: schedule.name, holders: holders.length }); continue }
    const deleted = await deleteSchedule({ userId: actor.id, email: actor.email }, schedule.id)
    if (!deleted.ok) throw new Error(`«${schedule.name}»: ${deleted.message}`)
    result.retired.push(schedule.name)
  }
  return result
}
