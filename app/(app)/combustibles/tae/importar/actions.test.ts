import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGuardPermission = vi.fn()
const mockCan = vi.fn()
const mockRevalidatePath = vi.fn()
const mockRecordAudit = vi.fn(async (..._args: unknown[]) => undefined)
const mockRecordStatusChange = vi.fn(async (..._args: unknown[]) => undefined)
const mockFindBatch = vi.fn()
const mockUpdateReturning = vi.fn()
const mockDeleteReturning = vi.fn()
const mockSelectSubmissions = vi.fn()
const mockForUpdate = vi.fn(() => mockSelectSubmissions())

const tx = {
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({ returning: mockUpdateReturning })),
    })),
  })),
  // Usado dos veces: borrar los movimientos de sello de las cargas del lote
  // (sin .returning(), FK sin CASCADE — ver actions.ts) y borrar las cargas.
  // `where()` devuelve el mismo objeto siempre: el primer delete lo await
  // directo (sin llamar `.returning`, no-op inofensivo sobre un objeto plano),
  // el segundo sí invoca `.returning()`.
  delete: vi.fn(() => ({
    where: vi.fn(() => ({ returning: mockDeleteReturning })),
  })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ for: mockForUpdate })),
    })),
  })),
  insert: vi.fn(),
  query: { fuelTaeImportBatches: { findFirst: (...args: unknown[]) => mockFindBatch(...args) } },
}

vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args) }))
vi.mock("@/lib/auth/can", () => ({
  guardPermission: (...args: unknown[]) => mockGuardPermission(...args),
  can: (...args: unknown[]) => mockCan(...args),
}))
vi.mock("@/db", () => ({ db: { transaction: (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } }))
vi.mock("@/lib/audit", () => ({
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
  recordStatusChange: (...args: unknown[]) => mockRecordStatusChange(...args),
}))
vi.mock("@/lib/services/fuel-tae", () => ({ generateTaeImportDryRunReport: vi.fn(), generateTaeImportPreview: vi.fn() }))
vi.mock("@/lib/combustibles/tae-import-service", () => ({ importTaeLegacyWorkbook: vi.fn(), reprocessTaeImportRejectedRows: vi.fn() }))

import { revertTaeImportBatchAction } from "./actions"

const session = { user: { id: "user-1", email: "admin@example.com", permissions: ["combustibles:tae_import", "combustibles:revert"], roles: [], worksiteIds: [], isGlobal: true } }

beforeEach(() => {
  vi.clearAllMocks()
  mockGuardPermission.mockResolvedValue({ session, error: null })
  mockCan.mockReturnValue(true)
  mockUpdateReturning.mockResolvedValue([{ id: "batch-1", status: "reverted" }])
  mockDeleteReturning.mockResolvedValue([{ id: "submission-1" }, { id: "submission-2" }])
  mockSelectSubmissions.mockResolvedValue([
    { id: "submission-1", worksiteId: "worksite-1" },
    { id: "submission-2", worksiteId: "worksite-2" },
  ])
})

describe("revertTaeImportBatchAction", () => {
  it("requires the generic lot-reversal permission in addition to TAE import", async () => {
    mockCan.mockReturnValue(false)

    const result = await revertTaeImportBatchAction("batch-1")

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/permiso/i)
    expect(tx.update).not.toHaveBeenCalled()
  })

  it("reverts the batch, removes its submissions and audits both records atomically", async () => {
    const result = await revertTaeImportBatchAction("batch-1")

    expect(result).toMatchObject({ ok: true, data: { removed: 2 } })
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "delete",
      entityType: "fuel_tae_import_batch",
      entityId: "batch-1",
      oldState: { status: "imported", submissions: 2 },
      newState: { status: "reverted", submissions: 0 },
    }), tx)
    expect(mockRecordStatusChange).toHaveBeenCalledWith(expect.objectContaining({
      fromStatus: "imported",
      toStatus: "reverted",
    }), tx)
    expect(mockRevalidatePath).toHaveBeenCalledWith("/combustibles/tae/importar/historial")
    // Movimientos de sello borrados ANTES de las cargas — sin CASCADE en la FK,
    // el orden inverso revienta con violación de FK apenas una carga del lote
    // llegó a validarse (ver el comentario en actions.ts).
    expect(tx.select).toHaveBeenCalled()
    expect(mockForUpdate).toHaveBeenCalledWith("update")
    expect(tx.delete).toHaveBeenCalledTimes(2)
  })

  it("skips the seal-movements cleanup when the batch has no submissions", async () => {
    mockSelectSubmissions.mockResolvedValue([])
    mockDeleteReturning.mockResolvedValue([])

    await revertTaeImportBatchAction("batch-1")

    // Un solo delete (las cargas) — no hay ids para borrar movimientos de sello.
    expect(tx.delete).toHaveBeenCalledTimes(1)
  })

  it("does not repeat a reversal when the conditional state update changes no row", async () => {
    mockUpdateReturning.mockResolvedValue([])
    mockFindBatch.mockResolvedValue({ status: "reverted" })

    const result = await revertTaeImportBatchAction("batch-1")

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/ya fue revertido/i)
    expect(mockDeleteReturning).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it("permite a un rol scoped revertir sólo cuando cubre todas las faenas del lote", async () => {
    mockGuardPermission.mockResolvedValue({
      session: { ...session, user: { ...session.user, isGlobal: false, worksiteIds: ["worksite-1", "worksite-2"] } },
      error: null,
    })

    const result = await revertTaeImportBatchAction("batch-1")

    expect(result.ok).toBe(true)
    expect(mockRecordAudit).toHaveBeenCalled()
  })

  it("rechaza antes de borrar derivados un lote que contiene una faena fuera del alcance", async () => {
    mockGuardPermission.mockResolvedValue({
      session: { ...session, user: { ...session.user, isGlobal: false, worksiteIds: ["worksite-1"] } },
      error: null,
    })

    const result = await revertTaeImportBatchAction("batch-1")

    expect(result).toMatchObject({ ok: false })
    expect(result.message).toMatch(/fuera de alcance/i)
    expect(tx.delete).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockRecordStatusChange).not.toHaveBeenCalled()
  })

  it("un rol scoped no puede apropiarse de un lote sin cargas que demuestren su alcance", async () => {
    mockGuardPermission.mockResolvedValue({
      session: { ...session, user: { ...session.user, isGlobal: false, worksiteIds: ["worksite-1"] } },
      error: null,
    })
    mockSelectSubmissions.mockResolvedValue([])

    const result = await revertTaeImportBatchAction("batch-1")

    expect(result).toMatchObject({ ok: false })
    expect(tx.delete).not.toHaveBeenCalled()
  })

  it("un rol sin faenas no puede revertir ningún lote", async () => {
    mockGuardPermission.mockResolvedValue({
      session: { ...session, user: { ...session.user, isGlobal: false, worksiteIds: [] } },
      error: null,
    })

    const result = await revertTaeImportBatchAction("batch-1")

    expect(result).toMatchObject({ ok: false })
    expect(tx.delete).not.toHaveBeenCalled()
  })

  it("no revela a un rol scoped si un lote ajeno existe o ya fue revertido", async () => {
    mockGuardPermission.mockResolvedValue({
      session: { ...session, user: { ...session.user, isGlobal: false, worksiteIds: ["worksite-1"] } },
      error: null,
    })
    mockUpdateReturning.mockResolvedValue([])
    mockFindBatch.mockResolvedValue({ status: "reverted" })

    const result = await revertTaeImportBatchAction("foreign-batch")

    expect(result).toMatchObject({ ok: false, message: "Lote no encontrado o fuera de alcance" })
    expect(mockFindBatch).not.toHaveBeenCalled()
  })
})
