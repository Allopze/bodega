// @vitest-environment jsdom
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"

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
  lastRunMonth: null,
  rowsReceived: 0,
  rowsAccepted: 0,
  rowsRejected: 0,
  rowsPending: 0,
  affectedQuantity: 0,
  affectedAmount: 0,
  cursor: null,
  pending: 0,
  pendingItems: [],
  coverageMonth: "2025-01-01",
  coverage: [],
  openRejections: [],
}
const source = {
  key: "copec" as const, name: "Copec", description: "Tarjetas de equipos y abastecimiento de estanques", status: "ok" as const, statusLabel: "Al día",
  lastUpdateAt: null, facts: [], feeds: ["Cargas › Tarjetas"], problem: null, technical: [], completeUntil: null,
}
const startOptions = { currentStart: "2025-01-01", minimumStart: "2020-01-01", maximumStart: "2026-10-01", latestImportedUntil: null }

const PLANNED = [{ from: "2026-10-01", to: "2026-10-31" }, { from: "2025-01-01", to: "2025-01-31" }]
const octoberDone = { from: "2026-10-01", status: "success", rowsReceived: 120, rowsAccepted: 120, rowsRejected: 0, rowsPending: 0, error: null }
const januaryPartial = { from: "2025-01-01", status: "partial", rowsReceived: 190, rowsAccepted: 0, rowsRejected: 0, rowsPending: 190, error: "TAE Diesel: No hay un proveedor Copec activo en el catálogo de combustibles." }

function renderPanel() {
  render(<Boundary><CopecSyncStatus source={source} initialStatus={status} initialStartOptions={startOptions} /></Boundary>)
}

/** Clic y avance del reloj: la pantalla consulta el avance cada 4 s. */
async function clickSyncAndAdvance(ms: number) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Actualizar ahora" }))
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe("aviso de cargas pendientes", () => {
  afterEach(() => cleanup())

  it("habla de cargas y de su mes, no de patentes", () => {
    render(<CopecSyncStatus source={source} initialStatus={{ ...status, pending: 566, lastRunMonth: "2025-01-01" }} initialStartOptions={startOptions} />)
    expect(screen.getByText(/566 cargas de enero de 2025 quedaron pendientes/)).toBeInTheDocument()
    expect(screen.queryByText(/patente\(s\) sin vehículo/)).not.toBeInTheDocument()
  })

  it("nombra la tarjeta de estanque y las patentes que dejaron cargas pendientes, cada una con su arreglo", () => {
    const pendingItems = [
      { kind: "tae_card" as const, label: "1-242269-00258-9-8", loads: 8 },
      { kind: "plate" as const, label: "AB-CD12", loads: 1 },
    ]
    render(<CopecSyncStatus source={source} initialStatus={{ ...status, pending: 9, lastRunMonth: "2026-01-01", pendingItems }} initialStartOptions={startOptions} />)
    const list = screen.getByRole("list", { name: "Tarjetas y patentes con cargas pendientes" })
    const items = within(list).getAllByRole("listitem").map((item) => item.textContent)
    expect(items).toEqual([
      "Tarjeta de abastecimiento 1-242269-00258-9-8 (8 cargas): ningún estanque activo tiene esta tarjeta.",
      "Patente AB-CD12 (1 carga): no está en la flota o no tiene asignación para ese mes.",
    ])
  })

  it("con muchas, nombra las primeras y resume el resto", () => {
    const pendingItems = Array.from({ length: 9 }, (_, index) => ({ kind: "plate" as const, label: `AAAA${index}`, loads: 1 }))
    render(<CopecSyncStatus source={source} initialStatus={{ ...status, pending: 9, lastRunMonth: "2026-01-01", pendingItems }} initialStartOptions={startOptions} />)
    const list = screen.getByRole("list", { name: "Tarjetas y patentes con cargas pendientes" })
    expect(within(list).getAllByRole("listitem")).toHaveLength(7)
    expect(within(list).getByText("y 3 más.")).toBeInTheDocument()
  })
})

