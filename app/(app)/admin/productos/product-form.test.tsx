// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ProductForm } from "./product-form"
import { createProductVariantBatch, prepareAddVariantForProduct, updateProduct } from "./actions"
import { productVariantBatchSchema } from "./actions/product-variant-batch.schema"
import type { ProductFamilyForAddVariant, ProductFormProps } from "./product-form.types"

vi.mock("./actions", () => ({ createProduct: vi.fn(), updateProduct: vi.fn(), createProductVariantBatch: vi.fn(), prepareAddVariantForProduct: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const props: ProductFormProps = {
  open: true, onClose: vi.fn(), variant: "embedded",
  categories: [{ id: "cat", name: "EPP", slug: "epp" }],
  allSuppliers: [],
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
    expect(screen.getByRole("button", { name: /Con logo/ })).toHaveAttribute("aria-disabled", "true")
    fireEvent.click(screen.getByRole("button", { name: "Proveedor" }))
    expect(screen.getByText(/Asocia un proveedor preferido/)).toBeVisible()
    const payload = container.querySelector<HTMLInputElement>('input[name="attributesJson"]')
    expect(JSON.parse(payload!.value)).toEqual([
      expect.objectContaining({ id: "t", options: '["4XL"]', sizeFamily: "ropa" }),
      // Una chaqueta EPP lleva logo siempre: el asistente lo suma y lo bloquea.
      expect.objectContaining({ name: "Logo", options: '["Con logo"]' }),
    ])
  })
})

describe("colores extra al editar", () => {
  const polera = {
    id: "p", sku: "EPP-1", name: "Polera Dryfresh L Azul", categoryId: "cat", description: null,
    unitOfMeasure: "unidad", isEpp: true, isService: false, requiresPrevencion: false,
    requiresWorker: false, equipmentKind: null, referencePrice: null, notes: null, isActive: true,
    attributes: [
      { id: "t", name: "Talla", type: "select" as const, options: '["L"]', sizeFamily: "ropa", isRequired: true, sortOrder: 0 },
      { id: "c", name: "Color", type: "select" as const, options: '["Azul"]', isRequired: true, sortOrder: 1 },
    ],
    suppliers: [],
  }
  const family = {
    id: "fam", canonicalName: "Polera Dryfresh",
    existingVariantKeys: [
      JSON.stringify([["color", "Azul"], ["talla", "L"]]),
      JSON.stringify([["color", "Rojo"], ["talla", "L"]]),
    ],
  } as unknown as ProductFamilyForAddVariant

  it("guarda el producto con su color y crea en la familia una variante por cada color nuevo", async () => {
    vi.mocked(updateProduct).mockResolvedValue({ ok: true, message: "Producto EPP-1 actualizado" })
    vi.mocked(prepareAddVariantForProduct).mockResolvedValue(family as never)
    vi.mocked(createProductVariantBatch).mockResolvedValue({ ok: true, message: "1 variante creada en la familia" })
    const onClose = vi.fn()
    const { container } = render(<ProductForm {...props} onClose={onClose} editProduct={polera} />)

    fireEvent.click(screen.getByRole("button", { name: "Talla y otros atributos" }))
    fireEvent.click(screen.getByRole("button", { name: "Negro" }))
    fireEvent.click(screen.getByRole("button", { name: "Rojo" }))

    const payload = JSON.parse(container.querySelector<HTMLInputElement>('input[name="attributesJson"]')!.value)
    expect(payload).toContainEqual(expect.objectContaining({ id: "c", options: '["Azul"]' }))

    fireEvent.click(screen.getByRole("button", { name: "Guardar y crear 2 colores" }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(prepareAddVariantForProduct).toHaveBeenCalledWith("p")
    // Rojo L ya existe en la familia: sólo se crea Negro.
    expect(createProductVariantBatch).toHaveBeenCalledWith(expect.objectContaining({
      familyId: "fam",
      familyName: "Polera Dryfresh",
      variants: [{ name: "Polera Dryfresh L Negro", attributes: expect.arrayContaining([{ name: "Talla", value: "L" }, { name: "Color", value: "Negro" }]) }],
    }))
    // La entrada tiene que pasar el esquema real del servidor: declarar el eje
    // Color sólo con el color del producto hacía que el lote la rechazara.
    const input = vi.mocked(createProductVariantBatch).mock.calls[0]![0]
    expect(productVariantBatchSchema.safeParse(input).success).toBe(true)
  })
})
