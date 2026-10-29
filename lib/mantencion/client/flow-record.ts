import { syncRecordSchema, type SyncCorrectiveRecord, type SyncPreventiveRecord, type SyncRecord } from "../contracts"
import { checklistFor } from "../schedule"
import type { MantItemValue, MantPhotoKind } from "../types"
import type { FleetRow } from "./fleet-view"
import { newDraft, stepsFor, type FlowDraft, type FlowStep } from "./flow-types"
import { analyzeLecture, parseQuantity, partsFilled } from "./flow-validate"
import type { QueueRecordItem, RecordSummary } from "./types"

/** Lo que hace falta del momento de firmar. */
export interface SignInput {
  row: FleetRow
  deviceId: string
  appVersion: string
  /** ISO de cuando se perdió la señal; `null` si se firma con señal. */
  offlineSince: string | null
  now: Date
}

export type BuiltRecord =
  | { ok: true; payload: SyncRecord; summary: RecordSummary; photoIds: string[] }
  | { ok: false; message: string }

function photoList(draft: FlowDraft): Array<{ id: string; kind: MantPhotoKind }> {
  if (draft.kind === "P") {
    const list: Array<{ id: string; kind: MantPhotoKind }> = []
    if (draft.photos.filtros) list.push({ id: draft.photos.filtros, kind: "filtros" })
    if (draft.photos.sticker) list.push({ id: draft.photos.sticker, kind: "sticker" })
    return list
  }
  return draft.photos.correctiva.map((id) => ({ id, kind: "correctiva" as const }))
}

/**
 * Convierte el borrador firmado en el registro del contrato y lo valida con el
 * MISMO esquema del servidor antes de encolarlo: lo que no pasa aquí no se
 * guarda como «pendiente» para que el servidor lo rechace horas después.
 */
export function buildRecord(draft: FlowDraft, input: SignInput): BuiltRecord {
  const { row } = input
  const analysis = analyzeLecture(draft, row)
  const reading = analysis.value
  if (reading === null) return { ok: false, message: "Falta la lectura del equipo." }

  const common = {
    id: draft.id,
    vehicleId: row.eq.id,
    reading,
    workDate: draft.workDate,
    signedAt: input.now.toISOString(),
    offlineSince: input.offlineSince,
    deviceId: input.deviceId,
    appVersion: input.appVersion.slice(0, 40),
    readingJumpConfirmed: analysis.jump !== null && draft.ackJump?.reading === reading && draft.ackJump.workDate === draft.workDate,
    duplicateConfirmed: analysis.duplicate !== null && draft.ackDuplicate === analysis.duplicate.id,
    correctsRecordId: draft.correctsRecordId,
    photos: photoList(draft),
  }

  let candidate: SyncPreventiveRecord | SyncCorrectiveRecord
  if (draft.kind === "P") {
    const schedule = draft.schedule
    if (!schedule || draft.intervalValue === null || draft.suggestedIntervalValue === null) return { ok: false, message: "Falta la pauta del equipo." }
    candidate = {
      ...common,
      kind: "P",
      scheduleId: schedule.id,
      scheduleVersion: schedule.version,
      intervalValue: draft.intervalValue,
      suggestedIntervalValue: draft.suggestedIntervalValue,
      manualScheduleReason: draft.intervalValue === draft.suggestedIntervalValue ? null : draft.intervalReason.trim(),
      items: draft.checklist.map((item) => {
        const value = (draft.marks[item.key] ?? "R") as MantItemValue
        return { itemKey: item.key, value, reason: value === "NR" ? (draft.reasons[item.key] ?? "").trim() : null }
      }),
      notes: draft.notes.trim(),
    }
  } else {
    const inWorkshop = draft.inWorkshop === true
    candidate = {
      ...common,
      kind: "C",
      workTypeIds: draft.workTypeIds,
      oilIds: draft.noOilChange ? [] : draft.oilIds,
      noOilChange: draft.noOilChange,
      executor: draft.executorKind === "yo"
        ? { kind: "yo" }
        : draft.executorKind === "otro_mecanico"
          ? { kind: "otro_mecanico", userId: draft.executorUserId }
          : { kind: "externo", workshopId: draft.executorWorkshopId },
      description: draft.description.trim(),
      parts: draft.noParts ? [] : partsFilled(draft).map((part) => ({ quantity: parseQuantity(part.quantity), description: part.description.trim() })),
      noParts: draft.noParts,
      hours: draft.hours,
      inWorkshop,
      workshopEntryDate: inWorkshop ? draft.workshopEntryDate : null,
      workOrder: draft.workOrder.trim() || null,
      driverIds: draft.driverIds,
    }
  }

  const parsed = syncRecordSchema.safeParse(candidate)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "El registro está incompleto." }
  return {
    ok: true,
    payload: parsed.data,
    photoIds: parsed.data.photos.map((photo) => photo.id),
    summary: {
      kind: draft.kind,
      vehicleId: row.eq.id,
      equipmentCode: row.eq.code,
      equipmentPlate: row.eq.plate,
      unit: row.eq.unit,
      intervalValue: draft.kind === "P" ? draft.intervalValue : null,
      workDate: draft.workDate,
      reading,
      inWorkshop: candidate.kind === "C" && candidate.inWorkshop,
      workshopEntryDate: candidate.kind === "C" ? candidate.workshopEntryDate : null,
    },
  }
}

