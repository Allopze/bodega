import { eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  fuelEquipmentTypes, fuelVehicleOperationalIntervals, fuelVehicles, mantEquipmentProfiles, worksites,
} from "@/db/schema"
import { isUniqueViolation } from "@/lib/action-error"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { isValidReason, reasonRequiredMessage } from "@/lib/validation/reason-thresholds"
import {
  diffEquipmentFields, summarizeChanges, writeEquipmentHistory, type EquipmentFields, type MantActor,
} from "./equipment-history"
import {
  equipmentFailure, loadEquipmentCurrent, resolveEquipment,
  type EquipmentCurrent, type EquipmentInput, type EquipmentResult, type FieldErrors, type ResolvedEquipment, type VehicleIdentity,
} from "./equipment-resolve"
import { resolveOrCreateWorksite } from "./worksites"

export { NEW_WORKSITE, countEquipmentRecords } from "./equipment-resolve"
export type { EquipmentCurrent, EquipmentInput, EquipmentResult, FieldErrors, ResolvedEquipment } from "./equipment-resolve"

/**
 * Escritura de equipos (§10): alta (o incorporación de un vehículo que ya
 * estaba en la flota), edición, baja y reactivación, con historial y auditoría
 * en la MISMA transacción. Es la ÚNICA puerta de escritura; la validación vive
 * en `equipment-resolve.ts`. El permiso `mant:equipment:manage` lo exige la
 * acción que llama.
 */

function uniqueFailure(error: unknown): { ok: false; message: string; fieldErrors: FieldErrors } | null {
  if (!isUniqueViolation(error)) return null
  return equipmentFailure({ plate: "Esa patente ya está en otro equipo." })
}

function auditState(fields: EquipmentFields) {
  return { ...fields } as Record<string, unknown>
}

/**
 * Escribe un alta: inserta el vehículo (o incorpora el que ya estaba en la
 * flota) y su perfil. Lo comparten el formulario y la importación.
 */
export async function applyCreate(
  tx: Tx,
  actor: MantActor,
  resolved: ResolvedEquipment,
  incorporate: VehicleIdentity | null,
  origin: "create" | "import",
): Promise<{ vehicleId: string; incorporated: boolean }> {
  if (!resolved.worksite.id) throw new Error("La faena del equipo no se resolvió.")
  const now = new Date().toISOString()
  const vehicleId = incorporate?.id ?? nanoid()
  const sharedValues = {
    code: resolved.code,
    plate: resolved.plate,
    type: resolved.type.slug,
    equipmentTypeId: resolved.type.id,
    brand: resolved.brand.name,
    model: resolved.model,
    year: resolved.year,
    worksiteId: resolved.worksite.id,
  }
  let before: EquipmentFields | null = null
  if (incorporate) {
    const [row] = await tx
      .select({
        code: fuelVehicles.code, plate: fuelVehicles.plate, brand: fuelVehicles.brand, model: fuelVehicles.model,
        year: fuelVehicles.year, typeName: fuelEquipmentTypes.name, worksiteName: worksites.name,
      })
      .from(fuelVehicles)
      .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
      .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
      .where(eq(fuelVehicles.id, vehicleId))
      .limit(1)
    if (row) {
      before = {
        code: row.code ?? "", plate: row.plate, noPlate: false, type: row.typeName, brand: row.brand ?? "",
        model: row.model, year: row.year, worksite: row.worksiteName, schedule: null, initialReading: null, initialReadingDate: null,
      }
    }
    await tx.update(fuelVehicles).set({ ...sharedValues, updatedAt: now }).where(eq(fuelVehicles.id, vehicleId))
  } else {
    // `meterType` y `performanceUnit` sólo se siembran en el alta: son editables por vehículo.
    await tx.insert(fuelVehicles).values({
      id: vehicleId, ...sharedValues, meterType: resolved.type.meterType, performanceUnit: resolved.type.performanceUnit, isActive: true,
    })
    await tx.insert(fuelVehicleOperationalIntervals).values({
      id: nanoid(), vehicleId, status: "operativo", startedAt: now, reason: "Alta en Mantención de equipos", changedBy: actor.userId,
    })
  }
  await tx.insert(mantEquipmentProfiles).values({
    vehicleId,
    brandId: resolved.brand.id,
    scheduleId: resolved.schedule?.id ?? null,
    initialReading: resolved.initialReading,
    initialReadingDate: resolved.initialReadingDate,
    noPlate: resolved.noPlate,
    updatedBy: actor.userId,
  })
  const changes = before ? diffEquipmentFields(before, resolved.fields) : {}
  const summary = origin === "import"
    ? (incorporate ? "Incorporado a la mantención desde la planilla de importación" : "Creado desde la planilla de importación")
    : incorporate ? "Equipo incorporado a la mantención desde la flota" : "Equipo creado"
  await writeEquipmentHistory(tx, {
    vehicleId,
    action: origin === "import" ? "import" : "create",
    summary: incorporate && Object.keys(changes).length ? `${summary} · ${summarizeChanges(changes)}` : summary,
    changes,
    userId: actor.userId,
  })
  await recordAudit({
    userId: actor.userId,
    userEmail: actor.email ?? undefined,
    action: "create",
    entityType: "mant_equipment",
    entityId: vehicleId,
    entityCode: resolved.code,
    newState: { ...auditState(resolved.fields), incorporated: !!incorporate, origin },
    worksiteId: resolved.worksite.id,
  }, tx)
  return { vehicleId, incorporated: !!incorporate }
}

