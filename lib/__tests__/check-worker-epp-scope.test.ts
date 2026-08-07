/**
 * getWorkerEppStatusAction: el workerId llega del cliente, así que la acción
 * debe autorizarlo por permiso y por faena antes de consultar nada.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequireAuth = vi.hoisted(() => vi.fn())
const mockCanAny = vi.hoisted(() => vi.fn(() => true))
const mockFindFirstWorker = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
const mockWorksiteScopeSql = vi.hoisted(() => vi.fn(() => undefined))

vi.mock("@/lib/auth/can", () => ({
  requireAuth: mockRequireAuth,
  canAny: mockCanAny,
}))
vi.mock("@/lib/auth/scope", () => ({
  worksiteScopeSql: mockWorksiteScopeSql,
}))
vi.mock("@/db", () => ({
  db: {
    query: { workers: { findFirst: mockFindFirstWorker } },
    select: mockSelect,
  },
}))

import { getWorkerEppStatusAction } from "@/app/(app)/solicitudes/actions-module/check-worker-epp"

/** Cadena drizzle encadenable: cualquier método devuelve la cadena; `limit` resuelve filas. */
function chain(rows: unknown[]) {
  const link: Record<string, unknown> = {}
  for (const method of ["from", "innerJoin", "leftJoin", "where", "orderBy"]) {
    link[method] = () => link
  }
  link.limit = () => Promise.resolve(rows)
  return link
}

const EMPTY = { activeRequest: null, lastDelivery: null }

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1", email: "faena@test.cl", name: "Solicitante",
      roles: ["solicitante_faena"], permissions: ["requests:create", "requests:view_own"],
      worksiteIds: ["ws-1"], primaryWorksiteId: "ws-1", isGlobal: false,
      avatarColor: "#000", isActive: true, ...overrides,
    },
  }
}

describe("getWorkerEppStatusAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequireAuth.mockResolvedValue(makeSession())
    mockCanAny.mockReturnValue(true)
    mockWorksiteScopeSql.mockReturnValue(undefined)
    mockSelect.mockImplementation(() => chain([]))
  })

  it("no consulta nada si el trabajador queda fuera del alcance de faena", async () => {
    mockFindFirstWorker.mockResolvedValue(undefined)

    const res = await getWorkerEppStatusAction("worker-de-otra-faena", "prod-1")

    expect(res).toEqual(EMPTY)
    expect(mockFindFirstWorker).toHaveBeenCalledTimes(1)
    expect(mockWorksiteScopeSql).toHaveBeenCalledTimes(1)
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it("niega a una sesión sin ningún permiso de solicitudes", async () => {
    mockCanAny.mockReturnValue(false)

    const res = await getWorkerEppStatusAction("worker-1", "prod-1")

    expect(res).toEqual(EMPTY)
    expect(mockFindFirstWorker).not.toHaveBeenCalled()
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it("devuelve el estado cuando el trabajador está dentro del alcance", async () => {
    mockFindFirstWorker.mockResolvedValue({ id: "worker-1" })
    mockSelect
      .mockImplementationOnce(() => chain([{ code: "SOL-0001", status: "submitted" }]))
      .mockImplementationOnce(() => chain([{ deliveredAt: "2026-01-01", lifespanMonths: 12 }]))

    const res = await getWorkerEppStatusAction("worker-1", "prod-1")

    expect(res.activeRequest).toEqual({ code: "SOL-0001", status: "submitted" })
    expect(res.lastDelivery).toEqual({ deliveredAt: "2026-01-01", lifespanMonths: 12 })
  })
})
