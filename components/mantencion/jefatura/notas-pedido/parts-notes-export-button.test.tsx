// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { PartsNotesExportButton } from "./parts-notes-export-button"

afterEach(cleanup)

describe("PartsNotesExportButton", () => {
  it("el enlace de descarga lleva la pestaña y los filtros de la bandeja, sin los vacíos", () => {
    render(<PartsNotesExportButton tabLabel="Pendientes" params={{ estado: "pendientes", faena: "ws-2", urgencia: "urgente", desde: undefined, equipo: "" }} />)
    fireEvent.click(screen.getByRole("button", { name: /Exportar Excel/ }))
    const link = screen.getByRole("link", { name: /Descargar/ })
    const url = new URL(link.getAttribute("href")!, "http://localhost")
    expect(url.pathname).toBe("/api/mantencion/notas-pedido/export")
    expect(Object.fromEntries(url.searchParams)).toEqual({ estado: "pendientes", faena: "ws-2", urgencia: "urgente" })
    expect(link.hasAttribute("download")).toBe(true)
  })

  it("el diálogo dice qué se exporta: la pestaña, una fila por línea y la hoja de historial; sin selector de fechas propio", () => {
    render(<PartsNotesExportButton tabLabel="Cerradas" params={{ estado: "cerradas" }} />)
    fireEvent.click(screen.getByRole("button", { name: /Exportar Excel/ }))
    expect(screen.getByText(/notas de «Cerradas»/)).toBeTruthy()
    expect(screen.getByText(/una fila por línea/)).toBeTruthy()
    expect(screen.queryByText("Desde")).toBeNull()
  })
})
