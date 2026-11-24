// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { EmptyState } from "./empty-state"

describe("EmptyState", () => {
  it("pinta el título, la descripción y las dos acciones", () => {
    render(
      <EmptyState
        title="Todavía no hay cargas"
        description="Registra una carga o agrega datos."
        action={<button type="button">Registrar carga</button>}
        secondaryAction={<button type="button">Ver fuentes de datos</button>}
      />,
    )
    expect(screen.getByRole("heading", { name: "Todavía no hay cargas" })).toBeInTheDocument()
    expect(screen.getByText("Registra una carga o agrega datos.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Registrar carga" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Ver fuentes de datos" })).toBeInTheDocument()
  })

  it("no pinta el ícono aunque quien llama lo pase: un estado vacío se dice con palabras", () => {
    const { container } = render(<EmptyState icon={<svg data-testid="ico" />} title="Sin datos" />)
    expect(screen.queryByTestId("ico")).toBeNull()
    // Sin caja tintada: el título es lo primero del bloque.
    expect(container.firstElementChild?.firstElementChild).toBe(screen.getByRole("heading", { name: "Sin datos" }))
  })

  it("`warning` y `danger` colorean el título con la variante -ink; `neutral` y `success` no cambian el color", () => {
    const { rerender } = render(<EmptyState title="Aviso" tone="warning" />)
    expect(screen.getByRole("heading", { name: "Aviso" })).toHaveClass("text-[var(--color-warning-ink)]")
    rerender(<EmptyState title="Aviso" tone="danger" />)
    expect(screen.getByRole("heading", { name: "Aviso" })).toHaveClass("text-[var(--color-danger-ink)]")
    rerender(<EmptyState title="Aviso" tone="success" />)
    expect(screen.getByRole("heading", { name: "Aviso" })).toHaveClass("text-[var(--color-text)]")
    rerender(<EmptyState title="Aviso" />)
    expect(screen.getByRole("heading", { name: "Aviso" })).toHaveClass("text-[var(--color-text)]")
  })

  it("`as` cambia la etiqueta del título (una página entera usa h1)", () => {
    render(<EmptyState title="No encontramos la página" as="h1" />)
    expect(screen.getByRole("heading", { level: 1, name: "No encontramos la página" })).toBeInTheDocument()
  })
})
