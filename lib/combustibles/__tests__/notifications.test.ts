import { describe, it, expect } from "vitest"
import { previousMonth } from "../notifications"

describe("previousMonth", () => {
  it("no desborda los días 29-31 (setMonth devolvía el mes en curso)", () => {
    // 2026-03-29/30/31 daban "2026-03"; may/jul/oct/dic daban su propio mes.
    expect(previousMonth(2026, 3)).toBe("2026-02")
    expect(previousMonth(2026, 5)).toBe("2026-04")
    expect(previousMonth(2026, 7)).toBe("2026-06")
    expect(previousMonth(2026, 10)).toBe("2026-09")
    expect(previousMonth(2026, 12)).toBe("2026-11")
  })

  it("cruza el año hacia atrás", () => {
    expect(previousMonth(2026, 1)).toBe("2025-12")
  })
})
