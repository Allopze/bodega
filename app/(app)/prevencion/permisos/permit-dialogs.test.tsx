// @vitest-environment jsdom
/**
 * Layout 5 / A3: "Nuevo tipo" y "Nuevo permiso" eran dos botones en la barra
 * de filtros. Ahora hay un "Nuevo" junto a Exportar que pregunta qué crear, con
 * el gateo de siempre: tipo con `permits:manage`; permiso con
 * `permits:request`, un tipo activo y una faena.
 */
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { PermitCreateButton } from "./permit-dialogs"

afterEach(cleanup)

const types = [{
  id: "t-1", code: "ALT", name: "Trabajo en altura", requiresIsolation: false, requiresMeasurement: false,
  requiresJsa: true, requiresCrewAcknowledgement: true, maxDurationHours: 8,
}]
const worksites = [{ id: "ws-1", name: "Faena A" }]

function renderButton(props: { canManage: boolean; canRequest: boolean; types?: typeof types }) {
  return render(<PermitCreateButton
    canManage={props.canManage}
    canRequest={props.canRequest}
    types={props.types ?? types}
    worksites={worksites}
    workers={[]}
    supervisors={[]}
  />)
}

describe("PermitCreateButton", () => {
  it("con los dos permisos pregunta qué crear", () => {
    renderButton({ canManage: true, canRequest: true })
    expect(screen.queryByRole("button", { name: "Nuevo tipo" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Nuevo permiso" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Nuevo" }))
    const chooser = screen.getByRole("dialog", { name: "¿Qué quieres crear?" })
    expect(Array.from(chooser.querySelectorAll("[data-choice]")).map((node) => node.getAttribute("data-choice"))).toEqual(["permiso", "tipo"])
  })

  it("el permiso abierto desde el selector trae el inicio prellenado", async () => {
    renderButton({ canManage: true, canRequest: true })
    fireEvent.click(screen.getByRole("button", { name: "Nuevo" }))
    fireEvent.click(within(screen.getByRole("dialog", { name: "¿Qué quieres crear?" })).getByRole("button", { name: /Permiso de trabajo/ }))
    const start = await screen.findByLabelText(/Inicio planificado/)
    await expect.poll(() => (start as HTMLInputElement).value).not.toBe("")
  })

  it("sin tipos activos, quien sólo solicita no ve alta", () => {
    const { container } = renderButton({ canManage: false, canRequest: true, types: [] })
    expect(container).toBeEmptyDOMElement()
  })

  it("con sólo manage abre directo el tipo", () => {
    renderButton({ canManage: true, canRequest: false })
    fireEvent.click(screen.getByRole("button", { name: "Nuevo tipo" }))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })
})
