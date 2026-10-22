import { checkLiters, checkSealInputs } from "@/lib/combustibles/field-load-rules"
import { parseFieldNumber } from "@/lib/combustibles/field-load-number"
import type { FieldIdentity } from "./use-field-identity"
import type { FieldLoadConfig, FieldLoadDraft, FieldLoadPhotos, FieldLoadStep } from "./types"

export type StepErrors = Record<string, string>

export interface ValidationContext {
  config: FieldLoadConfig
  draft: FieldLoadDraft
  photos: FieldLoadPhotos
  driver: FieldIdentity
  supervisor: FieldIdentity
}

export function vehicleOf(config: FieldLoadConfig, draft: FieldLoadDraft) {
  return config.vehicles.find((item) => item.id === draft.vehicleId)
}

/** Sellos tal como viajan: «No hay sello» vacía el número aunque quedara texto escrito. */
export function effectiveSeals(draft: FieldLoadDraft) {
  return {
    removedSealNumber: draft.noRemovedSeal ? "" : draft.removedSealNumber.trim(),
    installedSealNumber: draft.noInstalledSeal ? "" : draft.installedSealNumber.trim(),
  }
}

export function validateStep(step: FieldLoadStep, context: ValidationContext): StepErrors {
  const { config, draft, photos, driver, supervisor } = context
  const errors: StepErrors = {}
  const vehicle = vehicleOf(config, draft)
  if (step === "vehicle") {
    if (!vehicle) errors.vehicleId = "Elige el equipo al que le cargaste combustible."
    else if (vehicle.products.length === 0) errors.productId = "Este equipo no tiene combustibles habilitados. Avisa a tu supervisor."
    else if (!draft.productId) errors.productId = "Elige el combustible."
    if (!draft.supplyMediumId) errors.supplyMediumId = "Elige con qué medio se cargó el combustible."
  }
  if (step === "meter") {
    if (vehicle && vehicle.meterType !== "none") {
      const reading = parseFieldNumber(draft.meterReading)
      if (reading == null) errors.meterReading = `Escribe la lectura del ${vehicle.meterType === "hour_meter" ? "horómetro" : "odómetro"} tal como aparece en el tablero.`
    }
    if (!photos.odometer) errors.odometer = "Falta la foto del tablero con la lectura."
  }
  if (step === "liters") {
    const liters = parseFieldNumber(draft.liters)
    if (liters == null) errors.liters = "Escribe cuántos litros cargaste."
    else {
      const issue = checkLiters(liters, vehicle?.tankCapacityLiters)
      if (issue) errors.liters = issue.message
    }
    if (!photos.liter_meter) errors.liter_meter = "Falta la foto del medidor de litros."
  }
  if (step === "seals") {
    const seals = effectiveSeals(draft)
    if (!draft.noRemovedSeal && !seals.removedSealNumber) errors.removedSealNumber = "Escribe el número del sello que sacaste o marca «No hay sello»."
    if (!draft.noInstalledSeal && !seals.installedSealNumber) errors.installedSealNumber = "Escribe el número del sello nuevo o marca «No hay sello»."
    if (!errors.removedSealNumber && !errors.installedSealNumber) {
      const issue = checkSealInputs({ ...seals, noSealReason: draft.noSealReason })
      if (issue) errors[issue.field === "noSealReason" ? "noSealReason" : issue.field] = issue.message
    }
    if (seals.removedSealNumber && !photos.removed_seal) errors.removed_seal = "Falta la foto del sello que sacaste."
    if (seals.installedSealNumber && !photos.installed_seal) errors.installed_seal = "Falta la foto del sello nuevo."
  }
  if (step === "people") {
    if (!driver.matched && draft.driverName.trim().length < 2) errors.driverName = "Verifica el RUT del conductor o escribe su nombre."
    if (!supervisor.matched && draft.supervisorName.trim().length < 2) errors.supervisorName = "Verifica el RUT del supervisor o escribe su nombre."
  }
  return errors
}

const REVIEW_ORDER: FieldLoadStep[] = ["vehicle", "meter", "liters", "seals", "people"]

/** Primer paso con datos faltantes (o `null` si todo está completo): el resumen final lo usa antes de enviar. */
export function firstInvalidStep(context: ValidationContext): FieldLoadStep | null {
  return REVIEW_ORDER.find((step) => Object.keys(validateStep(step, context)).length > 0) ?? null
}

/** A qué paso llevar al operador cuando el servidor rechazó un campo concreto. */
export function stepForServerField(field: string | undefined): FieldLoadStep {
  switch (field) {
    case "vehicleId":
    case "productId":
    case "supplyMediumId":
      return "vehicle"
    case "meterReading":
      return "meter"
    case "liters":
      return "liters"
    case "removedSealNumber":
    case "installedSealNumber":
    case "noSealReason":
      return "seals"
    default:
      return "review"
  }
}
