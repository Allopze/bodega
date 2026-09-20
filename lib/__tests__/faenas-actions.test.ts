/**
 * Unit tests for worksite (faenas) admin actions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockCanAccessWorksite = vi.hoisted(() => vi.fn(() => true))
const mockCan = vi.hoisted(() => vi.fn(() => true))
const mockResolveWorksiteScope = vi.hoisted(() => vi.fn(() => ({ mode: "all" as "all" | "some" | "none", ids: [] as string[] })))
const mockFindFirstWorksite = vi.hoisted(() => vi.fn())
const mockInsert = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockSet = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())
const mockSetWorksiteActive = vi.hoisted(() => vi.fn())
/* Se mockea el AGREGADOR y no la pre-generación de capacitación: el alta de
 * faena debe dejar las casillas de los tres módulos, y un mock del módulo
 * suelto pasaría verde el día que alguien vuelva a llamar sólo a ése. */
const mockEnsurePreventionProgramSlotsForWorksiteTx = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
  canAccessWorksite: mockCanAccessWorksite,
  can: mockCan,
}))
vi.mock("@/lib/auth/scope", () => ({
  resolveWorksiteScope: mockResolveWorksiteScope,
}))
vi.mock("@/db", () => ({
  db: {
    query: {
      worksites: { findFirst: mockFindFirstWorksite },
    },
    insert: mockInsert,
    transaction: mockTransaction,
    update: mockUpdate,
  },
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: mockRecordAudit,
}))
vi.mock("@/lib/services/worksite-lifecycle", () => ({
  setWorksiteActive: mockSetWorksiteActive,
}))
vi.mock("@/lib/services/prevention-program-slots", () => ({
  ensurePreventionProgramSlotsForWorksiteTx: mockEnsurePreventionProgramSlotsForWorksiteTx,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { createWorksite, updateWorksite, toggleWorksiteActive } from "@/app/(app)/admin/faenas/actions"
import type { ActionState } from "@/lib/validation/operations"

const prevState: ActionState = { ok: false, message: "" }

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1", email: "admin@test.cl", name: "Admin",
      roles: ["administrador"], permissions: ["admin:worksites"],
      worksiteIds: ["ws-1"], primaryWorksiteId: "ws-1",
      avatarColor: "#000", isActive: true, ...overrides,
    },
  }
}

function makeFormData(fields: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("name", "Faena Test")
  fd.set("code", "F-TEST")
  fd.set("isActive", "on")
  for (const [k, v] of Object.entries(fields)) {
    if (v === "") fd.delete(k)
    else fd.set(k, v)
  }
  return fd
}

function setupDbMocks() {
  const whereFn = vi.fn().mockResolvedValue(undefined)
  const setChain = { where: whereFn }
  mockSet.mockReturnValue(setChain)
  mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })
  mockTransaction.mockImplementation(async (callback: (tx: { insert: typeof mockInsert }) => Promise<unknown>) => callback({ insert: mockInsert }))
  mockUpdate.mockReturnValue({ set: mockSet })
  mockSetWorksiteActive.mockResolvedValue({ programsDropped: 0, capaCancelled: 0, obligationsCancelled: 0 })
}

describe("createWorksite", () => {
  beforeEach(() => { vi.resetAllMocks(); setupDbMocks(); mockCanAccessWorksite.mockReturnValue(true) })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const res = await createWorksite(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if scope is not global", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockResolveWorksiteScope.mockReturnValueOnce({ mode: "some", ids: ["ws-1"] })
    const res = await createWorksite(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("alcance global")
  })

  it("returns error if code already exists", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorksite.mockResolvedValueOnce({ id: "existing", code: "F-TEST" })
    const res = await createWorksite(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.code).toBeDefined()
  })

  it("creates worksite successfully", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorksite.mockResolvedValueOnce(null)
    const res = await createWorksite(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(res.message).toContain("creada")
    expect(mockEnsurePreventionProgramSlotsForWorksiteTx).toHaveBeenCalledOnce()
  })

  it("does not create operational occurrences for an inactive worksite", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorksite.mockResolvedValueOnce(null)
    const res = await createWorksite(prevState, makeFormData({ isActive: "" }))
    expect(res.ok).toBe(true)
    expect(mockEnsurePreventionProgramSlotsForWorksiteTx).not.toHaveBeenCalled()
  })
})

