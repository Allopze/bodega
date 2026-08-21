import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockCreateMaintenanceRecord = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}))
vi.mock("@/lib/services/maintenance", () => ({
  createMaintenanceRecord: (...args: unknown[]) => mockCreateMaintenanceRecord(...args),
  updateMaintenanceRecord: vi.fn(),
  transitionMaintenanceRecord: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))

function validFormData() {
  const fd = new FormData()
  fd.set("vehicleId", "veh-1")
  fd.set("maintenanceDate", "2026-06-01")
  fd.set("maintenanceType", "preventiva")
  fd.set("status", "scheduled")
  fd.set("netAmount", "100")
  fd.set("taxAmount", "19")
  fd.set("totalAmount", "119")
  return fd
}

describe("mantenciones Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("denies create without mantenciones:create", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("Forbidden"))
    const { createMaintenanceRecordAction } = await import("./actions")

    const result = await createMaintenanceRecordAction({ ok: false }, validFormData())

    expect(result.ok).toBe(false)
    expect(mockCreateMaintenanceRecord).not.toHaveBeenCalled()
  })

  it("calls the service with parsed input when allowed", async () => {
    mockRequirePermission.mockResolvedValueOnce({ user: { id: "u-1" } })
    mockCreateMaintenanceRecord.mockResolvedValueOnce("maint-1")
    const { createMaintenanceRecordAction } = await import("./actions")

    const result = await createMaintenanceRecordAction({ ok: false }, validFormData())

    expect(result.ok).toBe(true)
    expect(mockCreateMaintenanceRecord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      vehicleId: "veh-1",
      status: "scheduled",
      totalAmount: 119,
    }))
  })
})