/** Alta de un equipo (o incorporación de un vehículo que ya estaba en la flota). */
export async function createEquipment(
  actor: MantActor,
  input: EquipmentInput,
): Promise<EquipmentResult<{ vehicleId: string; incorporated: boolean }>> {
  try {
    return await db.transaction(async (tx) => {
      const resolved = await resolveEquipment(tx, input, {
        current: null,
        createWorksite: (name) => resolveOrCreateWorksite(tx, { typedName: name, actor: { userId: actor.userId, email: actor.email } }),
      })
      if (!resolved.ok) return equipmentFailure(resolved.fieldErrors)
      const data = await applyCreate(tx, actor, resolved.value, resolved.incorporate, "create")
      return { ok: true as const, data, message: data.incorporated ? "El vehículo ya estaba en la flota: se incorporó a la mantención." : "Equipo creado." }
    })
  } catch (error) {
    const mapped = uniqueFailure(error)
    if (mapped) return mapped
    throw error
  }
}

export interface EquipmentStatusInput {
  active: boolean
  /** Motivo de la baja; obligatorio al desactivar. */
  retiredReason: string
}

function historyActionFor(changes: Record<string, unknown>): "update" | "schedule_change" | "initial_reading" {
  const keys = Object.keys(changes)
  if (keys.length === 1 && keys[0] === "Pauta") return "schedule_change"
  if (keys.length > 0 && keys.every((key) => key === "Lectura inicial" || key === "Fecha de la lectura inicial")) return "initial_reading"
  return "update"
}

/** Resumen del historial de una asignación de pauta (la comparten edición y asignación masiva). */
export function scheduleChangeSummary(before: string | null, after: string | null): string {
  if (after && before) return `Pauta asignada: «${after}» (antes «${before}»)`
  if (after) return `Pauta asignada: «${after}»`
  return `Pauta quitada: «${before ?? ""}»`
}

/** Aplica los cambios de ficha de un equipo existente; devuelve si hubo alguno. */
export async function applyUpdate(
  tx: Tx,
  actor: MantActor,
  current: EquipmentCurrent,
  resolved: ResolvedEquipment,
  origin: "update" | "import",
): Promise<boolean> {
  const changes = diffEquipmentFields(current.fields, resolved.fields)
  if (Object.keys(changes).length === 0) return false
  if (!resolved.worksite.id) throw new Error("La faena del equipo no se resolvió.")
  const now = new Date().toISOString()
  const unitChanged = resolved.type.unit !== current.unit
  await tx.update(fuelVehicles).set({
    code: resolved.code,
    plate: resolved.plate,
    type: resolved.type.slug,
    equipmentTypeId: resolved.type.id,
    brand: resolved.brand.name,
    model: resolved.model,
    year: resolved.year,
    worksiteId: resolved.worksite.id,
    // Cambiar a un tipo de otra unidad (sólo posible sin registros) lleva sus defaults de medidor.
    ...(unitChanged ? { meterType: resolved.type.meterType, performanceUnit: resolved.type.performanceUnit } : {}),
    updatedAt: now,
  }).where(eq(fuelVehicles.id, current.vehicleId))
  await tx.update(mantEquipmentProfiles).set({
    brandId: resolved.brand.id,
    scheduleId: resolved.schedule?.id ?? null,
    initialReading: resolved.initialReading,
    initialReadingDate: resolved.initialReadingDate,
    noPlate: resolved.noPlate,
    updatedAt: now,
    updatedBy: actor.userId,
  }).where(eq(mantEquipmentProfiles.vehicleId, current.vehicleId))
  const action = origin === "import" ? "import" : historyActionFor(changes)
  await writeEquipmentHistory(tx, {
    vehicleId: current.vehicleId,
    action,
    summary: action === "schedule_change"
      ? scheduleChangeSummary(current.fields.schedule, resolved.fields.schedule)
      : `${origin === "import" ? "Actualizado por importación" : "Editado"} · ${summarizeChanges(changes)}`,
    changes,
    userId: actor.userId,
  })
  await recordAudit({
    userId: actor.userId,
    userEmail: actor.email ?? undefined,
    action: "update",
    entityType: "mant_equipment",
    entityId: current.vehicleId,
    entityCode: resolved.code,
    oldState: auditState(current.fields),
    newState: auditState(resolved.fields),
    worksiteId: resolved.worksite.id,
  }, tx)
  return true
}

