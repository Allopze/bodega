/**
 * Unit tests for registerReceipt action — access control and validation.
 *
 * Uses the same pattern as other action tests: mock auth + service layer,
 * verify each guard in the action fires correctly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockRegisterReceipt = vi.hoisted(() => vi.fn())
const mockRedirect = vi.hoisted(() => vi.fn(() => ({ ok: true, message: "redirect" })))
const mockDbState = vi.hoisted(() => ({
  order: { id: "oc-1", worksiteId: "ws-1" } as { id: string; worksiteId: string } | undefined,
}))

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("@/lib/services/receiving", () => ({ registerReceipt: mockRegisterReceipt }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: mockRedirect }))
vi.mock("@/db", () => ({
  db: {
    query: {
      purchaseOrders: {
        findFirst: vi.fn(() => mockDbState.order),
      },
    },
  },
}))

import { registerReceiptAction } from "@/app/(app)/recepcion/actions"

function makeSession(overrides: Partial<Session["user"]> = {}): Session {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "admin@test.cl",
      name: "Admin",
      roles: ["administrador"],
      permissions: ["receiving:register_faena", "receiving:register_office"],
      worksiteIds: ["ws-1"],
      primaryWorksiteId: "ws-1",
      avatarColor: "#000",
      isActive: true,
      ...overrides,
    },
  }
}

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("purchaseOrderId", "oc-1")
  fd.set("stage", "office")
  fd.set("itemsJson", JSON.stringify([
    { purchaseOrderItemId: "poi-1", quantityReceived: 10 },
  ]))
  for (const [k, v] of Object.entries(overrides)) {
    if (v === "") fd.delete(k)
    else fd.set(k, v)
  }
  return fd
}

describe("registerReceiptAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbState.order = { id: "oc-1", worksiteId: "ws-1" }
  })

  it("returns error if user lacks permission", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession({ permissions: [] }))
    const res = await registerReceiptAction({ ok: false, message: "" }, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/permisos/i)
    expect(mockRegisterReceipt).not.toHaveBeenCalled()
  })

  it("returns error if items JSON is invalid", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const fd = makeFormData({ itemsJson: "{bad" })
    const res = await registerReceiptAction({ ok: false, message: "" }, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("ítems")
    expect(mockRegisterReceipt).not.toHaveBeenCalled()
  })

  it("returns error if Zod validation fails", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const fd = makeFormData({ purchaseOrderId: "" })
    const res = await registerReceiptAction({ ok: false, message: "" }, fd)
    expect(res.ok).toBe(false)
    expect(res.fieldErrors).toBeDefined()
    expect(mockRegisterReceipt).not.toHaveBeenCalled()
  })

  it("propagates service error", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockRegisterReceipt.mockRejectedValueOnce(new Error("OC no encontrada"))
    const res = await registerReceiptAction({ ok: false, message: "" }, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("OC no encontrada")
  })

  it("registers receipt successfully", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockRegisterReceipt.mockResolvedValueOnce("rec-1")
    const res = await registerReceiptAction({ ok: false, message: "" }, makeFormData())
    expect(res).toBeUndefined()
    expect(mockRegisterReceipt).toHaveBeenCalledWith(expect.any(Object), "all")
    expect(mockRedirect).toHaveBeenCalledWith("/recepcion/rec-1")
  })

  it("checks faena-stage permission vs office", async () => {
    // User only has office permission
    mockAuthFn.mockResolvedValueOnce(makeSession({ permissions: ["receiving:register_office"] }))
    const fd = makeFormData({ stage: "faena" })
    const res = await registerReceiptAction({ ok: false, message: "" }, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("permisos")
    expect(mockRegisterReceipt).not.toHaveBeenCalled()
  })
})
