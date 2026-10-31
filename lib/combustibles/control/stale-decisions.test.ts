import { describe, expect, it, vi } from "vitest"

vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))
vi.mock("./projection-series", () => ({ recomputeVehicleSeries: vi.fn() }))

const { seriesFingerprintChanged, STALE_DECISION_REASON } = await import("./stale-decisions")

const base = {
  anchorLoadId: "load-a",
  meterDelta: 300,
  accumulatedLiters: 100,
  performanceValue: 3,
  performanceStatus: "computed",
  duplicateOfId: null,
  flagReasons: ["late_entry"],
}

describe("seriesFingerprintChanged", () => {
  it("una serie idéntica no reabre la decisión", () => {
    expect(seriesFingerprintChanged(base, { ...base })).toBe(false)
    // La tolerancia de los decimales no cuenta como cambio.
    expect(seriesFingerprintChanged(base, { ...base, performanceValue: 3.0000000001 })).toBe(false)
  })

  it("cambia si cambia la carga contra la que se compara o lo que avanzó el medidor", () => {
    expect(seriesFingerprintChanged(base, { ...base, anchorLoadId: "load-new" })).toBe(true)
    expect(seriesFingerprintChanged(base, { ...base, meterDelta: 200 })).toBe(true)
    expect(seriesFingerprintChanged(base, { ...base, accumulatedLiters: 160 })).toBe(true)
    expect(seriesFingerprintChanged(base, { ...base, performanceValue: 2 })).toBe(true)
  })

  it("cambia si la carga pasa a ser (o deja de ser) duplicada, o si cambian sus marcas", () => {
    expect(seriesFingerprintChanged(base, { ...base, duplicateOfId: "load-x" })).toBe(true)
    expect(seriesFingerprintChanged(base, { ...base, performanceStatus: "excluded" })).toBe(true)
    expect(seriesFingerprintChanged(base, { ...base, flagReasons: ["late_entry", "outlier"] })).toBe(true)
    expect(seriesFingerprintChanged({ ...base, performanceValue: null }, { ...base, performanceValue: 3 })).toBe(true)
    expect(seriesFingerprintChanged({ ...base, performanceValue: null }, { ...base, performanceValue: null })).toBe(false)
  })

  it("el motivo auditado dice que se registró una carga anterior", () => {
    expect(STALE_DECISION_REASON.toLowerCase()).toContain("se registró una carga anterior")
  })
})
