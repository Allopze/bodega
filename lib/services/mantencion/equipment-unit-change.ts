import { eq } from "drizzle-orm"
import type { Tx } from "@/db"
import { mantEquipmentProfiles, type MantFieldChanges } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { unitName } from "@/lib/mantencion/format"
import type { MantUnit } from "@/lib/mantencion/types"
import { todayInChile } from "@/lib/utils"
import { isValidReason, reasonRequiredMessage } from "@/lib/validation/reason-thresholds"
import { EQUIPMENT_OUT_OF_SCOPE, actorEquipmentScope, isWorksiteInScope } from "./access"
import {
  diffEquipmentFields, summarizeChanges, writeEquipmentHistory, type EquipmentFields, type MantActor,
} from "./equipment-history"
import {
  equipmentFailure, isRealDate, loadEquipmentCurrent, loadScheduleCatalog, type EquipmentResult, type FieldErrors,
} from "./equipment-resolve"

/**
 * Cambio de la unidad de medida de un equipo de Mantención (decisión del usuario, 2026-11-25). Lo usa el script
 * de una sola vez que mueve los camiones de producción a horas; no tiene acción propia.
 *
 * Toca sólo el perfil de Mantención (`mant_equipment_profiles`): NO escribe `fuel_vehicles`, cuyo medidor y
 * rendimiento son de Combustible, y NO borra ni anula registros: quedan con la unidad con que se midieron.
 * Con un cambio, lo que estaba en la unidad vieja se limpia: la pauta (salvo una pauta de la unidad nueva que se
 * pase), la lectura inicial y la preventiva declarada anterior a la plataforma. El cambio deja fila en el
 * historial del equipo, auditoría y una nueva `updated_at` del perfil, todo en la transacción de quien llama.
 * Si el equipo ya se mide en la unidad pedida, no escribe nada.
 */

export interface SetEquipmentUnitInput {
  vehicleId: string
  /** La unidad nueva: `km` u `h`. */
  unit: MantUnit
  /** Lectura inicial en la unidad nueva. Va junto con su fecha; sin ella el equipo queda sin lectura inicial. */
  initialReading?: number | null
  initialReadingDate?: string | null
  /** Pauta que se conserva: tiene que medirse en la unidad nueva. Sin ella el equipo queda sin pauta. */
  scheduleId?: string | null
  /** Motivo del cambio: queda en el historial del equipo y en la auditoría. */
  reason: string
}

export interface SetEquipmentUnitResult {
  /** `false` si el equipo ya se medía en esa unidad: no se escribió nada. */
  changed: boolean
  unit: MantUnit
  /** Lo que cambió, con la etiqueta de cada campo (vacío si no cambió nada). */
  changes: MantFieldChanges
}

const auditState = (fields: EquipmentFields) => ({ ...fields }) as Record<string, unknown>

export async function setEquipmentUnit(
  tx: Tx,
  actor: MantActor,
  input: SetEquipmentUnitInput,
  today: string = todayInChile(),
): Promise<EquipmentResult<SetEquipmentUnitResult>> {
  const reason = input.reason.trim()
  const errors: FieldErrors = {}
  if (!isValidReason(reason)) errors.reason = reasonRequiredMessage("el motivo del cambio de unidad")
  if (input.unit !== "km" && input.unit !== "h") errors.unit = "La unidad tiene que ser kilómetros (km) u horas (h)."
  if (Object.keys(errors).length > 0) return equipmentFailure(errors)

  const current = await loadEquipmentCurrent(tx, input.vehicleId)
  if (!current) return equipmentFailure({}, "Ese equipo no está en Mantención.")
  if (!isWorksiteInScope(actorEquipmentScope(actor), current.worksiteId)) return equipmentFailure({}, EQUIPMENT_OUT_OF_SCOPE)
  // Ya se mide en la unidad pedida: no se escribe nada (así una segunda corrida del script no cambia la base).
  if (current.unit === input.unit) {
    return { ok: true as const, data: { changed: false, unit: current.unit, changes: {} }, message: `${current.fields.code} ya se mide en ${unitName(current.unit)}.` }
  }

  // La pauta que se conserva tiene que medirse en la unidad nueva; si no se pasa ninguna, el equipo queda sin pauta.
  const wantedSchedule = input.scheduleId ?? null
  let schedule: { id: string; name: string } | null = null
  if (wantedSchedule) {
    const row = (await loadScheduleCatalog(tx)).find((item) => item.id === wantedSchedule)
    if (!row) errors.scheduleId = "Esa pauta no existe."
    else if (row.unit !== input.unit) errors.scheduleId = `Esa pauta se mide en ${unitName(row.unit)} y el equipo quedaría en ${unitName(input.unit)}.`
    else schedule = { id: row.id, name: row.name }
  }

  // La lectura inicial va junto con su fecha: las dos, o ninguna.
  const reading = input.initialReading ?? null
  const readingDate = input.initialReadingDate || null
  if (reading !== null) {
    if (!Number.isFinite(reading) || reading < 0 || reading > 99_999_999) errors.initialReading = "Escribe una lectura válida: un número que no sea negativo."
    if (!readingDate) errors.initialReadingDate = "Indica la fecha de la lectura inicial."
    else if (!isRealDate(readingDate)) errors.initialReadingDate = "La fecha de la lectura no es válida."
    else if (readingDate > today) errors.initialReadingDate = "La fecha de la lectura no puede ser futura."
  } else if (readingDate) {
    errors.initialReadingDate = "Sin lectura inicial no puede haber fecha."
  }
  if (Object.keys(errors).length > 0) return equipmentFailure(errors)

  const next: EquipmentFields = {
    ...current.fields,
    unit: unitName(input.unit),
    schedule: schedule?.name ?? null,
    initialReading: reading,
    initialReadingDate: readingDate,
    priorPreventiveDate: null,
    priorPreventiveReading: null,
    priorPreventiveInterval: null,
    priorPreventiveEvidence: null,
  }
  const changes = diffEquipmentFields(current.fields, next)

  // `updated_at` sube con el cambio: la ETag del historial que ve la app del mecánico depende de él.
  await tx.update(mantEquipmentProfiles).set({
    unit: input.unit,
    scheduleId: schedule?.id ?? null,
    initialReading: reading,
    initialReadingDate: readingDate,
    priorPreventiveDate: null,
    priorPreventiveReading: null,
    priorPreventiveInterval: null,
    priorPreventiveEvidence: null,
    priorPreventiveDeclaredBy: null,
    priorPreventiveSource: null,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.userId,
  }).where(eq(mantEquipmentProfiles.vehicleId, current.vehicleId))

  await writeEquipmentHistory(tx, {
    vehicleId: current.vehicleId,
    action: "update",
    summary: `Cambio de unidad de medida · ${summarizeChanges(changes)} · Motivo: ${reason}`,
    changes,
    userId: actor.userId,
  })
  await recordAudit({
    userId: actor.userId,
    userEmail: actor.email ?? undefined,
    action: "update",
    entityType: "mant_equipment",
    entityId: current.vehicleId,
    entityCode: current.fields.code,
    oldState: { ...auditState(current.fields), priorPreventiveDeclaredBy: current.priorPreventiveDeclaredBy, priorPreventiveSource: current.priorPreventiveSource },
    newState: { ...auditState(next), priorPreventiveDeclaredBy: null, priorPreventiveSource: null },
    reason,
    worksiteId: current.worksiteId,
  }, tx)

  return {
    ok: true as const,
    data: { changed: true, unit: input.unit, changes },
    message: `${current.fields.code} ahora se mide en ${unitName(input.unit)}.`,
  }
}
