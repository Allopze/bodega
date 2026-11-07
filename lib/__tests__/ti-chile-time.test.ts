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

  it("una hora que no existe por el salto de septiembre avanza a la primera hora válida del mismo día", () => {
    // 2026-09-06: las 00:00 de Chile pasan a ser la 01:00 (−04 → −03). Antes la
    // hora inexistente caía en el día ANTERIOR (23:00 del 5), y una carga de
    // combustible de las 00:15 de ese día quedaba registrada el 5.
    expect(utils.chileLocalDateTimeToUtc("2026-09-06T00:00")).toBe("2026-09-06T04:00:00.000Z")
    expect(utils.chileLocalDateTimeToUtc("2026-09-06T00:30")).toBe("2026-09-06T04:30:00.000Z")
    expect(utils.todayInChile(Date.parse(utils.chileLocalDateTimeToUtc("2026-09-06T00:00")))).toBe("2026-09-06")
    // Las horas que sí existen alrededor del salto no cambian.
    expect(utils.chileLocalDateTimeToUtc("2026-09-05T23:59")).toBe("2026-09-06T03:59:00.000Z")
    expect(utils.chileLocalDateTimeToUtc("2026-09-06T01:00")).toBe("2026-09-06T04:00:00.000Z")
  })

  it("una hora repetida por el salto de abril conserva la conversión de siempre", () => {
    // 2026-04-05: a las 00:00 (−03) el reloj vuelve a las 23:00 del 4 (−04). La
    // hora 23:30 del 4 existe dos veces; se mantiene el instante que ya se usaba.
    expect(utils.chileLocalDateTimeToUtc("2026-04-04T22:00")).toBe("2026-04-05T01:00:00.000Z")
    expect(utils.chileLocalDateTimeToUtc("2026-04-05T10:00")).toBe("2026-04-05T14:00:00.000Z")
  })
})
