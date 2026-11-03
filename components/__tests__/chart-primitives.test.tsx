// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { ChartSection } from "@/components/charts/chart-section"
import { BulletBar } from "@/components/charts/bullet-bar"
import { AgingBar, agingColor } from "@/components/charts/aging-bar"
import { ComplianceCalendar } from "@/components/charts/compliance-calendar"

describe("ChartSection", () => {
  it("es una figura con nombre accesible, resumen, «Ver datos» y drill-down", () => {
    render(
      <ChartSection
        title="Capacitaciones por persona"
        summary="12 de 40 personas tienen alguna vencida"
        data={{ headers: ["Persona", "Vencidas"], rows: [["Ana", 2]] }}
        drillHref="/prevencion/capacitacion?estado=vencida"
        drillLabel="Ver vencidas"
      >
        <svg aria-hidden />
      </ChartSection>,
    )
    const figure = screen.getByRole("figure", { name: "Capacitaciones por persona" })
    expect(within(figure).getByText("12 de 40 personas tienen alguna vencida")).toBeDefined()
    expect(within(figure).getByText("Ver datos")).toBeDefined()
    expect(within(figure).getByRole("link", { name: "Ver vencidas" }).getAttribute("href")).toBe("/prevencion/capacitacion?estado=vencida")
    expect(screen.getByRole("heading", { level: 2, name: "Capacitaciones por persona" })).toBeDefined()
  })

  it("con `empty` no dibuja el gráfico: explica el vacío y ofrece la salida", () => {
    render(
      <ChartSection title="Pendientes" empty={{ label: "No hay pendientes", ctaLabel: "Crear solicitud", ctaHref: "/solicitudes/nueva" }}>
        <div data-testid="grafico" />
      </ChartSection>,
    )
    expect(screen.queryByTestId("grafico")).toBeNull()
    expect(screen.getByText("No hay pendientes")).toBeDefined()
    expect(screen.getByRole("link", { name: /Crear solicitud/ }).getAttribute("href")).toBe("/solicitudes/nueva")
  })
})

describe("BulletBar", () => {
  it("expone un meter con la cifra legible y acota el valor al máximo", () => {
    render(<BulletBar label="Estanque Teno" value={25_000} max={20_000} valueText="25.000 L de 20.000 L" markers={[{ value: 5_000, label: "Reposición" }]} note="Sobre capacidad" tone="danger" />)
    const meter = screen.getByRole("meter", { name: "Estanque Teno" })
    expect(meter.getAttribute("aria-valuenow")).toBe("20000")
    expect(meter.getAttribute("aria-valuetext")).toBe("25.000 L de 20.000 L. Sobre capacidad")
    expect(screen.getByText("Reposición")).toBeDefined()
  })

  it("no se rompe con capacidad cero", () => {
    render(<BulletBar label="Sin capacidad" value={10} max={0} valueText="10 L" />)
    expect(screen.getByRole("meter").getAttribute("aria-valuemax")).toBe("1")
  })
})

describe("AgingBar", () => {
  it("conserva el orden cronológico y describe cada tramo", () => {
    render(
      <AgingBar
        label="Pendientes por antigüedad"
        unit="solicitudes"
        buckets={[
          { label: "Menos de 1 día", count: 5 },
          { label: "1–3 días", count: 0 },
          { label: "Más de 7 días", count: 2, href: "/aprobaciones?antiguedad=7" },
        ]}
      />,
    )
    const img = screen.getByRole("img")
    expect(img.getAttribute("aria-label")).toBe("Pendientes por antigüedad. Menos de 1 día: 5 solicitudes; 1–3 días: 0 solicitudes; Más de 7 días: 2 solicitudes")
    const items = screen.getAllByRole("listitem").map((item) => item.textContent)
    expect(items[0]).toContain("Menos de 1 día")
    expect(items[2]).toContain("Más de 7 días")
    expect(screen.getByRole("link").getAttribute("href")).toBe("/aprobaciones?antiguedad=7")
  })

  it("el color va del gris de referencia al rojo", () => {
    expect(agingColor(0, 4)).toContain("var(--color-danger) 0%")
    expect(agingColor(3, 4)).toContain("var(--color-danger) 100%")
    expect(agingColor(0, 1)).toBe("var(--color-chart-reference)")
  })
})

describe("ComplianceCalendar", () => {
  it("es una tabla con encabezados de fila y columna y el estado en texto, no sólo en color", () => {
    render(
      <ComplianceCalendar
        caption="Alcotest por persona"
        columns={[{ key: "ene", label: "Ene" }, { key: "feb", label: "Feb" }]}
        rows={[{ id: "1", label: "Ana Rojas", cells: [{ status: "ok" }, { status: "missing", detail: "sin registro", href: "/x" }] }]}
      />,
    )
    const table = screen.getByRole("table", { name: "Alcotest por persona" })
    expect(within(table).getByRole("rowheader", { name: "Ana Rojas" })).toBeDefined()
    expect(within(table).getByRole("columnheader", { name: "Feb" })).toBeDefined()
    expect(within(table).getByText("Vencido sin cumplir, sin registro")).toBeDefined()
    expect(within(table).getByRole("link").getAttribute("href")).toBe("/x")
    // El contenedor desplazable recibe foco de teclado.
    expect(screen.getByRole("region", { name: "Alcotest por persona" }).getAttribute("tabindex")).toBe("0")
  })
})
