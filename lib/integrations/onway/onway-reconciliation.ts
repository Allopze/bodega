import type { OnwayDeviceSnapshot } from "./onway-contract"

interface FleetVehicleIdentity {
  id: string
  plate: string
  worksiteId: string
}

function normalizedPlate(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
}

export function reconcileOnwayDevices(devices: OnwayDeviceSnapshot[], vehicles: FleetVehicleIdentity[]) {
  const vehiclesByPlate = new Map<string, FleetVehicleIdentity[]>()
  for (const vehicle of vehicles) {
    const key = normalizedPlate(vehicle.plate)
    vehiclesByPlate.set(key, [...(vehiclesByPlate.get(key) ?? []), vehicle])
  }

  const ambiguousNormalizedPlates = [...vehiclesByPlate.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([plate]) => plate)
    .sort()
  const ambiguous = new Set(ambiguousNormalizedPlates)
  const matched: Array<{ device: OnwayDeviceSnapshot; vehicleId: string; worksiteId: string }> = []
  const unmatched: OnwayDeviceSnapshot[] = []

  for (const device of devices) {
    const candidates = vehiclesByPlate.get(device.normalizedPlate) ?? []
    if (candidates.length !== 1 || ambiguous.has(device.normalizedPlate)) {
      unmatched.push(device)
      continue
    }
    matched.push({ device, vehicleId: candidates[0]!.id, worksiteId: candidates[0]!.worksiteId })
  }

  return { matched, unmatched, ambiguousNormalizedPlates }
}
