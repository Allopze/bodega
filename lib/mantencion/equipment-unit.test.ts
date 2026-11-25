import { describe, expect, it } from "vitest"
import { defaultMaintenanceUnit, effectiveMaintenanceUnit, meterDefaultsOfUnit } from "./equipment-unit"

describe("defaultMaintenanceUnit", () => {
  const truck = { typeMeterType: "odometer", typeFamily: "camiones" }

  it("un camión o tracto de producción mide en horas aunque su tipo sea de odómetro", () => {
    expect(defaultMaintenanceUnit({ ...truck, worksiteCode: "SANTA-FE" })).toBe("h")
    expect(defaultMaintenanceUnit({ ...truck, worksiteCode: "FA-007" })).toBe("h")
  })

  it("un camión sin faena resuelta (vista previa de una importación) mide en horas", () => {
    expect(defaultMaintenanceUnit({ ...truck, worksiteCode: null })).toBe("h")
  })

  it("un camión de Biodiversa mide en kilómetros, sin importar mayúsculas", () => {
    expect(defaultMaintenanceUnit({ ...truck, worksiteCode: "BIODIVERSA" })).toBe("km")
    expect(defaultMaintenanceUnit({ ...truck, worksiteCode: "biodiversa" })).toBe("km")
  })

  it("los demás tipos miden como su tipo, también en Biodiversa", () => {
    expect(defaultMaintenanceUnit({ typeMeterType: "odometer", typeFamily: "cargadores_camionetas", worksiteCode: "SANTA-FE" })).toBe("km")
    expect(defaultMaintenanceUnit({ typeMeterType: "hour_meter", typeFamily: "maquinaria", worksiteCode: "BIODIVERSA" })).toBe("h")
    expect(defaultMaintenanceUnit({ typeMeterType: "odometer", typeFamily: null, worksiteCode: "SANTA-FE" })).toBe("km")
  })

  it("un tipo que no se mide en km ni en horas no tiene unidad", () => {
    expect(defaultMaintenanceUnit({ typeMeterType: "none", typeFamily: "camiones", worksiteCode: "SANTA-FE" })).toBeNull()
  })
})

describe("effectiveMaintenanceUnit", () => {
  it("manda la unidad fijada en el perfil", () => {
    expect(effectiveMaintenanceUnit("h", "odometer")).toBe("h")
    expect(effectiveMaintenanceUnit("km", "hour_meter")).toBe("km")
  })

  it("sin unidad fijada vale la del tipo", () => {
    expect(effectiveMaintenanceUnit(null, "odometer")).toBe("km")
    expect(effectiveMaintenanceUnit(undefined, "hour_meter")).toBe("h")
    expect(effectiveMaintenanceUnit(null, "none")).toBeNull()
  })

  it("ignora un valor que no es km ni h", () => {
    expect(effectiveMaintenanceUnit("mi", "odometer")).toBe("km")
  })
})

describe("meterDefaultsOfUnit", () => {
  it("lleva la unidad al medidor y rendimiento de Combustible", () => {
    expect(meterDefaultsOfUnit("km")).toEqual({ meterType: "odometer", performanceUnit: "km_per_liter" })
    expect(meterDefaultsOfUnit("h")).toEqual({ meterType: "hour_meter", performanceUnit: "liters_per_hour" })
  })
})