describe("updateWorksite", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDbMocks()
    mockCanAccessWorksite.mockReturnValue(true)
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const res = await updateWorksite(prevState, makeFormData({ id: "ws-1" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if ID missing — Zod catches it", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const res = await updateWorksite(prevState, makeFormData())
    expect(res.ok).toBe(false)
  })

  it("returns error if worksite not found", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorksite.mockResolvedValueOnce(null)
    const res = await updateWorksite(prevState, makeFormData({ id: "ws-1" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("no encontrada")
  })

  it("returns error if scope denied", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    // No code conflict, then found
    mockFindFirstWorksite.mockResolvedValueOnce(null)
    mockFindFirstWorksite.mockResolvedValueOnce({ id: "ws-1", name: "Test", code: "F-TEST", isActive: true })
    mockCanAccessWorksite.mockReturnValueOnce(false)
    const res = await updateWorksite(prevState, makeFormData({ id: "ws-1" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("acceso")
  })

  it("updates worksite successfully", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorksite.mockResolvedValueOnce(null)
    mockFindFirstWorksite.mockResolvedValueOnce({ id: "ws-1", name: "Test", code: "F-TEST", isActive: true })
    const res = await updateWorksite(prevState, makeFormData({ id: "ws-1" }))
    expect(res.ok).toBe(true)
    expect(res.message).toContain("actualizada")
  })

  it("no cambia el estado operativo desde la edición general", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorksite.mockResolvedValueOnce(null)
    mockFindFirstWorksite.mockResolvedValueOnce({ id: "ws-1", name: "Test", code: "F-TEST", isActive: true })

    await updateWorksite(prevState, makeFormData({ id: "ws-1", isActive: "" }))

    expect(mockSet).toHaveBeenCalledWith(expect.not.objectContaining({ isActive: expect.anything() }))
  })
})

describe("toggleWorksiteActive", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDbMocks()
    mockCanAccessWorksite.mockReturnValue(true)
    mockCan.mockReturnValue(true)
    mockSetWorksiteActive.mockResolvedValue({ programsDropped: 0, capaCancelled: 0, obligationsCancelled: 0 })
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const fd = new FormData(); fd.set("id", "ws-1"); fd.set("activate", "true")
    const res = await toggleWorksiteActive(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if ID missing", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const fd = new FormData(); fd.set("activate", "true")
    const res = await toggleWorksiteActive(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("requerido")
  })

  it("returns error if worksite not found", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorksite.mockResolvedValueOnce(null)
    const fd = new FormData(); fd.set("id", "ws-1"); fd.set("activate", "true")
    const res = await toggleWorksiteActive(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("no encontrada")
  })

  it("toggles successfully", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorksite.mockResolvedValueOnce({ id: "ws-1", isActive: false })
    const fd = new FormData(); fd.set("id", "ws-1"); fd.set("activate", "true")
    const res = await toggleWorksiteActive(prevState, fd)
    expect(res.ok).toBe(true)
    expect(res.message).toContain("activada")
  })

  it("no deja devolver el saldo a quien sólo administra faenas", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorksite.mockResolvedValueOnce({ id: "ws-1", isActive: true })
    mockCan.mockReturnValue(false) // sin warehouse:adjust_stock
    const fd = new FormData()
    fd.set("id", "ws-1"); fd.set("activate", "false")
    fd.set("motivo", "Término del contrato principal"); fd.set("returnStock", "on")

    const res = await toggleWorksiteActive(prevState, fd)

    expect(res.ok).toBe(false)
    expect(mockSetWorksiteActive).not.toHaveBeenCalled()
  })

  it("traslada la devolución de saldo al servicio cuando hay permiso de bodega", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorksite.mockResolvedValueOnce({ id: "ws-1", isActive: true })
    mockSetWorksiteActive.mockResolvedValueOnce({
      programsDropped: 0, capaCancelled: 0, obligationsCancelled: 0,
      stockReturned: { products: 2, units: 9, officeName: "Oficina Central" },
    })
    const fd = new FormData()
    fd.set("id", "ws-1"); fd.set("activate", "false")
    fd.set("motivo", "Término del contrato principal"); fd.set("returnStock", "on")

    const res = await toggleWorksiteActive(prevState, fd)

    expect(mockSetWorksiteActive).toHaveBeenCalledWith(expect.objectContaining({ returnStockToOffice: true }))
    expect(res.ok).toBe(true)
    expect(res.message).toContain("Oficina Central")
  })

  it("devuelve el motivo del rechazo del servicio en vez de reventar la action", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorksite.mockResolvedValueOnce({ id: "ws-1", isActive: true })
    mockSetWorksiteActive.mockRejectedValueOnce(
      new Error('No se puede cerrar la faena "Faena 1": quedan 2 productos con existencias (7 en total).'),
    )
    const fd = new FormData()
    fd.set("id", "ws-1"); fd.set("activate", "false"); fd.set("motivo", "Término del contrato principal")

    const res = await toggleWorksiteActive(prevState, fd)

    expect(res.ok).toBe(false)
    expect(res.message).toContain("existencias")
  })
})
