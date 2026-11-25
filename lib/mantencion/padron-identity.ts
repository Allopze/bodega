import { defaultMaintenanceUnit, TRUCK_PERFORMANCE_FAMILY } from "./equipment-unit"
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
  /**
   * Familia de rendimiento del tipo: con `camiones`, la unidad depende de la faena. `undefined` si el
   * catálogo que llegó no la trae (entonces no se sabe qué unidad le toca y el servidor decide).
   */
  performanceFamily?: string | null
}

/** La unidad de Mantención de un tipo de equipo, por su medidor; `null` si no se mide en km ni en horas. */
export function maintenanceUnitOfMeter(meterType: string): MantUnit | null {
  if (meterType === "odometer") return "km"
  if (meterType === "hour_meter") return "h"
  return null
}

/**
 * Por qué no se puede elegir un tipo para un equipo de Mantención, o `null` si se puede. Compara la
 * unidad que tendría ese tipo EN LA FAENA del equipo (un camión de Biodiversa mide en km; los demás
 * camiones y tractocamiones, en horas) con la unidad del equipo, y bloquea sólo si el equipo está
 * fijado a su unidad (registros o pauta). `worksiteCode` es el código de la faena del equipo;
 * `undefined` si el catálogo no lo trae. Lo usa el selector de tipo del padrón para deshabilitar las
 * opciones que el servidor rechazaría.
 */
export function maintenanceTypeBlock(maintenance: PadronMaintenance, type: PadronTypeOption, worksiteCode: string | null | undefined): string | null {
  if (!maintenanceUnitOfMeter(type.defaultMeterType)) return "no se mide en km ni en horas"
  if (type.performanceFamily === undefined) return null
  if (type.performanceFamily === TRUCK_PERFORMANCE_FAMILY && worksiteCode === undefined) return null
  const unit = defaultMaintenanceUnit({ typeMeterType: type.defaultMeterType, typeFamily: type.performanceFamily, worksiteCode: worksiteCode ?? null })
  if (!unit) return "no se mide en km ni en horas"
  if (!maintenance.unitFixedBy || unit === maintenance.unit) return null
  return unit === "km" ? "se mide en km" : "se mide en horas"
}
