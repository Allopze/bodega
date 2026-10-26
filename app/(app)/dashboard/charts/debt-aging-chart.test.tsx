// @vitest-environment jsdom

import type { ComponentProps } from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DebtAgingChart, type DebtAgingBucket } from "./debt-aging-chart"

/** Los cinco tramos de `AGING_BUCKETS`, en el orden de los días. */
const ORDEN = ["No vencida", "1–30 días", "31–60 días", "61–90 días", "Más de 90 días"]

function buckets(amounts: number[], counts: Array<number | null> = amounts.map((amount) => (amount > 0 ? 2 : 0))): DebtAgingBucket[] {
  return ORDEN.map((label, index) => ({ key: `t${index}`, label, amount: amounts[index] ?? 0, count: counts[index] ?? 0 }))
}

function renderChart(amounts: number[], extra: Partial<ComponentProps<typeof DebtAgingChart>> = {}) {
  const lista = buckets(amounts)
  const total = amounts.reduce((sum, amount) => sum + amount, 0)
  return render(<DebtAgingChart buckets={lista} totalAmount={total} overdueAmount={total - (amounts[0] ?? 0)} {...extra} />)
}

const filas = () => within(screen.getByRole("list", { name: /tramo de antigüedad/i })).getAllByRole("listitem")

describe("DebtAgingChart", () => {
  // El defecto original: el ranking genérico reordenaba por monto y ponía el
  // tramo más grande (aquí el del medio) primero.
  it("conserva el orden de los días aunque el mayor monto esté en un tramo del medio", () => {
    renderChart([100_000_000, 200_000_000, 2_000_000_000, 300_000_000, 50_000_000])

    expect(filas().map((fila) => ORDEN.findIndex((tramo) => fila.textContent?.includes(tramo)))).toEqual([0, 1, 2, 3, 4])
    // Los segmentos de la barra también siguen el orden de los días.
    const segmentos = Array.from(document.querySelectorAll("[data-segment]")).map((nodo) => nodo.getAttribute("data-segment"))
    expect(segmentos).toEqual(["t0", "t1", "t2", "t3", "t4"])
  })

  it("dibuja un segmento por tramo con saldo y atenúa los tramos en cero", () => {
    renderChart([0, 950_000_000, 1_046_000_000, 493_000_000, 0])

    expect(document.querySelectorAll("[data-segment]")).toHaveLength(3)
    const [noVencida, , , , masDe90] = filas()
    for (const fila of [noVencida!, masDe90!]) {
      expect(fila.hasAttribute("data-zero")).toBe(true)
      expect(fila.textContent).toContain("—")
      expect(fila.textContent).toContain("$0")
    }
    expect(filas()[1]!.hasAttribute("data-zero")).toBe(false)
    expect(filas()[1]!.textContent).toContain("2 facturas")
  })

  it("el titular dice el saldo pendiente, las facturas y lo vencido una sola vez", () => {
    renderChart([0, 950_000_000, 1_046_000_000, 493_000_000, 0], { overdueHref: "/facturacion/facturas?vencidas=1" })

    // 2 facturas por tramo con saldo, tres tramos.
    expect(screen.getByText("en 6 facturas")).toBeDefined()
    expect(screen.getAllByText("$2.489M").length).toBeGreaterThanOrEqual(1)
    const vencido = screen.getByRole("link", { name: /vencido/ })
    expect(vencido.getAttribute("href")).toBe("/facturacion/facturas?vencidas=1")
    expect(vencido.textContent).toContain("$2.489M")
  })

  it("apuntar a una fila destaca su segmento y atenúa el resto; salir lo restaura", () => {
    renderChart([0, 950_000_000, 1_046_000_000, 493_000_000, 0])
    const filaTramo2 = filas()[2]!

    fireEvent.mouseEnter(filaTramo2)
    expect(filaTramo2.getAttribute("data-state")).toBe("active")
    expect(document.querySelector('[data-segment="t2"]')?.getAttribute("data-state")).toBe("active")
    expect(document.querySelector('[data-segment="t1"]')?.getAttribute("data-state")).toBe("dimmed")
    expect(filas()[1]!.getAttribute("data-state")).toBe("dimmed")

    // React deriva `mouseleave` de `mouseout`: salir de la fila sale también del contenedor.
    fireEvent.mouseLeave(filaTramo2)
    expect(filas().every((fila) => fila.getAttribute("data-state") === "idle")).toBe(true)
    expect(document.querySelector('[data-segment="t2"]')?.getAttribute("data-state")).toBe("idle")
  })

  it("apuntar a un segmento destaca la fila de su tramo", () => {
    renderChart([0, 950_000_000, 1_046_000_000, 493_000_000, 0])

    fireEvent.mouseEnter(document.querySelector('[data-segment="t3"]')!)
    expect(filas()[3]!.getAttribute("data-state")).toBe("active")
    expect(filas()[0]!.getAttribute("data-state")).toBe("dimmed")
  })

  it("la barra es una imagen con el resumen de los tramos con saldo", () => {
    renderChart([0, 950_000_000, 0, 0, 0])
    const barra = screen.getByRole("img")
    expect(barra.getAttribute("aria-label")).toContain("1–30 días")
    expect(barra.getAttribute("aria-label")).not.toContain("No vencida")
  })

  it("una fila con href es un enlace; sin href no lo es", () => {
    const lista = buckets([0, 950_000_000, 1_046_000_000, 0, 0])
    lista[1] = { ...lista[1]!, href: "/facturacion/facturas?vencidas=1" }
    render(<DebtAgingChart buckets={lista} totalAmount={1_996_000_000} overdueAmount={1_996_000_000} />)

    expect(within(filas()[1]!).getByRole("link").getAttribute("href")).toBe("/facturacion/facturas?vencidas=1")
    expect(within(filas()[2]!).queryByRole("link")).toBeNull()
  })

  it("con varias monedas no inventa un conteo de facturas", () => {
    const lista = buckets([0, 1_000, 2_000, 0, 0]).map((bucket) => ({ ...bucket, count: null }))
    render(<DebtAgingChart buckets={lista} totalAmount={3_000} overdueAmount={3_000} currency="USD" description="Saldo pendiente · sólo USD" />)

    expect(screen.getByText("por cobrar")).toBeDefined()
    expect(screen.queryByText(/facturas/)).toBeNull()
    // Otra moneda: monto completo con su símbolo, no el compacto en pesos.
    expect(screen.getAllByText(/US\$/).length).toBeGreaterThan(0)
    expect(screen.getByText("Saldo pendiente · sólo USD")).toBeDefined()
  })

  it("sin saldo pendiente muestra el estado vacío con un enlace real y sin barra", () => {
    render(<DebtAgingChart buckets={buckets([0, 0, 0, 0, 0])} totalAmount={0} overdueAmount={0} />)

    expect(screen.getByText("Sin saldo pendiente")).toBeDefined()
    expect(screen.getByRole("link", { name: "Ver facturación" }).getAttribute("href")).toBe("/facturacion")
    expect(screen.queryByRole("img")).toBeNull()
    expect(document.querySelectorAll("[data-segment]")).toHaveLength(0)
    // El título del gráfico sigue siendo el único encabezado.
    expect(screen.getByRole("heading", { name: "Antigüedad de la deuda" })).toBeDefined()
    expect(screen.getAllByRole("heading")).toHaveLength(1)
  })

  it("deuda al día: dice «sin saldo vencido» en vez de un vencido en cero", () => {
    renderChart([500_000_000, 0, 0, 0, 0], { overdueAmount: 0 })
    expect(screen.getByText("sin saldo vencido")).toBeDefined()
  })
})
