import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.fn()
const mockCanAccessWorksite = vi.fn()
const mockFindLoad = vi.fn()
const mockFindVehicle = vi.fn(async () => ({ id: "v-1", worksiteId: "ws-1", plate: "XX-XX-01", worksite: { name: "Faena Test" } }))
// update/delete devuelven la fila escrita: la precondición "sin cuenta corriente"
// se reafirma en el WHERE, así que 0 filas significa que otro proceso la asignó.
const mockDeleteReturning = vi.fn(async () => [{ id: "load-1" }])
const mockDeleteWhere = vi.fn(() => ({ returning: mockDeleteReturning }))
const mockUpdateReturning = vi.fn(async () => [{ id: "load-1" }])
const mockUpdateWhere = vi.fn(() => ({ returning: mockUpdateReturning }))
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }))
const mockInsertValues = vi.fn(async () => undefined)
const mockRecordAudit = vi.fn()
const mockRedirect = vi.fn()
const mockReevaluateFuelLoadAnomalies = vi.fn()
const mockNotifyAfterCommit = vi.fn((thunk: () => unknown) => thunk())
const mockFindDte = vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined)

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => mockRedirect(...args) }))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}))
vi.mock("@/lib/auth/scope", () => ({
  canAccessWorksite: (...args: unknown[]) => mockCanAccessWorksite(...args),
}))
vi.mock("@/db", () => {
  const db = {
    delete: () => ({ where: mockDeleteWhere }),
    update: () => ({ set: mockUpdateSet }),
    insert: () => ({ values: mockInsertValues }),
    // Auditoría dentro de la misma transacción que la mutación (CO-025): el tx
    // pasado al callback es el mismo `db` mockeado, mismas cadenas de arriba.
    transaction: vi.fn(async <T,>(fn: (tx: typeof db) => T): Promise<T> => fn(db)),
    query: {
      fuelLoads: {
        findFirst: (...args: unknown[]) => mockFindLoad(...args),
      },
      fuelVehicles: {
        findFirst: (...args: unknown[]) => mockFindVehicle(...(args as [])),
      },
      // El vínculo DTE↔carga vive en dte_documents: borrar o cambiar la
      // identidad de una carga con documento encima tiene que consultarlo.
      dteDocuments: { findFirst: (...args: unknown[]) => mockFindDte(...args) },
      systemSettings: { findFirst: vi.fn(async () => null) },
    },
  }
  return { db }
})
vi.mock("@/lib/audit", () => ({ recordAudit: (...args: unknown[]) => mockRecordAudit(...args) }))
vi.mock("@/lib/id", () => ({ nanoid: () => "id-new" }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("@/lib/combustibles/fuel-load-anomaly-reevaluation", () => ({
  reevaluateFuelLoadAnomalies: (...args: unknown[]) => mockReevaluateFuelLoadAnomalies(...args),
}))
vi.mock("@/lib/services/notifications", () => ({
  notifyAfterCommit: (thunk: () => unknown) => mockNotifyAfterCommit(thunk),
}))

import {
  createFuelLoadAction,
  deleteFuelLoadAction,
  registerFuelLoadAction,
  updateFuelLoadAction,
} from "./actions"

// Vehículo por defecto de cada caso: sin esto, un test que lo redefine filtraría
// su vehículo al resto del archivo (clearAllMocks no revierte implementaciones).
beforeEach(() => {
  mockFindVehicle.mockResolvedValue({ id: "v-1", worksiteId: "ws-1", plate: "XX-XX-01", worksite: { name: "Faena Test" } })
})

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

  // La FK dte_documents → fuel_loads es ON DELETE NO ACTION: sin la guarda el
  // DELETE llegaba a Postgres y el toast mostraba el 23503 con el nombre de la
  // constraint.
  it("no borra una carga que es la contraparte de un DTE vinculado", async () => {
    mockFindLoad.mockResolvedValue({ id: "load-1", worksiteId: "ws-mine", statementId: null, status: "registered" })
    mockCanAccessWorksite.mockReturnValue(true)
    mockFindDte.mockResolvedValueOnce({ id: "dte-1", tipoDte: "33", folio: 88123 } as never)

    const result = await deleteFuelLoadAction("load-1")

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/DTE tipo 33 folio 88123/)
    expect(mockDeleteWhere).not.toHaveBeenCalled()
  })

  it("falla si la carga fue asignada a una cuenta corriente entre la lectura y el DELETE", async () => {
    mockFindLoad.mockResolvedValue({ id: "load-1", worksiteId: "ws-mine", statementId: null, status: "registered" })
    mockCanAccessWorksite.mockReturnValue(true)
    mockDeleteReturning.mockResolvedValueOnce([])   // el WHERE guardado ya no calza

    const result = await deleteFuelLoadAction("load-1")

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/cuenta corriente/i)
    expect(mockRecordAudit).not.toHaveBeenCalled()
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

  // CO-025: la transición draft→registered no auditaba en absoluto.
  it("audita la transición a registered dentro de la misma transacción", async () => {
    mockFindLoad.mockResolvedValue({ id: "load-1", worksiteId: "ws-mine", status: "draft" })
    mockCanAccessWorksite.mockReturnValue(true)

    const result = await registerFuelLoadAction("load-1")

    expect(result.ok).toBe(true)
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "update", entityType: "fuel_load", entityId: "load-1" }),
      expect.anything(),
    )
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

  it("programa la reevaluación de anomalías después de editar una carga", async () => {
    mockFindLoad.mockResolvedValue({
      id: "load-1", worksiteId: "ws-1", statementId: null, status: "registered",
      loadDate: "2026-01-15", month: "2026-01", serviceType: "TCT",
      vehicleId: "v-1", fuelSupplierId: "s-1", product: "PETROLEO DIESEL",
      receiptNumber: null, odometerReading: null, hourMeterReading: null,
      liters: 100, iecFixed: 0, iecVariable: 0, baseAmount: 1000, iecTotal: 0, ivaAmount: 190, totalAmount: 1190,
      notes: null,
    })
    mockReevaluateFuelLoadAnomalies.mockResolvedValue({ created: 0, reopened: 0, resolved: 1 })

    const fd = new FormData()
    for (const [key, value] of Object.entries({
      id: "load-1", loadDate: "2026-01-15", serviceType: "TCT", vehicleId: "v-1", fuelSupplierId: "s-1", worksiteId: "ws-1", product: "PETROLEO DIESEL",
      receiptNumber: "", notes: "", liters: "100", baseAmount: "1000", iecFixed: "0", iecVariable: "0", iecTotal: "0", ivaAmount: "190", totalAmount: "1190",
    })) fd.set(key, value)

    const result = await updateFuelLoadAction({ ok: false, message: "" }, fd)
    expect(result.message).toBe("Carga actualizada")
    expect(mockNotifyAfterCommit).toHaveBeenCalled()
    expect(mockReevaluateFuelLoadAnomalies).toHaveBeenCalledWith("load-1", "user-1")
  })

  it("falla si la carga fue asignada a una cuenta corriente entre la lectura y el UPDATE", async () => {
    mockFindLoad.mockResolvedValue({
      id: "load-1", worksiteId: "ws-1", statementId: null, status: "registered",
      loadDate: "2026-01-15", month: "2026-01", serviceType: "TCT",
      vehicleId: "v-1", fuelSupplierId: "s-1", product: "PETROLEO DIESEL",
      receiptNumber: null, odometerReading: null, hourMeterReading: null,
      liters: 100, iecFixed: 0, iecVariable: 0, baseAmount: 1000, iecTotal: 0, ivaAmount: 190, totalAmount: 1190,
      notes: null,
    })
    mockUpdateReturning.mockResolvedValueOnce([])   // el WHERE guardado ya no calza

    const fd = new FormData()
    for (const [key, value] of Object.entries({
      id: "load-1", loadDate: "2026-01-15", serviceType: "TCT", vehicleId: "v-1", fuelSupplierId: "s-1", worksiteId: "ws-1", product: "PETROLEO DIESEL",
      receiptNumber: "", notes: "", liters: "100", baseAmount: "1000", iecFixed: "0", iecVariable: "0", iecTotal: "0", ivaAmount: "190", totalAmount: "1190",
    })) fd.set(key, value)

    const result = await updateFuelLoadAction({ ok: false, message: "" }, fd)

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/cuenta corriente/i)
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockNotifyAfterCommit).not.toHaveBeenCalled()
  })
})

