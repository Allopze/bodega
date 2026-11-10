// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("./actions", () => ({ createCategory: vi.fn(), updateCategory: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { CategoryPanel } = await import("./category-panel")

const base = { id: "cat-1", name: "General", slug: "general", isEpp: false, requiresPrevencion: false, sortOrder: 1 }

afterEach(cleanup)

describe("CategoryPanel", () => {
  it("en «Repuestos», el slug y las marcas EPP/Prevención son de solo lectura", () => {
    render(<CategoryPanel open onClose={() => {}} editCategory={{ ...base, id: "cat-repuestos", name: "Repuestos", slug: "repuestos" }} />)
    expect((screen.getByLabelText(/^Slug/) as HTMLInputElement).readOnly).toBe(true)
    expect((screen.getByLabelText(/Es EPP/) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText("Requiere aprobación de Prevención") as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/un repuesto no es EPP ni pasa por Prevención/)).toBeTruthy()
  })

  it("en otra categoría siguen editables", () => {
    render(<CategoryPanel open onClose={() => {}} editCategory={base} />)
    expect((screen.getByLabelText(/Es EPP/) as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByLabelText("Requiere aprobación de Prevención") as HTMLInputElement).disabled).toBe(false)
  })
})
