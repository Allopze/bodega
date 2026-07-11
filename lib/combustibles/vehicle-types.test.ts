import { describe, expect, it } from "vitest"
import { canonicalFuelVehicleType, formatFuelVehicleType } from "./validation"

describe("fuel vehicle type catalog", () => {
  it("maps safe legacy aliases to canonical types", () => {
    expect(canonicalFuelVehicleType("Tractocamión")).toBe("tracto")
    expect(canonicalFuelVehicleType("mini cargador")).toBe("minicargador")
  })

  it("keeps unknown legacy values editable", () => {
    expect(canonicalFuelVehicleType("maquina industrial")).toBeNull()
    expect(formatFuelVehicleType("maquina industrial")).toBe("maquina industrial")
  })
})
