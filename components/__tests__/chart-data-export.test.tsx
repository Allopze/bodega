// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import Link from "next/link"
import type { ReactNode } from "react"

const exportChartDataAction = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))

vi.mock("@/app/(app)/chart-data-export-action", () => ({ exportChartDataAction }))
vi.mock("@/lib/toast", () => ({ toast }))
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }))

import { ChartSection } from "@/components/charts/chart-section"

/**
 * «Ver datos» → Excel: opt-in con el permiso de exportar del módulo, y a Excel van las mismas
 * filas que la tabla (un enlace exporta su texto). El botón es el `ExportButton` de siempre.
 */
const rows = [
  [<Link key="c" href="/combustibles/consumo/litros?proveedor=copec">Copec</Link>, "1.200 L"],
  ["Total", 1200],
]

describe("ChartSection · «Ver datos» → Excel", () => {
  // jsdom no navega: el clic del enlace de descarga se captura para comprobar el archivo que se ofrece.
  const downloads: HTMLAnchorElement[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    downloads.length = 0
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this) })
    exportChartDataAction.mockResolvedValue({ ok: true, data: { base64: "AAAA", filename: "litros_por_proveedor_2026-11-03.xlsx" } })
  })

  it("por defecto no hay botón: quien ve una cifra no recibe por eso la descarga", () => {
    render(<ChartSection title="Litros por proveedor" data={{ headers: ["Proveedor", "Litros"], rows }}><div /></ChartSection>)

    expect(screen.queryByRole("button", { name: /Exportar Excel/ })).toBeNull()
  })

  it("con `excel` aparece «Exportar Excel» y exporta las mismas filas: el enlace sale como su texto", async () => {
    render(
      <ChartSection
        title="Litros por proveedor"
        data={{ caption: "Litros por proveedor y mes", headers: ["Proveedor", "Litros"], rows, excel: { permission: "combustibles:export", notes: ["Sin datos del proveedor en sep-2026."] } }}
      >
        <div />
      </ChartSection>,
    )

    // «Ver datos» es un <details> cerrado: el botón está dentro de él.
    const button = screen.getByText("Exportar Excel", { exact: false }).closest("button")!
    expect(button.getAttribute("aria-label")).toBe("Exportar Excel: Litros por proveedor y mes")
    fireEvent.click(button)

    await waitFor(() => expect(exportChartDataAction).toHaveBeenCalledTimes(1))
    expect(exportChartDataAction).toHaveBeenCalledWith({
      permission: "combustibles:export",
      title: "Litros por proveedor y mes",
      headers: ["Proveedor", "Litros"],
      rows: [["Copec", "1.200 L"], ["Total", 1200]],
      notes: ["Sin datos del proveedor en sep-2026."],
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Archivo exportado"))
    // La descarga es la de ExportButton: un .xlsx en base64 con el nombre que devolvió la acción.
    expect(downloads).toHaveLength(1)
    expect(downloads[0]!.download).toBe("litros_por_proveedor_2026-11-03.xlsx")
    expect(downloads[0]!.href).toContain("data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,AAAA")
  })

  it("si la acción niega el permiso, lo dice en vez de descargar", async () => {
    exportChartDataAction.mockResolvedValue({ ok: false, message: "Sin permisos" })
    render(<ChartSection title="Litros" data={{ headers: ["Mes", "Litros"], rows: [["Ago", 1]], excel: { permission: "combustibles:export" } }}><div /></ChartSection>)

    fireEvent.click(screen.getByText("Exportar Excel", { exact: false }).closest("button")!)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Sin permisos"))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("una tabla sin filas no ofrece exportar un archivo vacío", () => {
    render(<ChartSection title="Litros" data={{ headers: ["Mes", "Litros"], rows: [], excel: { permission: "combustibles:export" } }}><div /></ChartSection>)

    expect(screen.queryByText("Exportar Excel", { exact: false })).toBeNull()
  })

  it("sin notas no manda un arreglo vacío a la acción", async () => {
    render(<ChartSection title="Litros" data={{ headers: ["Mes", "Litros"], rows: [["Ago", 1]], excel: { permission: "analytics:export" } }}><div /></ChartSection>)

    fireEvent.click(screen.getByText("Exportar Excel", { exact: false }).closest("button")!)

    await waitFor(() => expect(exportChartDataAction).toHaveBeenCalled())
    expect(exportChartDataAction.mock.calls[0]![0]).not.toHaveProperty("notes")
  })
})
