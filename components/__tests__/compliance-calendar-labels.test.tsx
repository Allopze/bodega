// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { ComplianceCalendar } from "@/components/charts/compliance-calendar"

const COVERAGE_LABELS = { ok: "Completo", partial: "Parcial", missing: "Sin datos", upcoming: "En curso", na: "No aplica" }

describe("ComplianceCalendar › statusLabels", () => {
  const props = {
    caption: "Cobertura de datos por fuente y mes",
    columns: [{ key: "2026-09", label: "Sep" }, { key: "2026-10", label: "Oct" }, { key: "2026-11", label: "Nov" }],
    rows: [{ id: "copec", label: "Copec", cells: [{ status: "missing" as const, detail: "sin datos del proveedor" }, { status: "ok" as const, detail: "128 filas, 19.040 L" }, { status: "upcoming" as const }] }],
  }

  it("el texto de cada celda y la leyenda usan el vocabulario de la pantalla", () => {
    render(<ComplianceCalendar {...props} statusLabels={COVERAGE_LABELS} />)
    const table = screen.getByRole("table", { name: props.caption })
    expect(within(table).getByText("Sin datos, sin datos del proveedor")).toBeDefined()
    expect(within(table).getByText("Completo, 128 filas, 19.040 L")).toBeDefined()
    expect(within(table).getByText("En curso")).toBeDefined()
    const legend = screen.getByRole("list", { name: "Leyenda" })
    expect(within(legend).getByText(/Completo/)).toBeDefined()
    expect(within(legend).getByText(/En curso/)).toBeDefined()
    expect(within(legend).queryByText(/Cumplido/)).toBeNull()
  })

  it("lo que no se pasa conserva el rótulo de cumplimiento, y sin la prop todo queda como antes", () => {
    render(<ComplianceCalendar {...props} statusLabels={{ ok: "Completo" }} />)
    expect(screen.getByText("Completo, 128 filas, 19.040 L")).toBeDefined()
    expect(screen.getByText("Vencido sin cumplir, sin datos del proveedor")).toBeDefined()
  })

  it("sin statusLabels, los rótulos son los de cumplimiento", () => {
    render(<ComplianceCalendar {...props} />)
    expect(screen.getByText("Cumplido, 128 filas, 19.040 L")).toBeDefined()
  })
})
