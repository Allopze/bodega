// @vitest-environment jsdom

/**
 * CHART-036: `BillingFlowChart` vive en `components/charts/` y lo usan el tablero
 * (`framed`) y `/facturacion` (`plain`, dentro de un `ChartSection`). La variante
 * del tablero ya la cubre `dashboard-charts.test.tsx`; acá, la que se reutiliza.
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { BillingFlowChart } from "@/components/charts/billing-flow-chart"

const rows = [
  { period: "2026-08", invoiced: 1_000_000, collected: 1_000_000 },
  { period: "2026-09", invoiced: 1_000_000, collected: 700_000 },
  { period: "2026-10", invoiced: 1_500_000, collected: 300_000 },
]

describe("BillingFlowChart · variante plain", () => {
  it("dibuja el trazado y la leyenda sin marco propio: el título y la frase los pone quien lo envuelve", () => {
    const { container } = render(<BillingFlowChart data={rows} variant="plain" />)

    expect(container.querySelector('[data-chart-kind="bars"]')).not.toBeNull()
    expect(screen.getByRole("group", { name: "Series de facturado y cobrado" })).toBeDefined()
    // Sin `ChartFrame`: ni título ni cifra grande de cabecera.
    expect(screen.queryByRole("heading")).toBeNull()
    expect(screen.queryByText(/cobrado de \$/)).toBeNull()
  })

  it("la variante del tablero sigue trayendo su marco y su cifra", () => {
    render(<BillingFlowChart data={rows} />)
    expect(screen.getByRole("heading", { name: "Facturado y cobrado" })).toBeDefined()
    expect(screen.getByText("cobrado de $3,5M facturado entre agosto y octubre")).toBeDefined()
  })

  it("en otra moneda la cabecera usa esa moneda y no el compacto en pesos", () => {
    render(<BillingFlowChart data={[{ period: "2026-10", invoiced: 100, collected: 40 }]} currency="USD" />)
    expect(screen.getByText(/cobrado de US\$100,00 facturado en octubre/)).toBeDefined()
  })

  it("con el mes en curso parcial sigue dibujando las columnas", () => {
    const { container } = render(<BillingFlowChart data={rows} variant="plain" partialPeriod="2026-10" />)
    expect(container.querySelector('[data-chart-kind="bars"]')).not.toBeNull()
  })

  it("sin ningún monto no dibuja una rejilla vacía", () => {
    const { container } = render(<BillingFlowChart data={[{ period: "2026-10", invoiced: 0, collected: 0 }]} variant="plain" />)
    expect(container.firstChild).toBeNull()
  })
})
