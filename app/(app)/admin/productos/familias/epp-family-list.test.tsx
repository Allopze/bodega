// @vitest-environment jsdom
/**
 * La fila de escritorio comunicaba MENOS que la tarjeta móvil justo del dato
 * más importante (familia sin clasificar), los SKU se veían truncados y sin
 * salida, y "No vence" afirmaba una decisión que nadie había tomado.
 */
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

// La DataTable se conecta al buscador del TopBar vía router (regla de búsqueda
// del repo), así que necesita el router montado. Mismo patrón que
// `deliveries-table.test.tsx`.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}))

const actionMocks = vi.hoisted(() => ({ setEppFamilyTypeAction: vi.fn() }))

vi.mock("./actions", () => ({
  setEppFamilyTypeAction: actionMocks.setEppFamilyTypeAction,
  updateEppFamilyAction: vi.fn(),
  mergeEppFamiliesAction: vi.fn(),
  applyEppTypeSuggestionsAction: vi.fn(),
}))

import { EppFamilyList, type EppFamilyRow } from "./epp-family-list"

const family = (overrides: Partial<EppFamilyRow> = {}): EppFamilyRow => ({
  id: "fam-1",
  canonicalName: "Casco Activex I",
  brand: null,
  model: null,
  certification: null,
  lifespanMonths: null,
  lifespanNotApplicable: false,
  pictogramUrl: null,
  eppTypeId: null,
  eppTypeLabel: null,
  categoryName: "EPP",
  categoryId: "cat-epp",
  totalVariants: 2,
  activeVariants: 2,
  variants: [
    { id: "p-1", sku: "EPP-036", name: "Casco Activex I talla M" },
    { id: "p-2", sku: "EPP-037", name: "Casco Activex I talla L" },
  ],
  ...overrides,
})

const props = {
  eppTypes: [{ id: "t-cabeza", code: "cabeza", label: "Cabeza" }],
  categories: [{ id: "cat-epp", name: "EPP" }],
}

describe("catálogo de familias EPP", () => {
  it("flags an unclassified family on the desktop row, not only on the mobile card", () => {
    render(<EppFamilyList families={[family()]} {...props} />)
    const warning = screen.getAllByLabelText(/advertencia/i)[0]!
    expect(warning).toBeVisible()
    expect(warning.getAttribute("aria-label")).toContain("Sin tipo de EPP")
  })

  it("does not warn about a fully configured family", () => {
    render(<EppFamilyList families={[family({
      eppTypeId: "t-cabeza", eppTypeLabel: "Cabeza", certification: "NCh 461",
      brand: "3M", model: "H-700", lifespanMonths: 24,
    })]} {...props} />)
    expect(screen.queryByLabelText(/advertencia/i)).toBeNull()
  })

  it("says «Sin definir» for an unset lifespan and «No vence» only when it was decided", () => {
    const { unmount } = render(<EppFamilyList families={[family()]} {...props} />)
    expect(screen.getAllByText("Sin definir").length).toBeGreaterThan(0)
    expect(screen.queryByText("No vence")).toBeNull()
    unmount()

    render(<EppFamilyList families={[family({ lifespanNotApplicable: true })]} {...props} />)
    expect(screen.getAllByText("No vence").length).toBeGreaterThan(0)
  })

  it("links every SKU to its own variant instead of truncating at four", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `p-${i}`, sku: `EPP-10${i}`, name: `Traje PU variante ${i}`,
    }))
    render(<EppFamilyList families={[family({ variants: many, totalVariants: 8 })]} {...props} />)

    for (const variant of many) {
      const link = screen.getByRole("link", { name: variant.sku })
      expect(link).toHaveAttribute("href", `/admin/productos/${variant.id}`)
    }
    // El "+N" que no llevaba a ninguna parte ya no existe.
    expect(screen.queryByText("+4")).toBeNull()
  })

  it("offers merging, which the identity-collision error already instructed", () => {
    render(<EppFamilyList families={[family()]} {...props} />)
    expect(screen.getByLabelText("Fusionar familia Casco Activex I")).toBeVisible()
  })

  it("keeps the family searchable by the SKU the row displays", () => {
    render(<EppFamilyList families={[family()]} {...props} />)
    const row = screen.getByRole("link", { name: "EPP-036" }).closest("tr")!
    expect(within(row).getByText("Casco Activex I")).toBeVisible()
  })
})

describe("sugerencias de tipo", () => {
  it("offers the type deduced from the name without pre-selecting the dropdown", () => {
    render(<EppFamilyList families={[family()]} {...props} />)

    // El desplegable sigue diciendo "sin clasificar": la sugerencia no se
    // disfraza de valor guardado.
    expect(screen.getAllByRole("combobox", { name: /Tipo de EPP para Casco Activex I/ })[0])
      .toHaveTextContent(/sin clasificar/i)
    expect(screen.getAllByLabelText(/Aplicar tipo sugerido Cabeza a Casco Activex I/)[0]).toBeVisible()
  })

  it("applies the suggestion with one click", () => {
    actionMocks.setEppFamilyTypeAction.mockResolvedValue({ ok: true })
    render(<EppFamilyList families={[family()]} {...props} />)

    fireEvent.click(screen.getAllByLabelText(/Aplicar tipo sugerido Cabeza/)[0]!)
    expect(actionMocks.setEppFamilyTypeAction).toHaveBeenCalledWith("fam-1", "t-cabeza")
  })

  it("never suggests over a family somebody already classified", () => {
    render(<EppFamilyList families={[family({ eppTypeId: "t-cabeza", eppTypeLabel: "Cabeza" })]} {...props} />)
    expect(screen.queryByLabelText(/Aplicar tipo sugerido/)).toBeNull()
    expect(screen.queryByRole("button", { name: /Revisar sugerencias/ })).toBeNull()
  })

  it("does not offer a bulk review when no name is deducible", () => {
    render(<EppFamilyList families={[family({ canonicalName: "BORDADO ESPALDA" })]} {...props} />)
    expect(screen.queryByRole("button", { name: /Revisar sugerencias/ })).toBeNull()
  })

  it("opens the review dialog listing each family with its suggested type", () => {
    render(<EppFamilyList families={[family()]} {...props} />)
    fireEvent.click(screen.getByRole("button", { name: /Revisar sugerencias/ }))

    expect(screen.getByRole("dialog")).toHaveTextContent(/Revisar sugerencias de tipo/)
    expect(screen.getByRole("button", { name: /Clasificar 1/ })).toBeEnabled()
  })
})
