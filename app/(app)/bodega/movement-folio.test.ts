import { describe, expect, it } from "vitest"
import { movementFolio } from "./movement-href"

describe("movementFolio", () => {
  it("prefiere el folio del documento de bodega cuando el movimiento nace de uno", () => {
    expect(movementFolio({ documentFolio: "AJU-2026-0012", reason: "Ajuste e2e" })).toBe("AJU-2026-0012")
  })

  it("lo saca del motivo de una entrega o de una guía", () => {
    expect(movementFolio({ reason: "Entrega ENT-2026-0058 a Francisco Antonio" })).toBe("ENT-2026-0058")
    expect(movementFolio({ reason: "Guía GDI-000031 · salida a Biodiversa" })).toBe("GDI-000031")
  })

  it("lo saca de la nota de una recepción", () => {
    expect(movementFolio({ reason: null, notes: "Recepción REC-2026-0054, ingreso en Oficina Central" })).toBe("REC-2026-0054")
  })

  it("sin folio escrito devuelve null en vez de inventar uno", () => {
    expect(movementFolio({ reason: "conteo semanal", notes: null })).toBeNull()
    expect(movementFolio({})).toBeNull()
  })
})