describe("updateFuelLoadAction — guarda del vínculo DTE", () => {
  const linkedLoad = {
    id: "load-1", worksiteId: "ws-1", statementId: null, status: "registered",
    loadDate: "2026-01-15", month: "2026-01", serviceType: "TCT",
    vehicleId: "v-1", fuelSupplierId: "s-1", product: "PETROLEO DIESEL",
    receiptNumber: "88123", odometerReading: null, hourMeterReading: null,
    liters: 100, iecFixed: 0, iecVariable: 0, baseAmount: 1000, iecTotal: 0, ivaAmount: 190, totalAmount: 1190,
    notes: null,
  }
  const form = (overrides: Record<string, string> = {}) => {
    const fd = new FormData()
    for (const [key, value] of Object.entries({
      id: "load-1", loadDate: "2026-01-15", serviceType: "TCT", vehicleId: "v-1", fuelSupplierId: "s-1",
      worksiteId: "ws-1", product: "PETROLEO DIESEL", receiptNumber: "88123", notes: "",
      liters: "100", baseAmount: "1000", iecFixed: "0", iecVariable: "0", iecTotal: "0", ivaAmount: "190", totalAmount: "1190",
      ...overrides,
    })) fd.set(key, value)
    return fd
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(globalSession)
    mockCanAccessWorksite.mockReturnValue(true)
    mockFindLoad.mockResolvedValue(linkedLoad)
  })

  // Vincular un DTE no cambia el status de la carga: sin esta guarda, corregir
  // factura/proveedor/monto dejaba el documento tributario describiendo datos
  // que ya no existen.
  it("rechaza cambiar la factura cuando la carga tiene un DTE vinculado", async () => {
    mockFindDte.mockResolvedValueOnce({ id: "dte-1", tipoDte: "33", folio: 88123 } as never)

    const result = await updateFuelLoadAction({ ok: false, message: "" }, form({ receiptNumber: "88124" }))

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/DTE tipo 33 folio 88123/)
    expect(mockUpdateWhere).not.toHaveBeenCalled()
  })

  it("deja editar campos que no definen la identidad del vínculo", async () => {
    const result = await updateFuelLoadAction({ ok: false, message: "" }, form({ notes: "corrijo la observación" }))

    expect(result.ok).toBe(true)
    expect(mockFindDte).not.toHaveBeenCalled()
  })
})

