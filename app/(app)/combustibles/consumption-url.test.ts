import { describe, expect, it } from "vitest"
import { buildConsumptionHref } from "./consumption-url"

describe("buildConsumptionHref", () => {
  it("keeps the full analysis context when a filter changes and returns to page one", () => {
    expect(buildConsumptionHref(
      "desde=2026-06-01&hasta=2026-06-30&faena=faena-1&page=3",
      { patente: "ABCD12" },
    )).toBe("/combustibles?desde=2026-06-01&hasta=2026-06-30&faena=faena-1&patente=ABCD12")
  })

  it("removes a cleared filter without losing the remaining context", () => {
    expect(buildConsumptionHref(
      "desde=2026-06-01&hasta=2026-06-30&faena=faena-1&patente=ABCD12",
      { patente: "" },
    )).toBe("/combustibles?desde=2026-06-01&hasta=2026-06-30&faena=faena-1")
  })

  it("keeps every selected filter when pagination changes", () => {
    expect(buildConsumptionHref(
      "desde=2026-06-01&hasta=2026-06-30&faena=faena-1&asociacion=no",
      { page: "2" },
      { resetPage: false },
    )).toBe("/combustibles?desde=2026-06-01&hasta=2026-06-30&faena=faena-1&asociacion=no&page=2")
  })
})
