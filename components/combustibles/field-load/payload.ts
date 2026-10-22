import { parseFieldNumber } from "@/lib/combustibles/field-load-number"
import { TAE_ALWAYS_REQUIRED_EVIDENCE, taeEvidenceKinds, type TaeEvidenceKind } from "@/lib/validation/fuel-tae"
import type { QueuedTaeEvidence } from "@/lib/pwa/tae-offline-queue"
import { EMPTY_DRAFT, type FieldLoadConfig, type FieldLoadDraft, type FieldLoadPhotos } from "./types"
import { effectiveSeals, vehicleOf } from "./validate"
import type { FieldIdentity } from "./use-field-identity"

export function newClientId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `tae-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Payload tal como lo espera `taePublicSubmissionSchema`. Sin hora: la pone el servidor (o la cola, al encolar). */
export function buildPayload(input: {
  config: FieldLoadConfig
  draft: FieldLoadDraft
  driver: FieldIdentity
  supervisor: FieldIdentity
  clientSubmissionId: string
}): Record<string, unknown> {
  const { config, draft, driver, supervisor } = input
  const vehicle = vehicleOf(config, draft)!
  const seals = effectiveSeals(draft)
  const reading = vehicle.meterType === "none" ? null : parseFieldNumber(draft.meterReading)
  return {
    clientSubmissionId: input.clientSubmissionId,
    worksiteId: config.worksite.id,
    loadingPointId: config.loadingPoint?.id ?? "",
    vehicleId: vehicle.id,
    productId: draft.productId,
    supplyMediumId: draft.supplyMediumId,
    equipmentCode: vehicle.code ?? vehicle.plate,
    plate: vehicle.plate,
    driverWorkerId: driver.matched?.id ?? "",
    driverName: driver.matched?.name ?? draft.driverName.trim(),
    supervisorWorkerId: supervisor.matched?.id ?? "",
    supervisorName: supervisor.matched?.name ?? draft.supervisorName.trim(),
    manualIdentity: !driver.matched || !supervisor.matched,
    meterType: vehicle.meterType === "hour_meter" ? "hour_meter" : "odometer",
    meterReading: reading,
    meterUnavailableReason: "",
    liters: parseFieldNumber(draft.liters),
    removedSealNumber: seals.removedSealNumber,
    installedSealNumber: seals.installedSealNumber,
    noSealReason: draft.noRemovedSeal || draft.noInstalledSeal ? draft.noSealReason.trim() : "",
    notes: draft.notes.trim(),
  }
}

export function buildEvidence(draft: FieldLoadDraft, photos: FieldLoadPhotos): QueuedTaeEvidence[] {
  const seals = effectiveSeals(draft)
  const kinds: TaeEvidenceKind[] = [...TAE_ALWAYS_REQUIRED_EVIDENCE]
  if (seals.removedSealNumber) kinds.push("removed_seal")
  if (seals.installedSealNumber) kinds.push("installed_seal")
  return kinds.filter((kind) => photos[kind]).map((kind) => ({ kind, blob: photos[kind]!, fileName: photos[kind]!.name }))
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

/** Reconstruye el borrador de una carga rechazada para que el operador la corrija y la reenvíe. */
export function draftFromPayload(payload: Record<string, unknown>): FieldLoadDraft {
  const removed = text(payload.removedSealNumber)
  const installed = text(payload.installedSealNumber)
  return {
    ...EMPTY_DRAFT,
    vehicleId: text(payload.vehicleId),
    productId: text(payload.productId),
    supplyMediumId: text(payload.supplyMediumId),
    meterReading: payload.meterReading == null ? "" : text(payload.meterReading).replace(".", ","),
    liters: payload.liters == null ? "" : text(payload.liters).replace(".", ","),
    removedSealNumber: removed,
    installedSealNumber: installed,
    noRemovedSeal: !removed,
    noInstalledSeal: !installed,
    noSealReason: text(payload.noSealReason),
    driverName: text(payload.driverName),
    supervisorName: text(payload.supervisorName),
    notes: text(payload.notes),
  }
}

export function photosFromEvidence(evidence: QueuedTaeEvidence[]): FieldLoadPhotos {
  const photos: FieldLoadPhotos = {}
  for (const item of evidence) {
    if ((taeEvidenceKinds as readonly string[]).includes(item.kind)) photos[item.kind] = new File([item.blob], item.fileName, { type: item.blob.type })
  }
  return photos
}
