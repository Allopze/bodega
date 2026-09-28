// @vitest-environment jsdom
/**
 * Un requisito global o por cargo no lleva faena y rige en todas: el servidor
 * (`requireRequirementScope`) sólo lo acepta con alcance total. El formulario
 * se lo ofrecía igual a un usuario de faena, que siempre terminaba en error.
 */
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { NewRequirementDialog } from "./epp-dialogs"

afterEach(cleanup)

const props = {
  eppTypes: [{ id: "t-1", label: "Casco" }],
  families: [],
  worksites: [{ id: "ws-1", name: "Faena A" }],
}

function scopeOptions() {
  fireEvent.click(screen.getByRole("button", { name: "Nuevo requisito" }))
  const dialog = screen.getByRole("dialog")
  const [, alcance] = within(dialog).getAllByRole("combobox")
  if (!alcance) throw new Error("falta el selector de alcance")
  fireEvent.click(alcance)
  return { dialog, options: screen.getAllByRole("option").map((node) => node.textContent) }
}

describe("NewRequirementDialog — alcances según el alcance del usuario", () => {
  it("con alcance total ofrece toda la organización, faena y cargo", () => {
    render(<NewRequirementDialog {...props} allowOrgWideScopes />)
    expect(scopeOptions().options).toEqual(["Toda la organización", "Faena", "Cargo"])
  })

  it("con alcance por faena sólo ofrece Faena y lo explica", () => {
    render(<NewRequirementDialog {...props} allowOrgWideScopes={false} />)
    const { dialog, options } = scopeOptions()
    expect(options).toEqual(["Faena"])
    expect(within(dialog).getByText(/Tu alcance es por faena/)).toBeInTheDocument()
    // Parte en Faena: el selector de faena ya está a la vista.
    expect(dialog.querySelector('input[name="worksiteId"]')).not.toBeNull()
  })
})
