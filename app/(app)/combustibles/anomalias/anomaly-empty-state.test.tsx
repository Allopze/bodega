// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AnomalyEmptyState } from "./anomaly-empty-state"

describe("AnomalyEmptyState", () => {
  it("con filtros dice que ninguno coincide y ofrece quitarlos", () => {
    render(<AnomalyEmptyState filtered canManageRules />)
    expect(screen.getByRole("heading", { name: "Ningún caso coincide con los filtros" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Limpiar filtros" })).toHaveAttribute("href", "/combustibles/anomalias")
    expect(screen.queryByRole("link", { name: "Ver reglas" })).toBeNull()
  })

  it("sin ningún caso explica qué hace que aparezca uno y lleva a las reglas a quien puede administrarlas", () => {
    render(<AnomalyEmptyState filtered={false} canManageRules />)
    expect(screen.getByRole("heading", { name: "Aún no hay anomalías de combustible" })).toBeInTheDocument()
    expect(screen.getByText(/rompe una regla de control/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Ver reglas" })).toHaveAttribute("href", "/combustibles/anomalias/reglas")
  })

  it("sin permiso para administrar reglas no manda a una pantalla que lo rechazaría: lleva a las cargas", () => {
    render(<AnomalyEmptyState filtered={false} canManageRules={false} />)
    expect(screen.queryByRole("link", { name: "Ver reglas" })).toBeNull()
    expect(screen.getByRole("link", { name: "Ver cargas" })).toHaveAttribute("href", "/combustibles/bitacora")
  })

  it("nunca deja el vacío sin una acción real (A4)", () => {
    for (const props of [{ filtered: true, canManageRules: false }, { filtered: false, canManageRules: false }, { filtered: false, canManageRules: true }]) {
      const { unmount } = render(<AnomalyEmptyState {...props} />)
      expect(screen.getAllByRole("link")).toHaveLength(1)
      unmount()
    }
  })
})
