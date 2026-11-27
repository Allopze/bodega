// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { noteLine } from "./notas-pedido-fixtures"

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock("@/app/(app)/mantencion/notas-pedido/bulk-actions", () => ({ decideLinesInBulkAction: mocks.decide }))
vi.mock("@/app/(app)/mantencion/notas-pedido/actions", () => ({ rejectNoteItemAction: vi.fn(), resolveNoteItemFromStockAction: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: mocks.refresh }) }))
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }))

const { NoteLineActions } = await import("./note-line-actions")

afterEach(() => { cleanup(); vi.clearAllMocks() })

const props = { noteId: "n1", line: noteLine({ id: "line-9" }), worksiteName: "Biodiversa", buyHref: "/solicitudes/nueva?tipo=repuestos&np=n1" }

describe("«Enviar a compra» de una línea", () => {
  it("lo ve quien administra la nota, junto a las demás salidas", () => {
    render(<NoteLineActions {...props} canManage />)
    for (const name of ["Reservar de bodega", "Enviar a compra", "Rechazar"]) expect(screen.getByRole("button", { name })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Comprar" })).toBeTruthy()
  })

  it("quien sólo compra no lo ve: conserva «Comprar», que arma la solicitud a mano", () => {
    render(<NoteLineActions {...props} canManage={false} />)
    expect(screen.queryByRole("button", { name: "Enviar a compra" })).toBeNull()
    expect(screen.getByRole("link", { name: "Comprar" }).getAttribute("href")).toBe(props.buyHref)
  })

  it("una nota sin OT no ofrece reservar, pero sí enviar a compra", () => {
    render(<NoteLineActions {...props} canManage hasWorkOrder={false} />)
    expect(screen.queryByRole("button", { name: "Reservar de bodega" })).toBeNull()
    expect(screen.getByRole("button", { name: "Enviar a compra" })).toBeTruthy()
  })

  it("envía sólo esa línea, sin confirmar; avisa con el mensaje del servidor y refresca la ficha", async () => {
    mocks.decide.mockResolvedValue({ ok: true, message: "1 línea enviada a compra (SOL-0004).", result: { ok: 1, failed: [], requests: [{ code: "SOL-0004", id: "req-4", approved: true }] } })
    render(<NoteLineActions {...props} canManage />)
    fireEvent.click(screen.getByRole("button", { name: "Enviar a compra" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith("1 línea enviada a compra (SOL-0004)."))
    expect(mocks.decide).toHaveBeenCalledWith({ lineIds: ["line-9"], decision: "comprar" })
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it("si la línea no salió, avisa el motivo de la nota y no refresca", async () => {
    mocks.decide.mockResolvedValue({
      ok: false, message: "No se decidió ninguna línea.", result: { ok: 0, failed: [{ noteCode: "NP-2026-0001", message: "La nota está en espera: acéptala primero." }], requests: [] },
    })
    render(<NoteLineActions {...props} canManage />)
    fireEvent.click(screen.getByRole("button", { name: "Enviar a compra" }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("La nota está en espera: acéptala primero."))
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it("si el servidor rechaza la petición muestra su mensaje", async () => {
    mocks.decide.mockResolvedValue({ ok: false, message: "No tienes permiso para esta acción." })
    render(<NoteLineActions {...props} canManage />)
    fireEvent.click(screen.getByRole("button", { name: "Enviar a compra" }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("No tienes permiso para esta acción."))
  })
})
