import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const execute = vi.fn()
  const barrierRows = vi.fn()
  const liveLeaseRows = vi.fn()
  const insertValues = vi.fn()
  const cleanupWhere = vi.fn()
  const releaseWhere = vi.fn()
  const transaction = vi.fn()
  return { execute, barrierRows, liveLeaseRows, insertValues, cleanupWhere, releaseWhere, transaction }
})

vi.mock("@/db", () => ({
  db: {
    transaction: (...args: unknown[]) => mocks.transaction(...args),
    delete: () => ({ where: mocks.releaseWhere }),
  },
}))

vi.mock("@/db/schema", () => ({
  dtePortalOperationLeases: {},
  systemSettings: {},
}))

function installTransactionMock() {
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
    // Dentro de cada transacción se consulta primero el cerco y después la
    // cuenta de leases vivos.
    let selectCall = 0
    return callback({
      execute: mocks.execute,
      select: () => ({ from: () => ({ where: () => (selectCall++ === 0 ? mocks.barrierRows() : mocks.liveLeaseRows()) }) }),
      delete: () => ({ where: mocks.cleanupWhere }),
      insert: () => ({ values: mocks.insertValues }),
    })
  })
}

describe("DTE portal operation lease", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installTransactionMock()
    mocks.barrierRows.mockResolvedValue([])
    mocks.liveLeaseRows.mockResolvedValue([{ count: 0 }])
    mocks.insertValues.mockResolvedValue(undefined)
    mocks.cleanupWhere.mockResolvedValue(undefined)
    mocks.releaseWhere.mockResolvedValue(undefined)
  })

  it("holds a durable lease for the complete external request and releases it afterwards", async () => {
    const { withDtePortalOperationLease } = await import("../operation-lease")
    const work = vi.fn().mockResolvedValue("portal-response")

    await expect(withDtePortalOperationLease("query", 30_000, work)).resolves.toBe("portal-response")

    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      operation: "query",
      leaseExpiresAt: expect.any(String),
    }))
    expect(mocks.releaseWhere).toHaveBeenCalledTimes(1)
  })

  it.each(["paused", "cutover", "corrupt-value"])("fails closed before an external request when the barrier is %s", async (barrier) => {
    mocks.barrierRows.mockResolvedValue([{ value: barrier }])
    const { withDtePortalOperationLease } = await import("../operation-lease")
    const work = vi.fn()

    await expect(withDtePortalOperationLease("download", 30_000, work))
      .rejects.toMatchObject({ code: "DTE_PORTAL_STARTS_PAUSED" })

    expect(work).not.toHaveBeenCalled()
    expect(mocks.insertValues).not.toHaveBeenCalled()
  })

  it("distinguishes an operator-owned pause from a malformed barrier for cron health", async () => {
    const { DtePortalStartsPausedError, isIntentionalDtePortalCutoverPause } = await import("../operation-lease")

    expect(isIntentionalDtePortalCutoverPause(new DtePortalStartsPausedError("paused"))).toBe(true)
    expect(isIntentionalDtePortalCutoverPause(new DtePortalStartsPausedError("cutover"))).toBe(true)
    expect(isIntentionalDtePortalCutoverPause(new DtePortalStartsPausedError("corrupt-value"))).toBe(false)
  })

  // El throttle del cliente es por instancia y cada llamador construye la
  // suya: sin tope compartido, N sincronizaciones de períodos distintos salen
  // al portal a la vez.
  it("no deja pasar una tercera operación simultánea contra el portal", async () => {
    vi.useFakeTimers()
    try {
      mocks.liveLeaseRows.mockResolvedValue([{ count: 2 }])
      const { withDtePortalOperationLease } = await import("../operation-lease")
      const work = vi.fn()

      const pending = withDtePortalOperationLease("query", 30_000, work)
      const assertion = expect(pending).rejects.toMatchObject({ code: "DTE_PORTAL_TOO_MANY_OPERATIONS" })
      await vi.advanceTimersByTimeAsync(16_000)
      await assertion

      expect(work).not.toHaveBeenCalled()
      expect(mocks.insertValues).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("espera su turno y adquiere el lease apenas se libera un cupo", async () => {
    vi.useFakeTimers()
    try {
      mocks.liveLeaseRows
        .mockResolvedValueOnce([{ count: 2 }])
        .mockResolvedValue([{ count: 1 }])
      const { withDtePortalOperationLease } = await import("../operation-lease")
      const work = vi.fn().mockResolvedValue("portal-response")

      const pending = withDtePortalOperationLease("query", 30_000, work)
      await vi.advanceTimersByTimeAsync(400)

      await expect(pending).resolves.toBe("portal-response")
      expect(mocks.insertValues).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("lets the ordinary purchase-sync switch remain independent from the cutover barrier", async () => {
    // This query only reads dte.sync_start_barrier. A false value on the
    // separate dte.sync_enabled key therefore appears here as no barrier row.
    mocks.barrierRows.mockResolvedValue([])
    const { assertDtePortalStartsAllowed } = await import("../operation-lease")

    await expect(assertDtePortalStartsAllowed()).resolves.toBeUndefined()
  })
})
