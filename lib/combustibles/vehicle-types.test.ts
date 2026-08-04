import { describe, expect, it } from "vitest"
import { canonicalFuelVehicleType, formatFuelVehicleStatus, formatFuelVehicleType } from "./validation"

describe("fuel vehicle type catalog", () => {
  it("maps safe legacy aliases to canonical types", () => {
    expect(canonicalFuelVehicleType("Tractocamión")).toBe("tracto")
    expect(canonicalFuelVehicleType("mini cargador")).toBe("minicargador")
  })

  it("keeps unknown legacy values editable", () => {
    expect(canonicalFuelVehicleType("maquina industrial")).toBeNull()
    expect(formatFuelVehicleType("maquina industrial")).toBe("maquina industrial")
  })

  it("uses business labels for operational status without exposing unknown enums", () => {
    expect(formatFuelVehicleStatus("mantencion")).toBe("En mantención")
    expect(formatFuelVehicleStatus("legacy_pending_review")).toBe("Estado operacional no reconocido")
    expect(formatFuelVehicleStatus(null)).toBe("Sin estado operacional")
  })
})
