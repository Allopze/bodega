// @vitest-environment jsdom
/**
 * Layout 5 / A3: las altas de Higiene salieron de la barra de filtros a un
 * único "Nuevo" en el header. El gateo es el de antes (D8): agente con
 * `manage`; GES y programa con `assess`, y el GES además con agente y faena.
 */
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { HygieneCreateButton } from "./hygiene-dialogs"

afterEach(cleanup)

const agents = [{ id: "ag-1", code: "SIO2", name: "Sílice", unit: "mg/m3" }]
const worksites = [{ id: "ws-1", name: "Faena A" }]

function chooserOptions() {
  fireEvent.click(screen.getByRole("button", { name: "Nuevo" }))
  const chooser = screen.getByRole("dialog", { name: "¿Qué quieres crear?" })
  return Array.from(chooser.querySelectorAll("[data-choice]")).map((node) => node.getAttribute("data-choice"))
}

describe("HygieneCreateButton", () => {
  it("con sólo manage ofrece únicamente el agente, directo", () => {
    render(<HygieneCreateButton agents={agents} worksites={worksites} canManage canAssess={false} />)
    fireEvent.click(screen.getByRole("button", { name: "Nuevo agente" }))
    expect(screen.getByRole("dialog", { name: "Nuevo agente de exposición" })).toBeInTheDocument()
  })

  it("con sólo assess ofrece GES y programa, no el agente", () => {
    render(<HygieneCreateButton agents={agents} worksites={worksites} canManage={false} canAssess />)
    expect(chooserOptions()).toEqual(["grupo", "programa"])
  })

  it("sin agentes no ofrece GES: queda el programa, directo", () => {
    render(<HygieneCreateButton agents={[]} worksites={worksites} canManage={false} canAssess />)
    fireEvent.click(screen.getByRole("button", { name: "Nuevo programa de vigilancia" }))
    const dialog = screen.getByRole("dialog", { name: "Nuevo programa de vigilancia" })
    expect(within(dialog).getByRole("button", { name: "Crear programa" })).toBeInTheDocument()
  })

  it("con los dos permisos ofrece las tres altas", () => {
    render(<HygieneCreateButton agents={agents} worksites={worksites} canManage canAssess />)
    expect(chooserOptions()).toEqual(["agente", "grupo", "programa"])
  })

  it("sin permisos de alta no hay botón", () => {
    const { container } = render(<HygieneCreateButton agents={agents} worksites={worksites} canManage={false} canAssess={false} />)
    expect(container).toBeEmptyDOMElement()
  })
})
