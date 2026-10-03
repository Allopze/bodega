// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MiperHistoryEvent, MiperHistoryPage, MiperWorkspace } from "@/lib/services/miper/queries"

const loadMiperHistoryPageAction = vi.hoisted(() => vi.fn())
vi.mock("./history-actions", () => ({ loadMiperHistoryPageAction }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

import { HistoryPanel } from "./history-panel"

const workspace = { matrix: { id: "m1" }, versions: [], siblingMatrices: [] } as unknown as MiperWorkspace
const event = (id: string): MiperHistoryEvent => ({ id, at: "2026-10-01T12:00:00.000Z", actorName: "Ana", actingAs: null, changeType: "created", object: null, reason: `Motivo ${id}` })
const page = (ids: string[], nextCursor: string | null): MiperHistoryPage => ({ events: ids.map(event), nextCursor })

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("HistoryPanel: bitácora paginada", () => {
  it("«Cargar más» pide con el cursor y agrega", async () => {
    loadMiperHistoryPageAction.mockResolvedValue({ ok: true, data: page(["e3", "e4"], null) })
    render(<HistoryPanel workspace={workspace} history={page(["e1", "e2"], "cursor-1")} />)
    expect(screen.getByText("Mostrando 2 eventos")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }))
    await waitFor(() => expect(screen.getByText("Mostrando 4 eventos")).toBeTruthy())
    expect(loadMiperHistoryPageAction).toHaveBeenCalledWith({ matrixId: "m1", cursor: "cursor-1" })
    expect(screen.getByText("Motivo e4")).toBeTruthy()
    // Era la última página: el botón desaparece.
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull()
  })

  it("sin nextCursor no hay botón", () => {
    render(<HistoryPanel workspace={workspace} history={page(["e1"], null)} />)
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull()
  })

  it("una history nueva por props descarta las páginas agregadas", async () => {
    loadMiperHistoryPageAction.mockResolvedValue({ ok: true, data: page(["e3", "e4"], "cursor-2") })
    const { rerender } = render(<HistoryPanel workspace={workspace} history={page(["e1", "e2"], "cursor-1")} />)
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }))
    await waitFor(() => expect(screen.getByText("Mostrando 4 eventos")).toBeTruthy())
    rerender(<HistoryPanel workspace={workspace} history={page(["n1", "e1", "e2"], "cursor-9")} />)
    expect(screen.getByText("Mostrando 3 eventos")).toBeTruthy()
    expect(screen.queryByText("Motivo e4")).toBeNull()
    // El cursor vuelve a ser el de la history nueva.
    loadMiperHistoryPageAction.mockClear()
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }))
    await waitFor(() => expect(loadMiperHistoryPageAction).toHaveBeenCalledWith({ matrixId: "m1", cursor: "cursor-9" }))
  })
})
