// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  progress: vi.fn(),
  getStatus: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  toastSuccess: vi.fn(),
  reportError: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock("@/lib/toast", () => ({ toast: { error: mocks.toastError, warning: mocks.toastWarning, success: mocks.toastSuccess } }))
vi.mock("@/lib/observability/sentry-client", () => ({ reportBoundaryError: mocks.reportError }))
vi.mock("./copec-sync-action", () => ({
  startCopecSyncAction: mocks.start,
  getCopecSyncProgressAction: mocks.progress,
  getCopecSyncStatusAction: mocks.getStatus,
  confirmCopecPeriodEmptyAction: vi.fn(),
  updateCopecSyncStartAction: vi.fn(),
}))

import { CopecSyncStatus } from "./copec-sync-status"

class Boundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  render() {
    return this.state.failed ? <p>Error al cargar combustibles</p> : this.props.children
  }
}

const status = {
  lastRunAt: null,
  lastRunStatus: null,
  rowsReceived: 0,
  rowsAccepted: 0,
  rowsRejected: 0,
  rowsPending: 0,
  affectedQuantity: 0,
  affectedAmount: 0,
  cursor: null,
  pending: 0,
  coverageMonth: "2025-01-01",
  coverage: [],
}
const startOptions = { currentStart: "2025-01-01", minimumStart: "2020-01-01", maximumStart: "2026-10-01", latestImportedUntil: null }

const PLANNED = [{ from: "2026-10-01", to: "2026-10-31" }, { from: "2025-01-01", to: "2025-01-31" }]
const octoberDone = { from: "2026-10-01", status: "success", rowsReceived: 120, rowsAccepted: 120, rowsRejected: 0, rowsPending: 0, error: null }
const januaryPartial = { from: "2025-01-01", status: "partial", rowsReceived: 190, rowsAccepted: 0, rowsRejected: 0, rowsPending: 190, error: "TAE Diesel: No hay un proveedor Copec activo en el catálogo de combustibles." }

function renderPanel() {
  render(<Boundary><CopecSyncStatus initialStatus={status} initialStartOptions={startOptions} /></Boundary>)
}

