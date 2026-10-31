// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

const mocks = vi.hoisted(() => ({ run: vi.fn(), getStatus: vi.fn(), refresh: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn(), toastWarning: vi.fn(), toastInfo: vi.fn() }))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError, warning: mocks.toastWarning, info: mocks.toastInfo } }))
vi.mock("./aramco-sync-action", () => ({ runAramcoSyncAction: mocks.run, getAramcoSyncStatusAction: mocks.getStatus }))

import { AramcoSyncStatus } from "./aramco-sync-status"

const source = {
  key: "aramco" as const, name: "Aramco", description: "Tarjetas Aramco Fleet", status: "ok" as const, statusLabel: "Al día",
  lastUpdateAt: null, facts: [], feeds: ["Cargas › Tarjetas"], problem: null, technical: [], completeUntil: null,
}
const status = {
  lastBatchAt: null, lastPeriod: null, batches: 0, lastRunAt: null, lastRunStatus: null, rowsReceived: 0, rowsAccepted: 0, rowsRejected: 0, rowsPending: 0,
  affectedQuantity: 0, affectedAmount: 0, hasCredentials: true,
  settings: { syncEnabled: true, fields: { documentNumber: { configured: true, source: "environment" as const }, password: { configured: true, source: "environment" as const } }, hasStoredSettings: false, canStoreSecrets: true },
}

describe("fila de Aramco en «Fuentes de datos»", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getStatus.mockResolvedValue({ ok: true, data: status })
  })
  afterEach(() => cleanup())

  it("ya no trae el formulario de credenciales: remite a Ajustes › Integraciones", () => {
    render(<AramcoSyncStatus source={source} initialStatus={status} credentialsHref="/combustibles/ajustes/integraciones" />)
    expect(screen.queryByLabelText(/RUT de la cuenta/)).toBeNull()
    expect(screen.queryByLabelText(/Clave/)).toBeNull()
    expect(screen.queryByRole("button", { name: /Credenciales y automatización/ })).toBeNull()
    expect(screen.getByRole("link", { name: "Ajustes › Integraciones" })).toHaveAttribute("href", "/combustibles/ajustes/integraciones")
  })

  it("quien no administra integraciones no recibe el enlace", () => {
    render(<AramcoSyncStatus source={source} initialStatus={status} credentialsHref={null} />)
    expect(screen.queryByRole("link", { name: "Ajustes › Integraciones" })).toBeNull()
  })

  it("sin credenciales no se puede sincronizar y se dice dónde configurarlas", () => {
    render(<AramcoSyncStatus source={source} initialStatus={{ ...status, hasCredentials: false }} credentialsHref="/combustibles/ajustes/integraciones" />)
    expect(screen.getByRole("button", { name: "Actualizar ahora" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Traer meses anteriores" })).toBeDisabled()
    expect(screen.getByRole("link", { name: "Configúralas en Ajustes › Integraciones" })).toBeInTheDocument()
  })

  it("«Actualizar ahora» sincroniza, avisa el resultado y refresca la pantalla", async () => {
    mocks.run.mockResolvedValue({ ok: true, imported: 12, refreshed: 1, batches: 2, transactions: 14, rowsAccepted: 12, rowsRejected: 0, rowsPending: 0, pendingPlates: [], from: "2026-10-01", to: "2026-10-30" })
    render(<AramcoSyncStatus source={source} initialStatus={status} credentialsHref={null} />)
    fireEvent.click(screen.getByRole("button", { name: "Actualizar ahora" }))
    expect(await screen.findByText(/14 transacción\(es\) leídas · 12 registro\(s\) en 2 lote\(s\) nuevo\(s\)/)).toBeInTheDocument()
    expect(mocks.run).toHaveBeenCalledWith({})
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Aramco sincronizado: 12 registros")
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it("dice si la sincronización automática diaria está activada, apagada o sin credenciales", () => {
    render(<AramcoSyncStatus source={source} initialStatus={status} credentialsHref={null} />)
    expect(screen.getByText(/Sincronización automática diaria:/)).toHaveTextContent("Sincronización automática diaria: Activada.")
    cleanup()

    // El estado de la fila nace de `initialStatus` (no se actualiza con un re-render): otra fila, otro render.
    render(<AramcoSyncStatus source={source} initialStatus={{ ...status, settings: { ...status.settings, syncEnabled: false } }} credentialsHref={null} />)
    expect(screen.getByText(/Sincronización automática diaria:/)).toHaveTextContent("Sincronización automática diaria: Apagada.")
  })

  it("sin credenciales la sincronización automática figura «Sin credenciales», aunque el interruptor esté encendido", () => {
    render(<AramcoSyncStatus source={source} initialStatus={{ ...status, hasCredentials: false }} credentialsHref="/combustibles/ajustes/integraciones" />)
    expect(screen.getByText(/Sincronización automática diaria:/)).toHaveTextContent("Sincronización automática diaria: Sin credenciales.")
  })

  it("con filas pendientes ofrece ir a vincular las patentes", () => {
    render(<AramcoSyncStatus source={source} initialStatus={{ ...status, rowsPending: 3 }} credentialsHref={null} />)
    expect(screen.getByRole("link", { name: "Ver patentes sin vincular" })).toHaveAttribute("href", "/combustibles/revisar?tipo=patente")
  })
})
