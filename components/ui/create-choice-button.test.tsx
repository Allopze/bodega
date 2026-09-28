// @vitest-environment jsdom
/**
 * AGENTS.md (layout 5 / densidad A3): varias altas de página = UN botón en
 * `PageHeader.actions` que pregunta qué crear. Con una sola opción permitida no
 * se pregunta nada; sin opciones no se pinta el botón.
 */
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { CreateChoiceButton, type CreateChoice } from "./create-choice-button"

afterEach(cleanup)

const choice = (key: string, label: string, soloLabel: string): CreateChoice => ({
  key,
  label,
  soloLabel,
  description: `Descripción de ${label}`,
  render: ({ open, onOpenChange }) => (open
    ? <div role="dialog" aria-label={`Diálogo ${label}`}><button type="button" onClick={() => onOpenChange(false)}>Cerrar</button></div>
    : null),
})

describe("CreateChoiceButton", () => {
  it("sin opciones no pinta nada", () => {
    const { container } = render(<CreateChoiceButton choices={[]} description="x" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("con una sola opción abre su diálogo directo, sin preguntar", () => {
    render(<CreateChoiceButton choices={[choice("a", "Comité", "Nuevo comité")]} description="x" />)
    fireEvent.click(screen.getByRole("button", { name: "Nuevo comité" }))
    expect(screen.queryByRole("dialog", { name: "¿Qué quieres crear?" })).toBeNull()
    expect(screen.getByRole("dialog", { name: "Diálogo Comité" })).toBeInTheDocument()
  })

  it("con varias pregunta qué crear y abre sólo la elegida", () => {
    render(<CreateChoiceButton
      choices={[choice("a", "Comité", "Nuevo comité"), choice("b", "Revisión", "Nueva revisión")]}
      description="Elige qué agregar."
    />)
    expect(screen.getAllByRole("button")).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "Nuevo" }))
    const chooser = screen.getByRole("dialog", { name: "¿Qué quieres crear?" })
    fireEvent.click(within(chooser).getByRole("button", { name: /Revisión/ }))

    expect(screen.queryByRole("dialog", { name: "¿Qué quieres crear?" })).toBeNull()
    expect(screen.getByRole("dialog", { name: "Diálogo Revisión" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Diálogo Comité" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }))
    expect(screen.queryByRole("dialog", { name: "Diálogo Revisión" })).toBeNull()
  })
})
