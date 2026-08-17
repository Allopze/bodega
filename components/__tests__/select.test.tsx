// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

describe("Select", () => {
  afterEach(cleanup)

  it("keeps the searchable trigger input editable and filters visible options", () => {
    render(
      <Select searchable value="">
        <SelectTrigger aria-label="Trabajador">
          <SelectValue placeholder="Busca y selecciona trabajador" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ramon" textValue="Ramon Ernesto Mena Cid">
            Ramon Ernesto Mena Cid
          </SelectItem>
          <SelectItem value="rene" textValue="Rene Mauricio Sandoval Urbina">
            Rene Mauricio Sandoval Urbina
          </SelectItem>
        </SelectContent>
      </Select>,
    )

    fireEvent.click(screen.getByRole("combobox", { name: "Trabajador" }))

    const input = screen.getByPlaceholderText("Buscar...")

    expect(fireEvent.mouseDown(input)).toBe(true)

    fireEvent.change(input, { target: { value: "rene" } })

    expect(screen.getByText("Rene Mauricio Sandoval Urbina")).toBeVisible()
    expect(screen.getByText("Ramon Ernesto Mena Cid")).not.toBeVisible()
  })

  // El trigger tiene una línea y trunca: cuando el label de la opción es una
  // frase larga (el nombre completo de una metodología MIPER) se corta a media
  // palabra. Pasarle hijos a SelectValue muestra ahí una forma corta sin perder
  // el label largo en la lista; el diálogo de nueva versión MIPER depende de eso.
  it("prefers the children of SelectValue over the selected option's label", () => {
    render(
      <Select value="miper-5x5">
        <SelectTrigger aria-label="Metodología">
          <SelectValue placeholder="Selecciona metodología">MIPER-5X5 · 2026.1</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="miper-5x5">Matriz de probabilidad y consecuencia 5×5 · 2026.1</SelectItem>
        </SelectContent>
      </Select>,
    )

    const trigger = screen.getByRole("combobox", { name: "Metodología" })

    expect(trigger).toHaveTextContent("MIPER-5X5 · 2026.1")
    expect(trigger).not.toHaveTextContent("Matriz de probabilidad")
  })
})
