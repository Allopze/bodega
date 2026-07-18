/**
 * Regression tests for CHO-003 (AUDITORIA_INTEGRAL_CHOME.md): the repuestos
 * and servicios quotation download routes must enforce owner-or-view_all,
 * on top of worksite scope, instead of only checking worksite access.
 * `can`/`canAccessWorksite` are exercised for real (only auth/db/fs/storage
 * are mocked) so the actual authorization branching in each route is tested.
 */

import type { Session } from "next-auth"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAuth = vi.hoisted(() => vi.fn())
const mockFindRepuestoQuotation = vi.hoisted(() => vi.fn())
const mockFindServiceQuotation = vi.hoisted(() => vi.fn())
const mockFindPurchaseRequest = vi.hoisted(() => vi.fn())
const mockReadFile = vi.hoisted(() => vi.fn())
const mockResolveQuotationAttachmentFile = vi.hoisted(() => vi.fn())
const mockResolveServiceQuotationFile = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuth }))
vi.mock("@/db", () => ({
  db: {
    query: {
      repuestoQuotations: { findFirst: mockFindRepuestoQuotation },
      serviceQuotations: { findFirst: mockFindServiceQuotation },
      purchaseRequests: { findFirst: mockFindPurchaseRequest },
    },
  },
}))
vi.mock("node:fs", () => ({ promises: { readFile: mockReadFile } }))
vi.mock("@/lib/storage/config", () => ({
  resolveQuotationAttachmentFile: mockResolveQuotationAttachmentFile,
  resolveServiceQuotationFile: mockResolveServiceQuotationFile,
}))
vi.mock("@/lib/utils", () => ({
  encodeContentDisposition: vi.fn(() => "inline; filename=cotizacion.pdf"),
}))

import { GET as getRepuestoQuotation } from "@/app/api/repuestos/quotaciones/[id]/route"
import { GET as getServiceQuotation } from "@/app/api/servicios/cotizaciones/[id]/route"

function makeSession(overrides: {
  userId?: string
  permissions?: string[]
  worksiteIds?: string[]
  isGlobal?: boolean
} = {}): Session {
  const worksiteIds = overrides.worksiteIds ?? []
  return {
    user: {
      id: overrides.userId ?? "user-a",
      name: "Test User",
      email: "test@example.com",
      roles: [],
      permissions: overrides.permissions ?? [],
      worksiteIds,
      primaryWorksiteId: worksiteIds[0] ?? null,
      avatarColor: null,
      isActive: true,
      isGlobal: overrides.isGlobal ?? false,
    },
    expires: "2099-01-01T00:00:00.000Z",
  }
}

function makeReq() {
  return new NextRequest(new URL("http://localhost/api/x/y/q-1"))
}

const quotation = { id: "q-1", requestId: "req-1", filePath: "q-1.pdf", fileName: "cotizacion.pdf" }

const routeConfigs = [
  {
    label: "repuestos quotaciones",
    GET: getRepuestoQuotation,
    permOwn: "repuestos:view_own",
    permAll: "repuestos:view_all",
    findQuotation: mockFindRepuestoQuotation,
    resolveFile: mockResolveQuotationAttachmentFile,
  },
  {
    label: "servicios cotizaciones",
    GET: getServiceQuotation,
    permOwn: "servicios:view_own",
    permAll: "servicios:view_all",
    findQuotation: mockFindServiceQuotation,
    resolveFile: mockResolveServiceQuotationFile,
  },
] as const

describe.each(routeConfigs)("$label — descarga: propiedad y alcance de faena", (config) => {
  beforeEach(() => {
    vi.resetAllMocks()
    config.resolveFile.mockReturnValue("/tmp/fake-quotation-path.pdf")
    mockReadFile.mockResolvedValue(Buffer.from("%PDF-1.4"))
  })

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await config.GET(makeReq(), { params: Promise.resolve({ id: "q-1" }) })
    expect(res.status).toBe(401)
  })

  it("returns 403 without view_own or view_all", async () => {
    mockAuth.mockResolvedValueOnce(makeSession({ permissions: [] }))
    const res = await config.GET(makeReq(), { params: Promise.resolve({ id: "q-1" }) })
    expect(res.status).toBe(403)
  })

  it("returns 404 when the quotation does not exist", async () => {
    mockAuth.mockResolvedValueOnce(makeSession({ permissions: [config.permOwn], worksiteIds: ["ws-a"] }))
    config.findQuotation.mockResolvedValueOnce(undefined)
    const res = await config.GET(makeReq(), { params: Promise.resolve({ id: "missing" }) })
    expect(res.status).toBe(404)
  })

  it("returns 404 (IDOR) for a view_own user in the right worksite but a different requester", async () => {
    mockAuth.mockResolvedValueOnce(
      makeSession({ userId: "user-b", permissions: [config.permOwn], worksiteIds: ["ws-a"] }),
    )
    config.findQuotation.mockResolvedValueOnce(quotation)
    mockFindPurchaseRequest.mockResolvedValueOnce({ worksiteId: "ws-a", requesterId: "user-a" })

    const res = await config.GET(makeReq(), { params: Promise.resolve({ id: "q-1" }) })

    expect(res.status).toBe(404)
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it("returns 200 for the owner with view_own in the right worksite", async () => {
    mockAuth.mockResolvedValueOnce(
      makeSession({ userId: "user-a", permissions: [config.permOwn], worksiteIds: ["ws-a"] }),
    )
    config.findQuotation.mockResolvedValueOnce(quotation)
    mockFindPurchaseRequest.mockResolvedValueOnce({ worksiteId: "ws-a", requesterId: "user-a" })

    const res = await config.GET(makeReq(), { params: Promise.resolve({ id: "q-1" }) })

    expect(res.status).toBe(200)
  })

  it("returns 200 for a view_all user regardless of requester, within worksite scope", async () => {
    mockAuth.mockResolvedValueOnce(
      makeSession({ userId: "user-c", permissions: [config.permAll], worksiteIds: ["ws-a"] }),
    )
    config.findQuotation.mockResolvedValueOnce(quotation)
    mockFindPurchaseRequest.mockResolvedValueOnce({ worksiteId: "ws-a", requesterId: "user-a" })

    const res = await config.GET(makeReq(), { params: Promise.resolve({ id: "q-1" }) })

    expect(res.status).toBe(200)
  })

  it("returns 404 for the owner when the parent request's worksite is out of session scope", async () => {
    mockAuth.mockResolvedValueOnce(
      makeSession({ userId: "user-a", permissions: [config.permOwn], worksiteIds: ["ws-b"] }),
    )
    config.findQuotation.mockResolvedValueOnce(quotation)
    mockFindPurchaseRequest.mockResolvedValueOnce({ worksiteId: "ws-a", requesterId: "user-a" })

    const res = await config.GET(makeReq(), { params: Promise.resolve({ id: "q-1" }) })

    expect(res.status).toBe(404)
  })

  it("returns 404 for a view_all user outside worksite scope (no global bypass)", async () => {
    mockAuth.mockResolvedValueOnce(
      makeSession({ userId: "user-c", permissions: [config.permAll], worksiteIds: ["ws-b"], isGlobal: false }),
    )
    config.findQuotation.mockResolvedValueOnce(quotation)
    mockFindPurchaseRequest.mockResolvedValueOnce({ worksiteId: "ws-a", requesterId: "user-a" })

    const res = await config.GET(makeReq(), { params: Promise.resolve({ id: "q-1" }) })

    expect(res.status).toBe(404)
  })
})