async function applyRetire(tx: Tx, actor: MantActor, vehicleId: string, code: string, reason: string) {
  const now = new Date().toISOString()
  await tx.update(fuelVehicles).set({ isActive: false, updatedAt: now }).where(eq(fuelVehicles.id, vehicleId))
  await tx.update(mantEquipmentProfiles).set({ retiredReason: reason, updatedAt: now, updatedBy: actor.userId })
    .where(eq(mantEquipmentProfiles.vehicleId, vehicleId))
  await writeEquipmentHistory(tx, { vehicleId, action: "retire", summary: `Dado de baja: ${reason}`, changes: { Estado: { from: "Activo", to: "Dado de baja" } }, userId: actor.userId })
  await recordAudit({
    userId: actor.userId, userEmail: actor.email ?? undefined, action: "status_change",
    entityType: "mant_equipment", entityId: vehicleId, entityCode: code,
    oldState: { active: true }, newState: { active: false }, reason,
  }, tx)
}

async function applyReactivate(tx: Tx, actor: MantActor, vehicleId: string, code: string) {
  const now = new Date().toISOString()
  await tx.update(fuelVehicles).set({ isActive: true, updatedAt: now }).where(eq(fuelVehicles.id, vehicleId))
  await tx.update(mantEquipmentProfiles).set({ retiredReason: null, updatedAt: now, updatedBy: actor.userId })
    .where(eq(mantEquipmentProfiles.vehicleId, vehicleId))
  await writeEquipmentHistory(tx, { vehicleId, action: "reactivate", summary: "Reactivado", changes: { Estado: { from: "Dado de baja", to: "Activo" } }, userId: actor.userId })
  await recordAudit({
    userId: actor.userId, userEmail: actor.email ?? undefined, action: "status_change",
    entityType: "mant_equipment", entityId: vehicleId, entityCode: code,
    oldState: { active: false }, newState: { active: true },
  }, tx)
}

/**
 * Edita la ficha y, si cambia, el estado (activo / dado de baja) en una sola
 * transacción: un error en cualquier parte no deja la ficha a medias.
 */
export async function updateEquipment(
  actor: MantActor,
  vehicleId: string,
  input: EquipmentInput,
  status: EquipmentStatusInput,
): Promise<EquipmentResult<{ changed: boolean }>> {
  try {
    return await db.transaction(async (tx) => {
      const current = await loadEquipmentCurrent(tx, vehicleId)
      if (!current) return equipmentFailure({}, "Ese equipo no existe en la mantención.")
      if (!status.active && current.active && !isValidReason(status.retiredReason)) {
        return equipmentFailure({ retiredReason: reasonRequiredMessage("el motivo de la baja") })
      }
      const resolved = await resolveEquipment(tx, input, {
        current,
        createWorksite: (name) => resolveOrCreateWorksite(tx, { typedName: name, actor: { userId: actor.userId, email: actor.email } }),
      })
      if (!resolved.ok) return equipmentFailure(resolved.fieldErrors)
      const edited = await applyUpdate(tx, actor, current, resolved.value, "update")
      let statusChanged = false
      if (!status.active && current.active) {
        await applyRetire(tx, actor, vehicleId, resolved.value.code, status.retiredReason.trim())
        statusChanged = true
      } else if (status.active && !current.active) {
        await applyReactivate(tx, actor, vehicleId, resolved.value.code)
        statusChanged = true
      }
      const changed = edited || statusChanged
      return { ok: true as const, data: { changed }, message: changed ? `Cambios guardados en ${resolved.value.code}.` : "No había cambios que guardar." }
    })
  } catch (error) {
    const mapped = uniqueFailure(error)
    if (mapped) return mapped
    throw error
  }
}

/** Da de baja un equipo con su motivo (sus registros se conservan). */
export async function retireEquipment(actor: MantActor, vehicleId: string, reason: string): Promise<EquipmentResult<undefined>> {
  if (!isValidReason(reason)) return equipmentFailure({ retiredReason: reasonRequiredMessage("el motivo de la baja") })
  return db.transaction(async (tx) => {
    const current = await loadEquipmentCurrent(tx, vehicleId)
    if (!current) return equipmentFailure({}, "Ese equipo no existe en la mantención.")
    if (!current.active) return equipmentFailure({}, "El equipo ya estaba dado de baja.")
    await applyRetire(tx, actor, vehicleId, current.fields.code, reason.trim())
    return { ok: true as const, data: undefined, message: `${current.fields.code} quedó dado de baja.` }
  })
}

/** Vuelve a activar un equipo dado de baja. */
export async function reactivateEquipment(actor: MantActor, vehicleId: string): Promise<EquipmentResult<undefined>> {
  return db.transaction(async (tx) => {
    const current = await loadEquipmentCurrent(tx, vehicleId)
    if (!current) return equipmentFailure({}, "Ese equipo no existe en la mantención.")
    if (current.active) return equipmentFailure({}, "El equipo ya estaba activo.")
    await applyReactivate(tx, actor, vehicleId, current.fields.code)
    return { ok: true as const, data: undefined, message: `${current.fields.code} volvió a estar activo.` }
  })
}
