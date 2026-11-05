import { describe, expect, it } from "vitest"
import {
  createFuelVehicleSchema,
  fuelEquipmentTypeIdForLegacy,
  fuelEquipmentTypeSlug,
  fuelEquipmentTypeSchema,
  fuelMetricDefaultsForLegacy,
  updateFuelVehicleSchema,
  updateVehicleExpiriesSchema,
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

describe("combustible compatible según el medidor", () => {
  const base = {
    plate: "PWTD-82",
    equipmentTypeId: "fet-carro",
    worksiteId: "ws-1",
    operatingTimezone: "America/Santiago",
  }
  const sinMedidor = { ...base, meterType: "none", performanceUnit: "not_applicable" }
  const conOdometro = { ...base, meterType: "odometer", performanceUnit: "km_per_liter" }

  it("un carro o una batea (sin medidor) es válido sin productos compatibles", () => {
    expect(createFuelVehicleSchema.safeParse({ ...sinMedidor, compatibleProductIds: [] }).success).toBe(true)
  })

  it("un equipo con medidor sigue exigiendo al menos un producto, y el error cuelga del campo", () => {
    const result = createFuelVehicleSchema.safeParse({ ...conOdometro, compatibleProductIds: [] })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.flatten().fieldErrors.compatibleProductIds?.[0]).toBe("Selecciona al menos un producto compatible")
    expect(createFuelVehicleSchema.safeParse({ ...conOdometro, compatibleProductIds: ["fuel-diesel"] }).success).toBe(true)
  })

  it("al editar rige lo mismo cuando el formulario informa el medidor", () => {
    expect(updateFuelVehicleSchema.safeParse({ id: "v1", ...sinMedidor, compatibleProductIds: [] }).success).toBe(true)
    expect(updateFuelVehicleSchema.safeParse({ id: "v1", ...conOdometro, compatibleProductIds: [] }).success).toBe(false)
    // Sin medidor en la entrada no se sabe si lo tiene: lo resuelve la acción con lo guardado.
    expect(updateFuelVehicleSchema.safeParse({ id: "v1", compatibleProductIds: [] }).success).toBe(true)
  })
})

describe("campos de vehículo que se pueden borrar", () => {
  const sinMedidor = {
    plate: "PWTD-82", equipmentTypeId: "fet-carro", worksiteId: "ws-1", operatingTimezone: "America/Santiago",
    meterType: "none", performanceUnit: "not_applicable", compatibleProductIds: [],
  }

  it("vacío es null (quitar el dato) y ausente es undefined (no tocar)", () => {
    const result = updateFuelVehicleSchema.parse({ id: "v1", ...sinMedidor, code: "", soapExpiresAt: "", notes: "  " })
    expect(result.code).toBeNull()
    expect(result.soapExpiresAt).toBeNull()
    expect(result.notes).toBeNull()
    expect(result.brand).toBeUndefined()
    expect(result.insuranceExpiresAt).toBeUndefined()
  })

  it("el texto con contenido se guarda recortado", () => {
    const result = updateFuelVehicleSchema.parse({ id: "v1", ...sinMedidor, code: " KA-90 ", insurancePolicyNumber: " POL-1 " })
    expect(result.code).toBe("KA-90")
    expect(result.insurancePolicyNumber).toBe("POL-1")
  })

  it("las fechas de vencimiento son fechas civiles reales, no cualquier texto", () => {
    for (const bad of ["31-12-2026", "2026-02-31", "2026-13-01", "mañana"]) {
      const result = updateFuelVehicleSchema.safeParse({ id: "v1", ...sinMedidor, technicalReviewExpiresAt: bad })
      expect(result.success, bad).toBe(false)
      if (!result.success) expect(result.error.flatten().fieldErrors.technicalReviewExpiresAt?.[0]).toMatch(/revisión técnica/)
    }
    expect(updateFuelVehicleSchema.safeParse({ id: "v1", ...sinMedidor, technicalReviewExpiresAt: "2027-02-28" }).success).toBe(true)
  })
})

describe("updateVehicleExpiriesSchema (hoja «Actualizar vencimientos»)", () => {
  it("distingue fecha, vacío (quitar) y ausente (no tocar) en cada columna", () => {
    const result = updateVehicleExpiriesSchema.parse({ vehicleId: "veh-1", soapExpiresAt: "2027-03-31", technicalReviewExpiresAt: "" })
    expect(result).toEqual({ vehicleId: "veh-1", soapExpiresAt: "2027-03-31", technicalReviewExpiresAt: null })
    expect(result.circulationPermitExpiresAt).toBeUndefined()
  })

  it("rechaza una fecha imposible con el nombre del documento y exige el vehículo", () => {
    const bad = updateVehicleExpiriesSchema.safeParse({ vehicleId: "veh-1", insuranceExpiresAt: "2026-02-30" })
    expect(bad.success).toBe(false)
    if (!bad.success) expect(bad.error.flatten().fieldErrors.insuranceExpiresAt?.[0]).toMatch(/seguro/)
    expect(updateVehicleExpiriesSchema.safeParse({ vehicleId: " " }).success).toBe(false)
  })
})
