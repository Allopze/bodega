// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  runPeriod: vi.fn(),
  getStatus: vi.fn(),
  toastError: vi.fn(),
  reportError: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock("@/lib/toast", () => ({ toast: { error: mocks.toastError, warning: vi.fn(), success: vi.fn() } }))
vi.mock("@/lib/observability/sentry-client", () => ({ reportBoundaryError: mocks.reportError }))
vi.mock("./copec-sync-action", () => ({
  getCopecSyncPlanAction: mocks.plan,
  runCopecSyncPeriodAction: mocks.runPeriod,
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

describe("sincronización Copec", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runPeriod.mockReset()
    mocks.getStatus.mockReset().mockResolvedValue({ ok: true, data: status })
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.plan.mockResolvedValue({ ok: true, periods: [{ from: "2025-01-01", to: "2025-01-31" }] })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("mantiene la pantalla y advierte que la corrida podría continuar si se pierde la respuesta", async () => {
    mocks.runPeriod.mockRejectedValue(new Error("Failed to fetch"))
    render(<Boundary><CopecSyncStatus initialStatus={status} initialStartOptions={startOptions} /></Boundary>)

    fireEvent.click(screen.getByRole("button", { name: "Sincronizar meses TCT" }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(expect.stringMatching(/podría seguir en curso/i)))
    expect(mocks.reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "Failed to fetch" }))
    expect(screen.queryByText("Error al cargar combustibles")).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("button", { name: "Sincronizar meses TCT" })).toBeEnabled(), { timeout: 5000 })
  })

  it("actualiza el estado y conserva lo confirmado cuando se pierde la respuesta de un período posterior", async () => {
    mocks.plan.mockResolvedValue({ ok: true, periods: [
      { from: "2025-01-01", to: "2025-01-31" },
      { from: "2025-02-01", to: "2025-02-28" },
    ] })
    mocks.runPeriod.mockResolvedValueOnce({ ok: true, imported: 7, refreshed: 0, received: 0, rowsReceived: 7, rowsRejected: 0, rowsPending: 0, pending: 0, unmappedCards: [], unavailable: [], reports: 1, openPeriod: false })
      .mockRejectedValueOnce(new Error("Failed to fetch"))
    mocks.getStatus.mockResolvedValue({ ok: true, data: { ...status, lastRunStatus: "running" } })
    render(<Boundary><CopecSyncStatus initialStatus={status} initialStartOptions={startOptions} /></Boundary>)

    fireEvent.click(screen.getByRole("button", { name: "Sincronizar meses TCT" }))

    await waitFor(() => expect(screen.getByText(/7 registros.*confirmados/i)).toBeInTheDocument())
    expect(screen.getByText(/Copec mantiene una corrida abierta/i)).toBeInTheDocument()
    expect(mocks.getStatus).toHaveBeenCalledOnce()
    expect(screen.queryByText("Error al cargar combustibles")).not.toBeInTheDocument()
  })

  it("conserva el resultado confirmado si falla la actualización final del estado", async () => {
    mocks.runPeriod.mockResolvedValue({ ok: true, imported: 7, refreshed: 0, received: 0, rowsReceived: 7, rowsRejected: 0, rowsPending: 0, pending: 0, unmappedCards: [], unavailable: [], reports: 1, openPeriod: false })
    mocks.getStatus.mockRejectedValue(new Error("Failed to fetch status"))
    render(<Boundary><CopecSyncStatus initialStatus={status} initialStartOptions={startOptions} /></Boundary>)

    fireEvent.click(screen.getByRole("button", { name: "Sincronizar meses TCT" }))

    await waitFor(() => expect(screen.getByText(/7 registros importados/i)).toBeInTheDocument())
    expect(screen.getByText(/no se pudo actualizar el estado/i)).toBeInTheDocument()
    expect(screen.queryByText(/podría seguir en curso/i)).not.toBeInTheDocument()
    expect(screen.queryByText("Error al cargar combustibles")).not.toBeInTheDocument()
  })


  it("informa que no comenzó ninguna corrida si falla la preparación", async () => {
    mocks.plan.mockRejectedValueOnce(new Error("Failed to prepare"))
    render(<Boundary><CopecSyncStatus initialStatus={status} initialStartOptions={startOptions} /></Boundary>)
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar meses TCT" }))
    await waitFor(() => expect(screen.getByText(/no se inició ninguna corrida/i)).toBeInTheDocument())
    expect(mocks.runPeriod).not.toHaveBeenCalled()
  })

  it("conserva el resultado cuando la lectura final devuelve un error de aplicación", async () => {
    mocks.runPeriod.mockResolvedValue({ ok: true, imported: 7, refreshed: 0, received: 0, rowsReceived: 7, rowsRejected: 0, rowsPending: 0, pending: 0, unmappedCards: [], unavailable: [], reports: 1, openPeriod: false })
    mocks.getStatus.mockResolvedValue({ ok: false, message: "sin estado" })
    render(<Boundary><CopecSyncStatus initialStatus={status} initialStartOptions={startOptions} /></Boundary>)
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar meses TCT" }))
    await waitFor(() => expect(screen.getByText(/7 registros importados.*no se pudo actualizar el estado/i)).toBeInTheDocument())
  })


  it("muestra el resultado desconocido inmediatamente aunque la consulta de estado quede pendiente", async () => {
    let resolveStatus!: (value: unknown) => void
    mocks.runPeriod.mockRejectedValue(new Error("Failed to fetch"))
    mocks.getStatus.mockReturnValue(new Promise((resolve) => { resolveStatus = resolve }))
    render(<Boundary><CopecSyncStatus initialStatus={status} initialStartOptions={startOptions} /></Boundary>)
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar meses TCT" }))
    await waitFor(() => expect(screen.getByText(/podría seguir en curso/i)).toBeInTheDocument())
    await act(async () => { resolveStatus({ ok: true, data: status }) })
  })

  it("muestra el resultado confirmado y limita la espera si no llega el estado final", async () => {
    vi.useFakeTimers()
    try {
      mocks.runPeriod.mockResolvedValue({ ok: true, imported: 7, refreshed: 0, received: 0, rowsReceived: 7, rowsRejected: 0, rowsPending: 0, pending: 0, unmappedCards: [], unavailable: [], reports: 1, openPeriod: false })
      mocks.getStatus.mockReturnValue(new Promise(() => {}))
      render(<Boundary><CopecSyncStatus initialStatus={status} initialStartOptions={startOptions} /></Boundary>)
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sincronizar meses TCT" })); await vi.advanceTimersByTimeAsync(1) })
      expect(screen.getByText(/7 registros importados/i)).toBeInTheDocument()
      await act(async () => { await vi.advanceTimersByTimeAsync(10_001) })
      expect(screen.getByText(/no se pudo actualizar el estado/i)).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Sincronizar meses TCT" })).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })

})
