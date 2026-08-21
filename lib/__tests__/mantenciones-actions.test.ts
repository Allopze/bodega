/**
 * Unit tests for mantenciones Server Actions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockCreateMaintenance = vi.hoisted(() => vi.fn(() => "maint-1"))
const mockUpdateMaintenance = vi.hoisted(() => vi.fn())
const mockTransitionMaintenance = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
}))

vi.mock("@/lib/services/maintenance", () => ({
  createMaintenanceRecord: mockCreateMaintenance,
  updateMaintenanceRecord: mockUpdateMaintenance,
  transitionMaintenanceRecord: mockTransitionMaintenance,
}))

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn() },
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import {
  createMaintenanceRecordAction,
  updateMaintenanceRecordAction,
  cancelMaintenanceRecordAction,
  transitionMaintenanceRecordAction,
} from "@/app/(app)/mantenciones/actions"
import type { ActionState } from "@/lib/validation/masters"

const prevState: ActionState = { ok: false, message: "" }

function makeSession() {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1", email: "admin@test.cl", name: "Admin",
      roles: ["administrador"], permissions: ["mantenciones:create", "mantenciones:edit"],
      worksiteIds: ["ws-1"], primaryWorksiteId: "ws-1",
      avatarColor: "#000", isActive: true,
    },
  }
}

function makeFormData(overrides: Record<string, string | number> = {}): FormData {
  const fd = new FormData()
  fd.set("vehicleId", "v-1")
  fd.set("maintenanceDate", "2025-06-15")
  fd.set("maintenanceType", "correctiva")
  fd.set("status", "scheduled")
  fd.set("netAmount", "100000")
  fd.set("taxAmount", "19000")
  fd.set("totalAmount", "119000")
  for (const [k, v] of Object.entries(overrides)) fd.set(k, String(v))
  return fd
}

describe("createMaintenanceRecordAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const res = await createMaintenanceRecordAction(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if validation fails (missing vehicle)", async () => {
    const fd = makeFormData()
    fd.delete("vehicleId")
    const res = await createMaintenanceRecordAction(prevState, fd)
    expect(res.ok).toBe(false)
  })

  it("returns error if total does not match net+tax", async () => {
    const fd = makeFormData({ totalAmount: "99999" })
    const res = await createMaintenanceRecordAction(prevState, fd)
    expect(res.ok).toBe(false)
  })

  it("creates record successfully", async () => {
    const res = await createMaintenanceRecordAction(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(res.message).toContain("Mantención registrada")
  })

  it("returns error on service failure", async () => {
    mockCreateMaintenance.mockRejectedValueOnce(new Error("DB error"))
    const res = await createMaintenanceRecordAction(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("DB error")
  })
})

describe("updateMaintenanceRecordAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const res = await updateMaintenanceRecordAction(prevState, makeFormData({ id: "m-1" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if total does not match net+tax", async () => {
    const fd = makeFormData({ id: "m-1", totalAmount: "99999" })
    const res = await updateMaintenanceRecordAction(prevState, fd)
    expect(res.ok).toBe(false)
  })

  it("updates record successfully", async () => {
    const res = await updateMaintenanceRecordAction(prevState, makeFormData({ id: "m-1" }))
    expect(res.ok).toBe(true)
    expect(res.message).toContain("Mantención actualizada")
  })

  it("returns error on service failure", async () => {
    mockUpdateMaintenance.mockRejectedValueOnce(new Error("Not found"))
    const res = await updateMaintenanceRecordAction(prevState, makeFormData({ id: "m-1" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Not found")
  })
})

describe("cancelMaintenanceRecordAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const res = await cancelMaintenanceRecordAction("m-1", "scheduled", "Orden duplicada")
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if id is empty", async () => {
    const res = await cancelMaintenanceRecordAction("", "scheduled", "Orden duplicada")
    expect(res.ok).toBe(false)
    expect(res.message).toContain("ID requerido")
  })

  it("cancels maintenance successfully", async () => {
    mockTransitionMaintenance.mockResolvedValueOnce({ status: "cancelled" })
    const res = await cancelMaintenanceRecordAction("m-1", "scheduled", "Orden duplicada")
    expect(res.ok).toBe(true)
    expect(res.message).toContain("Estado de mantención actualizado")
    expect(mockTransitionMaintenance).toHaveBeenCalledWith(expect.anything(), {
      id: "m-1",
      expectedStatus: "scheduled",
      transition: "cancel",
      reason: "Orden duplicada",
    })
  })

  it("returns error on service failure", async () => {
    mockTransitionMaintenance.mockRejectedValueOnce(new Error("Already cancelled"))
    const res = await cancelMaintenanceRecordAction("m-1", "scheduled", "Orden duplicada")
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Already cancelled")
  })

  it("rechaza una transición sin motivo antes de llamar al servicio", async () => {
    const res = await transitionMaintenanceRecordAction({
      id: "m-1",
      expectedStatus: "in_progress",
      transition: "complete",
      reason: "ok",
    })
    expect(res.ok).toBe(false)
    expect(mockTransitionMaintenance).not.toHaveBeenCalled()
  })
})
