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

import { getFuelMonthlyTrend } from "@/lib/services/dashboard-fuel"

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
