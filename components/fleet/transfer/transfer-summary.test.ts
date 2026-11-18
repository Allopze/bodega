import { describe, expect, it } from "vitest"
import type { TransferCandidate } from "@/lib/services/fleet-transfers"
import { transferRowNotes, transferSummaryText } from "./transfer-summary"

const candidate = (patch: Partial<TransferCandidate> = {}): TransferCandidate => ({
  vehicleId: "v1", code: "KA-71", plate: "CBJY-18", typeName: "Camión", brand: "Scania",
  worksiteId: "ws-a", worksiteName: "Santa Fe", stayStartedOn: null,
  openWorkOrderFolio: null, providerMappingCount: 0, ...patch,
})

describe("transferSummaryText", () => {
  it("sin equipos marcados pide marcarlos", () => {
    expect(transferSummaryText(0, "Mininco", "2026-11-15")).toBe("Marca los equipos que se trasladan.")
    expect(transferSummaryText(0, null, "2026-11-15")).toBe("Marca los equipos que se trasladan.")
  })

  it("dice cuántos pasan, adónde y desde cuándo, en singular y plural", () => {
    expect(transferSummaryText(1, "Mininco", "2026-11-15")).toBe("1 equipo pasa a Mininco desde el 15-11-2026")
    expect(transferSummaryText(3, "Mininco", "2026-11-15")).toBe("3 equipos pasan a Mininco desde el 15-11-2026")
  })

  it("sin destino elegido lo pide en vez de inventar una faena", () => {
    expect(transferSummaryText(2, null, "2026-11-15")).toBe("2 equipos por trasladar · elige la faena de destino")
  })
})

describe("transferRowNotes", () => {
  it("siempre dice de qué faena sale", () => {
    expect(transferRowNotes(candidate(), "Mininco", "2026-11-15")).toEqual(["Sale de Santa Fe"])
  })

  it("avisa que la OT abierta se queda en la faena de origen", () => {
    expect(transferRowNotes(candidate({ openWorkOrderFolio: "OT-123" }), "Mininco", "2026-11-15")).toEqual([
      "Sale de Santa Fe",
      "Tiene la OT-123 abierta en Santa Fe: la OT se queda en Santa Fe",
    ])
  })

  it("avisa que la asignación Copec pasa al destino desde la fecha del traslado", () => {
    expect(transferRowNotes(candidate({ providerMappingCount: 2 }), "Mininco", "2026-11-15")).toEqual([
      "Sale de Santa Fe",
      "Tiene asignación Copec: pasa a Mininco desde el 15-11-2026",
    ])
  })

  it("con OT y Copec lleva las tres notas, en ese orden", () => {
    expect(transferRowNotes(candidate({ openWorkOrderFolio: "OT-9", providerMappingCount: 1 }), "Mininco", "2026-11-15")).toHaveLength(3)
  })
})