/** A qué paso lleva un rechazo, según el campo que señaló el servidor. */
export function stepForRejection(field: string | null): FlowStep {
  if (!field) return "revisar"
  if (/^(reading|workDate|vehicleId|interval|schedule|manualSchedule)/.test(field)) return "lectura"
  if (/^(items|notes|photos)/.test(field)) return field.startsWith("items") ? "pauta" : "fotos"
  if (/^(workType|oil|executor|description|parts|hours|inWorkshop|workshop|workOrder|driver)/.test(field)) return "trabajo"
  return "revisar"
}

/**
 * «Corregir y reenviar»: un borrador nuevo (id nuevo) con los datos y las FOTOS
 * del registro rechazado, parado en Revisar. Al firmar, el rechazado sale de la
 * cola; las fotos pasan al envío nuevo sin volver a sacarlas.
 */
export function draftFromRejected(item: QueueRecordItem, row: FleetRow, now: Date = new Date()): FlowDraft {
  const { payload } = item
  const schedule = row.schedule
  const base = newDraft({ userId: item.authorUserId, kind: payload.kind, vehicleId: row.eq.id, schedule, now })
  const draft: FlowDraft = {
    ...base,
    readingText: String(payload.reading),
    workDate: payload.workDate,
    correctsRecordId: payload.correctsRecordId,
    replacesQueueId: item.id,
    ackJump: payload.readingJumpConfirmed ? { reading: payload.reading, workDate: payload.workDate } : null,
  }

  if (payload.kind === "P") {
    const intervals = schedule?.intervals ?? []
    const intervalIndex = intervals.indexOf(payload.intervalValue)
    const analysis = analyzeLecture({ ...draft, intervalIndex: intervalIndex >= 0 ? intervalIndex : null }, row)
    const items = schedule && analysis.intervalValue !== null ? checklistFor(schedule, analysis.intervalValue, row.eq.brandId) : []
    const marks: Record<string, MantItemValue> = {}
    const reasons: Record<string, string> = {}
    for (const result of payload.items) {
      if (!items.some((entry) => entry.key === result.itemKey)) continue
      marks[result.itemKey] = result.value
      if (result.reason) reasons[result.itemKey] = result.reason
    }
    return {
      ...draft,
      step: stepsFor("P").length - 1,
      intervalIndex: analysis.manual ? intervalIndex : null,
      intervalReason: payload.manualScheduleReason ?? "",
      checklist: items,
      intervalValue: analysis.intervalValue,
      suggestedIntervalValue: analysis.suggestion?.intervalValue ?? null,
      marks,
      reasons,
      openGroup: -1,
      notes: payload.notes,
      photos: {
        filtros: payload.photos.find((photo) => photo.kind === "filtros")?.id ?? null,
        sticker: payload.photos.find((photo) => photo.kind === "sticker")?.id ?? null,
        correctiva: [],
      },
    }
  }

  return {
    ...draft,
    step: stepsFor("C").length - 1,
    workTypeIds: payload.workTypeIds,
    oilIds: payload.oilIds,
    noOilChange: payload.noOilChange,
    executorKind: payload.executor.kind,
    executorUserId: payload.executor.kind === "otro_mecanico" ? payload.executor.userId : "",
    executorWorkshopId: payload.executor.kind === "externo" ? payload.executor.workshopId : "",
    description: payload.description,
    workOrder: payload.workOrder ?? "",
    parts: payload.parts.length > 0 ? payload.parts.map((part) => ({ quantity: String(part.quantity).replace(".", ","), description: part.description })) : [{ quantity: "1", description: "" }],
    noParts: payload.noParts,
    hours: payload.hours,
    inWorkshop: payload.inWorkshop,
    workshopEntryDate: payload.workshopEntryDate ?? draft.workshopEntryDate,
    driverIds: payload.driverIds,
    photos: { filtros: null, sticker: null, correctiva: payload.photos.map((photo) => photo.id) },
  }
}

