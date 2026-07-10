import { describe, it, expect } from "vitest"
import {
  calcPrecioPromedioUnidad,
  calcRendimientoPonderado,
  calcVariacion,
  computeBatchTotals,
} from "../consumption-calculations"

describe("calcPrecioPromedioUnidad", () => {
  it("divides monto by cantidad", () => {
    expect(calcPrecioPromedioUnidad(1000000, 1000)).toBe(1000)
  })

  it("returns null when cantidad is zero (no division by zero)", () => {
    expect(calcPrecioPromedioUnidad(1000000, 0)).toBeNull()
  })

  it("returns null when cantidad is negative", () => {
    expect(calcPrecioPromedioUnidad(1000000, -5)).toBeNull()
  })
})

describe("calcRendimientoPonderado", () => {
  it("weights rendimiento by cantidad consumed", () => {
    const rows = [
      { cantidadUnidad: 100, monto: 0, rendimientoPromedio: 10, numeroTransacciones: 0, numeroTarjetas: 0 },
      { cantidadUnidad: 300, monto: 0, rendimientoPromedio: 2, numeroTransacciones: 0, numeroTarjetas: 0 },
    ]
    // (100*10 + 300*2) / 400 = (1000+600)/400 = 4
    expect(calcRendimientoPonderado(rows)).toBe(4)
  })

  it("returns 0 when there is no cantidad at all", () => {
    expect(calcRendimientoPonderado([])).toBe(0)
  })
})

describe("calcVariacion", () => {
  it("computes percentage change", () => {
    expect(calcVariacion(150, 100)).toBe(50)
    expect(calcVariacion(50, 100)).toBe(-50)
  })

  it("returns null when there is no previous-period data (division by zero)", () => {
    expect(calcVariacion(100, 0)).toBeNull()
    expect(calcVariacion(100, null)).toBeNull()
    expect(calcVariacion(100, undefined)).toBeNull()
  })
})

describe("computeBatchTotals", () => {
  it("aggregates totals and counts unique plates", () => {
    const rows = [
      { patente: "AAAA11", cantidadUnidad: 100, monto: 90000, rendimientoPromedio: 3, numeroTransacciones: 2, numeroTarjetas: 1 },
      { patente: "AAAA11", cantidadUnidad: 50, monto: 45000, rendimientoPromedio: 3, numeroTransacciones: 1, numeroTarjetas: 1 },
      { patente: "BBBB22", cantidadUnidad: 200, monto: 180000, rendimientoPromedio: 4, numeroTransacciones: 3, numeroTarjetas: 2 },
    ]
    const totals = computeBatchTotals(rows)
    expect(totals.totalFilas).toBe(3)
    expect(totals.totalPatentes).toBe(2)
    expect(totals.totalTarjetas).toBe(4)
    expect(totals.totalTransacciones).toBe(6)
    expect(totals.totalCantidad).toBe(350)
    expect(totals.totalMonto).toBe(315000)
  })

  it("returns zeroed totals for an empty batch", () => {
    const totals = computeBatchTotals([])
    expect(totals).toEqual({ totalFilas: 0, totalPatentes: 0, totalTarjetas: 0, totalTransacciones: 0, totalCantidad: 0, totalMonto: 0 })
  })
})
