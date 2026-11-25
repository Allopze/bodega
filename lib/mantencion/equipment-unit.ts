import { maintenanceUnitOfMeter } from "./padron-identity"
import type { MantUnit } from "./types"

/**
 * Unidad (km u horas) en que Mantención mide un equipo.
 *
 * La unidad vive en `mant_equipment_profiles.unit`; si es nula vale la del tipo
 * (`fuel_equipment_types.default_meter_type`). La regla de cuál se fija al dar de alta es esta
 * (decisión del usuario, 2026-11-25): los camiones y tractocamiones de producción miden en horas
 * (horómetro) y los de Biodiversa, que van por ruta, en kilómetros (odómetro). El resto de los tipos
 * mide como su tipo.
 *
 * Es sólo de Mantención: no toca `fuel_vehicles.meter_type`, que es de Combustible.
 */

/** Código (`worksites.code`) de la faena cuyos camiones miden en odómetro. */
export const ODOMETER_TRUCK_WORKSITE_CODE = "BIODIVERSA"

/** `fuel_equipment_types.performance_family` de camiones y tractocamiones. */
export const TRUCK_PERFORMANCE_FAMILY = "camiones"

export interface DefaultUnitInput {
  /** `fuel_equipment_types.default_meter_type` del tipo del equipo. */
  typeMeterType: string
  /** `fuel_equipment_types.performance_family` del tipo. */
  typeFamily: string | null
  /** `worksites.code` de la faena del equipo; `null` si aún no existe (vista previa de una importación). */
  worksiteCode: string | null
}

/**
 * La unidad con que nace un equipo (o la que le corresponde al cambiarle el tipo si aún no la tiene
 * fija): odómetro para camiones y tractos de Biodiversa, horómetro para los demás camiones y tractos,
 * y la del tipo para cualquier otro. `null` si el tipo no se mide en km ni en horas.
 */
export function defaultMaintenanceUnit(input: DefaultUnitInput): MantUnit | null {
  const typeUnit = maintenanceUnitOfMeter(input.typeMeterType)
  if (!typeUnit) return null
  if (input.typeFamily !== TRUCK_PERFORMANCE_FAMILY) return typeUnit
  return input.worksiteCode?.toUpperCase() === ODOMETER_TRUCK_WORKSITE_CODE ? "km" : "h"
}

/** La unidad efectiva: la fijada en el perfil o, si no hay, la del tipo. */
export function effectiveMaintenanceUnit(stored: string | null | undefined, typeMeterType: string): MantUnit | null {
  if (stored === "km" || stored === "h") return stored
  return maintenanceUnitOfMeter(typeMeterType)
}

/** `fuel_vehicles.meter_type` / `performance_unit` que corresponden a una unidad de Mantención. */
export function meterDefaultsOfUnit(unit: MantUnit): { meterType: "odometer" | "hour_meter"; performanceUnit: "km_per_liter" | "liters_per_hour" } {
  return unit === "km"
    ? { meterType: "odometer", performanceUnit: "km_per_liter" }
    : { meterType: "hour_meter", performanceUnit: "liters_per_hour" }
}
