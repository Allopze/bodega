// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ChartSlot, DashboardPanel, PanelBlock } from "./dashboard-panel"

describe("DashboardPanel", () => {
  it("es un div sin rol: nunca una región (los e2e cuentan tiles por región)", () => {
    const { container } = render(<DashboardPanel><PanelBlock>contenido</PanelBlock></DashboardPanel>)
    const panel = container.querySelector("[data-dashboard-panel]") as HTMLElement
    expect(panel.tagName).toBe("DIV")
    expect(panel).not.toHaveAttribute("role")
    expect(panel).not.toHaveAttribute("aria-label")
    expect(screen.queryByRole("region")).toBeNull()
    expect(container.querySelector("section")).toBeNull()
  })

  it("aplica el número de columnas pedido a la grilla interior", () => {
    const { container } = render(<DashboardPanel cols="kpis"><PanelBlock>a</PanelBlock></DashboardPanel>)
    // auto-fit: un grupo de 2 tiles se reparte el ancho en vez de dejar media fila vacía.
    expect(container.querySelector("[data-dashboard-panel] > div")).toHaveClass("sm:grid-cols-2", "xl:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]")
  })

  it("se oculta entero cuando ninguna celda tiene contenido", () => {
    const { container } = render(<DashboardPanel cols="charts"><ChartSlot /></DashboardPanel>)
    expect(container.querySelector("[data-dashboard-panel]")?.className).toContain("[&:not(:has(>div>:not(:empty)))]:hidden")
  })
})

describe("PanelBlock", () => {
  it("dibuja las divisiones con borde superior e izquierdo", () => {
    render(<PanelBlock>bloque</PanelBlock>)
    expect(screen.getByText("bloque")).toHaveClass("border-l", "border-t")
  })

  it("el ancho `wide` y `full` ocupan columnas del bento", () => {
    render(<><PanelBlock span="wide">ancho</PanelBlock><PanelBlock span="full">completo</PanelBlock></>)
    expect(screen.getByText("ancho")).toHaveClass("xl:col-span-2")
    expect(screen.getByText("completo")).toHaveClass("xl:col-span-2", "2xl:col-span-3")
  })
})

describe("ChartSlot", () => {
  it("lleva `empty:hidden`: sin gráfico la celda desaparece y no deja un hueco", () => {
    const { container } = render(<ChartSlot />)
    expect(container.firstElementChild).toHaveClass("empty:hidden")
    expect(container.firstElementChild).toBeEmptyDOMElement()
  })

  it("no agrega padding propio: el gráfico lo trae", () => {
    const { container } = render(<ChartSlot>grafico</ChartSlot>)
    expect(container.firstElementChild?.className).not.toMatch(/\bp-\d/)
  })
})
