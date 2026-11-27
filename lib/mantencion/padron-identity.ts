import { maintenanceUnitOfMeter } from "./equipment-unit"
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
  /** Unidad efectiva del equipo: la fijada en su perfil o, si no tiene, la de su tipo. */
  unit: MantUnit
  /**
   * Unidad de su tipo actual (la de su medidor), que puede ser otra que `unit` si se eligió al darlo de alta. Con
   * ella un cambio a un tipo que mide como el actual no se bloquea: la unidad del equipo no se mueve. `undefined` si
   * quien arma esto no la trae (entonces se compara sólo con `unit`).
   */
  typeUnit?: MantUnit | null
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

/** Tipo de equipo tal como lo ofrece el selector del padrón. */
export interface PadronTypeOption {
  /** Medidor del tipo (`fuel_equipment_types.default_meter_type`). */
  defaultMeterType: string
}

/** Se sigue exportando desde aquí: lo usan el padrón, el servidor y sus pruebas. */
export { maintenanceUnitOfMeter }

/**
 * Por qué no se puede elegir un tipo para un equipo de Mantención, o `null` si se puede. La unidad del equipo ya
 * no depende de su faena (2026-11-26): sólo se bloquea un tipo que no se mide, o uno que mide distinto que el
 * actual y distinto del equipo cuando éste está fijado a su unidad (registros o pauta). Un tipo que mide igual
 * que el actual nunca se bloquea: no mueve la unidad del equipo, aunque éste se haya dado de alta en otra. Lo usa
 * el selector de tipo del padrón para deshabilitar las opciones que el servidor rechazaría.
 */
export function maintenanceTypeBlock(maintenance: PadronMaintenance, type: PadronTypeOption): string | null {
  const unit = maintenanceUnitOfMeter(type.defaultMeterType)
  if (!unit) return "no se mide en km ni en horas"
  if (!maintenance.unitFixedBy || unit === maintenance.unit) return null
  if (maintenance.typeUnit !== undefined && unit === maintenance.typeUnit) return null
  return unit === "km" ? "se mide en km" : "se mide en horas"
}
