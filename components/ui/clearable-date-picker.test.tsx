// @vitest-environment jsdom
import * as React from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ClearableDatePicker } from "./clearable-date-picker"

afterEach(cleanup)

function Harness({ initial, name = "soapExpiresAt" }: { initial: string; name?: string }) {
  const [value, setValue] = React.useState(initial)
  return (
    <form data-testid="form">
      <ClearableDatePicker id="soap" name={name} value={value} onChange={setValue} ariaLabel="SOAP" clearAriaLabel="Quitar fecha de SOAP" />
    </form>
  )
}

/** Lo que viajaría al servidor: el campo oculto del `DatePicker`. */
const submitted = (name = "soapExpiresAt") => new FormData(screen.getByTestId("form") as HTMLFormElement).get(name)

describe("ClearableDatePicker", () => {
  it("con fecha ofrece «Quitar fecha», nombrado por el campo", () => {
    render(<Harness initial="2027-03-31" />)

    expect(screen.getByRole("button", { name: "Quitar fecha de SOAP" })).toHaveTextContent("Quitar fecha")
    expect(submitted()).toBe("2027-03-31")
  })

  it("sin fecha no hay nada que quitar", () => {
    render(<Harness initial="" />)

    expect(screen.queryByRole("button", { name: /Quitar fecha/ })).toBeNull()
  })

  it("quitar vacía el campo —que viaja vacío, no ausente— y devuelve el foco al selector", () => {
    render(<Harness initial="2027-03-31" />)

    fireEvent.click(screen.getByRole("button", { name: "Quitar fecha de SOAP" }))

    // Vacío («quitar el dato»), no ausente («no tocar»): el servidor los distingue.
    expect(submitted()).toBe("")
    expect(screen.queryByRole("button", { name: /Quitar fecha/ })).toBeNull()
    expect(document.activeElement?.id).toBe("soap")
  })
})
