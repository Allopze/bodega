import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

const projections: Array<Record<string, unknown>> = []
const results: unknown[][] = []

function queryChain(data: unknown[]) {
  const chain: Record<string, unknown> = {}
  for (const method of ["from", "where", "groupBy", "orderBy"]) chain[method] = vi.fn(() => chain)
  chain.then = (resolve: (value: unknown[]) => void, reject?: (error: unknown) => void) =>
    Promise.resolve(data).then(resolve, reject)
  return chain
}

vi.mock("@/db", () => ({
  db: { select: (projection: Record<string, unknown>) => {
    projections.push(projection)
    return queryChain(results.shift() ?? [])
  } },
}))

import { getOperationsSummary } from "@/lib/combustibles/operations-dashboard"

function sqlText(node: unknown, out: string[] = []): string {
  if (typeof node === "string") out.push(node)
  else if (Array.isArray(node)) node.forEach((item) => sqlText(item, out))
  else if (node && typeof node === "object") {
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

describe("getOperationsSummary cost capability", () => {
  it("keeps operational aggregates but redacts all monetary projections", async () => {
    results.push(
      [{ totalLitros: 80, totalMonto: null, totalEquipos: 1, totalRegistros: 2 }],
      [{ plate: "AA-BB-11", code: null, cantidad: 80, monto: null, transacciones: 2, rendimiento: 9, vehicleId: "veh-1", unidad: "km_lt" }],
      [{ faena: "Faena Uno", litros: 80, monto: null, equipos: 1 }],
      [{ proveedor: "Proveedor", litros: 80, monto: null, transacciones: 2 }],
    )
    const session = { user: { id: "operator", permissions: ["combustibles:view"], isGlobal: true, worksiteIds: [] } } as unknown as Session

    const summary = await getOperationsSummary(session)

    expect(summary).not.toBeNull()
    expect(summary).toMatchObject({ totalLitros: 80, totalMonto: null, topEquiposPorGasto: [] })
    expect(summary?.porFaena[0]).toMatchObject({ litros: 80, monto: null })
    expect(summary?.porProveedor[0]).toMatchObject({ litros: 80, monto: null })
    for (const [projection, key] of [[projections[0], "totalMonto"], [projections[1], "monto"], [projections[2], "monto"], [projections[3], "monto"]] as const) {
      expect(sqlText(projection?.[key])).not.toContain("monto")
    }
  })
})
