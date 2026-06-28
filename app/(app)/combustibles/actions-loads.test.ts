import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.fn()
const mockCanAccessWorksite = vi.fn()
const mockFindLoad = vi.fn()
const mockDeleteWhere = vi.fn(async () => undefined)
const mockUpdateWhere = vi.fn(async () => undefined)
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }))
const mockInsertValues = vi.fn(async () => undefined)
const mockRecordAudit = vi.fn()

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}))
vi.mock("@/lib/auth/scope", () => ({
  canAccessWorksite: (...args: unknown[]) => mockCanAccessWorksite(...args),
}))
vi.mock("@/db", () => ({
  db: {
    delete: () => ({ where: mockDeleteWhere }),
    update: () => ({ set: mockUpdateSet }),
    insert: () => ({ values: mockInsertValues }),
    query: {
      fuelLoads: {
        findFirst: (...args: unknown[]) => mockFindLoad(...args),
      },
      systemSettings: { findFirst: vi.fn(async () => null) },
    },
  },
}))
vi.mock("@/lib/audit", () => ({ recordAudit: (...args: unknown[]) => mockRecordAudit(...args) }))
vi.mock("@/lib/id", () => ({ nanoid: () => "id-new" }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))

import {
  createFuelLoadAction,
  deleteFuelLoadAction,
  registerFuelLoadAction,
  updateFuelLoadAction,
} from "./actions"

const globalSession = {
  user: { id: "user-1", roles: ["administrador"], worksiteIds: [], isGlobal: true, permissions: ["combustibles:delete", "combustibles:create"] },
}
const scopedSession = {
  user: { id: "user-2", roles: ["solicitante_faena"], worksiteIds: ["ws-mine"], isGlobal: false, permissions: ["combustibles:delete", "combustibles:create"] },
}

describe("deleteFuelLoadAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(scopedSession)
    mockCanAccessWorksite.mockReturnValue(false)
  })

  it("returns error when session cannot access the load worksite", async () => {
    mockFindLoad.mockResolvedValue({ id: "load-1", worksiteId: "ws-other", statementId: null, status: "registered" })
    mockCanAccessWorksite.mockReturnValue(false)

    const result = await deleteFuelLoadAction("load-1")

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/faena|acceso/i)
    expect(mockDeleteWhere).not.toHaveBeenCalled()
  })

  it("deletes when session has access to the load worksite", async () => {
    mockFindLoad.mockResolvedValue({ id: "load-1", worksiteId: "ws-mine", statementId: null, status: "registered" })
    mockCanAccessWorksite.mockReturnValue(true)

    const result = await deleteFuelLoadAction("load-1")

    expect(result.ok).toBe(true)
    expect(mockDeleteWhere).toHaveBeenCalled()
  })
})

describe("registerFuelLoadAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(scopedSession)
  })

  it("returns error when session cannot access the load worksite", async () => {
    mockFindLoad.mockResolvedValue({ id: "load-1", worksiteId: "ws-other", status: "draft" })
    mockCanAccessWorksite.mockReturnValue(false)

    const result = await registerFuelLoadAction("load-1")

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/faena|acceso/i)
    expect(mockUpdateWhere).not.toHaveBeenCalled()
  })
})

describe("updateFuelLoadAction — statement guard (H5)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(globalSession)
    mockCanAccessWorksite.mockReturnValue(true)
  })

  it("blocks edit when load is assigned to a statement", async () => {
    mockFindLoad.mockResolvedValue({
      id: "load-1", worksiteId: "ws-1", statementId: "stmt-1", status: "registered",
      loadDate: "2026-01-15", month: "2026-01", serviceType: "TCT",
      vehicleId: "v-1", fuelSupplierId: "s-1", product: "PETROLEO DIESEL",
      receiptNumber: null, odometerReading: null, hourMeterReading: null,
      liters: 100, iecFixed: 0, iecVariable: 0, baseAmount: 1000, iecTotal: 0, ivaAmount: 190, totalAmount: 1190,
      notes: null,
    })

    const fd = new FormData()
    fd.set("id", "load-1")
    fd.set("liters", "200")
    fd.set("baseAmount", "2000")
    fd.set("iecFixed", "0")
    fd.set("iecVariable", "0")
    fd.set("iecTotal", "0")
    fd.set("ivaAmount", "380")
    fd.set("totalAmount", "2380")
    fd.set("loadDate", "2026-01-15")
    fd.set("serviceType", "TCT")
    fd.set("vehicleId", "v-1")
    fd.set("fuelSupplierId", "s-1")
    fd.set("worksiteId", "ws-1")
    fd.set("product", "PETROLEO DIESEL")

    const result = await updateFuelLoadAction({ ok: false, message: "" }, fd)

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/cuenta corriente|resumen/i)
    expect(mockUpdateWhere).not.toHaveBeenCalled()
  })
})

// -- Audit logging (H8) --

describe("createFuelLoadAction — audit logging", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(globalSession)
    mockCanAccessWorksite.mockReturnValue(true)
    mockInsertValues.mockResolvedValue(undefined)
    mockRecordAudit.mockResolvedValue(undefined)
  })

  it("records an audit entry after successful create", async () => {
    const fd = new FormData()
    fd.set("loadDate", "2026-01-15")
    fd.set("serviceType", "TCT")
    fd.set("vehicleId", "v-1")
    fd.set("fuelSupplierId", "s-1")
    fd.set("worksiteId", "ws-1")
    fd.set("product", "PETROLEO DIESEL")
    fd.set("liters", "100")
    fd.set("baseAmount", "1000")
    fd.set("iecFixed", "10")
    fd.set("iecVariable", "8")
    fd.set("iecTotal", "18")
    fd.set("ivaAmount", "190")
    fd.set("totalAmount", "1208")

    const result = await createFuelLoadAction({ ok: false, message: "" }, fd)

    expect(result.ok).toBe(true)
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "create", entityType: "fuel_load" }),
    )
  })
})
