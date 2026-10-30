import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  availability: vi.fn(),
  getCopecSweepPeriods: vi.fn(),
  syncCopecReports: vi.fn(),
  listCopecSyncRunsSince: vi.fn(),
  startCronJobInBackground: vi.fn(),
  isCronJobRunning: vi.fn(),
  getCronRunSince: vi.fn(),
}))

vi.mock("@/lib/auth/can", () => ({ guardPermission: (...args: unknown[]) => Reflect.apply(mocks.guardPermission, null, args) }))
vi.mock("@/lib/combustibles/copec-reports", () => ({ copecSyncAvailability: () => mocks.availability() }))
vi.mock("@/lib/combustibles/copec-sync", () => ({
  getCopecSweepPeriods: () => mocks.getCopecSweepPeriods(),
  syncCopecReports: (...args: unknown[]) => Reflect.apply(mocks.syncCopecReports, null, args),
  listCopecSyncRunsSince: (...args: unknown[]) => Reflect.apply(mocks.listCopecSyncRunsSince, null, args),
  getCopecSyncPlan: vi.fn(),
  getCopecSyncState: vi.fn(),
  setCopecSyncStartDate: vi.fn(),
}))
vi.mock("@/lib/services/cron-lock", () => ({
  startCronJobInBackground: (...args: unknown[]) => Reflect.apply(mocks.startCronJobInBackground, null, args),
  isCronJobRunning: (...args: unknown[]) => Reflect.apply(mocks.isCronJobRunning, null, args),
  getCronRunSince: (...args: unknown[]) => Reflect.apply(mocks.getCronRunSince, null, args),
}))
vi.mock("@/lib/combustibles/copec-coverage-store", () => ({ listCopecPeriodCoverage: vi.fn(), recordCopecPeriodCoverage: vi.fn() }))

const { startCopecSyncAction, getCopecSyncProgressAction } = await import("./copec-sync-action")

const PERIODS = [{ from: "2026-10-01", to: "2026-10-31" }, { from: "2025-01-01", to: "2025-01-31" }]

describe("startCopecSyncAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.guardPermission.mockResolvedValue({ session: { user: { id: "operador-1" } }, error: null })
    mocks.availability.mockReturnValue({ hasCredentials: true, syncEnabled: true })
    mocks.getCopecSweepPeriods.mockResolvedValue(PERIODS)
    mocks.startCronJobInBackground.mockResolvedValue("started")
  })

  it("respeta el permiso antes de tocar el portal", async () => {
    mocks.guardPermission.mockResolvedValue({ session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } })
    await expect(startCopecSyncAction()).resolves.toEqual({ ok: false, message: "No tienes permisos para realizar esta acción" })
    expect(mocks.startCronJobInBackground).not.toHaveBeenCalled()
  })

  it("explica que faltan credenciales en vez de iniciar una corrida que fallaría", async () => {
    mocks.availability.mockReturnValue({ hasCredentials: false, syncEnabled: true })
    await expect(startCopecSyncAction()).resolves.toMatchObject({ ok: false, message: expect.stringMatching(/credenciales de Copec/) })
    expect(mocks.startCronJobInBackground).not.toHaveBeenCalled()
  })

  it("corre el mismo barrido del cron bajo su lock, a nombre del operador, y devuelve los meses planeados", async () => {
    const result = await startCopecSyncAction()
    expect(result).toMatchObject({ ok: true, periods: PERIODS })
    expect(result.ok && new Date(result.since).toString()).not.toBe("Invalid Date")
    expect(mocks.startCronJobInBackground).toHaveBeenCalledWith("fuel-copec-sync", expect.any(Function))

    const run = mocks.startCronJobInBackground.mock.calls[0]![1] as () => Promise<unknown>
    await run()
    expect(mocks.syncCopecReports).toHaveBeenCalledWith({ importerId: "operador-1" })
  })

  it("no abre otra sesión del portal si el cron u otra persona ya está sincronizando", async () => {
    mocks.startCronJobInBackground.mockResolvedValue("busy")
    await expect(startCopecSyncAction()).resolves.toMatchObject({ ok: false, message: expect.stringMatching(/en curso/) })
  })
})

describe("getCopecSyncProgressAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.guardPermission.mockResolvedValue({ session: { user: { id: "operador-1" } }, error: null })
    mocks.isCronJobRunning.mockResolvedValue(false)
    mocks.getCronRunSince.mockResolvedValue({ outcome: "failed", detail: "El período 2025-01-01 a 2025-01-31 no alcanzó cobertura terminal para cada canal y producto; se detuvo el barrido antes de saltarlo." })
    mocks.listCopecSyncRunsSince.mockResolvedValue([])
  })

  it("rechaza un instante que no es ISO", async () => {
    await expect(getCopecSyncProgressAction({ since: "ayer" })).resolves.toMatchObject({ ok: false })
    expect(mocks.isCronJobRunning).not.toHaveBeenCalled()
  })

  it("informa si sigue viva, cómo terminó y el resultado de cada mes", async () => {
    mocks.listCopecSyncRunsSince.mockResolvedValue([
      { requestedFrom: "2026-10-01", requestedTo: "2026-10-31", status: "success", rowsReceived: 120, rowsAccepted: 120, rowsRejected: 0, rowsPending: 0, error: null },
      { requestedFrom: "2025-01-01", requestedTo: "2025-01-31", status: "partial", rowsReceived: 190, rowsAccepted: 0, rowsRejected: 0, rowsPending: 190, error: "BlueMax: asignación histórica pendiente; TAE Diesel: No hay un proveedor Copec activo en el catálogo de combustibles." },
    ])
    const result = await getCopecSyncProgressAction({ since: "2026-10-29T23:00:00.000Z" })
    expect(result).toEqual({
      ok: true,
      running: false,
      outcome: "failed",
      detail: expect.stringMatching(/no alcanzó cobertura terminal/),
      runs: [
        expect.objectContaining({ from: "2026-10-01", status: "success", rowsAccepted: 120, error: null }),
        expect.objectContaining({ from: "2025-01-01", status: "partial", rowsPending: 190, error: expect.stringMatching(/asignación histórica pendiente/) }),
      ],
    })
    expect(mocks.getCronRunSince).toHaveBeenCalledWith("fuel-copec-sync", "2026-10-29T23:00:00.000Z")
  })

  // Visto en producción el 2026-08-28: una corrida dejó en `error` la consulta
  // SQL completa del guardado de estado, con las patentes como parámetros.
  it("no deja llegar a la pantalla consultas SQL ni parámetros guardados como error", async () => {
    mocks.listCopecSyncRunsSince.mockResolvedValue([
      { requestedFrom: "2020-01-01", requestedTo: "2020-01-31", status: "partial", rowsReceived: 79, rowsAccepted: 0, rowsRejected: 0, rowsPending: 84, error: "Failed query: insert into \"system_settings\" (\"key\", \"value\") values ($1, $2)\nparams: combustibles.copec.sync,{\"pending\":[\"BPDH-41\"]}" },
    ])
    mocks.getCronRunSince.mockResolvedValue({ outcome: "failed", detail: "Failed query: select 1\nparams: x" })
    const result = await getCopecSyncProgressAction({ since: "2026-10-29T23:00:00.000Z" })
    expect(JSON.stringify(result)).not.toMatch(/Failed query|params:|BPDH-41/)
    expect(result).toMatchObject({ ok: true, detail: expect.stringMatching(/error interno/), runs: [expect.objectContaining({ error: expect.stringMatching(/error interno/i) })] })
  })
})
