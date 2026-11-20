import { describe, expect, it } from "vitest"
import { blockingSummary, lineIssue, quantityError, reasonError, type ReconciliationLine } from "./guide-reconciliation"

const line = (id: string, name: string, quantity: number, receivedQuantity = 0): ReconciliationLine =>
  ({ id, name, quantity, unitOfMeasure: "unidad", receivedQuantity })

describe("lineIssue", () => {
  const casco = line("casco", "Casco", 6)

  it("la cantidad completa no pide motivo", () => {
    expect(lineIssue(casco, "6", undefined)).toBeNull()
  })

  it("una diferencia sin motivo, o con uno corto, bloquea", () => {
    expect(lineIssue(casco, "4", undefined)).toBe("missing_reason")
    expect(lineIssue(casco, "4", "   ")).toBe("missing_reason")
    expect(lineIssue(casco, "4", "falt")).toBe("short_reason")
    expect(lineIssue(casco, "4", "Faltó una caja")).toBeNull()
  })

  it("no acepta más de lo pendiente ni negativos", () => {
    expect(lineIssue(casco, "7", undefined)).toBe("over_pending")
    expect(lineIssue(casco, "-1", undefined)).toBe("invalid_quantity")
  })

  it("lo ya confirmado descuenta lo pendiente", () => {
    const parcial = line("p", "Pantalón", 2, 2)
    expect(lineIssue(parcial, "0", undefined)).toBeNull()
    expect(lineIssue(parcial, "1", undefined)).toBe("over_pending")
    expect(quantityError(parcial, "over_pending")).toBe("Supera lo pendiente (0 unidad).")
  })

  it("el motivo vacío no se marca en rojo; el corto sí", () => {
    expect(reasonError("missing_reason")).toBeUndefined()
    expect(reasonError("short_reason")).toBe("Escribe al menos 5 caracteres.")
  })
})

describe("blockingSummary", () => {
  // OC-2026-0065: seis líneas, tres no salieron de oficina.
  const lines = [
    line("guante", "Guante Cabritilla", 20),
    line("pantalon", "Pantalón Lightwind", 2),
    line("camisa", "Camisa Absolute Zero", 2),
    line("botin", "Botín V-Flex", 1),
  ]
  const received = { guante: "20", pantalon: "0", camisa: "0", botin: "0" }

  it("con el motivo en una sola línea nombra las que faltan", () => {
    expect(blockingSummary(lines, received, { pantalon: "No fue enviado desde oficina" })).toBe(
      "Falta el motivo de la diferencia (mínimo 5 caracteres) en Camisa Absolute Zero y Botín V-Flex.",
    )
  })

  it("con todos los motivos no hay nada que impida confirmar", () => {
    const reason = "No fue enviado desde oficina"
    expect(blockingSummary(lines, received, { pantalon: reason, camisa: reason, botin: reason })).toBeNull()
  })

  it("separa el motivo de la cantidad y distingue un producto repetido", () => {
    const repeated = [line("a", "Casco", 5), line("b", "Casco", 5), line("c", "Botín", 1)]
    expect(blockingSummary(repeated, { a: "4", b: "6", c: "1" }, {})).toBe(
      "Falta el motivo de la diferencia (mínimo 5 caracteres) en Casco (línea 1). Revisa la cantidad recibida de Casco (línea 2).",
    )
  })
})
