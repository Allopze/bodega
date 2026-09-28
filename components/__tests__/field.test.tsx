// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

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

  /**
   * Un `<label>` que envuelve contenido rotula al primer control labelable que
   * encuentra y le presta TODO su texto. Con un contenedor de varios controles
   * eso bautizaba al primero con la etiqueta del grupo más el texto de los
   * otros: en `/recepcion/nueva`, "Recepción en oficina" se llamaba "Tipo de
   * recepción Recepción en faena Pendiente Disponible una vez registrada la
   * llegada a oficina".
   */
  it("no presta su etiqueta al primer control cuando el hijo es un contenedor", () => {
    render(
      <Field label="Tipo de recepción">
        <div>
          <button type="button">Recepción en oficina</button>
          <button type="button">Recepción en faena</button>
        </div>
      </Field>,
    )

    expect(screen.getByRole("button", { name: "Recepción en oficina" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Recepción en faena" })).toBeDefined()
  })

  it("sigue rotulando implícitamente cuando el hijo único sí es un control", () => {
    render(
      <Field label="Observaciones">
        <Input />
      </Field>,
    )

    expect(screen.getByLabelText("Observaciones")).toBeDefined()
  })

  /*
   * Sin `htmlFor`, con ayuda o error, el label caía al layout con <div> y no se
   * asociaba a nada: el control quedaba sin nombre accesible. Lo destapó el E2E
   * de gestión del cambio (el textarea "Descripción del cambio" con su "Mínimo
   * 10 caracteres." no se encontraba por su rótulo), y afectaba a cualquier
   * Field sin id que mostrara un error por campo.
   */
  it("sin htmlFor, con ayuda, el control conserva su nombre y su descripción", () => {
    render(
      <Field label="Descripción del cambio" hint="Mínimo 10 caracteres.">
        <Textarea name="description" />
      </Field>,
    )
    const control = screen.getByRole("textbox", { name: "Descripción del cambio" })
    expect(control).toHaveAccessibleDescription("Mínimo 10 caracteres.")
  })

  it("sin htmlFor, con error, el control conserva su nombre y queda inválido", () => {
    render(
      <Field label="Motivo" error="El motivo es obligatorio.">
        <Input name="reason" />
      </Field>,
    )
    const control = screen.getByRole("textbox", { name: "Motivo" })
    expect(control).toHaveAccessibleDescription("El motivo es obligatorio.")
    expect(control).toHaveAttribute("aria-invalid", "true")
  })

  /*
   * Un control que declara su propio nombre lo conserva: inyectarle
   * aria-labelledby lo pisaba ("Firma de prevencionista" pasaba a ser
   * "Firma: prevencionista") y rompía a quien lo localiza por nombre (acta de
   * cierre de inspecciones).
   */
  it("sin htmlFor, respeta el aria-label propio del control y sólo le suma la descripción", () => {
    render(
      <Field label="Firma: prevencionista" hint="Nombre de quien firma.">
        <Input aria-label="Firma de prevencionista" />
      </Field>,
    )
    const control = screen.getByRole("textbox", { name: "Firma de prevencionista" })
    expect(control).toHaveAccessibleDescription("Nombre de quien firma.")
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
