import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

const findFirstVehicle = vi.fn()
const findFirstRecord = vi.fn()
const insertValues = vi.fn(() => Promise.resolve())
const updateWhere = vi.fn(() => Promise.resolve())
const updateSet = vi.fn(() => ({ where: updateWhere }))

vi.mock("@/db", () => ({
  db: {
    query: {
      fuelVehicles: { findFirst: () => findFirstVehicle() },
      maintenanceRecords: { findFirst: () => findFirstRecord() },
    },
    insert: () => ({ values: insertValues }),
    update: () => ({ set: updateSet }),
  },
}))

vi.mock("@/lib/auth/scope", () => ({
  isGlobalRole: vi.fn(),
  visibleWorksiteIds: vi.fn(),
}))

import {
  createMaintenanceRecord,
  updateMaintenanceRecord,
  cancelMaintenanceRecord,
  type CreateMaintenanceInput,
} from "@/lib/services/maintenance"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"

const mockIsGlobalRole = vi.mocked(isGlobalRole)
const mockVisibleWorksiteIds = vi.mocked(visibleWorksiteIds)

const session = { user: { id: "user-1" } } as Session

const input: CreateMaintenanceInput = {
  vehicleId: "veh-1",
  maintenanceDate: "2026-06-01",
  maintenanceType: "preventiva",
  status: "completed",
  netAmount: 100,
  taxAmount: 19,
  totalAmount: 119,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsGlobalRole.mockReturnValue(true)
  mockVisibleWorksiteIds.mockReturnValue([])
})

describe("createMaintenanceRecord", () => {
  it("throws when the vehicle does not exist", async () => {
    findFirstVehicle.mockResolvedValue(undefined)
    await expect(createMaintenanceRecord(session, input)).rejects.toThrow("Vehículo no encontrado")
  })

  it("blocks scoped users from a worksite they cannot see", async () => {
    findFirstVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "ws-2" })
    mockIsGlobalRole.mockReturnValue(false)
    mockVisibleWorksiteIds.mockReturnValue(["ws-1"])
    await expect(createMaintenanceRecord(session, input)).rejects.toThrow("No puedes registrar")
  })

  it("inserts and returns an id on success", async () => {
    findFirstVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "ws-1" })
    const id = await createMaintenanceRecord(session, input)
    expect(typeof id).toBe("string")
    expect(insertValues).toHaveBeenCalledOnce()
  })
})

describe("updateMaintenanceRecord", () => {
  it("throws when the record is missing", async () => {
    findFirstRecord.mockResolvedValue(undefined)
    await expect(updateMaintenanceRecord(session, "mr-1", input)).rejects.toThrow("no encontrada")
  })

  it("blocks editing a record in a worksite the user cannot see", async () => {
    findFirstRecord.mockResolvedValue({ id: "mr-1", worksiteId: "ws-2" })
    mockIsGlobalRole.mockReturnValue(false)
    mockVisibleWorksiteIds.mockReturnValue(["ws-1"])
    await expect(updateMaintenanceRecord(session, "mr-1", input)).rejects.toThrow("No puedes editar")
  })

  it("updates on success", async () => {
    findFirstRecord.mockResolvedValue({ id: "mr-1", worksiteId: "ws-1" })
    findFirstVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "ws-1" })
    await updateMaintenanceRecord(session, "mr-1", input)
    expect(updateSet).toHaveBeenCalledOnce()
    expect(updateWhere).toHaveBeenCalledOnce()
  })
})

describe("cancelMaintenanceRecord", () => {
  it("throws when the record is missing", async () => {
    findFirstRecord.mockResolvedValue(undefined)
    await expect(cancelMaintenanceRecord(session, "mr-1")).rejects.toThrow("no encontrada")
  })

  it("throws when already cancelled", async () => {
    findFirstRecord.mockResolvedValue({ id: "mr-1", worksiteId: "ws-1", status: "cancelled" })
    await expect(cancelMaintenanceRecord(session, "mr-1")).rejects.toThrow("ya está cancelada")
  })

  it("marks the record as cancelled on success", async () => {
    findFirstRecord.mockResolvedValue({ id: "mr-1", worksiteId: "ws-1", status: "completed" })
    await cancelMaintenanceRecord(session, "mr-1")
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }))
  })
})
