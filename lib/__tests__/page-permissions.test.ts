// El destino de rechazo lleva ahora la sección de origen (`?desde=`) para
// ofrecer un retorno contextual, así que se comprueba el prefijo y no la
// cadena exacta.
/**
 * Unit tests for page-level permission gates.
 *
 * Verifies that the gates accept both the original permission and superset
 * alternatives (e.g. requests:view_all for users who lack requests:view_own).
 *
 * Pages tested:
 *  1. solicitudes/page.tsx   — gate: requests:view_own OR requests:view_all
 *  2. soporte/page.tsx       — gate: feedback:view_own OR feedback:view_all OR feedback:manage
 *  3. soporte/[id]/page.tsx  — gate: feedback:view_own OR feedback:view_all OR feedback:manage
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockRedirect = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_REDIRECT") }))
const mockNotFound = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_NOT_FOUND") }))

// ── Module mocks (hoisted) ─────────────────────────────────────────────────────

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: mockRedirect, notFound: mockNotFound }))

// ── Solicitudes page: mock DB and components to avoid rendering side effects ──

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => {
        // Thenable chain that resolves to empty arrays for all DB queries
        const chain: Record<string, unknown> = {
          where: vi.fn(() => chain),
          orderBy: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          offset: vi.fn(() => chain),
          innerJoin: vi.fn(() => chain),
          leftJoin: vi.fn(() => chain),
          groupBy: vi.fn(() => chain),
        }
        chain.then = (fn: (rows: unknown[]) => unknown) =>
          Promise.resolve().then(() => fn([]))
        return chain
      }),
    })),
    query: {
      purchaseRequests: { findFirst: vi.fn() },
      fuelLoads: { findFirst: vi.fn() },
    },
  },
}))

vi.mock("@/components/ui/page-header", () => ({
  PageHeader: () => null,
  Breadcrumbs: () => null,
}))
vi.mock("@/components/ui/page-container", () => ({
  PageContainer: ({ children }: { children: unknown }) => children,
}))
vi.mock("@/components/ui/server-pagination", () => ({
  ServerPagination: () => null,
}))
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: unknown }) => children,
}))
vi.mock("@/components/states/state-badge", () => ({
  StateBadge: () => null,
  FEEDBACK_TIPO_LABELS: {},
  REQUEST_STATE_META: {},
}))
vi.mock("@/lib/pagination", () => ({
  buildPaginationHref: () => "",
  resolvePagination: () => ({
    page: 1, limit: 20, offset: 0, totalPages: 0, totalItems: 0,
  }),
}))
vi.mock("@/lib/adquisiciones/list-query", () => ({
  parseListParams: () => ({ q: "", estados: [], faena: null }),
  statusSql: () => undefined,
  worksiteEqSql: () => undefined,
  periodSql: () => undefined,
}))
vi.mock("@/lib/constants", () => ({ SOLICITUDES_PAGE_SIZE: 20, DEFAULT_PAGE_SIZE: 25 }))
vi.mock("@/lib/services/feedback", () => ({
  countReports: () => Promise.resolve(0),
  listReports: () => Promise.resolve([]),
  getReport: () => Promise.resolve(null),
  getReportAttachments: () => Promise.resolve([]),
  getReportEvents: () => Promise.resolve([]),
}))
vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => children }))

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import SolicitudesPage from "@/app/(app)/solicitudes/page"
import SoportePage from "@/app/(app)/soporte/page"
import ReporteDetailPage from "@/app/(app)/soporte/[id]/page"

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<Session["user"]> = {}): Session {
  return {
    expires: "9999-12-31",
    user: {
      id: "u-test", name: "Test User", email: "test@chome.cl",
      roles: [], permissions: [], worksiteIds: [],
      primaryWorksiteId: null, avatarColor: null, isActive: true,
      ...overrides,
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  1. Solicitudes page
// ═══════════════════════════════════════════════════════════════════════════════

describe("solicitudes/page.tsx — permission gate", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("redirects to /forbidden for unauthenticated users", async () => {
    mockAuthFn.mockResolvedValue(null)
    await expect(SolicitudesPage({ searchParams: Promise.resolve({}) }))
      .rejects.toThrow("NEXT_REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith(expect.stringMatching(/^\/forbidden(\?|$)/))
  })

  it("redirects to /forbidden for users without requests:view_own AND without requests:view_all", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ permissions: ["some:other"] }))
    await expect(SolicitudesPage({ searchParams: Promise.resolve({}) }))
      .rejects.toThrow("NEXT_REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith(expect.stringMatching(/^\/forbidden(\?|$)/))
  })

  it("allows users with only requests:view_own through the gate", async () => {
    mockAuthFn.mockResolvedValue(makeSession({
      permissions: ["requests:view_own"],
      worksiteIds: ["ws-1"],
    }))
    await expect(SolicitudesPage({ searchParams: Promise.resolve({}) }))
      .resolves.toBeDefined()
    expect(mockRedirect).not.toHaveBeenCalledWith(expect.stringMatching(/^\/forbidden(\?|$)/))
  })

  // ═══════════════════════════════════════════════════════════════════════
  //  KEY TEST: jefa_chome has requests:view_all but NOT requests:view_own
  // ═══════════════════════════════════════════════════════════════════════

  it("allows jefa_chome (requests:view_all without requests:view_own) through the gate", async () => {
    mockAuthFn.mockResolvedValue(makeSession({
      roles: ["jefa_chome"],
      permissions: ["requests:view_all", "requests:delete"],
      worksiteIds: [],
    }))
    await expect(SolicitudesPage({ searchParams: Promise.resolve({}) }))
      .resolves.toBeDefined()
    expect(mockRedirect).not.toHaveBeenCalledWith(expect.stringMatching(/^\/forbidden(\?|$)/))
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
//  2. Soporte list page
// ═══════════════════════════════════════════════════════════════════════════════

describe("soporte/page.tsx — permission gate", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("redirects to /forbidden for unauthenticated users", async () => {
    mockAuthFn.mockResolvedValue(null)
    await expect(SoportePage()).rejects.toThrow("NEXT_REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith(expect.stringMatching(/^\/forbidden(\?|$)/))
  })

  it("redirects to /forbidden for users without feedback:view_own AND without feedback:view_all AND without feedback:manage", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ permissions: ["some:other"] }))
    await expect(SoportePage()).rejects.toThrow("NEXT_REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith(expect.stringMatching(/^\/forbidden(\?|$)/))
  })

  it("allows users with only feedback:view_own through the gate", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ permissions: ["feedback:view_own"] }))
    await expect(SoportePage()).resolves.toBeDefined()
    expect(mockRedirect).not.toHaveBeenCalledWith(expect.stringMatching(/^\/forbidden(\?|$)/))
  })

  it("allows users with only feedback:view_all through the gate", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ permissions: ["feedback:view_all"] }))
    await expect(SoportePage()).resolves.toBeDefined()
    expect(mockRedirect).not.toHaveBeenCalledWith(expect.stringMatching(/^\/forbidden(\?|$)/))
  })

  it("allows users with only feedback:manage through the gate", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ permissions: ["feedback:manage"] }))
    await expect(SoportePage()).resolves.toBeDefined()
    expect(mockRedirect).not.toHaveBeenCalledWith(expect.stringMatching(/^\/forbidden(\?|$)/))
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
//  3. Soporte detail page
// ═══════════════════════════════════════════════════════════════════════════════

describe("soporte/[id]/page.tsx — permission gate", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("redirects to /forbidden for unauthenticated users", async () => {
    mockAuthFn.mockResolvedValue(null)
    await expect(ReporteDetailPage({ params: Promise.resolve({ id: "test-1" }) }))
      .rejects.toThrow("NEXT_REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith(expect.stringMatching(/^\/forbidden(\?|$)/))
  })

  it("redirects to /forbidden for users without feedback:view_own AND without feedback:view_all AND without feedback:manage", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ permissions: ["some:other"] }))
    await expect(ReporteDetailPage({ params: Promise.resolve({ id: "test-1" }) }))
      .rejects.toThrow("NEXT_REDIRECT")
    expect(mockRedirect).toHaveBeenCalledWith(expect.stringMatching(/^\/forbidden(\?|$)/))
  })

  it("allows users with feedback:view_own through the gate (then calls notFound)", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ permissions: ["feedback:view_own"] }))
    await expect(ReporteDetailPage({ params: Promise.resolve({ id: "test-1" }) }))
      .rejects.toThrow("NEXT_NOT_FOUND")
    expect(mockRedirect).not.toHaveBeenCalledWith(expect.stringMatching(/^\/forbidden(\?|$)/))
  })

  it("allows users with feedback:view_all through the gate", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ permissions: ["feedback:view_all"] }))
    await expect(ReporteDetailPage({ params: Promise.resolve({ id: "test-1" }) }))
      .rejects.toThrow("NEXT_NOT_FOUND")
    expect(mockRedirect).not.toHaveBeenCalledWith(expect.stringMatching(/^\/forbidden(\?|$)/))
  })

  it("allows users with feedback:manage through the gate", async () => {
    mockAuthFn.mockResolvedValue(makeSession({ permissions: ["feedback:manage"] }))
    await expect(ReporteDetailPage({ params: Promise.resolve({ id: "test-1" }) }))
      .rejects.toThrow("NEXT_NOT_FOUND")
    expect(mockRedirect).not.toHaveBeenCalledWith(expect.stringMatching(/^\/forbidden(\?|$)/))
  })
})
