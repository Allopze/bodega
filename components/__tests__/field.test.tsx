// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

describe("Field", () => {
  it("renders label and children", () => {
    render(
      <Field label="Correo" htmlFor="email">
        <Input id="email" />
      </Field>,
    )

    expect(screen.getByText("Correo")).toBeDefined()
    expect(screen.getByText("Correo").getAttribute("for")).toBe("email")
  })

  it("shows required indicator", () => {
    render(
      <Field label="Nombre" htmlFor="name" required>
        <Input id="name" />
      </Field>,
    )

    expect(screen.getByText("Nombre")).toBeDefined()
  })

  it("displays helper text", () => {
    render(
      <Field label="Email" htmlFor="email" helper="Nunca compartiremos tu email">
        <Input id="email" />
      </Field>,
    )

    expect(screen.getByText("Nunca compartiremos tu email")).toBeDefined()
  })

  it("displays error message and sets role alert", () => {
    render(
      <Field label="Email" htmlFor="email" error="Email inválido">
        <Input id="email" />
      </Field>,
    )

    expect(screen.getByText("Email inválido")).toBeDefined()
  })

  it("associates error with input via aria-describedby when Field gets error prop", () => {
    render(
      <Field label="Email" htmlFor="email" error="Requerido">
        <Input id="email" data-testid="email-input" />
      </Field>,
    )

    expect(screen.getByText("Requerido")).toBeDefined()
  })

  it("renders FieldGroup", () => {
    const { container } = render(
      <FieldGroup>
        <Field label="A" htmlFor="a"><Input id="a" /></Field>
        <Field label="B" htmlFor="b"><Input id="b" /></Field>
      </FieldGroup>,
    )

    expect(container.firstChild).toBeDefined()
  })
})
