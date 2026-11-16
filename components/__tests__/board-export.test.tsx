// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const exportChartDataAction = vi.hoisted(() => vi.fn())
const exportBoardDataAction = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))

vi.mock("@/app/(app)/chart-data-export-action", () => ({ exportChartDataAction, exportBoardDataAction }))
vi.mock("@/lib/toast", () => ({ toast }))

import { ChartDataTable } from "@/components/charts/chart-data-table"
import { BoardExportButton } from "@/components/dashboard/board-export-button"

/**
 * «Exportar Excel» de la cabecera de un tablero: junta las tablas «Ver datos» exportables de la
 * pantalla, en el orden en que aparecen, aunque el botón viva en la TopBar (otro árbol) y no en
 * `<main>`. Una tabla sin permiso de exportar (sin `excel`) no entra.
 */
describe("BoardExportButton", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    exportBoardDataAction.mockResolvedValue({ ok: true, data: { base64: "AAAA", filename: "panel_de_mantencion_2026-11-15.xlsx" } })
  })
  afterEach(cleanup)

  it("sin tablas exportables queda en su lugar, deshabilitado", () => {
    render(<BoardExportButton title="Panel de mantención" scope={{ periodo: "Noviembre 2026" }} />)

    expect(screen.getByRole("button", { name: /Exportar Excel/ })).toBeDisabled()
  })

  it("exporta las tablas de la pantalla en el orden en que aparecen, sin las que no tienen permiso", async () => {
    // El botón se monta en otro árbol (la TopBar), como en la aplicación.
    render(<BoardExportButton title="Panel de mantención" scope={{ periodo: "Noviembre 2026", faena: "Todas las faenas" }} />)
    render(
      <main>
        <ChartDataTable caption="OT abiertas hoy, por estado" headers={["Estado", "OT"]} rows={[["Asignada", 5]]} excel={{ permission: "mant:export" }} />
        <ChartDataTable caption="Sólo para ver" headers={["A", "B"]} rows={[["x", 1]]} />
        <ChartDataTable caption="Días fuera de servicio" headers={["Mes", "Días"]} rows={[["oct 2026", 23.8]]} excel={{ permission: "mant:export", notes: ["El último mes es parcial."] }} />
      </main>,
    )

    const button = screen.getByRole("button", { name: "Exportar Excel: Panel de mantención, una hoja por gráfico" })
    expect(button).toBeEnabled()
    fireEvent.click(button)

    await waitFor(() => expect(exportBoardDataAction).toHaveBeenCalledTimes(1))
    expect(exportBoardDataAction).toHaveBeenCalledWith({
      title: "Panel de mantención",
      scope: { periodo: "Noviembre 2026", faena: "Todas las faenas" },
      tables: [
        { title: "OT abiertas hoy, por estado", headers: ["Estado", "OT"], rows: [["Asignada", 5]], permission: "mant:export" },
        { title: "Días fuera de servicio", headers: ["Mes", "Días"], rows: [["oct 2026", 23.8]], permission: "mant:export", notes: ["El último mes es parcial."] },
      ],
    })
  })

  it("una tabla que se desmonta (otra faena, otro período) sale del libro", () => {
    render(<BoardExportButton title="Panel de combustible" scope={{}} />)
    const { unmount } = render(
      <ChartDataTable caption="Litros por faena" headers={["Faena", "Litros"]} rows={[["Biodiversa", 500]]} excel={{ permission: "combustibles:export" }} />,
    )
    expect(screen.getByRole("button", { name: /Exportar Excel: Panel de combustible/ })).toBeEnabled()

    unmount()

    expect(screen.getByRole("button", { name: /Exportar Excel/ })).toBeDisabled()
  })
})
