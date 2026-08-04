// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { Badge } from "@/components/ui/badge"
import { ResponsiveDataListCard, ResponsiveDataListField } from "./responsive-data-list"

describe("ResponsiveDataListCard", () => {
  it("keeps identity, status, named data and the row action together", () => {
    render(
      <ResponsiveDataListCard
        title="Administrador de faena"
        description="Gestiona permisos locales"
        status={<Badge variant="success">Activo</Badge>}
        actions={<button type="button">Editar</button>}
      >
        <ResponsiveDataListField label="Permisos">12</ResponsiveDataListField>
        <ResponsiveDataListField label="Alcance">Faena</ResponsiveDataListField>
      </ResponsiveDataListCard>,
    )

    expect(screen.getByRole("heading", { name: "Administrador de faena" })).toBeDefined()
    expect(screen.getByText("Gestiona permisos locales")).toBeDefined()
    expect(screen.getByText("Activo")).toBeDefined()
    expect(screen.getByText("Permisos")).toBeDefined()
    expect(screen.getByText("12")).toBeDefined()
    expect(screen.getByRole("button", { name: "Editar" })).toBeDefined()
  })
})
