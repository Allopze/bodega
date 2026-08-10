import { describe, expect, it } from "vitest"
import { DELIVERY_PRINT_STYLES } from "./delivery-print-styles"

describe("DELIVERY_PRINT_STYLES", () => {
  it("keeps document identifiers indivisible in the A4 layout", () => {
    expect(DELIVERY_PRINT_STYLES).toContain("@page { size: A4; margin: 12mm 14mm 20mm; }")
    expect(DELIVERY_PRINT_STYLES).toContain(".delivery-sheet .field dd.document-value-nowrap { white-space: nowrap; }")
  })
})
