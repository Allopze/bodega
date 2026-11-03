import { afterEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

const selectChains: Array<Record<string, ReturnType<typeof vi.fn>>> = []
const selectProjections: Array<Record<string, unknown>> = []

function createChain() {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.groupBy = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => chain)
  chain.limit = vi.fn(() => chain)
  chain.then = (resolve: (value: unknown[]) => void, reject?: (error: unknown) => void) =>
    Promise.resolve([{ value: 0 }]).then(resolve, reject)
  selectChains.push(chain as Record<string, ReturnType<typeof vi.fn>>)
  return chain
}

vi.mock("@/db", () => ({ db: { select: (projection: Record<string, unknown>) => {
  selectProjections.push(projection)
  return createChain()
} } }))

import { getFuelMonthlyTrend, isPartialMonth } from "@/lib/services/dashboard-fuel"

/** Trozos literales y parámetros de un predicado de Drizzle. */
function sqlChunks(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node)
    return out
  }
  if (!node || typeof node !== "object") return out
  if (Array.isArray(node)) {
    for (const item of node) sqlChunks(item, out)
    return out
  }
  const candidate = node as { queryChunks?: unknown[]; value?: unknown }
  if (Array.isArray(candidate.queryChunks)) {
    for (const chunk of candidate.queryChunks) sqlChunks(chunk, out)
    return out
  }
  if (typeof candidate.value === "string") out.push(candidate.value)
  else if (Array.isArray(candidate.value)) {
    for (const part of candidate.value) if (typeof part === "string") out.push(part)
  }
  return out
}

afterEach(() => {
  selectChains.length = 0
  selectProjections.length = 0
  vi.useRealTimers()
})

describe("getFuelMonthlyTrend", () => {
  it("does not project fuel amounts without view_costs", async () => {
    const session = { user: { id: "operator", permissions: ["combustibles:view"], isGlobal: true, worksiteIds: [] } } as unknown as Session

    const fuel = await getFuelMonthlyTrend(session, 1)

    expect(fuel[0]?.amount).toBeNull()
    // La proyección del monto es el literal `null`: la columna `amount` del proveedor ni se consulta.
    expect(sqlChunks(selectProjections[0]!.amount).join("").trim().toLowerCase()).toBe("null")
  })
})

/**
 * El mes en curso no está completo: al 3 de noviembre sus barras valen 3 días y,
 * sin marca, el gráfico lo dibuja como una caída del consumo. Es la misma regla
 * de Analítica (`buildMonthlyTrend`): parcial el mes de «hoy» mientras hoy no sea
 * su último día, con «hoy» en calendario chileno y no en UTC.
 */
describe("isPartialMonth", () => {
  it("el mes de hoy es parcial hasta su último día", () => {
    expect(isPartialMonth("2026-11", "2026-11-03")).toBe(true)
    expect(isPartialMonth("2026-11", "2026-11-29")).toBe(true)
    expect(isPartialMonth("2026-11", "2026-11-30")).toBe(false)
    expect(isPartialMonth("2026-02", "2026-02-27")).toBe(true)
    expect(isPartialMonth("2026-02", "2026-02-28")).toBe(false)
    expect(isPartialMonth("2028-02", "2028-02-28")).toBe(true)
  })

  it("un mes anterior es completo y un mes futuro no es dato parcial", () => {
    expect(isPartialMonth("2026-10", "2026-11-03")).toBe(false)
    expect(isPartialMonth("2025-11", "2026-11-03")).toBe(false)
    expect(isPartialMonth("2026-12", "2026-11-03")).toBe(false)
  })
})

describe("getFuelMonthlyTrend · mes parcial", () => {
  const session = { user: { id: "operator", permissions: ["combustibles:view", "combustibles:view_costs"], isGlobal: true, worksiteIds: [] } } as unknown as Session
  const partialKeys = async (now: Date) => (await getFuelMonthlyTrend(session, 6, undefined, now)).filter((point) => point.partial).map((point) => point.monthKey)

  it("sólo el último punto —el mes en curso— sale marcado como parcial", async () => {
    const trend = await getFuelMonthlyTrend(session, 6, undefined, new Date("2026-11-03T15:00:00.000Z"))

    expect(trend.map((point) => point.monthKey)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"])
    expect(trend.map((point) => point.partial)).toEqual([false, false, false, false, false, true])
  })

  it("«hoy» es el día chileno: a las 22:00 del 31 de octubre (ya 1 de noviembre en UTC) octubre es el último mes y su último día no es parcial", async () => {
    expect(await partialKeys(new Date("2026-11-01T01:00:00.000Z"))).toEqual([])
  })

  it("pasada la medianoche chilena empieza noviembre y es parcial", async () => {
    expect(await partialKeys(new Date("2026-11-01T03:30:00.000Z"))).toEqual(["2026-11"])
  })

  it("el último día del mes ya no es parcial, aunque en UTC sea el día siguiente", async () => {
    expect(await partialKeys(new Date("2026-12-01T02:30:00.000Z"))).toEqual([])
    expect(await partialKeys(new Date("2026-11-30T12:00:00.000Z"))).toEqual([])
    expect(await partialKeys(new Date("2026-11-29T12:00:00.000Z"))).toEqual(["2026-11"])
  })
})
