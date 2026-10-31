import { describe, expect, it } from "vitest"
import { LOADING_POINT_TYPE_LABELS } from "@/lib/combustibles/control/contracts"
import { activeLinksByPoint, LOADING_POINT_TYPE_CHOICES, loadingPointTypeLabel } from "./point-types"

describe("tipos de punto de carga", () => {
  it("el legado «tae» se dice por su nombre completo, sin la sigla", () => {
    expect(loadingPointTypeLabel("tae")).toBe("Tarjeta Copec de abastecimiento")
    expect(loadingPointTypeLabel("fixed_dispenser")).toBe("Surtidor fijo")
    expect(loadingPointTypeLabel("algo_nuevo")).toBe("Otro")
  })

  it("al crear un punto sólo se ofrecen los tipos vigentes, no los legados", () => {
    expect(LOADING_POINT_TYPE_CHOICES).not.toContain("tae")
    expect(LOADING_POINT_TYPE_CHOICES).not.toContain("other")
    for (const type of LOADING_POINT_TYPE_CHOICES) expect(LOADING_POINT_TYPE_LABELS[type]).toBeDefined()
    for (const type of LOADING_POINT_TYPE_CHOICES) expect(loadingPointTypeLabel(type)).not.toMatch(/\bTAE\b/)
  })
})

describe("enlaces vigentes por punto", () => {
  it("cuenta sólo los no revocados y los que tienen punto", () => {
    const counts = activeLinksByPoint([
      { loadingPointId: "p1", revokedAt: null },
      { loadingPointId: "p1", revokedAt: null },
      { loadingPointId: "p1", revokedAt: "2026-10-01T10:00:00.000Z" },
      { loadingPointId: "p2", revokedAt: "2026-10-01T10:00:00.000Z" },
      { loadingPointId: null, revokedAt: null },
    ])
    expect(counts.get("p1")).toBe(2)
    expect(counts.has("p2")).toBe(false)
    expect(counts.size).toBe(1)
  })
})
