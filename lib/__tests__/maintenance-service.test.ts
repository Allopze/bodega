import { describe, expect, it, vi } from "vitest"
import { createMaintenanceRecord, type CreateMaintenanceInput } from "@/lib/services/maintenance"

const mockFindFirst = vi.fn()
const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(true) })

vi.mock("@/db", () => ({
  db: {
    query: {
      fuelVehicles: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
    insert: (...args: unknown[]) => mockInsert(...args),
  },
}))

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
}))

describe("Maintenance Service (createMaintenanceRecord)", () => {
  const dummySession: any = {
    user: { id: "user-1", email: "mantencion@chome.cl", role: "admin" },
  }

  it("rejects maintenance record creation for non-existent vehicle", async () => {
    mockFindFirst.mockResolvedValueOnce(null)

    const input: CreateMaintenanceInput = {
      vehicleId: "veh-nonexistent",
      maintenanceDate: "2026-07-22",
      maintenanceType: "preventiva",
      status: "scheduled",
      netAmount: 100000,
      taxAmount: 19000,
      totalAmount: 119000,
    }

    await expect(createMaintenanceRecord(dummySession, input)).rejects.toThrow("Vehículo no encontrado")
  })

  it("checks worksite access scope when session is restricted", async () => {
    mockFindFirst.mockResolvedValueOnce({ id: "veh-1", worksiteId: "ws-restricted" })

    const restrictedSession: any = {
      user: { id: "user-2", role: "user", worksiteIds: ["ws-allowed"] },
    }

    const input: CreateMaintenanceInput = {
      vehicleId: "veh-1",
      worksiteId: "ws-restricted",
      maintenanceDate: "2026-07-22",
      maintenanceType: "correctiva",
      status: "in_progress",
      netAmount: 50000,
      taxAmount: 9500,
      totalAmount: 59500,
    }

    await expect(createMaintenanceRecord(restrictedSession, input)).rejects.toThrow("No puedes registrar mantenciones para esta faena")
  })
})
