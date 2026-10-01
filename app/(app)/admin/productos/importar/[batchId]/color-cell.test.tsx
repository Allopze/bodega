// @vitest-environment jsdom
/**
 * Regresión: el color de una fila de la importación EPP era un `Select` de un
 * solo valor. «Amarillo, Naranja» se dibujaba vacío, elegir un color pisaba al
 * otro y no había forma de escribir uno fuera de la lista.
 */
import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { ColorCell } from "./color-cell"

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
}))

function open(value: string | null) {
  const onChange = vi.fn()
  render(<ColorCell value={value} onChange={onChange} />)
  fireEvent.click(screen.getByRole("button", { name: /^Color:/ }))
  return { onChange, panel: within(screen.getByRole("dialog")) }
}

describe("ColorCell", () => {
  it("muestra todos los colores de una fila multicolor", () => {
    const { panel } = open("Amarillo, Naranja")

    expect(screen.getByRole("button", { name: "Color: Amarillo, Naranja" })).toBeTruthy()
    expect(panel.getByRole("button", { name: /Amarillo$/ }).getAttribute("aria-pressed")).toBe("true")
    expect(panel.getByRole("button", { name: /Naranja$/ }).getAttribute("aria-pressed")).toBe("true")
  })

  it("marcar otro color lo suma en vez de reemplazar", () => {
    const { onChange, panel } = open("Amarillo")

    fireEvent.click(panel.getByRole("button", { name: "Azul" }))

    expect(onChange).toHaveBeenCalledWith("Amarillo, Azul")
  })

  it("desmarcar el último color deja la fila sin color", () => {
    const { onChange, panel } = open("Amarillo")

    fireEvent.click(panel.getByRole("button", { name: /Amarillo$/ }))

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it("permite crear un color que no está en la lista, con Enter", () => {
    const { onChange, panel } = open("Amarillo")

    const input = panel.getByRole("textbox", { name: "Agregar otro color" })
    fireEvent.change(input, { target: { value: "Verde limón" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(onChange).toHaveBeenCalledWith("Amarillo, Verde limón")
  })

  it("no duplica un color ya marcado al escribirlo con otra capitalización", () => {
    const { onChange, panel } = open("Amarillo")

    const input = panel.getByRole("textbox", { name: "Agregar otro color" })
    fireEvent.change(input, { target: { value: "amarillo" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(onChange).not.toHaveBeenCalled()
  })

  it("ofrece como opción un color propio que ya trae la fila", () => {
    const { panel } = open("Blanco corporativo")

    expect(panel.getByRole("button", { name: /Blanco corporativo$/ }).getAttribute("aria-pressed")).toBe("true")
  })
})
