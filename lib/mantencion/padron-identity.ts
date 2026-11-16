import type { MantUnit } from "./types"

/**
 * Lo que el formulario del padrón (Vehículos › Editar vehículo) necesita saber de un equipo que
 * está en Mantención (crítica 2026-11-15, paso 4b). La identidad se edita en un solo lugar, el
 * padrón, pero un equipo con perfil sigue las reglas de Mantención: marca de la lista cerrada,
 * «Sin patente» y un tipo medido en la misma unidad cuando ya tiene registros o una pauta. El
 * servidor las vuelve a exigir (`resolveFleetIdentity`); esto sólo evita ofrecer lo que rechazaría.
 */
export interface PadronMaintenance {
  /** Marca del perfil, de la lista cerrada de Mantención. */
  brandId: string
  noPlate: boolean
  /** Unidad en que se mide hoy (la de su tipo). */
  unit: MantUnit
  /** Por qué no puede pasar a un tipo de otra unidad; `null` si puede. */
  unitFixedBy: { kind: "registros" } | { kind: "pauta"; scheduleName: string } | null
  /** `mant:equipment:manage` en su faena: puede cambiar la marca y «Sin patente». */
  canChangeProfile: boolean
}

/** Marca de la lista de Mantención; una inactiva sólo se ofrece al equipo que ya la tiene. */
export interface PadronBrandOption {
  id: string
  name: string
  isActive: boolean
}

/** La unidad de Mantención de un tipo de equipo, por su medidor; `null` si no se mide en km ni en horas. */
export function maintenanceUnitOfMeter(meterType: string): MantUnit | null {
  if (meterType === "odometer") return "km"
  if (meterType === "hour_meter") return "h"
  return null
}

/**
 * Por qué no se puede elegir un tipo para un equipo de Mantención, o `null` si se puede. Lo usa
 * el selector de tipo del padrón para deshabilitar las opciones que el servidor rechazaría.
 */
export function maintenanceTypeBlock(maintenance: PadronMaintenance, typeMeter: string): string | null {
  const unit = maintenanceUnitOfMeter(typeMeter)
  if (!unit) return "no se mide en km ni en horas"
  if (unit !== maintenance.unit && maintenance.unitFixedBy) return unit === "km" ? "se mide en km" : "se mide en horas"
  return null
}
