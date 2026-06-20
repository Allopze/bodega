/**
 * Unit tests for registerWorkerDelivery / registerDelivery actions.
 *
 * Covers permission guard and scope enforcement for the deliveries flow.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockRegisterWorker = vi.hoisted(() => vi.fn())
const mockRegisterWorksite = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("@/lib/services/deliveries", () => ({
  registerWorkerEppDelivery: mockRegisterWorker,
  registerWorksiteDelivery: mockRegisterWorksite,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { registerWorkerDeliveryAction } from "@/app/(app)/entregas/actions"

function makeSession(overrides: Partial<Session["user"]> = {}): Session {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "op@test.cl",
      name: "Operador",
      roles: ["secretaria"],
      permissions: ["warehouse:register_movement"],
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
  fd.set("worksiteId", "ws-1")
  fd.set("workerId", "w-1")
  fd.set("requestItemId", "ri-1")
  fd.set("quantity", "2")
  for (const [k, v] of Object.entries(overrides)) {
    if (v === "") fd.delete(k)
    else fd.set(k, v)
  }
  return fd
}

describe("registerWorkerDeliveryAction", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("returns error if user lacks permission", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession({ permissions: [] }))
    const res = await registerWorkerDeliveryAction({ ok: false, message: "" }, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/permisos/i)
    expect(mockRegisterWorker).not.toHaveBeenCalled()
  })

  it("returns error if workerId is missing", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const fd = makeFormData({ workerId: "" })
    const res = await registerWorkerDeliveryAction({ ok: false, message: "" }, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("trabajador")
    expect(mockRegisterWorker).not.toHaveBeenCalled()
  })

  it("returns error if quantity is invalid", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    const fd = makeFormData({ quantity: "0" })
    const res = await registerWorkerDeliveryAction({ ok: false, message: "" }, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("cantidad")
    expect(mockRegisterWorker).not.toHaveBeenCalled()
  })

  it("propagates service error", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockRegisterWorker.mockRejectedValueOnce(new Error("Stock insuficiente"))
    const res = await registerWorkerDeliveryAction({ ok: false, message: "" }, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Stock insuficiente")
  })

  it("registers delivery successfully", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession())
    mockRegisterWorker.mockResolvedValueOnce("del-1")
    const res = await registerWorkerDeliveryAction({ ok: false, message: "" }, makeFormData())
    expect(res.ok).toBe(true)
    expect(mockRegisterWorker).toHaveBeenCalledOnce()
  })

  it("rejects worksite outside user scope", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession({ worksiteIds: ["ws-other"] }))
    const res = await registerWorkerDeliveryAction({ ok: false, message: "" }, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/acceso|faena/i)
    expect(mockRegisterWorker).not.toHaveBeenCalled()
  })
})
