import { describe, expect, it } from "vitest"
import { defaultMaintenanceUnit, effectiveMaintenanceUnit, parseMaintenanceUnit } from "./equipment-unit"

describe("defaultMaintenanceUnit", () => {
  it("nace con la unidad de su tipo: odómetro en km, horómetro en horas", () => {
    expect(defaultMaintenanceUnit({ typeMeterType: "odometer" })).toBe("km")
    expect(defaultMaintenanceUnit({ typeMeterType: "hour_meter" })).toBe("h")
  })

  it("un tipo que no se mide en km ni en horas no tiene unidad", () => {
    expect(defaultMaintenanceUnit({ typeMeterType: "none" })).toBeNull()
  })
})

describe("parseMaintenanceUnit", () => {
  it("sólo km y h son unidades de Mantención", () => {
    expect(parseMaintenanceUnit("km")).toBe("km")
    expect(parseMaintenanceUnit("h")).toBe("h")
    for (const value of ["", "KM", "mi", "horas", null, undefined]) expect(parseMaintenanceUnit(value)).toBeNull()
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
