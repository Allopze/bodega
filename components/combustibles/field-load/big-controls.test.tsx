// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { BigField, BigInput } from "./big-controls"

afterEach(() => cleanup())

describe("BigField", () => {
  it("conecta el campo a la ayuda y al error", () => {
    render(
      <BigField id="tae-liters" label="Litros cargados" hint="Si tiene decimales, usa coma." error="Escribe los litros">
        <BigInput id="tae-liters" error />
      </BigField>,
    )
    expect(screen.getByLabelText("Litros cargados")).toHaveAttribute("aria-describedby", "tae-liters-hint tae-liters-error")
    expect(document.getElementById("tae-liters-hint")).toHaveTextContent("Si tiene decimales")
    expect(document.getElementById("tae-liters-error")).toHaveTextContent("Escribe los litros")
  })

  it("sin error sólo apunta a la ayuda, y sin ninguna de las dos no declara nada", () => {
    const { unmount } = render(
      <BigField id="a" label="Con ayuda" hint="Una ayuda"><BigInput id="a" /></BigField>,
    )
    expect(screen.getByLabelText("Con ayuda")).toHaveAttribute("aria-describedby", "a-hint")
    unmount()
    render(<BigField id="b" label="Sin nada"><BigInput id="b" /></BigField>)
    expect(screen.getByLabelText("Sin nada")).not.toHaveAttribute("aria-describedby")
  })
})
