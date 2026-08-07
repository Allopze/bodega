// @vitest-environment jsdom

import { render, fireEvent, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { OptionSelect } from "./option-select"

const OPTIONS = [
  { value: "clp", label: "CLP" },
  { value: "usd", label: "USD" },
]

function hiddenValue(container: HTMLElement) {
  return (container.querySelector('input[type="hidden"]') as HTMLInputElement | null)?.value
}

describe("OptionSelect", () => {
  it("envía el valor elegido bajo el nombre del campo", () => {
    const { container } = render(
      <OptionSelect name="currency" defaultValue="clp" options={OPTIONS} aria-label="Moneda" />,
    )
    expect((container.querySelector('input[type="hidden"]') as HTMLInputElement).name).toBe("currency")
    expect(hiddenValue(container)).toBe("clp")
  })

  it("traduce la opción vacía a la cadena vacía, no al centinela", () => {
    // Es lo que separa este componente de usar Radix a pelo: `__none__` no
    // puede llegar al FormData, porque el servidor espera "" (o null).
    const onValueChange = vi.fn()
    const { container } = render(
      <OptionSelect
        name="ownerUserId"
        defaultValue="u1"
        emptyLabel="Sin asignar"
        options={[{ value: "u1", label: "Ana" }]}
        aria-label="Responsable"
      />,
    )
    expect(hiddenValue(container)).toBe("u1")

    fireEvent.click(screen.getByRole("combobox", { name: "Responsable" }))
    fireEvent.click(screen.getByRole("option", { name: "Sin asignar" }))

    expect(hiddenValue(container)).toBe("")
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it("controlado: no guarda estado propio y avisa con la cadena vacía", () => {
    const onValueChange = vi.fn()
    const { container } = render(
      <OptionSelect
        value=""
        onValueChange={onValueChange}
        emptyLabel="Todos"
        options={OPTIONS}
        aria-label="Moneda"
      />,
    )

    fireEvent.click(screen.getByRole("combobox", { name: "Moneda" }))
    fireEvent.click(screen.getByRole("option", { name: "USD" }))
    expect(onValueChange).toHaveBeenCalledWith("usd")

    // El padre no movió `value`, así que el trigger sigue en "Todos".
    expect(hiddenValue(container)).toBeUndefined()
    expect(screen.getByRole("combobox", { name: "Moneda" })).toHaveTextContent("Todos")
  })
})
