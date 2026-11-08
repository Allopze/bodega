// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock("./actions", () => ({ acceptTalanaFusibleAction: mocks.accept }))
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.toastSuccess, error: vi.fn() } }))

import { FusibleBanner } from "./fusible-banner"

function renderBanner(reason: string | null = "active_drop") {
  return render(<FusibleBanner runId="run-9" reason={reason} startedAt="2026-11-08T09:30:00.000Z" />)
}

beforeEach(() => { mocks.accept.mockResolvedValue({ ok: true, message: "Fusible rearmado: la próxima corrida podrá aplicar los cambios." }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("FusibleBanner", () => {
  it("se anuncia como alerta con el motivo en español y la corrida que se detuvo", () => {
    renderBanner("no_active_contracts")

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("La sincronización con Talana se detuvo por seguridad")
    expect(alert).toHaveTextContent("Talana devolvió cero contratos activos")
    expect(alert).toHaveTextContent("08-11-2026 06:30")
    expect(alert).toHaveTextContent("no cambió nada en Chome")
  })

  it.each([
    ["active_drop", "Los contratos activos cayeron sin finiquitos que lo expliquen"],
    ["mass_altas", "Demasiadas altas en una sola corrida"],
  ])("explica el fusible %s", (reason, text) => {
    renderBanner(reason)
    expect(screen.getByRole("alert")).toHaveTextContent(text)
  })

  it("no rearma sin confirmar", () => {
    renderBanner()

    fireEvent.click(screen.getByRole("button", { name: "Rearmar fusible" }))

    expect(screen.getByRole("dialog", { name: "Rearmar el fusible" })).toBeTruthy()
    expect(mocks.accept).not.toHaveBeenCalled()
  })

  it("al confirmar rearma esa corrida, cierra el diálogo y avisa", async () => {
    renderBanner()
    fireEvent.click(screen.getByRole("button", { name: "Rearmar fusible" }))

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rearmar fusible" }))

    await waitFor(() => expect(mocks.accept).toHaveBeenCalledWith({ runId: "run-9" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(mocks.toastSuccess).toHaveBeenCalledWith(expect.stringContaining("Fusible rearmado"))
  })

  it("si la acción falla, el motivo queda dentro del diálogo, que sigue abierto", async () => {
    mocks.accept.mockResolvedValue({ ok: false, message: "Esa corrida ya no está detenida o ya fue revisada." })
    renderBanner()
    fireEvent.click(screen.getByRole("button", { name: "Rearmar fusible" }))

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rearmar fusible" }))

    expect(await within(screen.getByRole("dialog")).findByText(/ya no está detenida o ya fue revisada/)).toBeTruthy()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })
})
