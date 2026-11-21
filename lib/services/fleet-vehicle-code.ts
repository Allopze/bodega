import { isUniqueViolation } from "@/lib/action-error"
import { canonicalEquipmentCode } from "@/lib/mantencion/equipment-identity"

/** Índice único del código de equipo tras normalizarlo (`equipmentCodeKey`). */
export const FUEL_VEHICLE_CODE_UNIQUE = "fuel_vehicles_code_key_unique"

/** «Ya existe un equipo con el código KA-71». El código se muestra en su forma canónica. */
export function duplicateEquipmentCodeMessage(code: string | null | undefined): string {
  const shown = canonicalEquipmentCode(code) ?? (code ?? "").trim().toUpperCase()
  return shown ? `Ya existe un equipo con el código ${shown}.` : "Ya existe un equipo con ese código."
}

/**
 * Si `error` es la violación del índice único del código, el mensaje para la
 * persona; si no, `null` (el llamador sigue con su manejo normal).
 */
export function duplicateEquipmentCodeError(error: unknown, code: string | null | undefined): string | null {
  return isUniqueViolation(error, FUEL_VEHICLE_CODE_UNIQUE) ? duplicateEquipmentCodeMessage(code) : null
}
