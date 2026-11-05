/**
 * Resolución patente→vehículo/faena con vigencia histórica.
 *
 * Los mappings de proveedor son la evidencia temporal. Una fila histórica sin
 * mapping vigente queda sin asignar en vez de heredar la faena actual del
 * vehículo. Para el período en curso se conserva el padrón como fallback, que
 * es la única asignación vigente disponible cuando aún no hay historial.
 */

import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelProviderMappings } from "@/db/schema"
import { plateMatchKey } from "@/lib/combustibles/xlsx-utils"
import { todayInChile } from "@/lib/utils"

export interface ResolvedVehicle {
  id: string
  plate: string
  worksiteId: string
  /** 'odometer' | 'hour_meter' | 'none'. */
  meterType: string
}

export interface DatedProviderVehicleMapping {
  externalKey: string
  vehicleId: string | null
  worksiteId: string
  effectiveFrom: string
  effectiveTo: string | null
  isActive: boolean
  version: number
}

export type VehicleResolver = (plate: string, effectiveFrom?: string, effectiveTo?: string) => ResolvedVehicle | undefined

/**
 * Si la patente es de la flota: un vehículo con esa patente (activo o dado de
 * baja) o una patente del proveedor vinculada a mano a un vehículo. Separa
 * «vehículo propio sin asignación para ese mes», que es trabajo pendiente, de
 * «vehículo ajeno», que no cuenta.
 */
export type FleetPlateCheck = (plate: string) => boolean

/** Motivo con que queda en el ledger una carga de una patente fuera de la flota. */
export const NOT_IN_FLEET = {
  code: "not_in_fleet",
  message: "La patente no está en la flota: la carga no se cuenta. Si es un vehículo propio, agrégalo a la flota y vuelve a sincronizar ese mes.",
} as const

export function createFleetPlateCheck(vehicles: Pick<ResolvedVehicle, "plate">[], mappings: Pick<DatedProviderVehicleMapping, "externalKey" | "vehicleId">[]): FleetPlateCheck {
  const keys = new Set([
    ...vehicles.map((vehicle) => plateMatchKey(vehicle.plate)),
    ...mappings.filter((mapping) => mapping.vehicleId).map((mapping) => plateMatchKey(mapping.externalKey)),
  ])
  return (plate) => keys.has(plateMatchKey(plate))
}

/** Pure resolver, exported so historical cutoffs can be regression tested. */
export function createVehicleResolver(
  vehicles: ResolvedVehicle[],
  mappings: DatedProviderVehicleMapping[],
  currentMonth: string,
): VehicleResolver {
  const byPlateKey = new Map(vehicles.map((vehicle) => [plateMatchKey(vehicle.plate), vehicle]))
  const byVehicleId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))
  const byMappedPlate = new Map<string, DatedProviderVehicleMapping[]>()
  for (const mapping of mappings) {
    const key = plateMatchKey(mapping.externalKey)
    byMappedPlate.set(key, [...(byMappedPlate.get(key) ?? []), mapping])
  }

  return (plate, effectiveFrom, effectiveTo) => {
    const key = plateMatchKey(plate)
    const plateMappings = byMappedPlate.get(key) ?? []
    if (effectiveFrom) {
      const through = effectiveTo ?? effectiveFrom
      const applicable = plateMappings
        .filter((mapping) => mapping.effectiveFrom <= effectiveFrom && (!mapping.effectiveTo || mapping.effectiveTo >= through))
        .sort((left, right) => right.version - left.version)[0]
      if (applicable) {
        const vehicle = applicable.vehicleId ? byVehicleId.get(applicable.vehicleId) : undefined
        return vehicle ? { ...vehicle, worksiteId: applicable.worksiteId } : undefined
      }

      // A period aggregate that crosses a reassignment cannot be attributed to
      // one faena. Historical rows without dated evidence stay unresolved.
      if (plateMappings.length || effectiveFrom < currentMonth) return undefined
    } else {
      const active = plateMappings
        .filter((mapping) => mapping.isActive)
        .sort((left, right) => right.version - left.version)[0]
      if (active) {
        const vehicle = active.vehicleId ? byVehicleId.get(active.vehicleId) : undefined
        return vehicle ? { ...vehicle, worksiteId: active.worksiteId } : undefined
      }
    }
    return byPlateKey.get(key)
  }
}

/**
 * Carga el padrón y las asignaciones del proveedor para una cuenta.
 *
 * C3 / 4.3: `inFleet` se arma con TODOS los mappings del proveedor, no sólo con
 * los de la cuenta que se está sincronizando. Un vínculo manual hecho desde el
 * lote de Diésel (`tct:diesel`) describe la misma patente que aparece en el
 * informe de BlueMax (`tct:bluemax`): acotado a la cuenta, BlueMax la veía como
 * `not_in_fleet`, no la contaba y tampoco la dejaba pendiente —el mes podía
 * cerrarse «completo» con litros faltantes—. La ASIGNACIÓN (`resolveVehicle`)
 * sí sigue siendo por cuenta: es la evidencia temporal de esa fuente.
 */
export async function loadVehicleResolver(
  mapping: { provider: "copec"; sourceAccount: string },
): Promise<VehicleResolver & { inFleet: FleetPlateCheck }> {
  const [vehicles, mappings, providerMappings] = await Promise.all([
    db.query.fuelVehicles.findMany({ columns: { id: true, plate: true, worksiteId: true, meterType: true } }),
    db.query.fuelProviderMappings.findMany({
      where: and(
        eq(fuelProviderMappings.provider, mapping.provider),
        eq(fuelProviderMappings.sourceAccount, mapping.sourceAccount),
      ),
      columns: { externalKey: true, vehicleId: true, worksiteId: true, effectiveFrom: true, effectiveTo: true, isActive: true, version: true },
    }),
    // Sólo para el chequeo de flota: patente ↔ vehículo del proveedor, sin importar la cuenta.
    db.query.fuelProviderMappings.findMany({
      where: eq(fuelProviderMappings.provider, mapping.provider),
      columns: { externalKey: true, vehicleId: true },
    }),
  ])
  const currentMonth = `${todayInChile().slice(0, 7)}-01`
  return Object.assign(createVehicleResolver(vehicles, mappings, currentMonth), { inFleet: createFleetPlateCheck(vehicles, providerMappings) })
}
