// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { PersonalUseNote } from "./personal-use-note"

afterEach(cleanup)

const TOOLTIP = "Los días en que un equipo estuvo con su dueño no suman en los litros ni en el rendimiento de los gráficos. Se marcan en la ficha del equipo."

describe("nota «Excluye uso personal» del Panel", () => {
  it("aparece cuando el período tiene días de uso personal", () => {
    render(<PersonalUseNote days={3} />)
    expect(screen.getByText("Excluye uso personal")).toBeInTheDocument()
  })

  it("sin días excluidos no se dibuja", () => {
    const { container } = render(<PersonalUseNote days={0} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText("Excluye uso personal")).not.toBeInTheDocument()
  })

  it("el aviso se alcanza con el teclado y el tooltip explica qué deja fuera, no un title", async () => {
    render(<PersonalUseNote days={3} />)
    const note = screen.getByText("Excluye uso personal")
    expect(note.getAttribute("tabindex")).toBe("0")
    expect(note.getAttribute("title")).toBeNull()
    fireEvent.focus(note)
    const tip = await screen.findAllByText(TOOLTIP)
    expect(tip.length).toBeGreaterThan(0)
  })
})
