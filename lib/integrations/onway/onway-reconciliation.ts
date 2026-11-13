import type { OnwayDeviceSnapshot } from "./onway-contract"
import { normalizePlate } from "@/lib/integrations/fleet-gps/identity"

interface FleetVehicleIdentity {
  id: string
  plate: string
  worksiteId: string
}

/** Vínculo manual de `fleet_gps_device_links` para un equipo de OnWay. */
export interface OnwayDeviceLink {
  status: "linked" | "excluded"
  vehicleId: string | null
}

/**
 * Cruza los equipos del portal con la flota. Orden de decisión por equipo:
 * 1. vínculo manual `excluded`: queda sin vehículo y NO cuenta como pendiente;
 * 2. vínculo manual `linked` a un vehículo que existe: manda sobre la patente;
 * 3. patente normalizada, sólo si es única en el catálogo.
 * Un vínculo `linked` a un vehículo que ya no existe se ignora y cae a la patente.
 */
export function reconcileOnwayDevices(
  devices: OnwayDeviceSnapshot[],
  vehicles: FleetVehicleIdentity[],
  links: ReadonlyMap<string, OnwayDeviceLink> = new Map(),
) {
  const vehiclesByPlate = new Map<string, FleetVehicleIdentity[]>()
  const vehiclesById = new Map<string, FleetVehicleIdentity>()
  for (const vehicle of vehicles) {
    const key = normalizePlate(vehicle.plate)
    vehiclesByPlate.set(key, [...(vehiclesByPlate.get(key) ?? []), vehicle])
    vehiclesById.set(vehicle.id, vehicle)
  }

  const ambiguousNormalizedPlates = [...vehiclesByPlate.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([plate]) => plate)
    .sort()
  const ambiguous = new Set(ambiguousNormalizedPlates)
  const matched: Array<{ device: OnwayDeviceSnapshot; vehicleId: string; worksiteId: string }> = []
  const unmatched: OnwayDeviceSnapshot[] = []
  const excluded: OnwayDeviceSnapshot[] = []

  for (const device of devices) {
    const link = links.get(device.externalDeviceId)
    if (link?.status === "excluded") {
      excluded.push(device)
      continue
    }
    const linkedVehicle = link?.status === "linked" && link.vehicleId ? vehiclesById.get(link.vehicleId) : undefined
    if (linkedVehicle) {
      matched.push({ device, vehicleId: linkedVehicle.id, worksiteId: linkedVehicle.worksiteId })
      continue
    }
    const candidates = vehiclesByPlate.get(device.normalizedPlate) ?? []
    if (candidates.length !== 1 || ambiguous.has(device.normalizedPlate)) {
      unmatched.push(device)
      continue
    }
    matched.push({ device, vehicleId: candidates[0]!.id, worksiteId: candidates[0]!.worksiteId })
  }

  return { matched, unmatched, excluded, ambiguousNormalizedPlates }
}
