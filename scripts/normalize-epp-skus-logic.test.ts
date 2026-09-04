import { describe, expect, it } from "vitest"
import { buildSequentialSkuMap } from "./normalize-epp-skus-logic"

describe("normalizador de SKUs", () => {
  it("salta SKUs conservados por productos fuera del conjunto activo", () => {
    const rows = Array.from({ length: 74 }, (_, index) => ({
      id: `active-${index + 1}`,
      name: `Producto ${String(index + 1).padStart(3, "0")}`,
      prefix: "EPP" as const,
      oldSku: `legacy-${index + 1}`,
    }))

    const assignments = buildSequentialSkuMap({
      rows,
      existingProducts: [
        { id: "inactive-072", sku: "EPP-072" },
        { id: "inactive-073", sku: "EPP-073" },
      ],
    })

    expect(assignments.find((row) => row.id === "active-72")?.newSku).toBe("EPP-074")
    expect(assignments.find((row) => row.id === "active-73")?.newSku).toBe("EPP-075")
    expect(assignments.map((row) => row.newSku)).not.toContain("EPP-072")
    expect(assignments.map((row) => row.newSku)).not.toContain("EPP-073")
    expect(new Set(assignments.map((row) => row.newSku)).size).toBe(assignments.length)
  })

  it("no reserva los SKUs actuales de productos que sí se renumerarán", () => {
    const assignments = buildSequentialSkuMap({
      rows: [
        { id: "active-a", name: "A", prefix: "EPP", oldSku: "EPP-002" },
        { id: "active-b", name: "B", prefix: "EPP", oldSku: "EPP-001" },
      ],
      existingProducts: [
        { id: "active-a", sku: "EPP-002" },
        { id: "active-b", sku: "EPP-001" },
      ],
    })

    expect(assignments.map((row) => row.newSku)).toEqual(["EPP-001", "EPP-002"])
  })
})
