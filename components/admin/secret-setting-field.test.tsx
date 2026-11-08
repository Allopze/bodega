// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SecretSettingField, SettingsKeyringCallout } from "./secret-setting-field"

describe("SecretSettingField", () => {
  it("parte vacío y dice de dónde viene el valor sin mostrarlo", () => {
    render(<SecretSettingField id="t" name="token" label="Token" type="password" status={{ configured: true, source: "environment" }} />)
    const input = screen.getByLabelText("Token")
    expect(input).toHaveValue("")
    expect(screen.getByText(/Del servidor \(\.env\) · vacío conserva/)).toBeInTheDocument()
  })

  it("ofrece borrar sólo lo guardado en la plataforma", () => {
    const { rerender } = render(
      <SecretSettingField id="t" name="token" label="Token" clearName="clearToken" status={{ configured: true, source: "environment" }} />,
    )
    expect(screen.queryByLabelText("Borrar el valor guardado (Token)")).not.toBeInTheDocument()

    rerender(<SecretSettingField id="t" name="token" label="Token" clearName="clearToken" status={{ configured: true, source: "system_settings" }} />)
    expect(screen.getByLabelText("Borrar el valor guardado (Token)")).toBeEnabled()
  })

  it("deshabilita «Borrar» mientras se escribe un valor nuevo y lo rehabilita al vaciarse el formulario", () => {
    render(
      <form data-testid="f">
        <SecretSettingField id="t" name="token" label="Token" clearName="clearToken" status={{ configured: true, source: "system_settings" }} />
      </form>,
    )
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "nuevo" } })
    expect(screen.getByLabelText("Borrar el valor guardado (Token)")).toBeDisabled()

    fireEvent.reset(screen.getByTestId("f"))
    expect(screen.getByLabelText("Borrar el valor guardado (Token)")).toBeEnabled()
  })

  it("sin valor dice «Sin configurar»", () => {
    render(<SecretSettingField id="t" name="token" label="Token" status={{ configured: false, source: "missing" }} />)
    expect(screen.getByText("Sin configurar.")).toBeInTheDocument()
  })
})

describe("SettingsKeyringCallout", () => {
  it("avisa como alerta y explica qué sí se puede guardar", () => {
    render(<SettingsKeyringCallout>El modo sí se puede cambiar.</SettingsKeyringCallout>)
    expect(screen.getByRole("alert")).toHaveTextContent("No hay llavero de cifrado en el servidor")
    expect(screen.getByRole("alert")).toHaveTextContent("El modo sí se puede cambiar.")
  })
})
