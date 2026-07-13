import { describe, expect, it } from "vitest"
import {
  createFuelVehicleSchema,
  fuelEquipmentTypeIdForLegacy,
  fuelEquipmentTypeSlug,
  fuelEquipmentTypeSchema,
  fuelMetricDefaultsForLegacy,
} from "./validation"

describe("equipment type normalization", () => {
  it("maps known aliases to canonical catalog ids", () => {
    expect(fuelEquipmentTypeIdForLegacy("Tractocamión")).toBe("fet-tracto")
    expect(fuelEquipmentTypeIdForLegacy("Mini cargador")).toBe("fet-minicargador")
  })

  it("uses the reviewable fallback for unknown legacy values", () => {
    expect(fuelEquipmentTypeIdForLegacy("Máquina especial X")).toBe("fet-other")
    expect(fuelEquipmentTypeSlug("Máquina especial X")).toBe("maquina-especial-x")
  })

  it("derives compatible metric defaults without mixing units", () => {
    expect(fuelMetricDefaultsForLegacy("camioneta")).toEqual({ meterType: "odometer", performanceUnit: "km_per_liter" })
    expect(fuelMetricDefaultsForLegacy("excavadora")).toEqual({ meterType: "hour_meter", performanceUnit: "liters_per_hour" })
  })
})
describe("equipment metric validation", () => {
  it("rejects incompatible catalog defaults", () => {
    const result = fuelEquipmentTypeSchema.safeParse({ name: "Excavadora", category: "heavy", defaultMeterType: "odometer", defaultPerformanceUnit: "liters_per_hour", sortOrder: 1 })
    expect(result.success).toBe(false)
  })

  it("rejects km/L when a vehicle does not use an odometer", () => {
    const result = createFuelVehicleSchema.safeParse({
      plate: "AA-BB-11",
      equipmentTypeId: "fet-camioneta",
      meterType: "hour_meter",
      performanceUnit: "km_per_liter",
      worksiteId: "ws-1",
      operatingTimezone: "America/Santiago",
    })
    expect(result.success).toBe(false)
  })
})
