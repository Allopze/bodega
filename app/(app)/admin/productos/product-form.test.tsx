// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ProductForm } from "./product-form"
import type { ProductFormProps } from "./product-form.types"

vi.mock("./actions", () => ({ createProduct: vi.fn(), updateProduct: vi.fn(), createProductVariantBatch: vi.fn() }))

const props: ProductFormProps = {
  open: true, onClose: vi.fn(), variant: "embedded",
  categories: [{ id: "cat", name: "EPP", slug: "epp" }],
  allSuppliers: [], units: [{ code: "unidad", label: "Unidad" }], templates: [],
  sizeFamilies: [{ family: "ropa", attributeName: "Talla", codes: ["M", "L"] }],
}

describe("editor del producto", () => {
  it("permite acceder a atributos y proveedor al editar y conserva la talla personalizada", () => {
    const { container } = render(<ProductForm {...props} editProduct={{
      id: "p", sku: "SKU", name: "Chaqueta", categoryId: "cat", description: null,
      unitOfMeasure: "unidad", isEpp: true, isService: false, requiresPrevencion: false,
      requiresWorker: false, equipmentKind: null, referencePrice: null, notes: null, isActive: true,
      attributes: [{ id: "t", name: "Talla", type: "select", options: '["4XL"]', sizeFamily: "ropa", isRequired: true, sortOrder: 0 }],
      suppliers: [],
    }} />)
    fireEvent.click(screen.getByRole("button", { name: "Talla y otros atributos" }))
    expect(screen.getByRole("button", { name: /4XL/, pressed: true })).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Proveedor" }))
    expect(screen.getByText(/Asocia un proveedor preferido/)).toBeVisible()
    const payload = container.querySelector<HTMLInputElement>('input[name="attributesJson"]')
    expect(JSON.parse(payload!.value)).toEqual([expect.objectContaining({ id: "t", options: '["4XL"]', sizeFamily: "ropa" })])
  })
})
