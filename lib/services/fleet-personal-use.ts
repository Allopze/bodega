import { asc, desc, eq, inArray } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import { fuelVehiclePersonalUsePeriods as periods, fuelVehicles } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import {
  indexPersonalUse,
  validatePersonalUsePeriod,
  type PersonalUseIndex,
  type PersonalUsePeriod,
} from "@/lib/fleet/personal-use"
import { nanoid } from "@/lib/id"
import { todayInChile } from "@/lib/utils"

/**
 * Períodos de uso personal de un equipo: listar, cargar por lote y escribir con
 * auditoría. Este servicio NO revisa permisos: las acciones piden
 * `flota:personal_use` y `canAccessWorksite` sobre la faena del equipo.
 *
 * Cada escritura bloquea la fila del equipo (`FOR UPDATE`) antes de validar
 * contra sus demás períodos, así dos marcas simultáneas no pasan las dos; el
 * trigger `PERSONAL_USE_OVERLAP` de la base es la última barrera.
 */

export type Actor = { userId: string; email: string | null }
export type PersonalUseResult = { ok: true; id: string } | { ok: false; message: string }
export type PersonalUseInput = { startedOn: string; endedOn: string | null; note: string | null }

const ENTITY_TYPE = "fuel_vehicle_personal_use"
const OVERLAP_MESSAGE = "Se cruza con otro uso personal de este equipo. Recarga la ficha y revisa los períodos."

const columns = {
  id: periods.id,
  vehicleId: periods.vehicleId,
  startedOn: periods.startedOn,
  endedOn: periods.endedOn,
  note: periods.note,
}

function cleanNote(note: string | null): string | null {
  const trimmed = note?.trim() ?? ""
  return trimmed === "" ? null : trimmed
}

function isOverlapError(error: unknown): boolean {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    if (String((e as { message?: unknown }).message ?? "").includes("PERSONAL_USE_OVERLAP")) return true
  }
  return false
}

function stateOf(period: PersonalUsePeriod) {
  return { vehicleId: period.vehicleId, startedOn: period.startedOn, endedOn: period.endedOn, note: period.note }
}

export async function listPersonalUsePeriods(vehicleId: string, client: DB = db): Promise<PersonalUsePeriod[]> {
  return client.select(columns).from(periods)
    .where(eq(periods.vehicleId, vehicleId))
    .orderBy(desc(periods.startedOn))
}

/** Períodos de varios equipos, para cruzar en memoria un lote (p. ej. Control operacional). */
export async function loadPersonalUseIndex(vehicleIds: readonly string[], client: DB = db): Promise<PersonalUseIndex> {
  if (vehicleIds.length === 0) return indexPersonalUse([])
  const rows = await client.select(columns).from(periods)
    .where(inArray(periods.vehicleId, [...new Set(vehicleIds)]))
    .orderBy(asc(periods.startedOn))
  return indexPersonalUse(rows)
}

/** Bloquea el equipo y trae sus períodos; `null` si el equipo no existe. */
async function lockVehicleTx(tx: Tx, vehicleId: string) {
  const [vehicle] = await tx.select({ id: fuelVehicles.id, code: fuelVehicles.code, worksiteId: fuelVehicles.worksiteId })
    .from(fuelVehicles).where(eq(fuelVehicles.id, vehicleId)).limit(1).for("update")
  if (!vehicle) return null
  const list = await tx.select(columns).from(periods).where(eq(periods.vehicleId, vehicleId))
  return { vehicle, periods: list }
}

async function write(run: () => Promise<PersonalUseResult>): Promise<PersonalUseResult> {
  try {
    return await run()
  } catch (error) {
    if (isOverlapError(error)) return { ok: false, message: OVERLAP_MESSAGE }
    throw error
  }
}

