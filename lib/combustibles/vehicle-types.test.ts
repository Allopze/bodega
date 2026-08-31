import { describe, expect, it } from "vitest"
import {
  canonicalFuelVehicleType,
  formatFuelImportBatchStatus,
  formatFuelVehicleStatus,
  formatFuelVehicleType,
} from "./validation"

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

describe("fuel import batch status", () => {
  it("labels known batch states in Spanish", () => {
    expect(formatFuelImportBatchStatus("importado")).toBe("Importado")
    expect(formatFuelImportBatchStatus("revertido")).toBe("Revertido")
  })

  it("collapses empty / missing states to the synthetic 'sin ejecución' label", () => {
    expect(formatFuelImportBatchStatus(null)).toBe("Sin ejecución visible")
    expect(formatFuelImportBatchStatus(undefined)).toBe("Sin ejecución visible")
    expect(formatFuelImportBatchStatus("sin_ejecucion")).toBe("Sin ejecución visible")
  })

  it("does not surface unknown enums as raw text", () => {
    expect(formatFuelImportBatchStatus("legacy_pending_review")).toBe("Estado no reconocido")
  })
})
