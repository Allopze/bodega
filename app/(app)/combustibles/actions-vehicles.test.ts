import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.fn()
const mockCanAccessWorksite = vi.fn()
const mockInsertValues = vi.fn(async () => undefined)
const mockUpdateWhere = vi.fn(async () => undefined)
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }))
const mockFindVehicle = vi.fn()

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}))

vi.mock("@/lib/auth/scope", () => ({
  canAccessWorksite: (...args: unknown[]) => mockCanAccessWorksite(...args),
}))

vi.mock("@/db", () => ({
  db: {
    insert: () => ({ values: mockInsertValues }),
    update: () => ({ set: mockUpdateSet }),
    query: {
      fuelVehicles: {
        findFirst: (...args: unknown[]) => mockFindVehicle(...args),
        findMany: vi.fn(async () => []),
      },
    },
  },
}))

vi.mock("@/lib/id", () => ({
  nanoid: () => "veh-new",
}))

const mockGetFleetAdminSettings = vi.fn(async () => ({ warningDays: 30, defaultVehicleStatus: "mantencion" }))
vi.mock("@/lib/services/system-settings", () => ({
  getFleetAdminSettings: () => mockGetFleetAdminSettings(),
}))

import {
  createFuelVehicleAction,
  toggleFuelVehicleActiveAction,
  updateFuelVehicleAction,
} from "./actions"

const session = {
  user: {
    id: "user-1",
    roles: ["solicitante_faena"],
    worksiteIds: ["ws-1"],
  },
}

function vehicleForm(overrides: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set("plate", "AA-BB-11")
  fd.set("type", "camioneta")
  fd.set("worksiteId", "ws-1")
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequirePermission.mockResolvedValue(session)
  mockCanAccessWorksite.mockReturnValue(true)
  mockFindVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "ws-1" })
})

describe("fuel vehicle actions worksite scope", () => {
  it("rejects creating a vehicle for a worksite outside the user's scope", async () => {
    mockCanAccessWorksite.mockReturnValue(false)

    const result = await createFuelVehicleAction({ ok: false }, vehicleForm({ worksiteId: "ws-2" }))

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/faena/i)
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it("rejects moving a vehicle to a worksite outside the user's scope", async () => {
    mockCanAccessWorksite
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)

    const result = await updateFuelVehicleAction({ ok: false }, vehicleForm({ id: "veh-1", worksiteId: "ws-2" }))

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/faena/i)
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })

  it("rejects deactivating a vehicle outside the user's scope", async () => {
    mockFindVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "ws-2" })
    mockCanAccessWorksite.mockReturnValue(false)

    const result = await toggleFuelVehicleActiveAction("veh-1", false)

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/faena/i)
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })
})

describe("createFuelVehicleAction default status", () => {
  it("applies the configured default status when none is submitted", async () => {
    const result = await createFuelVehicleAction({ ok: false }, vehicleForm())

    expect(result.ok).toBe(true)
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ operationalStatus: "mantencion" }))
  })

  it("respects an explicit status submitted by the form", async () => {
    const result = await createFuelVehicleAction({ ok: false }, vehicleForm({ operationalStatus: "fuera_servicio" }))

    expect(result.ok).toBe(true)
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ operationalStatus: "fuera_servicio" }))
  })
})

describe("updateFuelVehicleAction governance fields", () => {
  it("persists responsable, estado operacional and vigencias", async () => {
    const result = await updateFuelVehicleAction({ ok: false }, vehicleForm({
      id: "veh-1",
      responsibleUserId: "user-9",
      operationalStatus: "mantencion",
      soapExpiresAt: "2026-12-01",
      technicalReviewExpiresAt: "2026-11-01",
      circulationPermitExpiresAt: "2026-10-01",
      insurancePolicyNumber: "POL-123",
      insuranceExpiresAt: "2026-09-01",
    }))

    expect(result.ok).toBe(true)
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      responsibleUserId: "user-9",
      operationalStatus: "mantencion",
      soapExpiresAt: "2026-12-01",
      technicalReviewExpiresAt: "2026-11-01",
      circulationPermitExpiresAt: "2026-10-01",
      insurancePolicyNumber: "POL-123",
      insuranceExpiresAt: "2026-09-01",
    }))
  })
})

describe("toggleFuelVehicleActiveAction", () => {
  it("reactivates a vehicle within the user's scope", async () => {
    mockFindVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "ws-1" })

    const result = await toggleFuelVehicleActiveAction("veh-1", true)

    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/activado/i)
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }))
  })

  it("deactivates a vehicle within the user's scope", async () => {
    mockFindVehicle.mockResolvedValue({ id: "veh-1", worksiteId: "ws-1" })

    const result = await toggleFuelVehicleActiveAction("veh-1", false)

    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/desactivado/i)
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }))
  })
})