/** Clic y avance del reloj: la pantalla consulta el avance cada 4 s. */
async function clickSyncAndAdvance(ms: number) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar meses TCT" }))
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe("sincronización Copec en segundo plano", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.start.mockReset().mockResolvedValue({ ok: true, since: "2026-10-29T23:00:00.000Z", periods: PLANNED })
    mocks.progress.mockReset()
    mocks.getStatus.mockReset().mockResolvedValue({ ok: true, data: status })
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("inicia la corrida, muestra el mes en curso y resume cada mes con su motivo al terminar", async () => {
    mocks.progress
      .mockResolvedValueOnce({ ok: true, running: true, outcome: "running", detail: null, runs: [{ ...octoberDone, status: "running" }] })
      .mockResolvedValueOnce({ ok: true, running: false, outcome: "failed", detail: "El período 2025-01-01 a 2025-01-31 no alcanzó cobertura terminal para cada canal y producto; se detuvo el barrido antes de saltarlo.", runs: [octoberDone, januaryPartial] })
    renderPanel()

    await clickSyncAndAdvance(4_001)
    expect(screen.getByText(/Sincronizando octubre de 2026 · 0 de 2 mes\(es\) listos/i)).toBeInTheDocument()
    expect(mocks.progress).toHaveBeenCalledWith({ since: "2026-10-29T23:00:00.000Z" })

    await act(async () => { await vi.advanceTimersByTimeAsync(4_001) })
    expect(screen.getByText(/Meses sincronizados: octubre de 2026, enero de 2025\. 310 filas recibidas · 120 aceptadas · 190 pendientes · 0 rechazadas\./)).toBeInTheDocument()
    expect(screen.getByText(/enero de 2025: TAE Diesel: No hay un proveedor Copec activo/)).toBeInTheDocument()
    expect(screen.getByText(/Se detuvo: El período 2025-01-01 a 2025-01-31 no alcanzó cobertura terminal/)).toBeInTheDocument()
    expect(mocks.toastWarning).toHaveBeenCalledWith(expect.stringMatching(/con observaciones/))
    expect(mocks.getStatus).toHaveBeenCalledOnce()
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "Sincronizar meses TCT" })).toBeEnabled()
  })

  it("felicita sólo cuando todos los meses quedaron limpios", async () => {
    mocks.progress.mockResolvedValueOnce({ ok: true, running: false, outcome: "success", detail: null, runs: [octoberDone] })
    renderPanel()
    await clickSyncAndAdvance(4_001)
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Copec sincronizado")
    expect(mocks.toastWarning).not.toHaveBeenCalled()
  })

  it("avisa sin consultar avance si otra corrida ya tiene el portal", async () => {
    mocks.start.mockResolvedValue({ ok: false, message: "Ya hay una sincronización de Copec en curso (la automática o la de otra persona). Espera a que termine e inténtalo nuevamente." })
    renderPanel()
    await clickSyncAndAdvance(10_000)
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringMatching(/Ya hay una sincronización de Copec en curso/))
    expect(mocks.progress).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Sincronizar meses TCT" })).toBeEnabled()
  })

  it("advierte que podría estar en curso si se pierde la respuesta del inicio, sin romper la pantalla", async () => {
    mocks.start.mockRejectedValue(new Error("Failed to fetch"))
    renderPanel()
    await clickSyncAndAdvance(1)
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringMatching(/Podría estar en curso/i))
    expect(mocks.reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "Failed to fetch" }))
    expect(screen.queryByText("Error al cargar combustibles")).not.toBeInTheDocument()
    expect(mocks.progress).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Sincronizar meses TCT" })).toBeEnabled()
  })

  it("una consulta de avance perdida no corta la espera", async () => {
    mocks.progress
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, running: false, outcome: "success", detail: null, runs: [octoberDone] })
    renderPanel()
    await clickSyncAndAdvance(8_002)
    expect(mocks.reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "Failed to fetch" }))
    expect(screen.getByText(/Meses sincronizados: octubre de 2026/)).toBeInTheDocument()
  })

  it("deja de esperar en pantalla pasado el máximo y dice que la corrida sigue en el servidor", async () => {
    mocks.progress.mockResolvedValue({ ok: true, running: true, outcome: "running", detail: null, runs: [] })
    renderPanel()
    await clickSyncAndAdvance(15 * 60_000 + 4_001)
    expect(screen.getByText(/sigue en curso en el servidor/i)).toBeInTheDocument()
    expect(mocks.toastWarning).toHaveBeenCalledWith(expect.stringMatching(/sigue en curso/))
    expect(screen.getByRole("button", { name: "Sincronizar meses TCT" })).toBeEnabled()
  })

  it("conserva el resumen si falla la actualización final del estado", async () => {
    mocks.progress.mockResolvedValueOnce({ ok: true, running: false, outcome: "success", detail: null, runs: [octoberDone] })
    mocks.getStatus.mockRejectedValue(new Error("Failed to fetch status"))
    renderPanel()
    await clickSyncAndAdvance(4_001)
    expect(screen.getByText(/Meses sincronizados: octubre de 2026.*no se pudo actualizar el estado/i)).toBeInTheDocument()
    expect(screen.queryByText("Error al cargar combustibles")).not.toBeInTheDocument()
  })

  it("muestra el resumen antes de que responda el estado y limita esa espera", async () => {
    mocks.progress.mockResolvedValueOnce({ ok: true, running: false, outcome: "success", detail: null, runs: [octoberDone] })
    mocks.getStatus.mockReturnValue(new Promise(() => {}))
    renderPanel()
    await clickSyncAndAdvance(4_001)
    expect(screen.getByText(/Meses sincronizados: octubre de 2026/)).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001) })
    expect(screen.getByText(/no se pudo actualizar el estado/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Sincronizar meses TCT" })).toBeEnabled()
  })
})
