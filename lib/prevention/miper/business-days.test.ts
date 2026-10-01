/**
 * Días hábiles chilenos (§9.1): fines de semana y feriados.
 *
 * El caso que originó el helper: la firma pendiente de una MIPER se mide en
 * días **hábiles**, y el único helper que existía en el repo
 * (`subtractBusinessDays`) cuenta un feriado como día hábil.
 */
import { describe, expect, it } from "vitest"
import { addBusinessDays, businessDaysBetween, chileHolidays, isBusinessDay } from "./business-days"

describe("días hábiles chilenos", () => {
  it("salta el fin de semana", () => {
    // 2030-10-04 es viernes; 10-05 y 10-06 caen sábado y domingo.
    expect(addBusinessDays("2030-10-04", 1)).toBe("2030-10-07")
    expect(businessDaysBetween("2030-10-04", "2030-10-07")).toBe(2)
  })

  /* El plan de la F3 ilustra este caso con "2030-10-03" → "2030-10-07", pero
   * 2030-10-03 es jueves y el viernes 10-04 no es feriado: el día hábil
   * siguiente es el 10-04. Se deja el valor correcto y la nota, porque un
   * feriado inventado para cuadrar un ejemplo mueve avisos reales. */
  it("el día hábil siguiente a un jueves es el viernes", () => {
    expect(isBusinessDay("2030-10-03")).toBe(true)
    expect(addBusinessDays("2030-10-03", 1)).toBe("2030-10-04")
    expect(businessDaysBetween("2030-09-20", "2030-10-04")).toBeGreaterThan(5)
  })

  it("salta los feriados de Chile", () => {
    // 2026-09-18 (Independencia) y 2026-04-03 (Viernes Santo) son feriados.
    expect(isBusinessDay("2026-09-18")).toBe(false)
    expect(isBusinessDay("2026-04-03")).toBe(false)
    expect(addBusinessDays("2026-09-17", 1)).toBe("2026-09-21")
    expect(chileHolidays(2026)).toContain("2026-09-18")
    expect(chileHolidays(2026)).toContain("2026-04-03")
  })

  it("mueve al lunes los feriados trasladables (Ley 19.973)", () => {
    // 2027-10-12 es martes: el feriado se celebra el lunes 11.
    expect(chileHolidays(2027)).toContain("2027-10-11")
    expect(chileHolidays(2027)).not.toContain("2027-10-12")
    expect(isBusinessDay("2027-10-11")).toBe(false)
    // 2027-06-29 es martes: se celebra el lunes 28.
    expect(chileHolidays(2027)).toContain("2027-06-28")
    // 2030-10-31 cae jueves: se celebra el lunes 28 de ese mes.
    expect(chileHolidays(2030)).toContain("2030-10-28")
  })

  it("cuenta el intervalo cerrado [from, to] y no cuenta los días no hábiles", () => {
    expect(businessDaysBetween("2026-09-21", "2026-09-21")).toBe(1)
    expect(businessDaysBetween("2026-09-19", "2026-09-20")).toBe(0)
    // Mismo lunes a lunes siguiente: cinco hábiles.
    expect(businessDaysBetween("2026-09-21", "2026-09-28")).toBe(6)
    // Simétrico hacia atrás.
    expect(businessDaysBetween("2026-09-28", "2026-09-21")).toBe(-6)
  })

  it("rechaza un avance negativo o fraccionario", () => {
    expect(() => addBusinessDays("2026-09-21", -1)).toThrow(/entero no negativo/)
    expect(() => addBusinessDays("2026-09-21", 1.5)).toThrow(/entero no negativo/)
    expect(addBusinessDays("2026-09-21", 0)).toBe("2026-09-21")
  })
})