describe("fila de Copec en «Fuentes de datos»", () => {
  afterEach(() => cleanup())

  it("muestra el estado de la fuente y «Actualizar ahora» a la vista; el detalle técnico queda plegado", () => {
    const { container } = render(<CopecSyncStatus source={{ ...source, statusLabel: "Hasta ayer", facts: [{ label: "Última actualización", value: "ayer a las 05:31" }] }} initialStatus={status} initialStartOptions={startOptions} />)
    expect(screen.getByRole("heading", { name: "Copec" })).toBeInTheDocument()
    expect(screen.getByText("Hasta ayer")).toBeInTheDocument()
    expect(screen.getByText("ayer a las 05:31")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Actualizar ahora" })).toBeEnabled()
    expect(container.querySelector("details")).not.toHaveAttribute("open")
  })

  it("habla de «Tarjeta de equipos» y «Abastecimiento de estanques», no de TCT ni TAE", () => {
    const coverage = (channel: "TCT" | "TAE", product: "diesel" | "bluemax", rowStatus: "complete" | "unknown", canConfirmEmpty: boolean) => ({
      channel, product, status: rowStatus, canConfirmEmpty,
      canCloseWithIssues: false, closeWithIssuesBlockedReason: null,
      rowsReceived: 0, rowsAccepted: 0, rowsRejected: 0, rowsPending: 0,
      evidence: null, evidenceActorUserId: null, updatedAt: "2025-01-01T00:00:00.000Z",
    })
    render(<CopecSyncStatus source={source} initialStatus={{ ...status, coverage: [coverage("TCT", "diesel", "complete", false), coverage("TAE", "bluemax", "unknown", true)] }} initialStartOptions={startOptions} />)
    expect(screen.getByText("Tarjeta de equipos · Diésel")).toBeInTheDocument()
    expect(screen.getByText("Abastecimiento de estanques · BlueMax")).toBeInTheDocument()
    expect(screen.queryByText(/\bTCT\b|\bTAE\b/)).not.toBeInTheDocument()
  })

  it("con cargas pendientes ofrece ir a vincular las patentes en «Por revisar»", () => {
    render(<CopecSyncStatus source={source} initialStatus={{ ...status, pending: 28, lastRunMonth: "2026-10-01" }} initialStartOptions={startOptions} />)
    expect(screen.getByRole("link", { name: "Ver patentes sin vincular" })).toHaveAttribute("href", "/combustibles/revisar?tipo=patente")
  })

  it("sin pendientes no ofrece ese enlace, y el botón de exportar sólo aparece si se le pasa", () => {
    render(<CopecSyncStatus source={source} initialStatus={status} initialStartOptions={startOptions} qualityExport={<button type="button">Exportar pendientes y rechazos</button>} />)
    expect(screen.queryByRole("link", { name: "Ver patentes sin vincular" })).toBeNull()
    expect(screen.getByRole("button", { name: "Exportar pendientes y rechazos" })).toBeInTheDocument()
  })
})

describe("descripción de la fuente", () => {
  afterEach(() => cleanup())

  it("describe los web services, no el recorrido del portal retirado", () => {
    render(<CopecSyncStatus source={source} initialStatus={status} initialStartOptions={startOptions} />)
    expect(screen.getByText(/consulta los web services de Copec/)).toBeInTheDocument()
    expect(screen.queryByText(/Informes de Consumos/)).not.toBeInTheDocument()
  })
})

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
    expect(screen.getByText(/Sincronizando octubre de 2026 · 0 de 2 meses listos/i)).toBeInTheDocument()
    expect(mocks.progress).toHaveBeenCalledWith({ since: "2026-10-29T23:00:00.000Z" })

    await act(async () => { await vi.advanceTimersByTimeAsync(4_001) })
    expect(screen.getByText(/Meses sincronizados: octubre de 2026, enero de 2025\. 310 filas recibidas · 120 aceptadas · 190 pendientes · 0 rechazadas\./)).toBeInTheDocument()
    expect(screen.getByText(/enero de 2025: TAE Diesel: No hay un proveedor Copec activo/)).toBeInTheDocument()
    expect(screen.getByText(/Se detuvo: El período 2025-01-01 a 2025-01-31 no alcanzó cobertura terminal/)).toBeInTheDocument()
    expect(mocks.toastWarning).toHaveBeenCalledWith(expect.stringMatching(/con observaciones/))
    expect(mocks.getStatus).toHaveBeenCalledOnce()
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "Actualizar ahora" })).toBeEnabled()
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
    expect(screen.getByRole("button", { name: "Actualizar ahora" })).toBeEnabled()
  })

  it("advierte que podría estar en curso si se pierde la respuesta del inicio, sin romper la pantalla", async () => {
    mocks.start.mockRejectedValue(new Error("Failed to fetch"))
    renderPanel()
    await clickSyncAndAdvance(1)
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringMatching(/Podría estar en curso/i))
    expect(mocks.reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "Failed to fetch" }))
    expect(screen.queryByText("Error al cargar combustibles")).not.toBeInTheDocument()
    expect(mocks.progress).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Actualizar ahora" })).toBeEnabled()
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
    expect(screen.getByRole("button", { name: "Actualizar ahora" })).toBeEnabled()
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
    expect(screen.getByRole("button", { name: "Actualizar ahora" })).toBeEnabled()
  })
})
