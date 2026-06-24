/**
 * lib/__tests__/dashboard-service.test.ts
 *
 * Tests for dashboard data-loading helpers:
 * - getWorkQueueSnapshot
 * - getDashboardData
 * - buildActor
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

import { getWorkQueueSnapshot, getDashboardData, buildActor } from "@/lib/services/dashboard"
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

// ── buildActor ───────────────────────────────────────────────────────────────

describe("buildActor", () => {
  it("builds actor from global session", () => {
    mockIsGlobalRole.mockReturnValue(true)
    const session = makeSession({ permissions: ["requests:write", "items:approve"], worksiteIds: [] })
    const actor = buildActor(session)
    expect(actor).toEqual({
      userId: "user-1",
      permissions: ["requests:write", "items:approve"],
      worksiteIds: [],
      isGlobal: true,
    })
  })

  it("builds actor from local session", () => {
    mockIsGlobalRole.mockReturnValue(false)
    const session = makeSession({ worksiteIds: ["ws-1", "ws-2"] })
    const actor = buildActor(session)
    expect(actor).toEqual({
      userId: "user-1",
      permissions: ["requests:read"],
      worksiteIds: ["ws-1", "ws-2"],
      isGlobal: false,
    })
  })
})

// ── getWorkQueueSnapshot ─────────────────────────────────────────────────────

describe("getWorkQueueSnapshot", () => {
  it("returns empty snapshot when no data", async () => {
    const session = makeSession()
    const result = await getWorkQueueSnapshot(session)
    expect(result).toEqual({ requests: [], items: [], orders: [] })
  })

  it("maps request rows with item statuses and item count", async () => {
    const session = makeSession()
    mockIsGlobalRole.mockReturnValue(true)

    selectResults.push(
      // select 0: request rows
      { data: [{
        id: "req-1", code: "REP-001", worksiteId: "ws-1", worksiteName: "Obra Central",
        requesterId: "user-1", status: "submitted", urgency: "high",
        createdAt: "2024-01-01", submittedAt: "2024-01-02",
      }]},
      // select 1: item rows
      { data: [{
        id: "item-1", requestId: "req-1", requestCode: "REP-001",
        worksiteId: "ws-1", worksiteName: "Obra Central", requesterId: "user-1",
        productName: "Martillo", productNameFree: null, productId: "prod-1",
        status: "approved", urgency: "high", createdAt: "2024-01-01",
        quantity: 5, unitOfMeasure: "un",
      }]},
      // select 2: order rows
      { data: [] },
      // select 3: stock rows
      { data: [{ productId: "prod-1" }] },
    )

    const result = await getWorkQueueSnapshot(session)
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0]!.itemCount).toBe(1)
    expect(result.requests[0]!.itemStatuses).toEqual(["approved"])
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.hasStock).toBe(true)
    expect(result.items[0]!.productName).toBe("Martillo")
  })

  it("falls back to productNameFree when productName is null", async () => {
    const session = makeSession()
    mockIsGlobalRole.mockReturnValue(true)

    selectResults.push(
      { data: [{
        id: "req-1", code: "REP-001", worksiteId: "ws-1", worksiteName: "Obra",
        requesterId: "user-1", status: "draft", urgency: "normal",
        createdAt: "2024-01-01", submittedAt: null,
      }]},
      { data: [{
        id: "item-2", requestId: "req-1", requestCode: "REP-001",
        worksiteId: "ws-1", worksiteName: "Obra", requesterId: "user-1",
        productName: null, productNameFree: "Repuesto libre", productId: null,
        status: "requested", urgency: "normal", createdAt: "2024-01-01",
        quantity: 1, unitOfMeasure: "un",
      }]},
      { data: [] },
      { data: [] },
    )

    const result = await getWorkQueueSnapshot(session)
    expect(result.items[0]!.productName).toBe("Repuesto libre")
  })

  it("defaults to 'Ítem solicitado' when both product names are null", async () => {
    const session = makeSession()
    mockIsGlobalRole.mockReturnValue(true)

    selectResults.push(
      { data: [{
        id: "req-1", code: "REP-001", worksiteId: "ws-1", worksiteName: "Obra",
        requesterId: "user-1", status: "draft", urgency: "normal",
        createdAt: "2024-01-01", submittedAt: null,
      }]},
      { data: [{
        id: "item-3", requestId: "req-1", requestCode: "REP-001",
        worksiteId: "ws-1", worksiteName: "Obra", requesterId: "user-1",
        productName: null, productNameFree: null, productId: null,
        status: "requested", urgency: "normal", createdAt: "2024-01-01",
        quantity: 1, unitOfMeasure: "un",
      }]},
      { data: [] },
      { data: [] },
    )

    const result = await getWorkQueueSnapshot(session)
    expect(result.items[0]!.productName).toBe("Ítem solicitado")
  })

  it("sets hasStock to false when item has no productId", async () => {
    const session = makeSession()
    mockIsGlobalRole.mockReturnValue(true)

    selectResults.push(
      { data: [{
        id: "req-1", code: "REP-001", worksiteId: "ws-1", worksiteName: "Obra",
        requesterId: "user-1", status: "draft", urgency: "normal",
        createdAt: "2024-01-01", submittedAt: null,
      }]},
      { data: [{
        id: "item-4", requestId: "req-1", requestCode: "REP-001",
        worksiteId: "ws-1", worksiteName: "Obra", requesterId: "user-1",
        productName: "Libre", productNameFree: null, productId: null,
        status: "requested", urgency: "normal", createdAt: "2024-01-01",
        quantity: 1, unitOfMeasure: "un",
      }]},
      { data: [] },
      { data: [{ productId: "prod-1" }] },
    )

    const result = await getWorkQueueSnapshot(session)
    expect(result.items[0]!.hasStock).toBe(false)
  })

  it("uses false sql when no visible worksites for non-global user", async () => {
    const session = makeSession()
    mockIsGlobalRole.mockReturnValue(false)
    mockVisibleWorksiteIds.mockReturnValue([])
    const result = await getWorkQueueSnapshot(session)
    expect(result).toEqual({ requests: [], items: [], orders: [] })
  })

  it("maps order rows with itemCount and supplierName", async () => {
    const session = makeSession()
    mockIsGlobalRole.mockReturnValue(true)

    selectResults.push(
      { data: [] },
      { data: [] },
      { data: [{
        id: "oc-1", code: "OC-001", worksiteId: "ws-1", worksiteName: "Obra",
        supplierName: "Proveedor X", status: "issued", createdAt: "2024-01-01",
        issuedAt: "2024-01-02", sentAt: null, totalAmount: 150000, itemCount: 3,
      }]},
      { data: [] },
    )

    const result = await getWorkQueueSnapshot(session)
    expect(result.orders).toHaveLength(1)
    expect(result.orders[0]!.itemCount).toBe(3)
    expect(result.orders[0]!.supplierName).toBe("Proveedor X")
  })

  it("maps multiple items per request with correct statuses", async () => {
    const session = makeSession()
    mockIsGlobalRole.mockReturnValue(true)

    selectResults.push(
      { data: [{
        id: "req-1", code: "REP-001", worksiteId: "ws-1", worksiteName: "Obra",
        requesterId: "user-1", status: "in_review", urgency: "critical",
        createdAt: "2024-01-01", submittedAt: "2024-01-02",
      }]},
      { data: [
        {
          id: "item-1", requestId: "req-1", requestCode: "REP-001",
          worksiteId: "ws-1", worksiteName: "Obra", requesterId: "user-1",
          productName: "A", productNameFree: null, productId: "p1",
          status: "approved", urgency: "critical", createdAt: "2024-01-01",
          quantity: 1, unitOfMeasure: "un",
        },
        {
          id: "item-2", requestId: "req-1", requestCode: "REP-001",
          worksiteId: "ws-1", worksiteName: "Obra", requesterId: "user-1",
          productName: "B", productNameFree: null, productId: "p2",
          status: "requested", urgency: "critical", createdAt: "2024-01-01",
          quantity: 2, unitOfMeasure: "un",
        },
      ]},
      { data: [] },
      { data: [{ productId: "p1" }] },
    )

    const result = await getWorkQueueSnapshot(session)
    expect(result.requests[0]!.itemCount).toBe(2)
    expect(result.requests[0]!.itemStatuses).toEqual(["approved", "requested"])
    expect(result.items[0]!.hasStock).toBe(true)
    expect(result.items[1]!.hasStock).toBe(false)
  })
})

// ── getDashboardData ─────────────────────────────────────────────────────────

describe("getDashboardData", () => {
  it("returns zero metrics when no data", async () => {
    const session = makeSession()

    // 8 count/sum queries + 1 worksite breakdown + 3 detail queries = 12 total
    for (let i = 0; i < 12; i++) {
      selectResults.push({ data: [{ n: 0 }] })
    }

    const result = await getDashboardData(session)

    expect(result.metrics).toEqual({
      my_requests: 0,
      pending_approvals: 0,
      approved_without_oc: 0,
      orders_in_progress: 0,
      orders_pending_receipt: 0,
    })
    expect(result.summary).toEqual({ totalCosts: 0, totalRequests: 0, approvedRequests: 0 })
    expect(result.worksitesBreakdown).toEqual([])
  })

  it("populates metrics from DB rows", async () => {
    const session = makeSession()
    mockIsGlobalRole.mockReturnValue(true)

    // 8 count/sum queries
    const metricValues = [5, 3, 2, 4, 2, 1000000, 10, 8]
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
    expect(result.metrics.my_requests).toBe(5)
    expect(result.metrics.pending_approvals).toBe(3)
    expect(result.metrics.orders_in_progress).toBe(4)
    expect(result.summary.totalCosts).toBe(1000000)
    expect(result.summary.totalRequests).toBe(10)
    expect(result.summary.approvedRequests).toBe(8)
    expect(result.worksitesBreakdown).toHaveLength(2)
  })

  it("filters out worksites with zero requests and zero cost", async () => {
    const session = makeSession()
    mockIsGlobalRole.mockReturnValue(true)

    for (let i = 0; i < 8; i++) {
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

    for (let i = 0; i < 8; i++) {
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

    for (let i = 0; i < 8; i++) {
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
    for (let i = 0; i < 12; i++) {
      selectResults.push({ data: [] })
    }

    const result = await getDashboardData(session)
    expect(result.worksitesBreakdown).toEqual([])
  })
})
