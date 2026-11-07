/**
 * `chileHour` y `greetingForChileHour`: el saludo de Inicio se mide en hora de
 * Chile continental, no en la del proceso (UTC en producción).
 *
 * Chile continental: UTC-3 en verano (primer sábado de septiembre → primer
 * sábado de abril) y UTC-4 en invierno. Cada caso usa un instante UTC fijo, así
 * que el resultado no depende de la zona de quien corre la prueba.
 */

import { describe, expect, it } from "vitest"
import { chileHour, greetingForChileHour } from "@/lib/utils"

describe("chileHour()", () => {
  it("lee la hora de verano (UTC-3)", () => {
    expect(chileHour(new Date("2026-01-15T15:00:00Z"))).toBe(12)
  })

  it("lee la hora de invierno (UTC-4)", () => {
    expect(chileHour(new Date("2026-07-15T16:00:00Z"))).toBe(12)
  })

  it("el mismo instante UTC cae en horas distintas según el horario de verano", () => {
    // 15:30Z: 12:30 en verano, 11:30 en invierno.
    expect(chileHour(new Date("2026-01-15T15:30:00Z"))).toBe(12)
    expect(chileHour(new Date("2026-07-15T15:30:00Z"))).toBe(11)
  })

  it("rinde 0 —no 24— a medianoche", () => {
    expect(chileHour(new Date("2026-01-15T03:00:00Z"))).toBe(0)
    expect(chileHour(new Date("2026-07-15T04:00:00Z"))).toBe(0)
  })

  it("atraviesa el cambio a horario de verano (6 de septiembre de 2026)", () => {
    // A las 24:00 del sábado 5 los relojes saltan a las 01:00 del domingo.
    expect(chileHour(new Date("2026-09-06T03:59:59Z"))).toBe(23)
    expect(chileHour(new Date("2026-09-06T04:00:00Z"))).toBe(1)
  })

  it("atraviesa el cambio a horario de invierno (5 de abril de 2026)", () => {
    // A las 24:00 del sábado 4 los relojes vuelven a las 23:00: dos veces la hora 23.
    expect(chileHour(new Date("2026-04-05T02:59:59Z"))).toBe(23)
    expect(chileHour(new Date("2026-04-05T03:00:00Z"))).toBe(23)
  })

  it("acepta un string ISO o un timestamp", () => {
    expect(chileHour("2026-01-15T15:00:00Z")).toBe(12)
    expect(chileHour(Date.parse("2026-01-15T15:00:00Z"))).toBe(12)
  })
})

describe("greetingForChileHour()", () => {
  describe("en verano (UTC-3)", () => {
    it.each([
      ["2026-01-15T07:59:00Z", "Buenas noches"], // 04:59
      ["2026-01-15T08:00:00Z", "Buenos días"],   // 05:00
      ["2026-01-15T14:59:00Z", "Buenos días"],   // 11:59
      ["2026-01-15T15:00:00Z", "Buenas tardes"], // 12:00
      ["2026-01-15T22:59:00Z", "Buenas tardes"], // 19:59
      ["2026-01-15T23:00:00Z", "Buenas noches"], // 20:00
      ["2026-01-15T03:00:00Z", "Buenas noches"], // 00:00
    ])("%s → %s", (instant, expected) => {
      expect(greetingForChileHour(new Date(instant))).toBe(expected)
    })
  })

  describe("en invierno (UTC-4)", () => {
    it.each([
      ["2026-07-15T08:59:00Z", "Buenas noches"], // 04:59
      ["2026-07-15T09:00:00Z", "Buenos días"],   // 05:00
      ["2026-07-15T15:59:00Z", "Buenos días"],   // 11:59
      ["2026-07-15T16:00:00Z", "Buenas tardes"], // 12:00
      ["2026-07-15T23:59:00Z", "Buenas tardes"], // 19:59
      ["2026-07-16T00:00:00Z", "Buenas noches"], // 20:00
    ])("%s → %s", (instant, expected) => {
      expect(greetingForChileHour(new Date(instant))).toBe(expected)
    })
  })

  it("un mismo instante UTC saluda distinto en verano y en invierno", () => {
    // 15:30Z: 12:30 (tarde) en enero, 11:30 (mañana) en julio.
    expect(greetingForChileHour(new Date("2026-01-15T15:30:00Z"))).toBe("Buenas tardes")
    expect(greetingForChileHour(new Date("2026-07-15T15:30:00Z"))).toBe("Buenos días")
  })

  it("no confunde la hora UTC con la chilena", () => {
    // 22:00Z de julio son las 18:00 chilenas: tarde, aunque en UTC ya sea de noche.
    expect(greetingForChileHour(new Date("2026-07-15T22:00:00Z"))).toBe("Buenas tardes")
    // 02:00Z de julio son las 22:00 del día anterior en Chile: noche.
    expect(greetingForChileHour(new Date("2026-07-16T02:00:00Z"))).toBe("Buenas noches")
  })
})
