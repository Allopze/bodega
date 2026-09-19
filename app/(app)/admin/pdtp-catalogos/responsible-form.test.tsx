// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ResponsibleForm } from "./responsible-form"

vi.mock("./actions", () => ({
  savePdtpResponsibleAction: vi.fn(async () => ({ ok: false, message: "" })),
}))

afterEach(() => cleanup())

const ROLE_OPTIONS = ["administrador", "jefe_terreno", "prevencionista"]

// Radix Select duplica el valor seleccionado (trigger cerrado + opción
// resaltada) en jsdom, que no calcula layout real — por eso estas
// comprobaciones piden "existe al menos una vez", no "es único".
function expectVisible(text: string) {
  expect(screen.getAllByText(text).length).toBeGreaterThan(0)
}

describe("ResponsibleForm", () => {
  it("nunca deja escribir un tipo o un rol libres: son selects cerrados", () => {
    render(<ResponsibleForm open onClose={() => {}} editResponsible={null} roleOptions={ROLE_OPTIONS} />)

    // "Tipo" ofrece exactamente los 4 valores conocidos, con etiqueta en
    // español — no un <input> de texto libre.
    expect(screen.queryByRole("textbox", { name: /tipo/i })).toBeNull()
    fireEvent.click(screen.getByLabelText("Tipo"))
    expectVisible("Rol del sistema")
    expectVisible("Grupo")
    expectVisible("Persona")
    expectVisible("Otro")
    fireEvent.click(screen.getAllByText("Grupo")[0]!)

    // "Rol del sistema relacionado" ofrece los roles reales del registry, más
    // la opción de dejarlo vacío — no un <input> con un placeholder inventado.
    expect(screen.queryByRole("textbox", { name: /rol del sistema/i })).toBeNull()
    fireEvent.click(screen.getByLabelText(/rol del sistema relacionado/i))
    expectVisible("Sin rol asociado")
    for (const role of ROLE_OPTIONS) expectVisible(role)
  })

  it("conserva y rotula un rol heredado que ya no es un default-grant vigente", () => {
    render(
      <ResponsibleForm
        open
        onClose={() => {}}
        editResponsible={{ slug: "resp-1", displayName: "Responsable viejo", roleName: "rol_retirado", kind: "rol_rbac", notes: "", isActive: true }}
        roleOptions={ROLE_OPTIONS}
      />,
    )

    fireEvent.click(screen.getByLabelText(/rol del sistema relacionado/i))
    expectVisible("rol_retirado (heredado)")
  })

  it("conserva un tipo fuera de las 4 opciones conocidas en vez de mostrar el select vacío", () => {
    render(
      <ResponsibleForm
        open
        onClose={() => {}}
        editResponsible={{ slug: "resp-1", displayName: "Responsable viejo", roleName: "", kind: "role", notes: "", isActive: true }}
        roleOptions={ROLE_OPTIONS}
      />,
    )

    fireEvent.click(screen.getByLabelText("Tipo"))
    expectVisible("role (heredado)")
  })
})
