// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Combobox } from "./combobox"

const OPTIONS = ["Camión en pendiente", "Ruido de motor"].map((value) => ({ value, label: value }))
const input = () => screen.getByRole("combobox", { name: "Peligro" }) as HTMLInputElement

describe("Combobox", () => {
  it("sin allowCustomValue, un texto que no está en la lista no cambia el valor", () => {
    const onChange = vi.fn()
    render(<Combobox aria-label="Peligro" options={OPTIONS} value="" onChange={onChange} />)
    fireEvent.focus(input())
    fireEvent.change(input(), { target: { value: "Otro peligro" } })
    fireEvent.blur(input())
    expect(onChange).not.toHaveBeenCalled()
  })

  it("con allowCustomValue ofrece «Usar «texto»» y Enter lo confirma", () => {
    const onChange = vi.fn()
    render(<Combobox aria-label="Peligro" options={OPTIONS} value="" onChange={onChange} allowCustomValue />)
    fireEvent.focus(input())
    fireEvent.change(input(), { target: { value: "Polvo en suspensión" } })
    expect(screen.getByRole("option", { name: "Usar «Polvo en suspensión»" })).toBeTruthy()
    fireEvent.keyDown(input(), { key: "Enter" })
    expect(onChange).toHaveBeenCalledWith("Polvo en suspensión")
  })

  it("al salir del campo confirma lo escrito, recortado", () => {
    const onChange = vi.fn()
    render(<Combobox aria-label="Peligro" options={OPTIONS} value="" onChange={onChange} allowCustomValue />)
    fireEvent.focus(input())
    fireEvent.change(input(), { target: { value: "  Polvo  " } })
    fireEvent.blur(input())
    expect(onChange).toHaveBeenCalledWith("Polvo")
  })

  it("al enfocar deja editar el valor actual; salir sin escribir no cambia nada y vaciar lo borra", () => {
    const onChange = vi.fn()
    render(<Combobox aria-label="Peligro" options={OPTIONS} value="Polvo" onChange={onChange} allowCustomValue />)
    expect(input().value).toBe("Polvo")
    fireEvent.focus(input())
    expect(input().value).toBe("Polvo")
    fireEvent.blur(input())
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.focus(input())
    fireEvent.change(input(), { target: { value: "" } })
    fireEvent.blur(input())
    expect(onChange).toHaveBeenCalledWith("")
  })

  it("Enter recién enfocado, sin escribir, conserva el valor; con flecha elige la fila", () => {
    const onChange = vi.fn()
    render(<Combobox aria-label="Peligro" options={OPTIONS} value="Polvo" onChange={onChange} allowCustomValue />)
    fireEvent.focus(input())
    fireEvent.keyDown(input(), { key: "Enter" })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.focus(input())
    fireEvent.keyDown(input(), { key: "ArrowDown" })
    fireEvent.keyDown(input(), { key: "Enter" })
    expect(onChange).toHaveBeenCalledWith("Ruido de motor")
  })

  it("al salir con el texto de una opción existente confirma su value, no el texto", () => {
    const onChange = vi.fn()
    const options = [{ value: "id-1", label: "Camión en pendiente" }]
    render(<Combobox aria-label="Peligro" options={options} value="" onChange={onChange} allowCustomValue />)
    fireEvent.focus(input())
    fireEvent.change(input(), { target: { value: "camion en pendiente" } })
    fireEvent.blur(input())
    expect(onChange).toHaveBeenCalledWith("id-1")
  })
})
