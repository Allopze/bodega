import { describe, expect, it } from "vitest"
import { RISK_QUICK_FILTERS, RISK_QUICK_FILTER_LABELS, isRiskQuickFilter } from "./risk-list-filters"

describe("risk-list-filters", () => {
  it("todo filtro rápido salvo 'all' tiene etiqueta en español", () => {
    for (const filter of RISK_QUICK_FILTERS) {
      if (filter === "all") continue
      expect(RISK_QUICK_FILTER_LABELS[filter]).toBeTruthy()
    }
  })

  it("isRiskQuickFilter reconoce sólo valores del catálogo", () => {
    expect(isRiskQuickFilter("intolerable")).toBe(true)
    expect(isRiskQuickFilter("no-existe")).toBe(false)
    expect(isRiskQuickFilter(null)).toBe(false)
    expect(isRiskQuickFilter(undefined)).toBe(false)
  })
})
