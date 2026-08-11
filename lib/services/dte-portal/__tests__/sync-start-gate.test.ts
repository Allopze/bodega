import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const execute = vi.fn()
  const settingRows = vi.fn()
  const insertValues = vi.fn()
  const insertOnConflictDoNothing = vi.fn()
  const insertReturning = vi.fn()
  const transaction = vi.fn()
  return { execute, settingRows, insertValues, insertOnConflictDoNothing, insertReturning, transaction }
})

vi.mock("@/db", () => ({
  db: {
    transaction: (...args: unknown[]) => mocks.transaction(...args),
  },
}))

vi.mock("@/db/schema", () => ({
  dteSyncRuns: {},
  systemSettings: {},
}))

function installTransactionMock() {
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    execute: mocks.execute,
    select: () => ({ from: () => ({ where: () => mocks.settingRows() }) }),
    insert: () => ({
      values: (...args: unknown[]) => {
        mocks.insertValues(...args)
        return {
          onConflictDoNothing: () => {
            mocks.insertOnConflictDoNothing()
            return { returning: mocks.insertReturning }
          },
        }
      },
    }),
  }))
}

describe("claimDteSyncStart", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installTransactionMock()
    mocks.settingRows.mockResolvedValue([])
    mocks.insertReturning.mockResolvedValue([{ id: "run-1" }])
  })

  it("claims a run in the same short transaction that takes the conversion lock", async () => {
    const { claimDteSyncStart } = await import("../sync-start-gate")

    const claim = await claimDteSyncStart({
      runId: "run-1",
      periodo: "2026-08",
      codEmp: "433",
      trigger: "cron",
      correlationId: "batch-1",
    })

    expect(claim).toEqual({ allowed: true })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      id: "run-1",
      status: "running",
      correlationId: "batch-1",
    }))
  })

  it.each(["paused", "cutover"])("reports the operator-owned conversion barrier %s as intentionally disabled", async (barrier) => {
    mocks.settingRows.mockResolvedValue([{ value: barrier }])
    const { claimDteSyncStart } = await import("../sync-start-gate")

    await expect(claimDteSyncStart({
      runId: "run-2",
      periodo: "2026-08",
      codEmp: "433",
      trigger: "manual",
      correlationId: "batch-2",
    })).resolves.toEqual({ allowed: false, reason: "disabled" })

    expect(mocks.insertValues).not.toHaveBeenCalled()
  })

  it("keeps a malformed barrier blocked but distinct from an intentional pause", async () => {
    mocks.settingRows.mockResolvedValue([{ value: "corrupt-value" }])
    const { claimDteSyncStart } = await import("../sync-start-gate")

    await expect(claimDteSyncStart({
      runId: "run-invalid-barrier",
      periodo: "2026-08",
      codEmp: "433",
      trigger: "manual",
      correlationId: "batch-invalid-barrier",
    })).resolves.toEqual({ allowed: false, reason: "invalid_barrier" })

    expect(mocks.insertValues).not.toHaveBeenCalled()
  })

  it("does not treat the ordinary purchase-sync switch as a cutover fence", async () => {
    // La conversión debe pausar también ventas FacturaEnLínea; reutilizar
    // dte.sync_enabled aquí cambiaría involuntariamente la autonomía de
    // ventas cuando un operador sólo apaga las compras automáticas.
    // The gate queries only dte.sync_start_barrier, not dte.sync_enabled.
    mocks.settingRows.mockResolvedValue([])
    const { claimDteSyncStart } = await import("../sync-start-gate")

    await expect(claimDteSyncStart({
      runId: "run-ordinary-switch",
      periodo: "2026-08",
      codEmp: "433",
      trigger: "cron",
      correlationId: "batch-ordinary-switch",
    })).resolves.toEqual({ allowed: true })
  })

  it("keeps a live-run uniqueness collision distinct from a disabled barrier", async () => {
    mocks.insertReturning.mockResolvedValueOnce([])
    const { claimDteSyncStart } = await import("../sync-start-gate")

    await expect(claimDteSyncStart({
      runId: "run-3",
      periodo: "2026-08",
      codEmp: "433",
      trigger: "cron",
      correlationId: "batch-3",
    })).resolves.toEqual({ allowed: false, reason: "active_run" })
  })
})
