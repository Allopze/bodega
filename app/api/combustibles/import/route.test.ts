import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockRequirePermission = vi.fn()
const mockCanAccessWorksite = vi.fn()
const mockTransaction = vi.fn()

type TestSession = { user: { permissions: string[]; isGlobal?: boolean } }

// `assertFuelCostAccess` (capabilities.ts) decide con `can`/`canAny`/`isGlobalRole`
// de este mismo módulo: se simulan sobre `session.user.permissions`, igual que el real.
vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
  canAccessWorksite: (...args: unknown[]) => mockCanAccessWorksite(...args),
  can: (s: TestSession | null, permission: string) => s?.user?.permissions?.includes(permission) ?? false,
  canAny: (s: TestSession | null, ...permissions: string[]) => permissions.some((p) => s?.user?.permissions?.includes(p)),
  isGlobalRole: (s: TestSession | null) => s?.user?.isGlobal === true,
}))

vi.mock("@/db", () => ({
  db: {
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}))

vi.mock("@/lib/id", () => ({ nanoid: () => "id-new" }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock("@/lib/services/module-toggles", () => ({
  isRouteOperational: vi.fn(async () => true),
}))

// Importar cargas facturadas exige `import` y el contrato monetario (`view` + `view_costs`).
const session = { user: { id: "user-1", isGlobal: true, worksiteIds: [] as string[], permissions: ["combustibles:import", "combustibles:view", "combustibles:view_costs"] } }

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

/** ¿El SQL de drizzle menciona este valor? (`inArray` guarda sus valores en `Param.value`). */
function sqlMentions(value: unknown, needle: string): boolean {
  if (value == null) return false
  if (typeof value === "string" || typeof value === "number") return String(value) === needle
  if (Array.isArray(value)) return value.some((item) => sqlMentions(item, needle))
  if (typeof value === "object") {
    const record = value as { queryChunks?: unknown[]; value?: unknown }
    if (Array.isArray(record.queryChunks)) return record.queryChunks.some((chunk) => sqlMentions(chunk, needle))
    if ("value" in record) return sqlMentions(record.value, needle)
  }
  return false
}

/**
 * Simula la base real: el `WHERE` que trae el alcance de la sesión (`ws-1`) no
 * devuelve la carga de la otra faena; uno sin alcance sí la devuelve.
 */
function makeScopedTx(outOfScopeLoads: unknown[], vehicles: { scoped: unknown[]; allPlates: unknown[] }) {
  const tx = makeTx(outOfScopeLoads)
  tx.query.fuelVehicles.findMany = vi.fn((args: { columns?: { plate?: boolean } } = {}) =>
    Promise.resolve(args.columns?.plate ? vehicles.allPlates : vehicles.scoped))
  // La faena en alcance es `ws-1`, la misma de la sesión de prueba.
  tx.query.worksites.findMany = vi.fn().mockResolvedValue([{ id: "ws-1", name: "Faena Biodiversa", code: "FN-FAENA", isActive: true }])
  tx.where = vi.fn((condition: unknown) => Promise.resolve(sqlMentions(condition, "ws-1") ? [] : outOfScopeLoads))
  return tx
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

  // Cada fila crea una carga con base, IEC, IVA y total: es un alta de cifras de
  // costo, y la opción de la interfaz sólo se ofrece con `view_costs`.
  it("returns 403 when user can import but cannot view fuel costs", async () => {
    mockRequirePermission.mockResolvedValue({ user: { id: "user-2", isGlobal: true, worksiteIds: [], permissions: ["combustibles:import", "combustibles:view"] } })
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ loads: [validLoad], faenaMapping: {} }))
    expect(res.status).toBe(403)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("returns 403 when user has view_costs but lacks the operational view permission", async () => {
    mockRequirePermission.mockResolvedValue({ user: { id: "user-3", isGlobal: true, worksiteIds: [], permissions: ["combustibles:import", "combustibles:view_costs"] } })
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ loads: [validLoad], faenaMapping: {} }))
    expect(res.status).toBe(403)
    expect(mockTransaction).not.toHaveBeenCalled()
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

  // Hallazgo 6.2: el chequeo de duplicados recorría todas las cargas del mes.
  describe("alcance de faena en catálogos y deduplicación", () => {
    const scopedUser = {
      user: { id: "user-scope", isGlobal: false, worksiteIds: ["ws-1"], permissions: ["combustibles:import", "combustibles:view", "combustibles:view_costs"] },
    }
    const outOfScopeLoad = {
      fuelSupplierId: "s-1",
      receiptNumber: "29533428",
      vehicleId: "v-1",
      loadDate: "2026-01-15",
      liters: 100,
    }
    const scopedVehicles = [{ id: "v-1", plate: "CAMION", worksiteId: "ws-1" }]

    it("un usuario no global no ve la factura/fecha de una carga de otra faena", async () => {
      mockRequirePermission.mockResolvedValue(scopedUser)
      const tx = makeScopedTx([outOfScopeLoad], { scoped: scopedVehicles, allPlates: [{ plate: "CAMION" }] })
      mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx))

      const { POST } = await import("./route")
      const res = await POST(makeRequest({ loads: [validLoad], faenaMapping: {} }))
      const json = await res.json()

      // La carga ajena no se devuelve al `WHERE` con alcance: no hay duplicado y,
      // sobre todo, la respuesta no repite su factura ni su fecha.
      expect(json.imported).toBe(1)
      expect(json.errors).toEqual([])
      expect(JSON.stringify(json)).not.toContain("29533428")
      expect(JSON.stringify(json)).not.toContain("Carga duplicada")
    })

    it("un usuario global sí deduplica contra una carga de cualquier faena", async () => {
      mockRequirePermission.mockResolvedValue(session)
      const tx = makeScopedTx([outOfScopeLoad], { scoped: scopedVehicles, allPlates: [{ plate: "CAMION" }] })
      mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx))

      const { POST } = await import("./route")
      const json = await (await POST(makeRequest({ loads: [validLoad], faenaMapping: {} }))).json()

      expect(json.imported).toBe(0)
      expect(json.errors[0]).toMatchObject({ field: "FACTURA" })
    })

    it("una patente que sólo existe en otra faena se informa como no encontrada, sin delatar la faena", async () => {
      mockRequirePermission.mockResolvedValue(scopedUser)
      const tx = makeScopedTx([], { scoped: [], allPlates: [{ plate: "CAMION" }, { plate: "OTRA" }] })
      mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx))

      const { POST } = await import("./route")
      const json = await (await POST(makeRequest({ loads: [validLoad], faenaMapping: {}, createMissing: true }))).json()

      expect(json.imported).toBe(0)
      expect(json.errors[0]).toMatchObject({ field: "VEHICULO", message: '"CAMION" no encontrado' })
      expect(JSON.stringify(json)).not.toContain("otra faena")
      // Tampoco intenta crear un duplicado de una patente única que no puede ver.
      expect(tx.insert).not.toHaveBeenCalled()
    })
  })
})
