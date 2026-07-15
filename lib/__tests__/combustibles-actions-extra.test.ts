import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockCanAccessWorksite = vi.hoisted(() => vi.fn(() => true))

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
  canAccessWorksite: mockCanAccessWorksite,
}))
vi.mock("@/db", () => {
  const db = {
    query: {
      fuelLoads: { findFirst: vi.fn(), findMany: vi.fn(() => []) },
      fuelVehicles: { findFirst: vi.fn() },
      fuelSuppliers: { findFirst: vi.fn() },
      suppliers: { findFirst: vi.fn() },
      fuelMonthlyStatements: { findFirst: vi.fn() },
      systemSettings: { findFirst: vi.fn() },
    },
    insert: vi.fn(() => ({ values: vi.fn() })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    delete: vi.fn(() => ({ where: vi.fn() })),
    transaction: vi.fn(async <T,>(fn: (tx: typeof db) => T): Promise<T> => fn(db)),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ for: vi.fn(() => Promise.resolve([])) })) })) })),
  }
  return { db }
})
vi.mock("@/lib/id", () => ({ nanoid: vi.fn(() => "fuel-1") }))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock("@/lib/combustibles/queries", () => ({ buildFuelLoadsWhere: vi.fn(() => undefined) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { deleteFuelLoadAction, registerFuelLoadAction, createFuelSupplierAction, deleteFuelSupplierAction } from "@/app/(app)/combustibles/actions"
import { exportFuelLoadsXlsxAction } from "@/app/(app)/combustibles/actions-module/export"
import { recordAudit } from "@/lib/audit"
import type { ActionState } from "@/lib/validation/masters"

const prevState: ActionState = { ok: false, message: "" }

function makeSession(permissions: string[] = ["combustibles:delete", "combustibles:create", "combustibles:manage_suppliers"]) {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1", email: "admin@test.cl", name: "Admin",
      roles: ["administrador"], permissions,
      worksiteIds: ["ws-1"], primaryWorksiteId: "ws-1",
      avatarColor: "#000", isActive: true,
    },
  }
}

function makeSupplierForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("name", "Copec")
  fd.set("rut", "99555666-7")
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

async function getQuery() {
  const { db } = await import("@/db")
  return db.query
}

describe("deleteFuelLoadAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
    mockCanAccessWorksite.mockReturnValue(true)
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const res = await deleteFuelLoadAction("load-1")
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if load not found", async () => {
    const query = await getQuery()
    vi.mocked(query.fuelLoads.findFirst).mockResolvedValueOnce(undefined)
    const res = await deleteFuelLoadAction("load-1")
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Carga no encontrada")
  })
})

describe("registerFuelLoadAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const res = await registerFuelLoadAction("load-1")
    expect(res.ok).toBe(false)
  })

  it("returns error if load not found", async () => {
    const query = await getQuery()
    vi.mocked(query.fuelLoads.findFirst).mockResolvedValueOnce(undefined)
    const res = await registerFuelLoadAction("load-1")
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Carga no encontrada")
  })
})

describe("createFuelSupplierAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const res = await createFuelSupplierAction(prevState, makeSupplierForm())
    expect(res.ok).toBe(false)
  })

  it("creates supplier successfully", async () => {
    const query = await getQuery()
    vi.mocked(query.suppliers.findFirst).mockResolvedValueOnce(undefined)
    const res = await createFuelSupplierAction(prevState, makeSupplierForm())
    expect(res.ok).toBe(true)
    expect(res.message).toContain("Proveedor creado")
  })
})

describe("deleteFuelSupplierAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const res = await deleteFuelSupplierAction("sup-1")
    expect(res.ok).toBe(false)
  })

  it("soft-deletes supplier successfully", async () => {
    const query = await getQuery()
    vi.mocked(query.fuelSuppliers.findFirst).mockResolvedValueOnce({
      id: "sup-1",
      supplierId: null,
      name: "Copec",
      rut: "99555666-7",
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      notes: null,
      isActive: true,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    })
    const res = await deleteFuelSupplierAction("sup-1")
    expect(res.ok).toBe(true)
    expect(res.message).toContain("Proveedor desactivado")
  })
})

describe("exportFuelLoadsXlsxAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("bloquea la exportación con montos a quien no tiene combustibles:export_sensitive (sección 19: exclusión de columnas por permiso)", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const res = await exportFuelLoadsXlsxAction()
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos para exportar datos con montos")
  })

  it("audita la exportación con recordAudit al generarla (sección 19: auditoría de exportaciones)", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession(["combustibles:export_sensitive"]))
    const res = await exportFuelLoadsXlsxAction()
    expect(res.ok).toBe(true)
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "export", entityType: "fuel_loads_export" }),
    )
  })
})
