import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

const whereSentinel = { sql: "scoped-where" }
const chains: Array<Record<string, ReturnType<typeof vi.fn>>> = []

function createChain(data: unknown[] = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (resolve: (value: unknown[]) => void, reject?: (error: unknown) => void) => Promise<void>
  } = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    groupBy: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
  }
  chain.then = (resolve, reject) => Promise.resolve(data).then(resolve, reject)
  chains.push(chain)
  return chain
}

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => createChain([])),
  },
}))

vi.mock("@/lib/combustibles/queries", () => ({
  buildFuelLoadsWhere: vi.fn(() => whereSentinel),
}))

import { getFuelReportsData } from "@/lib/combustibles/reports"
import { buildFuelLoadsWhere } from "@/lib/combustibles/queries"

const mockBuildFuelLoadsWhere = vi.mocked(buildFuelLoadsWhere)

const session = {
  user: {
    id: "user-1",
    roles: ["faena"],
    permissions: ["combustibles:view", "combustibles:view_costs"],
    worksiteIds: ["ws-1"],
  },
} as Session

beforeEach(() => {
  vi.clearAllMocks()
  chains.length = 0
  mockBuildFuelLoadsWhere.mockReturnValue(whereSentinel as never)
})

describe("getFuelReportsData", () => {
  it("uses the shared fuel-load where helper so report charts keep worksite scoping", async () => {
    await getFuelReportsData(session, { startDate: "2026-06-01", endDate: "2026-06-30" })

    // …y pidiéndole sólo estados contabilizables: un reporte de gasto no
    // incluye borradores ni cargas anuladas (CO-014).
    expect(mockBuildFuelLoadsWhere).toHaveBeenCalledWith(
      session,
      { startDate: "2026-06-01", endDate: "2026-06-30" },
      { accountableOnly: true },
    )
    expect(chains.length).toBe(6)
    for (const chain of chains) {
      expect(chain.where).toHaveBeenCalledWith(whereSentinel)
    }
  })

  it("rechaza antes de consultar si falta la capacidad base o la de costos", async () => {
    const withoutCosts = {
      ...session,
      user: { ...session.user, permissions: ["combustibles:view"] },
    } as Session

    await expect(getFuelReportsData(withoutCosts)).rejects.toThrow("No autorizado")
    expect(chains).toHaveLength(0)
    expect(mockBuildFuelLoadsWhere).not.toHaveBeenCalled()
  })
})
