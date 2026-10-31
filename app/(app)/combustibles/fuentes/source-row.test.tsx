// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { SourceRow } from "./source-row"

const base = {
  key: "planilla" as const,
  name: "Planilla de cargas",
  description: "Una fila por carga",
  facts: [{ label: "Último archivo", value: "consolidado.xlsx · 1.240 filas" }],
  feeds: ["Cargas", "Equipos"],
  problem: null,
  technical: ["Las filas ya importadas se omiten solas."],
}

describe("SourceRow", () => {
  afterEach(() => cleanup())

  it("dice el estado, lo que llegó, a dónde llega y que no falta nada", () => {
    render(<SourceRow source={base} status={{ status: "ok", statusLabel: "Importada ayer" }} actions={<button type="button">Importar planilla</button>} />)
    expect(screen.getByRole("heading", { name: "Planilla de cargas" })).toBeInTheDocument()
    expect(screen.getByText("Importada ayer")).toBeInTheDocument()
    expect(screen.getByText("consolidado.xlsx · 1.240 filas")).toBeInTheDocument()
    expect(screen.getByText("Cargas, Equipos")).toBeInTheDocument()
    expect(screen.getByText("Nada")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Importar planilla" })).toBeInTheDocument()
  })

  it("lo que falta se dice en una frase en vez de «Nada»", () => {
    render(<SourceRow source={{ ...base, problem: "El último archivo tiene 1 patente sin vincular a un equipo." }} status={{ status: "pendiente", statusLabel: "Importada ayer" }} />)
    expect(screen.getByText("El último archivo tiene 1 patente sin vincular a un equipo.")).toBeInTheDocument()
    expect(screen.queryByText("Nada")).toBeNull()
  })

  it("una fuente sin datos del período no dice «Nada»: dice que todavía no hay", () => {
    render(<SourceRow source={{ ...base, facts: [] }} status={{ status: "sin_datos", statusLabel: "Sin archivos" }} />)
    expect(screen.getByText("Todavía no hay datos de este período")).toBeInTheDocument()
  })

  it("un dato puede llevar su enlace «cambiarlo» junto al valor, sin abrir el detalle", () => {
    const facts = [{ label: "Sincronización automática", value: "Activada", href: "/combustibles/ajustes/integraciones", hrefLabel: "Cambiar en Ajustes" }]
    render(<SourceRow source={{ ...base, key: "aramco", name: "Aramco", facts, technical: [] }} status={{ status: "ok", statusLabel: "Al día" }} />)
    expect(screen.getByText(/Activada/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Cambiar en Ajustes" })).toHaveAttribute("href", "/combustibles/ajustes/integraciones")
  })

  it("un dato sin enlace no pinta ninguno", () => {
    render(<SourceRow source={base} status={{ status: "ok", statusLabel: "Importada ayer" }} />)
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("el detalle técnico va plegado y sólo existe si hay algo que decir", () => {
    const { container, rerender } = render(<SourceRow source={base} status={{ status: "ok", statusLabel: "Al día" }} />)
    const details = container.querySelector("details")
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute("open")
    expect(screen.getByText("Detalle técnico")).toBeInTheDocument()
    rerender(<SourceRow source={{ ...base, technical: [] }} status={{ status: "ok", statusLabel: "Al día" }} />)
    expect(container.querySelector("details")).toBeNull()
  })
})
