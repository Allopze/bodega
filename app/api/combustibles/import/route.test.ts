import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockRequirePermission = vi.fn()
const mockCanAccessWorksite = vi.fn()
const mockFindManyVehicles = vi.fn()
const mockFindManySuppliers = vi.fn()
const mockFindManyWorksites = vi.fn()
const mockTransaction = vi.fn()

vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
  canAccessWorksite: (...args: unknown[]) => mockCanAccessWorksite(...args),
}))

vi.mock("@/db", () => ({
  db: {
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}))

vi.mock("@/lib/id", () => ({ nanoid: () => "id-new" }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))

const session = { user: { id: "user-1", isGlobal: true, worksiteIds: [] as string[], permissions: ["combustibles:import"] } }

const validLoad = {
  rowIndex: 2,
  loadDate: "2026-01-15",
  month: "2026-01",
  serviceType: "TCT",
  vehicle: "CAMION",
  supplier: "COPEC",
  worksite: "FAENA BIODIVERSA",
  product: "PETROLEO DIESEL",
  receiptNumber: "29533428",
  liters: 100,
  iecFixed: 10,
  iecVariable: 8,
  baseAmount: 500,
  iecTotal: 18,
  ivaAmount: 95,
  totalAmount: 613, // 500 + 18 + 95 = 613 ✓
}

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/combustibles/import", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

function makeTx(existingLoads: unknown[] = []) {
  return {
    query: {
      fuelVehicles: { findMany: vi.fn().mockResolvedValue([{ id: "v-1", plate: "CAMION" }]) },
      fuelSuppliers: { findMany: vi.fn().mockResolvedValue([{ id: "s-1", name: "COPEC" }]) },
      worksites: { findMany: vi.fn().mockResolvedValue([{ id: "w-1", name: "Faena Biodiversa", code: "FN-FAENA", isActive: true }]) },
    },
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(existingLoads),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
  }
}

describe("POST /api/combustibles/import", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(session)
    mockCanAccessWorksite.mockReturnValue(true)
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx()))
  })

  it("returns 403 when user lacks permission", async () => {
    mockRequirePermission.mockRejectedValue(new Error("Forbidden"))
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ loads: [validLoad], faenaMapping: {} }))
    expect(res.status).toBe(403)
  })

  it("returns 400 for invalid payload shape", async () => {
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ loads: "not-an-array", faenaMapping: {} }))
    expect(res.status).toBe(400)
  })

  it("returns 400 when loads array is empty", async () => {
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ loads: [], faenaMapping: {} }))
    expect(res.status).toBe(400)
  })

  it("rejects loads with incoherent financial amounts (H2)", async () => {
    const badLoad = { ...validLoad, totalAmount: 9999 } // 500 + 18 + 95 = 613, not 9999
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ loads: [badLoad], faenaMapping: {} }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.imported).toBe(0)
    expect(json.errors).toHaveLength(1)
    expect(json.errors[0].field).toMatch(/TOTAL/i)
  })

  it("accepts loads where total is within ±1 CLP tolerance (H2)", async () => {
    // totalAmount off by 1 due to rounding — should still pass
    const almostValidLoad = { ...validLoad, totalAmount: 614 }
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ loads: [almostValidLoad], faenaMapping: {} }))
    const json = await res.json()

    expect(json.imported).toBe(1)
    expect(json.errors).toHaveLength(0)
  })

  it("deduplicates loads already in the DB (H3)", async () => {
    const existingLoad = {
      fuelSupplierId: "s-1",
      receiptNumber: "29533428",
      vehicleId: "v-1",
      loadDate: "2026-01-15",
      liters: 100,
    }
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(makeTx([existingLoad])),
    )

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ loads: [validLoad], faenaMapping: {} }))
    const json = await res.json()

    expect(json.imported).toBe(0)
    expect(json.errors).toHaveLength(1)
    expect(json.errors[0].field).toMatch(/FACTURA/i)
  })

  it("does NOT deduplicate when receipt numbers differ (H3 negative case)", async () => {
    const existingLoad = {
      fuelSupplierId: "s-1",
      receiptNumber: "DIFFERENT-99999",
      vehicleId: "v-1",
      loadDate: "2026-01-15",
      liters: 100,
    }
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(makeTx([existingLoad])),
    )

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ loads: [validLoad], faenaMapping: {} }))
    const json = await res.json()

    expect(json.imported).toBe(1)
    expect(json.errors).toHaveLength(0)
  })

  it("rejects loads from worksites the user cannot access (H7 scope)", async () => {
    mockCanAccessWorksite.mockReturnValue(false)

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ loads: [validLoad], faenaMapping: {} }))
    const json = await res.json()

    expect(json.imported).toBe(0)
    expect(json.errors).toHaveLength(1)
    expect(json.errors[0].field).toMatch(/FAENA/i)
  })

  it("reports missing vehicle when createMissing is false", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = makeTx()
      tx.query.fuelVehicles.findMany = vi.fn().mockResolvedValue([]) // no vehicles
      return fn(tx)
    })

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ loads: [validLoad], faenaMapping: {}, createMissing: false }))
    const json = await res.json()

    expect(json.imported).toBe(0)
    expect(json.errors[0].field).toBe("VEHICULO")
  })

  it("marks loads from explicitly skipped faenas as errors", async () => {
    const { POST } = await import("./route")
    const res = await POST(makeRequest({
      loads: [validLoad],
      faenaMapping: { "FAENA BIODIVERSA": "__skip__" },
    }))
    const json = await res.json()

    expect(json.imported).toBe(0)
    expect(json.errors[0].field).toBe("FAENA")
    expect(json.errors[0].message).toMatch(/omitida/i)
  })
})
