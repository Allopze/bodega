/**
 * Additional unit tests for solicitudes Server Actions (coverage 36.61% → now covered).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockRequireAuth = vi.hoisted(() => vi.fn())
const mockCanAccessWorksite = vi.hoisted(() => vi.fn(() => true))
const mockCan = vi.hoisted(() => vi.fn(() => true))
const mockFindFirstRequest = vi.hoisted(() => vi.fn())
const mockFindManyItems = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
  requireAuth: mockRequireAuth,
  canAccessWorksite: mockCanAccessWorksite,
  can: mockCan,
}))
vi.mock("@/db", () => {
  const db = {
    query: {
      purchaseRequests: { findFirst: mockFindFirstRequest },
      purchaseRequestItems: { findMany: mockFindManyItems },
      products: { findMany: vi.fn(() => []) },
    },
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    transaction: vi.fn(async <T,>(fn: (tx: typeof db) => T): Promise<T> => fn(db)),
    delete: vi.fn(() => ({ where: vi.fn() })),
  }
  return { db }
})
vi.mock("@/lib/services/requests-delete", () => ({
  deleteRequest: vi.fn(),
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
  recordStatusChange: vi.fn(),
}))
vi.mock("@/lib/services/notifications", () => ({
  notifyManyUser: vi.fn(),
  getUserIdsWithPermission: vi.fn(() => Promise.resolve([])),
  notifyAfterCommit: vi.fn((fn: () => unknown) => fn()),
}))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("@/lib/request-types", () => ({
  isRequestType: vi.fn(() => true),
  permissionForRequestType: vi.fn(() => "requests:view_own"),
  QUOTATION_TYPES: new Set(["repuestos", "servicios"]),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { deleteRequestAction } from "@/app/(app)/solicitudes/actions"
import type { ActionState } from "@/lib/validation/operations"

const prevState: ActionState = { ok: false, message: "" }

function makeSession() {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1", email: "admin@test.cl", name: "Admin",
      roles: ["administrador"],
      permissions: ["requests:create", "requests:view_own", "requests:view_all", "requests:delete"],
      worksiteIds: ["ws-1"], primaryWorksiteId: "ws-1",
      avatarColor: "#000", isActive: true,
    },
  }
}

// F1-1/F1-2 unificó cancelRequest en un solo servicio (cancel-request.ts) que
// lockea el padre Y sus ítems (FOR UPDATE) antes de decidir — el mock plano
// de `@/db` de este archivo (un objeto único sin locks reales) ya no alcanza
// para ejercitarlo. La cobertura real vive en:
//   - lib/__tests__/cancel-request-action.test.ts (guards de la action: auth,
//     ownership, scope de faena, delegación al servicio)
//   - lib/__tests__/cancel-request-service.test.ts (PGlite: estado
//     cancelable, motivo obligatorio, ítems bloqueados, rechazo de ítems
//     abiertos, liberación de reposición EPP)

describe("deleteRequestAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const fd = new FormData()
    fd.set("requestId", "req-1")
    const res = await deleteRequestAction(prevState, fd)
    expect(res.ok).toBe(false)
  })

  it("returns error if requestId missing", async () => {
    const fd = new FormData()
    const res = await deleteRequestAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("ID requerido")
  })

  it("returns error if request not found", async () => {
    mockFindFirstRequest.mockResolvedValueOnce(undefined)
    const fd = new FormData()
    fd.set("requestId", "req-1")
    const res = await deleteRequestAction(prevState, fd)
    expect(res.ok).toBe(false)
  })
})
