// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { PdtpCreateProgramForm } from "./create-form"

vi.mock("../actions", () => ({
  createPdtpProgramAction: vi.fn(async () => ({ ok: false, message: "" })),
}))

vi.mock("@/components/admin/submit-button", () => ({
  SubmitButton: ({ label, disabled }: { label: string; disabled?: boolean }) => (
    <button type="submit" disabled={disabled}>{label}</button>
  ),
}))

afterEach(() => cleanup())

const BASE = {
  version: 1,
  activityCount: 87,
  contentDigest: "sha256:base-2026",
}

describe("PdtpCreateProgramForm", () => {
  it("muestra solo el año y el resumen de la Base", () => {
    render(<PdtpCreateProgramForm suggestedYear={2027} existingYears={[2026]} baseRevision={BASE} />)

    expect(screen.getByLabelText("Año del programa")).toHaveValue(2027)
    expect(screen.getByText("Base preventiva para 2027")).toBeDefined()
    expect(screen.getByText(/Revisión 1 · 87 actividades/)).toBeDefined()
    expect(screen.getByRole("button", { name: "Crear programa anual" })).toBeEnabled()
    expect(screen.queryByText(/plantilla/i)).toBeNull()
    expect(screen.queryByText(/programa vacío/i)).toBeNull()
  })

  it("si el año ya existe, indica que abrirá el programa sin duplicarlo", () => {
    render(<PdtpCreateProgramForm suggestedYear={2026} existingYears={[2026]} baseRevision={BASE} />)

    expect(screen.getByText("Existente")).toBeDefined()
    expect(screen.getByRole("button", { name: "Abrir programa anual" })).toBeEnabled()
    expect(screen.getByText(/se abrirá el existente/i)).toBeDefined()
  })

  it("actualiza el año mostrado y la decisión al cambiar el año", () => {
    render(<PdtpCreateProgramForm suggestedYear={2027} existingYears={[2028]} baseRevision={BASE} />)

    fireEvent.change(screen.getByLabelText("Año del programa"), { target: { value: "2028" } })
    expect(screen.getByText("Base preventiva para 2028")).toBeDefined()
    expect(screen.getByRole("button", { name: "Abrir programa anual" })).toBeEnabled()
  })

  it("bloquea la creación mientras no exista una revisión de Base para el año", () => {
    render(<PdtpCreateProgramForm suggestedYear={2027} existingYears={[]} baseRevision={null} />)

    expect(screen.getByRole("alert")).toHaveTextContent("Base 2027 no instalada")
    expect(screen.getByRole("button", { name: "Crear programa anual" })).toBeDisabled()
  })

  it("permite abrir un año existente aunque la base no esté disponible", () => {
    render(<PdtpCreateProgramForm suggestedYear={2027} existingYears={[2027]} baseRevision={null} />)

    expect(screen.getByRole("button", { name: "Abrir programa anual" })).toBeEnabled()
  })
})
