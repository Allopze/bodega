import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

const projections: Array<Record<string, unknown>> = []
const results: unknown[][] = []

function queryChain(data: unknown[]) {
  const chain: Record<string, unknown> = {}
  for (const method of ["from", "where", "groupBy", "orderBy", "limit", "leftJoin", "innerJoin"]) {
    chain[method] = vi.fn(() => chain)
  }
  chain.then = (resolve: (value: unknown[]) => void, reject?: (error: unknown) => void) =>
    Promise.resolve(data).then(resolve, reject)
  return chain
}

vi.mock("@/db", () => ({
  db: {
    select: (projection: Record<string, unknown>) => {
      projections.push(projection)
      return queryChain(results.shift() ?? [])
    },
  },
}))

import { getConsumptionDashboard } from "@/lib/combustibles/consumption-dashboard"
import { buildConsumptionWhere } from "@/lib/combustibles/consumption-queries"

function sqlText(node: unknown, out: string[] = []): string {
  if (typeof node === "string") out.push(node)
  else if (Array.isArray(node)) node.forEach((item) => sqlText(item, out))
  else if (node && typeof node === "object") {
    const named = node as { name?: unknown; columnType?: unknown }
    if (typeof named.name === "string" && typeof named.columnType === "string") {
      out.push(named.name)
      return out.join(" ").toLowerCase()
    }
    const value = node as { queryChunks?: unknown[]; value?: unknown }
    if (value.queryChunks) sqlText(value.queryChunks, out)
    if (typeof value.value === "string") out.push(value.value)
    else if (Array.isArray(value.value)) sqlText(value.value, out)
  }
  return out.join(" ").toLowerCase()
}

beforeEach(() => {
  projections.length = 0
  results.length = 0
})

describe("getConsumptionDashboard cost capability", () => {
  it("redacta montos, elimina filtros monetarios y no proyecta columnas de costo sin permiso", async () => {
    results.push(
      [{ totalCantidad: 120, totalMonto: null, totalTransacciones: 3, totalTarjetas: 2, patentesUnicas: 1, patentesSinAsociacion: 0, rendimientoPonderado: 8 }],
      [{ totalCantidad: 100, totalMonto: null }],
      [{ periodo: "2026-08-01", cantidad: 120, monto: null }],
      [{ patente: "AA-BB-11", cantidad: 120, monto: null, transacciones: 3, rendimiento: 8, vehicleId: "veh-1" }],
    )
    const session = { user: { id: "operator", permissions: ["combustibles:view"], isGlobal: true, worksiteIds: [] } } as unknown as Session

    const dashboard = await getConsumptionDashboard(session, {
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      montoMin: 10,
      montoMax: 999_999,
    })

    expect(dashboard.filters.montoMin).toBeUndefined()
    expect(dashboard.filters.montoMax).toBeUndefined()
    expect(dashboard.kpis).toMatchObject({ totalMonto: null, precioPromedioUnidad: null, variacionMontoPct: null })
    expect(dashboard.seriesPorPeriodo[0]).toMatchObject({ monto: null, precioPromedio: null })
    expect(dashboard.topPatentesPorGasto).toEqual([])
    expect(dashboard.alerts.some((alert) => alert.type === "gasto_rendimiento_bajo" || alert.entityLabel === "Gasto total")).toBe(false)

    expect(sqlText(projections[0]!.totalMonto)).not.toContain("monto")
    expect(sqlText(projections[1]!.totalMonto)).not.toContain("monto")
    expect(sqlText(projections[2]!.monto)).not.toContain("monto")
    expect(sqlText(projections[3]!.monto)).not.toContain("monto")
  })

  it("ignora predicados monetarios en el constructor compartido sin ambas capacidades", () => {
    const withoutCosts = { user: { id: "operator", permissions: ["combustibles:view"], isGlobal: true, worksiteIds: [] } } as unknown as Session
    const withCosts = { user: { id: "auditor", permissions: ["combustibles:view", "combustibles:view_costs"], isGlobal: true, worksiteIds: [] } } as unknown as Session

    const redacted = buildConsumptionWhere(withoutCosts, { montoMin: 10, montoMax: 20 })
    const authorized = buildConsumptionWhere(withCosts, { montoMin: 10, montoMax: 20 })

    expect(sqlText(redacted)).not.toContain("monto")
    expect(sqlText(authorized)).toContain("monto")
  })
})
