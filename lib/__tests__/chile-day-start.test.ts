import { describe, expect, it } from "vitest"
import { chileDayStartInstant } from "@/lib/utils"

describe("chileDayStartInstant", () => {
  it("respeta el horario de verano e invierno de Chile", () => {
    expect(chileDayStartInstant("2026-01-15")).toBe("2026-01-15T03:00:00.000Z")
    expect(chileDayStartInstant("2026-06-15")).toBe("2026-06-15T04:00:00.000Z")
  })

  it("rechaza una fecha inválida en vez de devolver un instante inventado", () => {
    expect(() => chileDayStartInstant("2026-13-01")).toThrow()
  })
})
