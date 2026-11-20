// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PersonalUseNote } from "./personal-use-note"

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
})
