// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_PERFORMANCE_CONTROL_SETTINGS } from "@/lib/combustibles/control/contracts"

const save = vi.hoisted(() => vi.fn())
const recompute = vi.hoisted(() => vi.fn())
vi.mock("../actions-thresholds", () => ({ savePerformanceThresholdsAction: save, recomputeSeriesBatchAction: recompute }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const { ThresholdsForm } = await import("./thresholds-form")

const batch = (overrides: Record<string, unknown>) => ({
  ok: true,
  data: { processed: 25, total: 50, nextCursor: "veh-25", done: false, changedLoads: 0, flagged: 0, released: 0, ...overrides },
})

describe("ThresholdsForm", () => {
  beforeEach(() => vi.clearAllMocks())

  it("al guardar un valor distinto recalcula por lotes y dice cuántas cargas cambiaron", async () => {
    save.mockResolvedValue({ ok: true, message: "Umbrales guardados.", data: { changed: true } })
    recompute
      .mockResolvedValueOnce(batch({ changedLoads: 4, flagged: 3, released: 1 }))
      .mockResolvedValueOnce(batch({ processed: 25, nextCursor: "veh-50", done: true, changedLoads: 2, flagged: 2, released: 0 }))
    render(<ThresholdsForm settings={DEFAULT_PERFORMANCE_CONTROL_SETTINGS} />)

    fireEvent.change(screen.getByLabelText(/Máximo posible, en litros por hora/), { target: { value: "10" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    expect(await screen.findByText(/Se recalcularon 50 equipos\. 6 cargas cambiaron: 5 pasaron a «Por decidir» y 1 dejó de estarlo\./)).toBeInTheDocument()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ maxLitersPerHour: "10", minSamples: "5" }))
    expect(recompute).toHaveBeenNthCalledWith(1, { cursor: null })
    expect(recompute).toHaveBeenNthCalledWith(2, { cursor: "veh-25" })
    // Hay cargas nuevas por decidir: se ofrece ir a verlas.
    expect(screen.getByRole("link", { name: "Ver las cargas por decidir" })).toHaveAttribute("href", "/combustibles/revisar?tipo=carga")
  })

  it("si nada cambió no recalcula las cargas anteriores", async () => {
    save.mockResolvedValue({ ok: true, message: "Los umbrales ya estaban así: no hay nada que recalcular.", data: { changed: false } })
    render(<ThresholdsForm settings={DEFAULT_PERFORMANCE_CONTROL_SETTINGS} />)
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(recompute).not.toHaveBeenCalled()
    expect(screen.queryByText(/Se recalcularon/)).toBeNull()
  })

  it("«Recalcular las cargas anteriores» corre el recálculo sin guardar", async () => {
    recompute.mockResolvedValue(batch({ processed: 3, total: 3, done: true, nextCursor: "veh-3" }))
    render(<ThresholdsForm settings={DEFAULT_PERFORMANCE_CONTROL_SETTINGS} />)
    fireEvent.click(screen.getByRole("button", { name: "Recalcular las cargas anteriores" }))
    expect(await screen.findByText("Se recalcularon 3 equipos. Ninguna carga cambió.")).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
    expect(screen.queryByRole("link", { name: "Ver las cargas por decidir" })).toBeNull()
  })

  it("el umbral de atípicos se muestra de sólo lectura y lleva a las reglas", () => {
    render(<ThresholdsForm settings={{ ...DEFAULT_PERFORMANCE_CONTROL_SETTINGS, thresholdStdDevs: 2.5 }} />)
    expect(screen.getByText("2,5 veces su variación normal")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Cambiarlo en las reglas de detección" })).toHaveAttribute("href", "/combustibles/ajustes/reglas")
  })
})
