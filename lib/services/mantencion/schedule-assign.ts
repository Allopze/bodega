import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  fuelEquipmentTypes, fuelVehicles, mantBrands, mantEquipmentProfiles, mantSchedules, worksites,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import type { MantUnit } from "@/lib/mantencion/types"
import { scheduleChangeSummary } from "./equipment"
import { writeEquipmentHistory, type MantActor } from "./equipment-history"

/**
 * Asignación de equipos a una pauta (§10). Sólo participan equipos ACTIVOS que
 * se miden en la unidad de la pauta: los marcados quedan con ella (los que
 * tenían otra, la cambian) y los desmarcados que la tenían quedan sin pauta. La
 * asignación no cambia la pauta, así que no publica una versión (el catálogo de
 * la app cambia por el equipo, no por la pauta). Escribe `schedule_change` en
 * el historial de cada equipo y una fila de auditoría.
 */

export interface AssignCandidate {
  vehicleId: string
  code: string
  plate: string
  typeName: string
  brandName: string
  worksiteId: string
  worksiteName: string
  scheduleId: string | null
  scheduleName: string | null
}

const METER_OF_UNIT: Record<MantUnit, string> = { km: "odometer", h: "hour_meter" }

async function candidatesFor(client: Pick<Tx, "select">, unit: MantUnit): Promise<AssignCandidate[]> {
  const rows = await client
    .select({
      vehicleId: fuelVehicles.id,
      code: fuelVehicles.code,
      plate: fuelVehicles.plate,
      typeName: fuelEquipmentTypes.name,
      brandName: mantBrands.name,
      worksiteId: worksites.id,
      worksiteName: worksites.name,
      scheduleId: mantSchedules.id,
      scheduleName: mantSchedules.name,
    })
    .from(mantEquipmentProfiles)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, mantEquipmentProfiles.vehicleId))
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .innerJoin(mantBrands, eq(mantBrands.id, mantEquipmentProfiles.brandId))
    .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .leftJoin(mantSchedules, and(eq(mantSchedules.id, mantEquipmentProfiles.scheduleId), isNull(mantSchedules.deletedAt)))
    .where(and(eq(fuelVehicles.isActive, true), eq(fuelEquipmentTypes.defaultMeterType, METER_OF_UNIT[unit])))
    .orderBy(asc(worksites.name), asc(fuelVehicles.code))
  return rows.map((row) => ({ ...row, code: row.code ?? row.plate }))
}

/** Equipos que pueden recibir la pauta (activos y de su unidad), con la pauta que tienen hoy. */
export async function listAssignCandidates(scheduleId: string): Promise<{ schedule: { id: string; name: string; unit: MantUnit }; candidates: AssignCandidate[] } | null> {
  const [schedule] = await db.select().from(mantSchedules)
    .where(and(eq(mantSchedules.id, scheduleId), isNull(mantSchedules.deletedAt))).limit(1)
  if (!schedule) return null
  const unit = schedule.unit as MantUnit
  return { schedule: { id: schedule.id, name: schedule.name, unit }, candidates: await candidatesFor(db, unit) }
}

export interface AssignSummary { added: number; moved: number; removed: number }

/**
 * Deja `vehicleIds` como el conjunto final de equipos con la pauta (entre los
 * que pueden recibirla). El servidor recalcula los cambios sobre el estado
 * actual: no confía en el resumen que vio la pantalla.
 */
export async function assignEquipment(
  actor: MantActor,
  input: { scheduleId: string; vehicleIds: string[] },
): Promise<{ ok: true; message: string; data: AssignSummary } | { ok: false; message: string }> {
  return db.transaction(async (tx) => {
    const [schedule] = await tx.select().from(mantSchedules)
      .where(and(eq(mantSchedules.id, input.scheduleId), isNull(mantSchedules.deletedAt))).for("update").limit(1)
    if (!schedule) return { ok: false as const, message: "Esa pauta ya no existe." }
    const candidates = await candidatesFor(tx, schedule.unit as MantUnit)
    const selected = new Set(input.vehicleIds)
    const assign: AssignCandidate[] = []
    const release: AssignCandidate[] = []
    for (const candidate of candidates) {
      const wanted = selected.has(candidate.vehicleId)
      if (wanted && candidate.scheduleId !== schedule.id) assign.push(candidate)
      else if (!wanted && candidate.scheduleId === schedule.id) release.push(candidate)
    }
    const now = new Date().toISOString()
    if (assign.length) {
      await tx.update(mantEquipmentProfiles)
        .set({ scheduleId: schedule.id, updatedAt: now, updatedBy: actor.userId })
        .where(inArray(mantEquipmentProfiles.vehicleId, assign.map((item) => item.vehicleId)))
    }
    if (release.length) {
      await tx.update(mantEquipmentProfiles)
        .set({ scheduleId: null, updatedAt: now, updatedBy: actor.userId })
        .where(inArray(mantEquipmentProfiles.vehicleId, release.map((item) => item.vehicleId)))
    }
    for (const item of assign) {
      await writeEquipmentHistory(tx, {
        vehicleId: item.vehicleId, action: "schedule_change", userId: actor.userId,
        summary: scheduleChangeSummary(item.scheduleName, schedule.name),
        changes: { Pauta: { from: item.scheduleName, to: schedule.name } },
      })
    }
    for (const item of release) {
      await writeEquipmentHistory(tx, {
        vehicleId: item.vehicleId, action: "schedule_change", userId: actor.userId,
        summary: scheduleChangeSummary(schedule.name, null),
        changes: { Pauta: { from: schedule.name, to: null } },
      })
    }
    const summary: AssignSummary = {
      added: assign.filter((item) => !item.scheduleId).length,
      moved: assign.filter((item) => item.scheduleId).length,
      removed: release.length,
    }
    if (assign.length || release.length) {
      await recordAudit({
        userId: actor.userId, userEmail: actor.email ?? undefined, action: "update",
        entityType: "mant_schedule_assignment", entityId: schedule.id, entityCode: schedule.name,
        newState: {
          ...summary,
          assigned: assign.map((item) => item.code),
          released: release.map((item) => item.code),
        },
      }, tx)
    }
    const parts = [
      summary.added ? `${summary.added} ${summary.added === 1 ? "equipo asignado" : "equipos asignados"}` : "",
      summary.moved ? `${summary.moved} ${summary.moved === 1 ? "equipo cambió de pauta" : "equipos cambiaron de pauta"}` : "",
      summary.removed ? `${summary.removed} ${summary.removed === 1 ? "equipo quedó sin pauta" : "equipos quedaron sin pauta"}` : "",
    ].filter(Boolean)
    return { ok: true as const, data: summary, message: parts.length ? parts.join(" · ") : "Sin cambios en la asignación." }
  })
}