export async function createPersonalUsePeriod(
  actor: Actor,
  input: { vehicleId: string } & PersonalUseInput,
  client: DB = db,
): Promise<PersonalUseResult> {
  return write(() => client.transaction(async (tx): Promise<PersonalUseResult> => {
    const locked = await lockVehicleTx(tx, input.vehicleId)
    if (!locked) return { ok: false, message: "El equipo ya no existe." }
    const problem = validatePersonalUsePeriod(input, locked.periods, todayInChile())
    if (problem) return { ok: false, message: problem }

    const period: PersonalUsePeriod = {
      id: nanoid(), vehicleId: input.vehicleId, startedOn: input.startedOn, endedOn: input.endedOn, note: cleanNote(input.note),
    }
    await tx.insert(periods).values({ ...period, createdByUserId: actor.userId })
    await recordAudit({
      userId: actor.userId, userEmail: actor.email ?? undefined, action: "create",
      entityType: ENTITY_TYPE, entityId: period.id, entityCode: locked.vehicle.code ?? undefined,
      worksiteId: locked.vehicle.worksiteId ?? undefined, newState: stateOf(period),
    }, tx)
    return { ok: true, id: period.id }
  }))
}

export async function updatePersonalUsePeriod(
  actor: Actor,
  id: string,
  input: PersonalUseInput,
  client: DB = db,
): Promise<PersonalUseResult> {
  return write(() => client.transaction(async (tx): Promise<PersonalUseResult> => {
    const [current] = await tx.select(columns).from(periods).where(eq(periods.id, id)).limit(1)
    if (!current) return { ok: false, message: "El período ya no existe: recarga la ficha." }
    const locked = await lockVehicleTx(tx, current.vehicleId)
    if (!locked) return { ok: false, message: "El equipo ya no existe." }
    const others = locked.periods.filter((p) => p.id !== id)
    const problem = validatePersonalUsePeriod(input, others, todayInChile())
    if (problem) return { ok: false, message: problem }

    const next: PersonalUsePeriod = { ...current, startedOn: input.startedOn, endedOn: input.endedOn, note: cleanNote(input.note) }
    await tx.update(periods)
      .set({ startedOn: next.startedOn, endedOn: next.endedOn, note: next.note, updatedAt: new Date().toISOString() })
      .where(eq(periods.id, id))
    await recordAudit({
      userId: actor.userId, userEmail: actor.email ?? undefined, action: "update",
      entityType: ENTITY_TYPE, entityId: id, entityCode: locked.vehicle.code ?? undefined,
      worksiteId: locked.vehicle.worksiteId ?? undefined, oldState: stateOf(current), newState: stateOf(next),
    }, tx)
    return { ok: true, id }
  }))
}

export async function deletePersonalUsePeriod(actor: Actor, id: string, client: DB = db): Promise<PersonalUseResult> {
  return client.transaction(async (tx): Promise<PersonalUseResult> => {
    const [current] = await tx.select(columns).from(periods).where(eq(periods.id, id)).limit(1).for("update")
    if (!current) return { ok: false, message: "El período ya no existe: recarga la ficha." }
    const [vehicle] = await tx.select({ code: fuelVehicles.code, worksiteId: fuelVehicles.worksiteId })
      .from(fuelVehicles).where(eq(fuelVehicles.id, current.vehicleId)).limit(1)
    await tx.delete(periods).where(eq(periods.id, id))
    await recordAudit({
      userId: actor.userId, userEmail: actor.email ?? undefined, action: "delete",
      entityType: ENTITY_TYPE, entityId: id, entityCode: vehicle?.code ?? undefined,
      worksiteId: vehicle?.worksiteId ?? undefined, oldState: stateOf(current),
    }, tx)
    return { ok: true, id }
  })
}

/** Equipo de un período, para que la acción revise el alcance de faena antes de escribir. */
export async function getPersonalUsePeriodVehicleId(id: string, client: DB = db): Promise<string | null> {
  const [row] = await client.select({ vehicleId: periods.vehicleId }).from(periods).where(eq(periods.id, id)).limit(1)
  return row?.vehicleId ?? null
}
