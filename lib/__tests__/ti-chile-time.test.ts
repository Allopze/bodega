import { describe, expect, it } from "vitest"
import * as utils from "@/lib/utils"

type ChileTimeUtils = typeof utils & {
  chileLocalDateTimeToUtc?: (value: string) => string
}

describe("módulo TI — hora operacional de Chile", () => {
  it("convierte la hora local de entrega con el desfase real de invierno y verano", () => {
    const parse = (utils as ChileTimeUtils).chileLocalDateTimeToUtc

    expect(parse).toBeTypeOf("function")
    expect(parse?.("2026-01-15T10:00")).toBe("2026-01-15T13:00:00.000Z")
    expect(parse?.("2026-07-15T10:00")).toBe("2026-07-15T14:00:00.000Z")
  })
})
