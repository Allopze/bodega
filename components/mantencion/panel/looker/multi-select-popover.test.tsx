// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MultiSelectPopover } from "./multi-select-popover"

afterEach(cleanup)

const options = Array.from({ length: 8 }, (_, index) => ({
  value: `v-${index}`,
  label: `QA-LK-A${index} · QALKA${index}`,
  hint: "QA_ Faena Looker A",
}))

function open() {
  render(<MultiSelectPopover label="Código" options={options} values={[]} onChange={vi.fn()} emptyLabel="Todos" />)
  fireEvent.click(screen.getByRole("button", { name: "Código: Todos" }))
}

describe("MultiSelectPopover", () => {
  it("el buscador mide 16 px en móvil (iOS hace zoom al enfocar campos de menos) y 12 px desde sm, como el Input", () => {
    open()
    const classes = screen.getByRole("searchbox", { name: "Buscar código" }).className.split(/\s+/)
    expect(classes).toContain("text-[1rem]")
    expect(classes).toContain("sm:text-xs")
    // Un `text-xs` suelto le gana al `text-[1rem]` del Input y deja 12 px también en móvil.
    expect(classes).not.toContain("text-xs")
  })

  it("la faena de la derecha de cada opción se muestra junto al código (no la oculta ni la corta)", () => {
    open()
    const row = screen.getByRole("checkbox", { name: /QA-LK-A1 · QALKA1/ }).closest("label")!
    expect(row.textContent).toContain("QA_ Faena Looker A")
    expect(row.querySelector(".truncate")).toBeNull()
  })
})
