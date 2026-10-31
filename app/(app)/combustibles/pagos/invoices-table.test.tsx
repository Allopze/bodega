// @vitest-environment jsdom
/**
 * «Pagos › Facturas» muestra el neto, el IEC y el IVA como columnas (antes sólo
 * el total), con los estados en palabras y un enlace a la ficha de cada carga.
 * La misma información sale como tarjetas bajo `md`.
 */
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { resolvePagination } from "@/lib/pagination"
import { InvoicesTable, type InvoiceRow } from "./invoices-table"

const row: InvoiceRow = {
  id: "load-1", loadDate: "2026-10-28", serviceType: "TCT", product: "PETROLEO DIESEL", receiptNumber: "F-881204",
  odometerReading: 120_300, hourMeterReading: null, liters: 62, baseAmount: 78_210, iecTotal: 14_880, ivaAmount: 17_690, totalAmount: 110_780,
  status: "registered", vehicle: { code: "CM-11", plate: "AA-BB-11" }, supplierName: "Copec", worksiteName: "Biodiversa",
}

function renderTable(rows: InvoiceRow[] = [row], totalItems = rows.length) {
  return render(
    <InvoicesTable
      rows={rows}
      pagination={resolvePagination({ pageParam: "1", totalItems, pageSize: 50 })}
      hrefForPage={(page) => `/combustibles/pagos?pagina=${page}`}
    />,
  )
}

describe("InvoicesTable", () => {
  it("separa neto, IEC e IVA en columnas, con la sigla explicada", () => {
    renderTable()
    const table = screen.getByRole("table")

    for (const header of ["Neto", "IEC", "IVA", "Total"]) expect(within(table).getByRole("columnheader", { name: header })).toBeInTheDocument()
    expect(within(table).getByText("IEC")).toHaveAttribute("title", expect.stringMatching(/impuesto específico/i))
    expect(within(table).getByText("IVA")).toHaveAttribute("title", expect.stringMatching(/19 %/))
    expect(within(table).getByText("$78.210")).toBeInTheDocument()
    expect(within(table).getByText("$14.880")).toBeInTheDocument()
    expect(within(table).getByText("$17.690")).toBeInTheDocument()
    expect(within(table).getByText("$110.780")).toBeInTheDocument()
  })

  it("dice el estado en palabras, la fecha legible y el tipo de tarjeta con el nombre del glosario", () => {
    renderTable()
    const table = screen.getByRole("table")

    expect(within(table).getByText("Registrado")).toBeInTheDocument()
    expect(within(table).getByText("28-10-2026")).toBeInTheDocument()
    expect(within(table).getByText("Tarjeta Copec de equipos")).toBeInTheDocument()
    expect(within(table).queryByText("registered")).toBeNull()
    expect(within(table).queryByText("TCT")).toBeNull()
  })

  it("cada factura lleva a su ficha de carga", () => {
    renderTable()

    const link = within(screen.getByRole("table")).getByRole("link", { name: /ver la factura f-881204/i })
    expect(link).toHaveAttribute("href", "/combustibles/cargas/factura/load-1")
  })

  it("repite la lista como tarjetas para pantalla angosta, con las mismas cifras", () => {
    const { container } = renderTable()
    const cards = container.querySelector<HTMLElement>("div.md\\:hidden")!

    expect(within(cards).getByRole("link", { name: "CM-11 · AA-BB-11" })).toHaveAttribute("href", "/combustibles/cargas/factura/load-1")
    expect(within(cards).getByText("IEC")).toBeInTheDocument()
    expect(within(cards).getByText("$14.880")).toBeInTheDocument()
    expect(within(cards).getByRole("link", { name: /ver factura f-881204/i })).toBeInTheDocument()
  })

  it("pagina con enlaces que conservan el resto de la URL", () => {
    renderTable([row], 120)

    expect(screen.getByRole("link", { name: "Página siguiente" })).toHaveAttribute("href", "/combustibles/pagos?pagina=2")
    expect(screen.getByRole("navigation", { name: "Paginación" })).toHaveTextContent("1 - 50 de 120")
  })

  it("una carga sin equipo ni medidor no inventa datos", () => {
    renderTable([{ ...row, vehicle: null, odometerReading: null, receiptNumber: null, supplierName: null, worksiteName: null }])
    const table = screen.getByRole("table")

    expect(within(table).queryByText(/km|\bh\b/)).toBeNull()
    expect(within(table).getAllByText("—").length).toBeGreaterThanOrEqual(3)
  })
})
