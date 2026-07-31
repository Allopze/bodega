/**
 * lib/__tests__/dashboard-service.test.ts
 *
 * Tests for dashboard data-loading helpers:
 * - getDashboardData
 *
 * Key insight: drizzle query builders are thenable (implement .then()).
 * All chain methods return the chain itself; the chain resolves via .then().
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

// ── Mock DB ──────────────────────────────────────────────────────────────────
// Each db.select() returns an independent thenable chain.

let selectCallCount = 0
const selectResults: Array<{ data: unknown }> = []

function createChain(data: unknown[] = []) {
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.innerJoin = vi.fn(() => chain)
  chain.leftJoin = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => chain)
  chain.groupBy = vi.fn(() => chain)
  chain.limit = vi.fn(() => chain)
  // Make chain thenable — this is how drizzle resolves queries
  chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(data).then(resolve, reject)
  return chain
}

vi.mock("@/db", () => ({
  db: {
    select: (_cols?: unknown) => {
      const idx = selectCallCount++
      const spec = selectResults[idx]
      return createChain((spec?.data as unknown[]) ?? [])
    },
  },
}))

// ── Mock auth ────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/scope", () => ({
  isGlobalRole: vi.fn(),
  visibleWorksiteIds: vi.fn(),
}))

// ── Import after mocks ───────────────────────────────────────────────────────

import { getDashboardData } from "@/lib/services/dashboard"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"

const mockIsGlobalRole = vi.mocked(isGlobalRole)
const mockVisibleWorksiteIds = vi.mocked(visibleWorksiteIds)

function makeSession(overrides?: Partial<Session["user"]>): Session {
  return {
    user: {
      id: "user-1",
      name: "Test User",
      email: "test@test.com",
      permissions: ["requests:read"],
      worksiteIds: ["ws-1"],
      ...overrides,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as Session
}

beforeEach(() => {
  vi.clearAllMocks()
  selectCallCount = 0
  selectResults.length = 0
  mockIsGlobalRole.mockReturnValue(false)
  mockVisibleWorksiteIds.mockReturnValue(["ws-1"])
})

describe("getDashboardData", () => {
  it("returns zero metrics when no data", async () => {
    const session = makeSession()

    // 2 count queries + 1 worksite breakdown + 3 detail queries = 6 total
    for (let i = 0; i < 6; i++) {
      selectResults.push({ data: [{ n: 0 }] })
    }

    const result = await getDashboardData(session)

    expect(result.metrics).toEqual({
      pending_approvals: 0,
      orders_pending_receipt: 0,
    })
    expect(result.worksitesBreakdown).toEqual([])
  })

  it("populates metrics from DB rows", async () => {
    const session = makeSession()
    mockIsGlobalRole.mockReturnValue(true)

    // 2 count queries: pending_approvals, orders_pending_receipt
    const metricValues = [3, 2]
    for (const v of metricValues) {
      selectResults.push({ data: [{ n: v }] })
    }

    // select 9: worksite breakdown
    selectResults.push({ data: [
      { id: "ws-1", name: "Obra Central", requestsCount: 5 },
      { id: "ws-2", name: "Obra Norte", requestsCount: 3 },
    ]})

    // select 10-12: per-worksite detail queries
    selectResults.push(
      { data: [
        { worksiteId: "ws-1", totalCost: 600000 },
        { worksiteId: "ws-2", totalCost: 400000 },
      ]},
      { data: [
        { worksiteId: "ws-1", n: 2 },
        { worksiteId: "ws-2", n: 1 },
      ]},
      { data: [
        { worksiteId: "ws-1", n: 4 },
        { worksiteId: "ws-2", n: 2 },
      ]},
    )

    const result = await getDashboardData(session)
    expect(result.metrics.pending_approvals).toBe(3)
    expect(result.metrics.orders_pending_receipt).toBe(2)
    expect(result.worksitesBreakdown).toHaveLength(2)
  })

  it("filters out worksites with zero requests and zero cost", async () => {
    const session = makeSession()
    mockIsGlobalRole.mockReturnValue(true)

    for (let i = 0; i < 2; i++) {
      selectResults.push({ data: [{ n: 0 }] })
    }
    selectResults.push({ data: [
      { id: "ws-1", name: "Active", requestsCount: 3 },
      { id: "ws-2", name: "Empty", requestsCount: 0 },
    ]})
    selectResults.push(
      { data: [{ worksiteId: "ws-1", totalCost: 500 }] },
      { data: [] },
      { data: [] },
    )

    const result = await getDashboardData(session)
    expect(result.worksitesBreakdown).toHaveLength(1)
    expect(result.worksitesBreakdown[0]!.id).toBe("ws-1")
  })

  it("sorts worksites by totalCost descending", async () => {
    const session = makeSession()
    mockIsGlobalRole.mockReturnValue(true)

    for (let i = 0; i < 2; i++) {
      selectResults.push({ data: [{ n: 1 }] })
    }
    selectResults.push({ data: [
      { id: "ws-1", name: "Low Cost", requestsCount: 1 },
      { id: "ws-2", name: "High Cost", requestsCount: 1 },
    ]})
    selectResults.push(
      { data: [
        { worksiteId: "ws-1", totalCost: 100 },
        { worksiteId: "ws-2", totalCost: 999 },
      ]},
      { data: [] },
      { data: [] },
    )

    const result = await getDashboardData(session)
    expect(result.worksitesBreakdown[0]!.id).toBe("ws-2")
    expect(result.worksitesBreakdown[1]!.id).toBe("ws-1")
  })

  it("handles local (non-global) role with visible worksites", async () => {
    const session = makeSession()
    mockIsGlobalRole.mockReturnValue(false)
    mockVisibleWorksiteIds.mockReturnValue(["ws-1"])

    for (let i = 0; i < 2; i++) {
      selectResults.push({ data: [{ n: 1 }] })
    }
    selectResults.push({ data: [
      { id: "ws-1", name: "My Worksite", requestsCount: 1 },
    ]})
    selectResults.push(
      { data: [{ worksiteId: "ws-1", totalCost: 500 }] },
      { data: [{ worksiteId: "ws-1", n: 1 }] },
      { data: [{ worksiteId: "ws-1", n: 1 }] },
    )

    const result = await getDashboardData(session)
    expect(result.worksitesBreakdown).toHaveLength(1)
  })

  it("handles empty worksite list for non-global user", async () => {
    const session = makeSession()
    mockIsGlobalRole.mockReturnValue(false)
    mockVisibleWorksiteIds.mockReturnValue([])

    // All queries return empty because the where clause uses `sql\`false\``
    for (let i = 0; i < 6; i++) {
      selectResults.push({ data: [] })
    }

    const result = await getDashboardData(session)
    expect(result.worksitesBreakdown).toEqual([])
  })
})
