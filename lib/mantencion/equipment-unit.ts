import type { MantUnit } from "./types"

/**
 * Unidad (km u horas) en que Mantención mide un equipo.
 *
 * La unidad vive en `mant_equipment_profiles.unit`; si es nula vale la del tipo
 * (`fuel_equipment_types.default_meter_type`). Al dar de alta un equipo se pregunta (decisión del usuario,
 * 2026-11-26): el formulario la prellena con la de su tipo y quien lo da de alta puede cambiarla. Ya no hay una
 * regla escondida por faena (la de que los camiones de Biodiversa medían en km era una indicación de una sola
 * vez, no una regla): donde nadie la elige —la carga inicial, la importación de equipos— nace con la de su tipo.
 *
 * Es sólo de Mantención: no toca `fuel_vehicles.meter_type`, que es de Combustible.
 */

/** `fuel_equipment_types.performance_family` de camiones y tractocamiones (la usan el script de 2026-11 y las fixtures). */
export const TRUCK_PERFORMANCE_FAMILY = "camiones"

/** La unidad de Mantención de un medidor (`fuel_equipment_types.default_meter_type`); `null` si no es km ni horas. */
export function maintenanceUnitOfMeter(meterType: string): MantUnit | null {
  if (meterType === "odometer") return "km"
  if (meterType === "hour_meter") return "h"
  return null
}

export interface DefaultUnitInput {
  /** `fuel_equipment_types.default_meter_type` del tipo del equipo. */
  typeMeterType: string
}

/**
 * La unidad con que nace un equipo cuando nadie la elige: la de su tipo (odómetro, km; horómetro, horas).
 * `null` si el tipo no se mide en km ni en horas.
 */
export function defaultMaintenanceUnit(input: DefaultUnitInput): MantUnit | null {
  return maintenanceUnitOfMeter(input.typeMeterType)
}

/** `km` u `h`; cualquier otro valor (incluido vacío) no es una unidad de Mantención. */
export function parseMaintenanceUnit(value: string | null | undefined): MantUnit | null {
  return value === "km" || value === "h" ? value : null
}

/** La unidad efectiva: la fijada en el perfil o, si no hay, la del tipo. */
export function effectiveMaintenanceUnit(stored: string | null | undefined, typeMeterType: string): MantUnit | null {
  return parseMaintenanceUnit(stored) ?? maintenanceUnitOfMeter(typeMeterType)
}
