import { describe, expect, it } from "vitest"
import type { RankingRow } from "@/lib/services/analytics"
import { OTHER_SUPPLIERS_KEY, buildSupplierPareto, paretoSummary, paretoYAxisTicks } from "./analytics-pareto"

const supplier = (id: string, totalAmount: number, module = "Compras", count = 1): RankingRow => ({ id, name: `Proveedor ${id}`, module, totalAmount, count })

describe("buildSupplierPareto", () => {
  it("ordena de mayor a menor y acumula contra el gasto TOTAL, no contra la suma de los listados", () => {
    const pareto = buildSupplierPareto({
      suppliers: [supplier("b", 200), supplier("a", 500), supplier("c", 100)],
      totalSpend: 1000,
    })

    expect(pareto.rows.map((row) => row.label)).toEqual(["Proveedor a", "Proveedor b", "Proveedor c", "Otros proveedores"])
    expect(pareto.rows.map((row) => row.sharePct)).toEqual([50, 20, 10, 20])
    expect(pareto.rows.map((row) => row.cumulativePct)).toEqual([50, 70, 80, 100])
  })

  it("«Otros proveedores» es el total menos los listados y siempre va al final, aunque pese más que el primero", () => {
    const pareto = buildSupplierPareto({ suppliers: [supplier("a", 100), supplier("b", 50)], totalSpend: 1000 })

    const other = pareto.rows.at(-1)!
    expect(other).toMatchObject({ key: OTHER_SUPPLIERS_KEY, amount: 850, isOther: true, sharePct: 85, cumulativePct: 100 })
    expect(pareto.rows.filter((row) => row.isOther)).toHaveLength(1)
  })

  it("si los proveedores suman el total no hay fila «Otros»", () => {
    const pareto = buildSupplierPareto({ suppliers: [supplier("a", 600), supplier("b", 400)], totalSpend: 1000 })

    expect(pareto.rows.some((row) => row.isOther)).toBe(false)
    expect(pareto.rows.at(-1)?.cumulativePct).toBe(100)
  })

  it("un residuo de menos de un peso (redondeo) no inventa una fila «Otros»", () => {
    const pareto = buildSupplierPareto({ suppliers: [supplier("a", 999.6)], totalSpend: 1000 })

    expect(pareto.rows.some((row) => row.isOther)).toBe(false)
  })

  it("nunca pasa de 100 %: si los proveedores suman más que el total (datos de dos cortes) el total se corrige", () => {
    const pareto = buildSupplierPareto({ suppliers: [supplier("a", 700), supplier("b", 500)], totalSpend: 1000 })

    expect(pareto.totalSpend).toBe(1200)
    expect(Math.max(...pareto.rows.map((row) => row.cumulativePct))).toBeLessThanOrEqual(100)
  })

  it("ignora proveedores sin gasto y limita a los 10 mayores", () => {
    const many = Array.from({ length: 14 }, (_, i) => supplier(String(i), 100 - i))
    many.push(supplier("cero", 0))
    const pareto = buildSupplierPareto({ suppliers: many, totalSpend: 5000 })

    expect(pareto.rows.filter((row) => !row.isOther)).toHaveLength(10)
    expect(pareto.rows.some((row) => row.key === "cero")).toBe(false)
  })

  it("sin gasto o sin proveedores identificados no hay Pareto que dibujar", () => {
    expect(buildSupplierPareto({ suppliers: [], totalSpend: 0 }).rows).toEqual([])
    expect(buildSupplierPareto({ suppliers: [], totalSpend: 1000 }).rows).toEqual([])
    expect(buildSupplierPareto({ suppliers: [supplier("a", 0)], totalSpend: 1000 }).rows).toEqual([])
  })

  it("conserva el módulo (Compras o Combustible): el ranking mezcla los dos y la tabla lo dice", () => {
    const pareto = buildSupplierPareto({ suppliers: [supplier("copec", 900, "Combustible", 40), supplier("a", 100)], totalSpend: 1000 })

    expect(pareto.rows[0]).toMatchObject({ module: "Combustible", count: 40 })
  })
})

describe("paretoSummary", () => {

  it("dice cuánto concentra el mayor y cuánto los tres mayores, calculado de los datos", () => {
    const pareto = buildSupplierPareto({ suppliers: [supplier("a", 500), supplier("b", 200), supplier("c", 100), supplier("d", 50)], totalSpend: 1000 })

    expect(paretoSummary(pareto, 60)).toBe("Proveedor a concentra el 50% del gasto; los 3 mayores proveedores, el 80%.")
  })

  it("con menos de tres proveedores no promete «los 3 mayores»", () => {
    const pareto = buildSupplierPareto({ suppliers: [supplier("a", 600), supplier("b", 100)], totalSpend: 1000 })

    expect(paretoSummary(pareto, 60)).toBe("Proveedor a concentra el 60% del gasto; los 2 mayores proveedores, el 70%. Supera el umbral de concentración (60%).")
  })

  it("con un solo proveedor lo dice sin comparar", () => {
    const pareto = buildSupplierPareto({ suppliers: [supplier("a", 1000)], totalSpend: 1000 })

    expect(paretoSummary(pareto, 60)).toBe("Proveedor a concentra el 100% del gasto. Supera el umbral de concentración (60%).")
  })

  it("avisa de la concentración sólo cuando el mayor llega al umbral", () => {
    const below = buildSupplierPareto({ suppliers: [supplier("a", 590), supplier("b", 410)], totalSpend: 1000 })
    const at = buildSupplierPareto({ suppliers: [supplier("a", 600), supplier("b", 400)], totalSpend: 1000 })

    expect(paretoSummary(below, 60)).not.toContain("umbral")
    expect(paretoSummary(at, 60)).toContain("umbral")
  })

  it("nombra la base cuando no es todo el gasto (sin costos de combustible sólo hay compras)", () => {
    const pareto = buildSupplierPareto({ suppliers: [supplier("a", 500), supplier("b", 500)], totalSpend: 1000 })

    expect(paretoSummary(pareto, 60, "del gasto en compras")).toBe("Proveedor a concentra el 50% del gasto en compras; los 2 mayores proveedores, el 100%.")
  })

  it("sin proveedores identificados no afirma nada", () => {
    expect(paretoSummary(buildSupplierPareto({ suppliers: [], totalSpend: 1000 }), 60)).toBe("")
  })
})

describe("paretoYAxisTicks", () => {
  it("el eje de porcentaje acumulado llega siempre a 100 y trae el umbral para que el trazo de referencia tenga su marca", () => {
    expect(paretoYAxisTicks(60)).toEqual([0, 25, 50, 60, 75, 100])
    expect(paretoYAxisTicks(50)).toEqual([0, 25, 50, 75, 100])
  })
})
