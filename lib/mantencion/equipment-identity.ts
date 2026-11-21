/**
 * Identidad de un equipo por código interno y patente (R2, 2026-11-21).
 *
 * Una sola regla para comparar, usada por los importadores, la ficha de flota y
 * el índice único `fuel_vehicles_code_key_unique`. Las planillas escriben el
 * mismo equipo de muchas formas: «Ka-128», «TO.38», «KRR-010», «SJFC66»,
 * «SR-CJ-44». Para compararlos:
 *
 * - código: mayúsculas, sólo letras y dígitos, y sin ceros a la izquierda en la
 *   parte numérica que sigue a las letras («KRR-010» = «KRR-10» = «krr10»).
 *   Es exactamente la expresión del índice único; si cambia una, cambia la otra.
 * - patente: mayúsculas, sólo letras y dígitos («SR-CJ-44» = «SRCJ44»). Los
 *   ceros de una patente sí importan, no se quitan.
 *
 * Estas claves sirven para comparar, nunca para mostrar ni para guardar: lo
 * que se guarda es `canonicalEquipmentCode`, que respeta los dígitos escritos.
 */

const ALNUM = /[^A-Z0-9]/g

function compactUpper(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(ALNUM, "")
}

/** Clave de comparación de un código interno. Vacío → `""`. */
export function equipmentCodeKey(raw: string | null | undefined): string {
  return compactUpper(raw).replace(/^([A-Z]+)0+([0-9])/, "$1$2")
}

/** Clave de comparación de una patente. Vacío → `""`. */
export function plateKey(raw: string | null | undefined): string {
  return compactUpper(raw)
}

/**
 * Forma para guardar un código escrito por alguien: mayúsculas, letras, guion
 * y números tal como se escribieron («ka 128» → «KA-128», «TO.38» → «TO-38»,
 * «KRR-010» → «KRR-010»). `null` si no queda una forma letras + números; un
 * código así se informa como error, no se adivina.
 */
export function canonicalEquipmentCode(raw: string | null | undefined): string | null {
  const compact = compactUpper(raw)
  const match = /^([A-Z]+)([0-9]+)$/.exec(compact)
  return match ? `${match[1]}-${match[2]}` : null
}

export interface IdentifiedVehicle { id: string; code: string | null; plate: string }

export type VehicleMatch =
  | { state: "linked"; vehicleId: string }
  | { state: "unmatched"; vehicleId: null }
  | { state: "conflict"; vehicleId: null; reason: string }

/**
 * Encuentra el equipo por código y patente. Si los dos se informan y apuntan a
 * equipos distintos es un conflicto: nunca se elige uno. Un código o una
 * patente que coincide con más de un equipo también es conflicto.
 */
export function matchVehicle(
  input: { code?: string | null; plate?: string | null },
  vehicles: readonly IdentifiedVehicle[],
): VehicleMatch {
  const codeKey = equipmentCodeKey(input.code)
  const plateK = plateKey(input.plate)
  if (!codeKey && !plateK) return { state: "unmatched", vehicleId: null }
  const byCode = codeKey ? vehicles.filter((vehicle) => vehicle.code && equipmentCodeKey(vehicle.code) === codeKey) : []
  const byPlate = plateK ? vehicles.filter((vehicle) => plateKey(vehicle.plate) === plateK) : []
  if (byCode.length > 1) return { state: "conflict", vehicleId: null, reason: "El código coincide con más de un equipo." }
  if (byPlate.length > 1) return { state: "conflict", vehicleId: null, reason: "La patente coincide con más de un equipo." }
  const code = byCode[0]
  const plate = byPlate[0]
  if (code && plate && code.id !== plate.id) {
    return { state: "conflict", vehicleId: null, reason: "El código y la patente corresponden a equipos distintos." }
  }
  const found = code ?? plate
  return found ? { state: "linked", vehicleId: found.id } : { state: "unmatched", vehicleId: null }
}
