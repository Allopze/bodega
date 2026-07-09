/**
 * Integration-level tests for solicitudes Server Actions — access control.
 *
 * Verifies that saveDraft and submitRequest reject request types whose
 * module-specific permission the session lacks.
 *
 * Pattern: mock auth + DB so the action runs but fails at the permission gate
 * before touching any domain service.
 */

import { describe, expect, it, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

// ── Hoisted mutable state ─────────────────────────────────────────────────────
const mockAuthFn = vi.hoisted(() => vi.fn())

// ── Module mocks: minimal surface so saveDraft can be imported ─────────────────
vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))

vi.mock("@/db", () => ({
  db: {
    query: {
      purchaseRequests: { findFirst: vi.fn() },
    },
  },
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

// PersistDraft delegates to these for quotation types; we never reach them
// because the permission gate fires first.
vi.mock("@/lib/services/repuestos", () => ({
  persistRepuestoDraft: vi.fn(),
  addQuotation: vi.fn(),
  submitRepuestoRequest: vi.fn(),
}))

vi.mock("@/lib/services/servicios", () => ({
  persistServiceDraft: vi.fn(),
  addServiceQuotation: vi.fn(),
  submitServiceRequest: vi.fn(),
}))

vi.mock("@/lib/services/requests-draft", () => ({
  persistRequestWithDiff: vi.fn(),
}))

vi.mock("@/lib/services/system-settings", () => ({
  getPdfMaxSizeMb: vi.fn().mockResolvedValue(10),
}))

vi.mock("@/lib/code-sequences", () => ({
  nextCodeTx: vi.fn((_: unknown, fn: () => Promise<string>) => fn()),
}))

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
  recordStatusChange: vi.fn(),
}))

vi.mock("@/lib/services/notifications", () => ({
  notifyManyUser: vi.fn(),
  getUserIdsWithPermission: vi.fn().mockResolvedValue([]),
  notifyAfterCommit: vi.fn(),
}))

vi.mock("@/lib/services/item-state", () => ({
  submitItemTx: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({  
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

// ── Import after mocks ────────────────────────────────────────────────────────
import { saveDraft } from "@/app/(app)/solicitudes/actions"
import { INITIAL_STATE } from "@/components/admin/form-state"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSession(permissions: string[]): Session {
  return {
    user: {
      id: "user-test",
      name: "Test User",
      email: "test@chome.cl",
      roles: ["solicitante_faena"],
      permissions,
      worksiteIds: ["ws-1"],
      primaryWorksiteId: "ws-1",
      avatarColor: null,
      isActive: true,
    },
    expires: "2030-01-01T00:00:00.000Z",
  }
}

function formData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("worksiteId", "ws-1")
  fd.set("requestType", "epp")
  fd.set("urgency", "normal")
  fd.set("requiredDate", "2026-12-31")
  fd.set("notes", "Test")
  fd.set("itemsJson", JSON.stringify([{ productNameFree: "Item de prueba", quantity: 1, unitOfMeasure: "unidad" }]))
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("saveDraft — RBAC rejection by request type", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("allows save when the session has the required create permission", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession(["requests:create", "repuestos:create", "servicios:create", "requests:view_all"]))
    // The permission gate passes; the action will fail later at
    // canAccessWorksite because there is no real session → worksite
    // mapping, but that confirms the permission check did NOT reject.
    const res = await saveDraft(INITIAL_STATE, formData({ requestType: "repuestos" }))
    // If permissions were the issue we'd get the "No tienes permisos" message;
    // instead we should get a worksite-related or DB error.
    expect(res.message).not.toContain("No tienes permisos para crear este tipo de solicitud")
  })

  it("rejects repuestos when session lacks repuestos:create", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession(["requests:create"]))
    const res = await saveDraft(INITIAL_STATE, formData({ requestType: "repuestos" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No tienes permisos para crear este tipo de solicitud")
  })

  it("rejects servicios when session lacks servicios:create", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession(["requests:create"]))
    const res = await saveDraft(INITIAL_STATE, formData({ requestType: "servicios" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No tienes permisos para crear este tipo de solicitud")
  })

  it("allows epp when session has only requests:create", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession(["requests:create", "requests:view_all"]))
    // Same as first test: the permission gate passes; the action will later
    // fail at worksite checking or persistRequestWithDiff for other reasons.
    const res = await saveDraft(INITIAL_STATE, formData({ requestType: "epp" }))
    expect(res.message).not.toContain("No tienes permisos para crear este tipo de solicitud")
  })

  it("allows otro when session has only requests:create", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession(["requests:create", "requests:view_all"]))
    const res = await saveDraft(INITIAL_STATE, formData({ requestType: "otro" }))
    expect(res.message).not.toContain("No tienes permisos para crear este tipo de solicitud")
  })

  it("rejects when not authenticated", async () => {
    mockAuthFn.mockResolvedValueOnce(null)
    const res = await saveDraft(INITIAL_STATE, formData({ requestType: "repuestos" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Debes iniciar sesión")
  })
})
