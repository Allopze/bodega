import type { Tx } from "@/db"
import type { SyncPreventiveRecord, SyncRecord, SyncWarning } from "@/lib/mantencion/contracts"
import { formatReading, meterName, unitName } from "@/lib/mantencion/format"
import { checkReading } from "@/lib/mantencion/readings"
import { baseInterval, checkItemResults, checklistFor, suggestInterval } from "@/lib/mantencion/schedule"
import { findDuplicatePreventive } from "@/lib/mantencion/status"
import { formatDate, todayInChile } from "@/lib/utils"
import { getScheduleSnapshot } from "./schedule-versions"
import { loadPhotos, loadVehicleHistory, type VehicleContext, type VehicleHistory } from "./records-create-context"
import { validateCorrective } from "./records-create-validate-corrective"
import {
  invalid, reject, type Author, type PlanItem, type PreventivePlan, type RecordFailure, type RecordPlan, type Validated,
} from "./records-create-types"

/**
 * Revalidación en el servidor de TODO lo que el teléfono ya validó (§8): el
 * cliente nunca es de fiar. Devuelve el plan de inserción (con los snapshots
 * resueltos) o el primer rechazo, redactado para el mecánico.
 *
 * Orden: lo que no depende de la base, la lectura, las reglas del tipo de
 * registro y, al final, las fotos: un rechazo definitivo gana sobre «faltan
 * fotos», para que la app no re-suba fotos de un registro que igual se rechaza.
 */

export async function validateRecord(
  tx: Tx,
  input: SyncRecord,
  author: Author,
  vehicle: VehicleContext | null,
): Promise<Validated<RecordPlan>> {
  if (!vehicle) return reject("Ese equipo no existe o no está en el módulo de mantención.", "vehicleId")
  if (!vehicle.isActive) return reject(`El equipo ${vehicle.code} está dado de baja: no admite registros nuevos.`, "vehicleId")
  if (input.workDate > todayInChile()) return reject("La fecha del trabajo no puede ser futura.", "workDate")

  const composition = checkPhotoComposition(input)
  if (composition) return composition

  const history = await loadVehicleHistory(tx, vehicle.vehicleId)
  const reading = checkReading({
    value: input.reading,
    workDate: input.workDate,
    unit: vehicle.unit,
    readings: history.readings,
    initial: vehicle.initial,
  })
  if (!reading.ok) return reject(reading.message, "reading")

  const warnings: SyncWarning[] = []
  if (reading.jump && reading.previous) {
    warnings.push({
      code: "reading_jump",
      message: `La lectura subió ${formatReading(reading.jump.delta, vehicle.unit)} desde la última (${reading.previous.source}, ${formatDate(reading.previous.date)}): jefatura lo verá marcado.`,
    })
  }
  // «Fuera de faena»: rol global nunca; el resto, si la faena del equipo no es una de sus asignadas.
  const outOfWorksite = !author.viewer.isGlobal && !author.viewer.worksiteIds.includes(vehicle.worksiteId)
  if (outOfWorksite) {
    warnings.push({
      code: "out_of_worksite",
      message: `El equipo ${vehicle.code} es de otra faena (${vehicle.worksiteName}): el registro queda marcado para jefatura.`,
    })
  }

  let preventive: PreventivePlan | null = null
  let corrective: RecordPlan["corrective"] = null
  let executor: RecordPlan["executor"] = { kind: "yo", userId: author.userId, workshopId: null, name: author.name }
  if (input.kind === "P") {
    const checked = await validatePreventive(tx, input, vehicle, history)
    if (!checked.ok) return checked
    preventive = checked.value.preventive
    warnings.push(...checked.value.warnings)
  } else {
    const checked = await validateCorrective(tx, input, author)
    if (!checked.ok) return checked
    corrective = checked.value.corrective
    executor = checked.value.executor
    warnings.push(...checked.value.warnings)
  }

  const photos = await checkPhotosUploaded(tx, input, author)
  if (photos) return photos

  return {
    ok: true,
    value: {
      vehicle,
      outOfWorksite,
      readingJumpAlert: reading.jump !== null,
      executor,
      preventive,
      corrective,
      photos: input.photos.map((photo) => ({ id: photo.id, kind: photo.kind })),
      warnings,
    },
  }
}

/** Regla 8: preventiva = 1 de filtros + 1 del sticker; correctiva = de 1 a 3 del trabajo. */
function checkPhotoComposition(input: SyncRecord): RecordFailure | null {
  const ids = input.photos.map((photo) => photo.id)
  if (new Set(ids).size !== ids.length) return invalid("Hay una foto repetida en el registro.", "photos")
  const count = (kind: string) => input.photos.filter((photo) => photo.kind === kind).length
  if (input.kind === "P") {
    if (input.photos.length !== 2 || count("filtros") !== 1 || count("sticker") !== 1) {
      return reject("La preventiva lleva exactamente una foto de los filtros y una del sticker de mantención.", "photos")
    }
  } else if (count("correctiva") !== input.photos.length) {
    return reject("La correctiva lleva de 1 a 3 fotos del trabajo.", "photos")
  }
  return null
}

