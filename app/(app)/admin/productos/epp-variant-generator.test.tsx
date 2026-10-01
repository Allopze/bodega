// @vitest-environment jsdom
/**
 * El asistente de tallas: una sola decisión de escala (sugerida por el nombre
 * del producto) en vez de cinco botones «+ Talla …» indistinguibles, con las
 * tallas típicas ya marcadas y la vista previa armada sola.
 *
 * Conserva la regresión del soft-lock del paso 2: un atributo venido de una
 * plantilla de categoría (no de un preset) se dibujaba sin chips y no había
 * forma de completarlo ni de quitarlo.
 */
import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { VariantGenerator } from "./epp-variant-generator"
import type { AttributeMultiValues, SizeFamilyOption } from "./product-form.types"

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
}))

/** Las familias llegan de `size_catalog`, igual que en la página real. */
const SIZE_FAMILIES: SizeFamilyOption[] = [
  { family: "ropa",    attributeName: "Talla",         label: "Ropa",    codes: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"], defaultCodes: ["S", "M", "L", "XL", "2XL", "3XL"] },
  { family: "calzado", attributeName: "Talla calzado", label: "Calzado", codes: ["36", "37", "38", "39", "40", "41", "42"], defaultCodes: ["38", "39", "40", "41", "42"] },
  { family: "casco",   attributeName: "Talla casco",   label: "Casco",   codes: ["Única"] },
]

function renderGenerator(wizAttrs: AttributeMultiValues[], overrides: Partial<Parameters<typeof VariantGenerator>[0]> = {}) {
  const props = {
    wizAttrs,
    productName: "Producto de prueba",
    sizeFamilies: SIZE_FAMILIES,
    onSetSizeScale: vi.fn(),
    onToggleAttr: vi.fn(),
    onUpdateAttrValues: vi.fn(),
    onRemoveAttr: vi.fn(),
    variantCount: 0,
    variantLimit: 500,
    variantWarnAt: 400,
    onMarkDirty: vi.fn(),
    ...overrides,
  }
  render(<VariantGenerator {...props} />)
  return props
}

const templateAttr: AttributeMultiValues = { name: "Marca", type: "select", values: ["Ansell", "Activex"] }

describe("escala de tallas", () => {
  it("ofrece una opción por escala del catálogo, con su rango, más «Sin tallas»", () => {
    renderGenerator([])
    for (const name of [/Ropa \(XS–4XL\)/, /Calzado \(36–42\)/, /Casco \(Única\)/, /Sin tallas/]) {
      expect(screen.getByRole("radio", { name })).toBeInTheDocument()
    }
    expect(screen.getByRole("radio", { name: /Sin tallas/ })).toHaveAttribute("aria-checked", "true")
  })

  it("sugiere la escala por el nombre del producto y la aplica con un clic", () => {
    const props = renderGenerator([], { productName: "Chaleco geólogo bicolor" })
    expect(screen.getByRole("radio", { name: /Ropa.*sugerida/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Usar Ropa \(XS–4XL\), sugerida para «Chaleco geólogo bicolor»/ }))
    expect(props.onSetSizeScale).toHaveBeenCalledWith(SIZE_FAMILIES[0])
  })

  it("lee como calzado un botín histórico cuyo atributo se llama sólo «Talla»", () => {
    renderGenerator([{ name: "Talla", type: "select", values: ["N41"] }], { productName: "Botín V-Flex V73" })
    expect(screen.getByRole("radio", { name: /Calzado/ })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("button", { name: "38" })).toBeInTheDocument()
  })

  it("«Sin tallas» quita el eje de talla", () => {
    const props = renderGenerator([{ name: "Talla", type: "select", values: ["M"], sizeFamily: "ropa" }])
    fireEvent.click(screen.getByRole("radio", { name: /Sin tallas/ }))
    expect(props.onSetSizeScale).toHaveBeenCalledWith(null)
  })

  it("marca las típicas, todas o ninguna", () => {
    const props = renderGenerator([{ name: "Talla", type: "select", values: ["M"], sizeFamily: "ropa" }])
    fireEvent.click(screen.getByRole("button", { name: /Típicas \(S–3XL\)/ }))
    expect(props.onUpdateAttrValues).toHaveBeenLastCalledWith("Talla", ["S", "M", "L", "XL", "2XL", "3XL"])
    fireEvent.click(screen.getByRole("button", { name: "Todas" }))
    expect(props.onUpdateAttrValues).toHaveBeenLastCalledWith("Talla", ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"])
    fireEvent.click(screen.getByRole("button", { name: "Ninguna" }))
    expect(props.onUpdateAttrValues).toHaveBeenLastCalledWith("Talla", [])
  })

  it("usa los códigos de la base y no una lista del bundle", () => {
    renderGenerator([{ name: "Talla calzado", type: "select", values: [], sizeFamily: "calzado" }])
    for (const code of ["40", "41", "42"]) {
      expect(screen.getByRole("button", { name: code })).toBeInTheDocument()
    }
    expect(screen.queryByRole("button", { name: "46" })).not.toBeInTheDocument()
  })

  it("una escala que la base no trae no se ofrece", () => {
    renderGenerator([], { sizeFamilies: [SIZE_FAMILIES[0]!] })
    expect(screen.queryByRole("radio", { name: /Calzado/ })).not.toBeInTheDocument()
  })

  it("permite agregar una talla que la escala no trae", () => {
    const props = renderGenerator([{ name: "Talla calzado", type: "select", values: ["40"], sizeFamily: "calzado" }])
    fireEvent.change(screen.getByLabelText("Agregar otra talla a Talla calzado"), { target: { value: "  47  " } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))
    expect(props.onUpdateAttrValues).toHaveBeenCalledWith("Talla calzado", ["40", "47"])
    expect(props.onMarkDirty).toHaveBeenCalled()
  })

  it("muestra una talla personalizada junto a las de la escala", () => {
    renderGenerator([{ name: "Talla calzado", type: "select", values: ["47"], sizeFamily: "calzado" }])
    expect(screen.getByRole("button", { name: /47/, pressed: true })).toBeVisible()
  })
})

describe("agregar tallas a una familia existente", () => {
  it("deshabilita las tallas que ya existen aunque estén escritas distinto (T/L = L)", () => {
    const props = renderGenerator(
      [{ name: "Talla", type: "select", values: [], sizeFamily: "ropa" }],
      { lockedAxes: true, existingValuesByAttr: { talla: ["T/L", "T/S"] }, blockedValuesByAttr: { talla: ["T/L", "T/S"] } },
    )
    expect(screen.getByRole("button", { name: /^L · existe/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /^S · existe/ })).toBeDisabled()
    // Sin cambio de escala: los ejes son los de la familia.
    expect(screen.queryByRole("radio", { name: /Sin tallas/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Todas" }))
    expect(props.onUpdateAttrValues).toHaveBeenLastCalledWith("Talla", ["XS", "M", "XL", "2XL", "3XL", "4XL"])
  })
})

describe("atributos que no son talla", () => {
  it("renderiza los valores del propio atributo cuando no hay preset que los provea", () => {
    renderGenerator([templateAttr])
    expect(screen.getByRole("button", { name: /Ansell/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Activex/ })).toBeInTheDocument()
  })

  it("dice qué atributo falta completar, en vez de un botón gris", () => {
    renderGenerator([{ ...templateAttr, values: [] }])
    expect(screen.getByRole("status")).toHaveTextContent("Marca al menos un valor en «Marca», o quítalo.")
    expect(screen.queryByRole("button", { name: /Generar variantes/ })).not.toBeInTheDocument()
  })

  it("resume cuántos productos se crearán", () => {
    renderGenerator([{ ...templateAttr, values: ["Ansell"] }], { variantCount: 6 })
    expect(screen.getByRole("status")).toHaveTextContent("Se crearán 6 productos, uno por combinación.")
  })

  it("no duplica un valor que ya está seleccionado", () => {
    const props = renderGenerator([{ ...templateAttr, values: ["Ansell"] }])
    fireEvent.change(screen.getByLabelText("Agregar un valor a Marca"), { target: { value: "Ansell" } })
    fireEvent.click(screen.getAllByRole("button", { name: "Agregar" })[0]!)
    expect(props.onUpdateAttrValues).not.toHaveBeenCalled()
  })

  it("deja quitar un atributo de plantilla", () => {
    const props = renderGenerator([templateAttr])
    fireEvent.click(screen.getByRole("button", { name: "Quitar atributo Marca" }))
    expect(props.onRemoveAttr).toHaveBeenCalledWith("Marca")
  })

  it("agrega el color con un botón propio", () => {
    const props = renderGenerator([])
    fireEvent.click(screen.getByRole("button", { name: "+ Color" }))
    expect(props.onToggleAttr).toHaveBeenCalledWith(expect.objectContaining({ name: "Color" }))
  })

  it("al editar una variante, elegir otro color reemplaza el anterior", () => {
    const props = renderGenerator([{ name: "Color", type: "select", values: ["Azul"] }], { singleVariant: true })
    fireEvent.click(screen.getByRole("button", { name: "Negro" }))
    expect(props.onUpdateAttrValues).toHaveBeenCalledWith("Color", ["Negro"])
  })
})

describe("agregar tallas a una familia con varios ejes", () => {
  it("no bloquea un color existente: una talla nueva en ese color es válida", () => {
    const props = renderGenerator(
      [
        { name: "Talla", type: "select", values: [], sizeFamily: "ropa" },
        { name: "Color", type: "select", values: ["Amarillo"] },
      ],
      { lockedAxes: true, existingValuesByAttr: { talla: ["L"], color: ["Amarillo"] }, blockedValuesByAttr: { talla: ["L"] } },
    )
    expect(screen.getByRole("button", { name: /Amarillo/ })).toBeEnabled()
    expect(screen.getByRole("button", { name: /Amarillo/ })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: /^L · existe/ })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "XS" }))
    expect(props.onUpdateAttrValues).toHaveBeenCalledWith("Talla", ["XS"])
  })
})
