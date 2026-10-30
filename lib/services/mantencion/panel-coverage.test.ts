import { describe, expect, it } from "vitest"
import type { MantEquipmentState } from "@/lib/mantencion/types"
import { fleetCoverage, overdueDetail } from "./panel-coverage"

const counts = (overrides: Partial<Record<MantEquipmentState, number>>): Record<MantEquipmentState, number> => ({
  vencida: 0, proxima: 0, al_dia: 0, sin_lecturas: 0, sin_pauta: 0, baja: 0, ...overrides,
})

describe("cobertura de la flota", () => {
  it("sólo cuentan como evaluables los equipos con pauta y lectura", () => {
    expect(fleetCoverage(counts({ vencida: 1, proxima: 2, al_dia: 4, sin_lecturas: 112, sin_pauta: 3 }))).toEqual({
      evaluable: 7, withoutReadings: 112, withoutSchedule: 3, unknown: 115,
    })
  })
})

describe("detalle de «Mantenciones vencidas»", () => {
  it("con vencidas dice cuántas están por vencer", () => {
    expect(overdueDetail(counts({ vencida: 3, proxima: 2, al_dia: 4 }))).toBe("2 próximas a vencer")
    expect(overdueDetail(counts({ vencida: 1, proxima: 1 }))).toBe("1 próxima a vencer")
    expect(overdueDetail(counts({ vencida: 3, al_dia: 4 }))).toBe("Ninguna otra próxima a vencer")
  })

  it("«Todas las pautas al día» sólo vale si no queda ningún equipo sin evaluar", () => {
    expect(overdueDetail(counts({ al_dia: 5 }))).toBe("Todas las pautas al día")
    expect(overdueDetail(counts({ al_dia: 5, sin_lecturas: 1 }))).not.toContain("Todas las pautas al día")
    expect(overdueDetail(counts({ al_dia: 5, sin_pauta: 1 }))).not.toContain("Todas las pautas al día")
  })

  it("con cero vencidas y equipos sin evaluar dice entre cuántos se midió", () => {
    expect(overdueDetail(counts({ al_dia: 7, sin_lecturas: 112 }))).toBe("Ninguna entre los 7 con pauta y lectura")
    expect(overdueDetail(counts({ al_dia: 1, sin_lecturas: 118 }))).toBe("Ninguna entre el único con pauta y lectura")
    expect(overdueDetail(counts({ proxima: 2, al_dia: 5, sin_lecturas: 3 }))).toBe("Ninguna entre los 7 con pauta y lectura · 2 próximas a vencer")
  })

  it("sin ningún equipo evaluable no afirma nada sobre las pautas", () => {
    expect(overdueDetail(counts({ sin_lecturas: 3, sin_pauta: 1 }))).toBe("Aún ningún equipo tiene pauta y lectura para evaluarse")
    expect(overdueDetail(counts({}))).toBe("Aún ningún equipo tiene pauta y lectura para evaluarse")
  })

  it("con todo evaluado pero con próximas a vencer, no promete «todas al día»", () => {
    expect(overdueDetail(counts({ proxima: 2, al_dia: 3 }))).toBe("Ninguna vencida · 2 próximas a vencer")
  })
})
