// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const exportLookerPanelAction = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))

vi.mock("@/app/(app)/mantencion/panel/looker-export-action", () => ({ exportLookerPanelAction }))
vi.mock("@/lib/toast", () => ({ toast }))

import { LookerExcelButton } from "./looker-export-button"

/**
 * «Exportar Excel» de Planificación, «Por kilómetros» y «Por horas»: lleva a la acción de servidor la pestaña y los
 * parámetros de la URL, y nada más. Las filas no viajan desde el navegador: el servidor las vuelve a consultar.
 */
describe("LookerExcelButton", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    exportLookerPanelAction.mockResolvedValue({ ok: true, data: { base64: "AAAA", filename: "panel_de_mantencion_por_kilometros_2026-11-24.xlsx" } })
  })
  afterEach(cleanup)

  it("se ofrece como «Exportar Excel», con un nombre accesible que dice qué pestaña y que lleva los filtros", () => {
    render(<LookerExcelButton tab="camiones" params={{}} />)
    const button = screen.getByRole("button", { name: /Exportar Excel/ })
    expect(button).toBeEnabled()
    expect(button.getAttribute("aria-label")).toBe("Exportar Excel: Panel de mantención, pestaña Por kilómetros, con los filtros elegidos")
    expect(button.textContent).toContain("Exportar Excel")
  })

  it("al pulsarlo llama a la acción con la pestaña y los parámetros actuales, y avisa al terminar", async () => {
    const params = { desde: "2026-10-01", hasta: "2026-10-31", faena: ["ws-1", "ws-2"], x_conductor: "JUAN PEREZ" }
    render(<LookerExcelButton tab="maquinas" params={params} />)

    fireEvent.click(screen.getByRole("button", { name: /Exportar Excel/ }))

    await waitFor(() => expect(exportLookerPanelAction).toHaveBeenCalledTimes(1))
    expect(exportLookerPanelAction).toHaveBeenCalledWith({ tab: "maquinas", params })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Archivo exportado"))
  })

  it("si el libro se cortó por el tope, avisa con el límite de filas", async () => {
    exportLookerPanelAction.mockResolvedValue({ ok: true, data: { base64: "AAAA", filename: "x.xlsx", truncated: true, rowLimit: 20_000 } })
    render(<LookerExcelButton tab="planificacion" params={{}} />)
    fireEvent.click(screen.getByRole("button", { name: /Exportar Excel/ }))
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("20")))
  })

  it("si la acción no puede, muestra su mensaje y no descarga", async () => {
    exportLookerPanelAction.mockResolvedValue({ ok: false, message: "Sin permisos" })
    render(<LookerExcelButton tab="planificacion" params={{}} />)
    fireEvent.click(screen.getByRole("button", { name: /Exportar Excel/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Sin permisos"))
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
  })
})
