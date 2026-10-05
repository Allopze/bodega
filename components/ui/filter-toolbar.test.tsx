// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { FilterToolbar } from "./filter-toolbar"

describe("FilterToolbar · Más filtros", () => {
  afterEach(cleanup)

  it("el nombre accesible incluye el conteo (TIUX-57)", () => {
    render(<FilterToolbar overflowFilters={<div />} activeCount={1} />)
    expect(screen.getByRole("button", { name: "Más filtros (1 activo)" })).toBeTruthy()
    cleanup()
    render(<FilterToolbar overflowFilters={<div />} activeCount={3} />)
    expect(screen.getByRole("button", { name: "Más filtros (3 activos)" })).toBeTruthy()
  })

  it("devuelve el foco al botón al cerrar con Escape (TIUX-24)", async () => {
    render(<FilterToolbar overflowFilters={<input aria-label="Extra" />} />)
    const button = screen.getByRole("button", { name: "Más filtros" })
    button.focus()
    fireEvent.click(button)
    await screen.findByRole("dialog")
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(document.activeElement).toBe(button)
  })
})