describe("updateFuelLoadAction — alcance de la faena destino (H9)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequirePermission.mockResolvedValue(scopedSession)
    mockCanAccessWorksite.mockImplementation((_s: unknown, ws: string) => ws === "ws-mine")
  })

  it("rechaza mover una carga a una faena fuera del alcance", async () => {
    // El vehículo destino SÍ pertenece a la faena destino: la validación cruzada
    // vehículo↔faena pasa, así que sólo el chequeo de alcance puede rechazarlo.
    mockFindVehicle.mockResolvedValue({ id: "v-2", worksiteId: "ws-otra", plate: "XX-XX-02", worksite: { name: "Faena Ajena" } })
    mockFindLoad.mockResolvedValue({
      id: "load-1", worksiteId: "ws-mine", statementId: null, status: "registered",
      loadDate: "2026-01-15", month: "2026-01", serviceType: "TCT",
      vehicleId: "v-1", fuelSupplierId: "s-1", product: "PETROLEO DIESEL",
      receiptNumber: null, odometerReading: null, hourMeterReading: null,
      liters: 100, iecFixed: 0, iecVariable: 0, baseAmount: 1000, iecTotal: 0, ivaAmount: 190, totalAmount: 1190,
      notes: null,
    })

    const fd = new FormData()
    for (const [key, value] of Object.entries({
      id: "load-1", loadDate: "2026-01-15", serviceType: "TCT", vehicleId: "v-2", fuelSupplierId: "s-1", worksiteId: "ws-otra", product: "PETROLEO DIESEL",
      liters: "100", baseAmount: "1000", iecFixed: "0", iecVariable: "0", iecTotal: "0", ivaAmount: "190", totalAmount: "1190",
    })) fd.set(key, value)

    const result = await updateFuelLoadAction({ ok: false, message: "" }, fd)

    expect(result.ok).toBe(false)
    expect(result.message).toBe("No puedes mover cargas a esta faena")
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

  it("records an audit entry and redirects to /combustibles after successful create", async () => {
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

    // En éxito, createFuelLoadAction navega server-side vía redirect() en vez
    // de devolver { ok: true } — evita la carrera cliente descrita en su
    // comentario (Next.js 16 re-renderiza la ruta actual en la respuesta de
    // la action, lo que remontaba el formulario antes de que un useEffect
    // alcanzara a disparar router.push).
    await createFuelLoadAction({ ok: false, message: "" }, fd)

    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ productId: "fuel-diesel" }))
    // Segundo argumento: el `tx` de la transacción que envuelve insert+audit (CO-025).
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "create", entityType: "fuel_load" }),
      expect.anything(),
    )
    expect(mockRedirect).toHaveBeenCalledWith("/combustibles")
  })
})