/** Cada foto debe existir, ser de este autor y no estar ya anclada a otro registro; si no, la app las vuelve a subir. */
async function checkPhotosUploaded(tx: Tx, input: SyncRecord, author: Author): Promise<RecordFailure | null> {
  const rows = new Map((await loadPhotos(tx, input.photos.map((photo) => photo.id))).map((row) => [row.id, row]))
  const missing = input.photos.filter((photo) => {
    const row = rows.get(photo.id)
    return !row || row.uploadedBy !== author.userId || (row.recordId !== null && row.recordId !== input.id)
  })
  if (missing.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "missing_photos",
      message: missing.length === 1 ? "Falta subir 1 foto: se vuelve a enviar sola." : `Faltan subir ${missing.length} fotos: se vuelven a enviar solas.`,
      field: "photos",
    }
  }
  const wrongKind = input.photos.find((photo) => rows.get(photo.id)?.kind !== photo.kind)
  if (wrongKind) return invalid("Una foto se subió con otro tipo que el declarado en el registro.", "photos")
  return null
}

async function validatePreventive(
  tx: Tx,
  input: SyncPreventiveRecord,
  vehicle: VehicleContext,
  history: VehicleHistory,
): Promise<Validated<{ preventive: PreventivePlan; warnings: SyncWarning[] }>> {
  // Se revalida contra la versión con que se firmó, no contra la vigente (decisión 8 del plan).
  const snapshot = await getScheduleSnapshot(input.scheduleId, input.scheduleVersion, tx)
  if (!snapshot) return reject("Esa versión de la pauta ya no está disponible. Actualiza la app y vuelve a hacer la preventiva.", "scheduleId")
  if (snapshot.unit !== vehicle.unit) {
    return reject(`La pauta va en ${unitName(snapshot.unit)} y el equipo ${vehicle.code} se mide en ${unitName(vehicle.unit)} (${meterName(vehicle.unit)}).`, "scheduleId")
  }
  if (!snapshot.intervals.includes(input.intervalValue)) {
    return reject(`La pauta no tiene un intervalo de ${formatReading(input.intervalValue, snapshot.unit)}.`, "intervalValue")
  }

  // El servidor recalcula la sugerencia: lo que declaró el teléfono no cuenta (regla 4).
  const suggested = suggestInterval(snapshot.intervals, input.reading)
  const manualReason = input.manualScheduleReason?.trim() ?? ""
  const manual = input.intervalValue !== suggested.intervalValue
  if (manual && manualReason.length < 3) {
    return reject(`Tocaba la de ${formatReading(suggested.intervalValue, snapshot.unit)}. Para hacer otra, escribe el motivo.`, "manualScheduleReason")
  }

  const checklist = checklistFor(snapshot, input.intervalValue, vehicle.brandId)
  if (checklist.length === 0) {
    return reject(`La pauta no tiene ítems para el intervalo de ${formatReading(input.intervalValue, snapshot.unit)}.`, "intervalValue")
  }
  const results = checkItemResults(checklist, input.items)
  if (!results.ok) return reject(results.message, "items")

  const byKey = new Map(input.items.map((item) => [item.itemKey, item]))
  const items = checklist.flatMap((item, index): PlanItem[] => {
    const result = byKey.get(item.key)
    if (!result) return []
    return [{
      itemKey: item.key,
      groupName: item.group,
      itemName: item.name,
      sortOrder: index,
      value: result.value,
      reason: result.value === "NR" ? result.reason?.trim() ?? null : null,
      manufacturerWarning: item.manufacturerWarning,
    }]
  })

  const warnings: SyncWarning[] = []
  const duplicateOf = findDuplicatePreventive({
    previous: history.preventives,
    intervalValue: input.intervalValue,
    reading: input.reading,
    workDate: input.workDate,
    base: baseInterval(snapshot.intervals),
  })
  if (duplicateOf) {
    warnings.push({
      code: "duplicate",
      message: `Ya había una preventiva de ${formatReading(input.intervalValue, snapshot.unit)} de este equipo (${duplicateOf.folio ?? "sin folio"}, ${formatDate(duplicateOf.date)}): jefatura lo verá marcado.`,
      recordId: duplicateOf.id,
      folio: duplicateOf.folio,
    })
  }
  if (vehicle.scheduleId !== input.scheduleId || vehicle.scheduleVersion !== input.scheduleVersion) {
    warnings.push({
      code: "schedule_outdated",
      message: "La pauta del equipo cambió mientras hacías el registro: quedó guardado con la versión que usaste.",
    })
  }

  return {
    ok: true,
    value: {
      warnings,
      preventive: {
        scheduleId: input.scheduleId,
        scheduleVersion: input.scheduleVersion,
        scheduleName: snapshot.name,
        intervalValue: input.intervalValue,
        suggestedIntervalValue: suggested.intervalValue,
        manualScheduleReason: manual ? manualReason : null,
        notes: input.notes,
        items,
        duplicateOf,
      },
    },
  }
}
