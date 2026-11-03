// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { computeStatusDistribution, type ComputedStatus } from "@/lib/services/trazabilidad-consolidated"
import { ConsolidatedStatusChart } from "./consolidated-status-chart"

afterEach(() => cleanup())

const distribution = (...statuses: ComputedStatus[]) => computeStatusDistribution(statuses.map((status) => ({ status })))

const MIXED = distribution(
  "entregado", "entregado", "entregado", "en_faena", "en_faena", "solicitado", "borrador", "rechazado",
)

describe("ConsolidatedStatusChart", () => {
  it("es una sola figura con la respuesta primero: el total y su corte en curso / cerradas", () => {
    render(<ConsolidatedStatusChart distribution={MIXED} estado="en_curso" searchParams={{ faena: "ws-1" }} />)
    const figure = screen.getByRole("figure", { name: "Solicitudes por estado" })
    expect(within(figure).getByText(/8 solicitudes: 4 en curso y 4 cerradas \(entregadas, rechazadas o canceladas\)\./)).toBeTruthy()
    // Ya no hay tiles de KPI: ninguna de las cifras de etapa no excluyentes.
    expect(screen.queryByText("Pendientes de compra")).toBeNull()
    expect(screen.queryByText("Esperando proveedor")).toBeNull()
  })

  it("ordena los segmentos por ciclo de vida, de Borrador a Entregado, y los desenlaces al final", () => {
    render(<ConsolidatedStatusChart distribution={MIXED} estado="en_curso" searchParams={{}} />)
    const legend = screen.getAllByRole("listitem").map((item) => item.textContent)
    expect(legend).toEqual(["Borrador1", "Solicitado1", "En faena2", "Entregado3", "Rechazado1"])
  })

  it("la barra describe cada estado con su cifra y su porcentaje, y suma el total", () => {
    render(<ConsolidatedStatusChart distribution={MIXED} estado="en_curso" searchParams={{}} />)
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Solicitudes por estado. Borrador: 1 solicitud (13 %); Solicitado: 1 solicitud (13 %); En faena: 2 solicitudes (25 %); Entregado: 3 solicitudes (38 %); Rechazado: 1 solicitud (13 %)",
    )
  })

  it("cada estado lleva a ?estado= conservando los demás filtros y reiniciando la página", () => {
    render(<ConsolidatedStatusChart distribution={MIXED} estado="en_curso" searchParams={{ faena: "ws-1", q: "SOL-1", page: "3", estado: "en_curso" }} />)
    expect(screen.getByRole("link", { name: /En faena/ }).getAttribute("href")).toBe("/seguimiento?faena=ws-1&q=SOL-1&estado=en_faena")
    expect(screen.getByRole("link", { name: /Entregado/ }).getAttribute("href")).toBe("/seguimiento?faena=ws-1&q=SOL-1&estado=entregado")
  })

  it("el estado elegido se marca y volver a elegirlo quita el filtro", () => {
    render(<ConsolidatedStatusChart distribution={MIXED} estado="en_faena" searchParams={{ faena: "ws-1", estado: "en_faena" }} />)
    const activo = screen.getByRole("link", { name: /En faena/ })
    expect(activo.getAttribute("aria-current")).toBe("true")
    expect(activo.getAttribute("href")).toBe("/seguimiento?faena=ws-1")
    expect(screen.getByRole("link", { name: /Entregado/ }).getAttribute("aria-current")).toBeNull()
  })

  it("usa los tonos de las insignias de estado, como tokens", () => {
    const { container } = render(<ConsolidatedStatusChart distribution={MIXED} estado="en_curso" searchParams={{}} />)
    const fills = Object.fromEntries([...container.querySelectorAll<HTMLElement>("[data-segment]")].map((el) => [el.dataset.segment, el.style.background]))
    expect(fills).toEqual({
      borrador: "var(--color-chart-reference)",
      solicitado: "var(--color-chart-reference)",
      en_faena: "var(--color-info)",
      entregado: "var(--color-success)",
      rechazado: "var(--color-danger)",
    })
  })

  it("avisa cuando la distribución cuenta lo filtrado y no la faena completa", () => {
    const { rerender } = render(<ConsolidatedStatusChart distribution={MIXED} estado="en_curso" searchParams={{}} />)
    expect(screen.queryByText(/no la faena completa/)).toBeNull()
    rerender(<ConsolidatedStatusChart distribution={MIXED} estado="en_curso" searchParams={{ q: "guante" }} filtered />)
    expect(screen.getByText(/Cuenta las que pasan los filtros aplicados, no la faena completa\./)).toBeTruthy()
  })

  it("concuerda en singular", () => {
    render(<ConsolidatedStatusChart distribution={distribution("entregado")} estado="en_curso" searchParams={{}} />)
    expect(screen.getByText(/1 solicitud: 0 en curso y 1 cerrada \(/)).toBeTruthy()
  })

  it("sin solicitudes no dibuja nada: la página ya tiene su estado vacío", () => {
    const { container } = render(<ConsolidatedStatusChart distribution={[]} estado="en_curso" searchParams={{}} />)
    expect(container.firstChild).toBeNull()
  })
})
