// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { GroupedBarList } from "@/components/charts/grouped-bar-list"

const SERIES = [
  { key: "items", label: "Ítems sin OC", color: "var(--color-chart-1)" },
  { key: "orders", label: "OC por recibir", color: "var(--color-chart-2)" },
]

describe("GroupedBarList", () => {
  const rows = [
    { key: "a", label: "Faena Norte", values: { items: 12, orders: 4 } },
    { key: "b", label: "Faena Sur", values: { items: 0, orders: 6 } },
  ]

  it("una fila por categoría con una barra y una cifra por serie, y la serie nombrada para el lector de pantalla", () => {
    render(<GroupedBarList rows={rows} series={SERIES} ariaLabel="Pendientes por faena" />)

    const list = screen.getByRole("list", { name: "Pendientes por faena" })
    const north = within(list).getByText("Faena Norte").closest("li")!
    expect(north.textContent).toContain("12")
    expect(north.textContent).toContain("Ítems sin OC")
    expect(north.querySelectorAll("[data-series]")).toHaveLength(2)
  })

  it("todas las barras miden contra el mayor valor de todo el gráfico", () => {
    const { container } = render(<GroupedBarList rows={rows} series={SERIES} ariaLabel="Pendientes por faena" />)

    const width = (rowIndex: number, series: string) =>
      (container.querySelectorAll("ul[aria-label='Pendientes por faena'] > li")[rowIndex]!.querySelector(`[data-series=${series}] [style]`) as HTMLElement | null)?.style.width
    expect(width(0, "items")).toBe("100%")
    expect(width(0, "orders")).toBe(`${(4 / 12) * 100}%`)
    expect(width(1, "orders")).toBe("50%")
  })

  it("un valor en cero no dibuja barra (la cifra «0» sí se escribe)", () => {
    const { container } = render(<GroupedBarList rows={rows} series={SERIES} ariaLabel="Pendientes por faena" />)

    const southItems = container.querySelectorAll("ul[aria-label='Pendientes por faena'] > li")[1]!.querySelector("[data-series=items]")!
    expect(southItems.querySelector("[style]")).toBeNull()
    expect(southItems.textContent).toContain("0")
  })

  it("el color es un token, nunca un hex", () => {
    const { container } = render(<GroupedBarList rows={rows} series={SERIES} ariaLabel="Pendientes por faena" />)

    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}/i)
    expect(container.innerHTML).toContain("var(--color-chart-1)")
  })

  it("el límite resume el resto en «y N más» en vez de truncar en silencio", () => {
    render(<GroupedBarList rows={rows} series={SERIES} ariaLabel="Pendientes por faena" limit={1} />)

    expect(screen.queryByText("Faena Sur")).toBeNull()
    expect(screen.getByText("y 1 más")).toBeInTheDocument()
  })

  it("sin filas no dibuja nada", () => {
    const { container } = render(<GroupedBarList rows={[]} series={SERIES} ariaLabel="Pendientes por faena" />)

    expect(container).toBeEmptyDOMElement()
  })
})
