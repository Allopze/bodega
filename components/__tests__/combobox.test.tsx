// @vitest-environment jsdom
/**
 * El combobox compartido: búsqueda, teclado y contrato ARIA. `ProductPicker`
 * usa el mismo `useComboboxListbox`, así que este archivo cubre la mecánica de
 * los dos.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Combobox } from "@/components/ui/combobox"

afterEach(() => cleanup())

const OPTIONS = [
  { value: "w-1", label: "Ana Colaboradora", hint: "11.111.111-1" },
  { value: "w-2", label: "Beto Operario", hint: "22.222.222-2" },
  { value: "w-3", label: "Camilo Órdenes", hint: "33.333.333-3" },
]

function setup(overrides: Partial<React.ComponentProps<typeof Combobox>> = {}) {
  const onChange = vi.fn()
  render(
    <Combobox
      id="cb"
      options={OPTIONS}
      value=""
      onChange={onChange}
      placeholder="Buscar colaborador..."
      {...overrides}
    />,
  )
  return { onChange, input: screen.getByRole("combobox") }
}

describe("Combobox", () => {
  it("expone el contrato ARIA del patrón combobox", () => {
    const { input } = setup()
    expect(input).toHaveAttribute("aria-autocomplete", "list")
    expect(input).toHaveAttribute("aria-expanded", "false")
    expect(input).toHaveAttribute("aria-controls")

    fireEvent.focus(input)
    expect(input).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    // La opción activa se anuncia por id, no por foco.
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0]!.id)
  })

  it("filtra por etiqueta y por el texto secundario", () => {
    const { input } = setup()
    fireEvent.focus(input)

    fireEvent.change(input, { target: { value: "beto" } })
    expect(screen.getAllByRole("option")).toHaveLength(1)
    expect(screen.getByRole("option")).toHaveTextContent("Beto Operario")

    // Búsqueda por RUT (el hint).
    fireEvent.change(input, { target: { value: "33.333" } })
    expect(screen.getByRole("option")).toHaveTextContent("Camilo Órdenes")
  })

  it("ignora tildes al buscar", () => {
    const { input } = setup()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: "ordenes" } })
    expect(screen.getByRole("option")).toHaveTextContent("Camilo Órdenes")
  })

  it("selecciona con Enter la opción que marcan las flechas", () => {
    const { input, onChange } = setup()
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onChange).toHaveBeenCalledWith("w-2")
  })

  it("ArrowUp desde el inicio va a la última opción", () => {
    const { input, onChange } = setup()
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: "ArrowUp" })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onChange).toHaveBeenCalledWith("w-3")
  })

  it("Escape cierra sin seleccionar", () => {
    const { input, onChange } = setup()
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: "Escape" })
    expect(input).toHaveAttribute("aria-expanded", "false")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("ofrece limpiar la selección sólo cuando el campo es opcional", () => {
    const { input, onChange } = setup({ value: "w-1", clearLabel: "Sin asignar" })
    expect(input).toHaveValue("Ana Colaboradora")
    fireEvent.focus(input)
    // `mouseDown` y no `click`: la fila se elige antes del blur, si no el
    // cierre del popup se comería la selección.
    fireEvent.mouseDown(screen.getByRole("option", { name: "Sin asignar" }))
    expect(onChange).toHaveBeenCalledWith("")

    cleanup()
    const obligatorio = setup({ value: "w-1" })
    fireEvent.focus(obligatorio.input)
    expect(screen.queryByRole("option", { name: "Sin asignar" })).not.toBeInTheDocument()
  })

  it("no reporta una opción activa cuando la búsqueda no encuentra nada", () => {
    const { input } = setup()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: "zzzz" } })
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    expect(input).not.toHaveAttribute("aria-activedescendant")
  })
})
