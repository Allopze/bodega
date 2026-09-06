// @vitest-environment jsdom

import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Callout } from "./callout"

describe("Callout", () => {
  it("renderiza el contenido con el tono warning por defecto", () => {
    const { getByRole } = render(<Callout>Revisa el período seleccionado.</Callout>)
    const el = getByRole("status")
    expect(el.className).toContain("bg-[var(--color-warning-tint)]")
    expect(el.textContent).toContain("Revisa el período seleccionado.")
  })

  it("cambia el tono con tokens -tint/-line/-ink (nunca los base)", () => {
    const { getByRole } = render(<Callout tone="danger">Falló la carga.</Callout>)
    const el = getByRole("status")
    expect(el.className).toContain("border-[var(--color-danger-line)]")
    expect(el.className).toContain("bg-[var(--color-danger-tint)]")
    expect(el.className).toContain("text-[var(--color-danger-ink)]")
  })

  it("role=alert para avisos que exigen acción", () => {
    const { getByRole } = render(<Callout tone="danger" role="alert">Reintenta.</Callout>)
    expect(getByRole("alert").textContent).toContain("Reintenta.")
  })

  it("role=none omite el rol (container presentacional)", () => {
    const { container } = render(<Callout role="none">Contenido.</Callout>)
    expect(container.firstElementChild?.getAttribute("role")).toBeNull()
  })

  it("renderiza title en negrita antes del cuerpo", () => {
    const { getByText } = render(
      <Callout title="Sin fuente demostrable">Concilia con una fuente verificable.</Callout>,
    )
    expect(getByText("Sin fuente demostrable").className).toContain("font-semibold")
    expect(getByText("Concilia con una fuente verificable.")).toBeTruthy()
  })

  it("el icono es decorativo (aria-hidden) y no rompe el rol", () => {
    const { getByRole } = render(<Callout icon={<span data-testid="icon" />}>Con icono.</Callout>)
    expect(getByRole("status")).toBeTruthy()
    expect(getByRole("status").querySelector('[data-testid="icon"]')?.parentElement?.getAttribute("aria-hidden")).toBe("true")
  })
})
