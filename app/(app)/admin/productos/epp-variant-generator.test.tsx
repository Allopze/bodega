// @vitest-environment jsdom
/**
 * Regresión del soft-lock del paso 2: un atributo venido de una plantilla de
 * categoría (no de los 4 presets) se dibujaba con cero chips porque las
 * opciones salían del preset y no del atributo. Sus `values` quedaban vacíos,
 * «Generar variantes» no se habilitaba nunca, y como el toggle de arriba sólo
 * enumera presets tampoco había forma de quitarlo: el asistente quedaba muerto.
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
  { family: "ropa",    attributeName: "Talla",         codes: ["XS", "S", "M", "L", "XL"] },
  { family: "calzado", attributeName: "Talla calzado", codes: ["40", "41", "42"] },
  { family: "casco",   attributeName: "Talla casco",   codes: ["S", "M", "L"] },
]

function renderGenerator(wizAttrs: AttributeMultiValues[], overrides: Partial<Parameters<typeof VariantGenerator>[0]> = {}) {
  const props = {
    wizAttrs,
    isEpp: true,
    sizeFamilies: SIZE_FAMILIES,
    onToggleAttr: vi.fn(),
    onUpdateAttrValues: vi.fn(),
    onRemoveAttr: vi.fn(),
    onGenerate: vi.fn(),
    generating: false,
    variantLimit: 500,
    variantWarnAt: 400,
    onMarkDirty: vi.fn(),
    ...overrides,
  }
  render(<VariantGenerator {...props} />)
  return props
}

const templateAttr: AttributeMultiValues = { name: "Marca", type: "select", values: ["Ansell", "Activex"] }

describe("VariantGenerator con atributos que no son preset", () => {
  it("renderiza los valores del propio atributo cuando no hay preset que los provea", () => {
    renderGenerator([templateAttr])

    expect(screen.getByRole("button", { name: /Ansell/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Activex/ })).toBeInTheDocument()
  })

  it("habilita «Generar variantes» con un atributo de plantilla ya seleccionado", () => {
    renderGenerator([{ ...templateAttr, values: ["Ansell"] }])

    expect(screen.getByRole("button", { name: /Generar variantes/ })).toBeEnabled()
  })

  it("mantiene deshabilitado el generador mientras un atributo no tenga valores", () => {
    renderGenerator([{ ...templateAttr, values: [] }])

    expect(screen.getByRole("button", { name: /selecciona valores/i })).toBeDisabled()
  })

  it("permite agregar un valor que ningún preset ofrece", () => {
    const props = renderGenerator([{ name: "Talla", type: "select", values: ["M"], sizeFamily: "ropa" }])

    fireEvent.change(screen.getByLabelText("Agregar un valor a Talla"), { target: { value: "  47  " } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))

    expect(props.onUpdateAttrValues).toHaveBeenCalledWith("Talla", ["M", "47"])
    expect(props.onMarkDirty).toHaveBeenCalled()
  })

  it("no duplica un valor que ya está seleccionado", () => {
    const props = renderGenerator([{ ...templateAttr, values: ["Ansell"] }])

    fireEvent.change(screen.getByLabelText("Agregar un valor a Marca"), { target: { value: "Ansell" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))

    expect(props.onUpdateAttrValues).not.toHaveBeenCalled()
  })

  it("deja quitar un atributo de plantilla sin pasar por el toggle de presets", () => {
    const props = renderGenerator([templateAttr])

    fireEvent.click(screen.getByRole("button", { name: "Quitar atributo Marca" }))

    expect(props.onRemoveAttr).toHaveBeenCalledWith("Marca")
    // `onToggleAttr` fuerza isEpp = true: quitar una fila no debe hacer eso.
    expect(props.onToggleAttr).not.toHaveBeenCalled()
  })
})

describe("VariantGenerator con las familias del catálogo", () => {
  it("ofrece un preset por familia activa, más el color", () => {
    renderGenerator([])

    for (const name of ["Talla", "Talla calzado", "Talla casco", "Color"]) {
      expect(screen.getByRole("button", { name: `+ ${name}` })).toBeInTheDocument()
    }
  })

  it("ofrece la talla de casco, que antes no tenía preset pese a existir en el padrón", () => {
    // `workers.size_helmet` existía y se mapeaba, pero ninguna variante podía
    // llevar el atributo: la sugerencia nunca llegaba a activarse.
    renderGenerator([])
    expect(screen.getByRole("button", { name: "+ Talla casco" })).toBeInTheDocument()
  })

  it("una familia que la base no trae no aparece como preset", () => {
    // Dar de baja una talla o una familia es `is_active = false` en la tabla; el
    // asistente deja de ofrecerla sin tocar código.
    renderGenerator([], { sizeFamilies: [SIZE_FAMILIES[0]!] })
    expect(screen.queryByRole("button", { name: "+ Talla calzado" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "+ Talla" })).toBeInTheDocument()
  })

  it("usa los códigos de la base y no una lista del bundle", () => {
    renderGenerator([{ name: "Talla calzado", type: "select", values: [] }])
    for (const code of ["40", "41", "42"]) {
      expect(screen.getByRole("button", { name: code })).toBeInTheDocument()
    }
    expect(screen.queryByRole("button", { name: "46" })).not.toBeInTheDocument()
  })
})


it("muestra una talla personalizada junto al catálogo de atajos", () => {
  renderGenerator([{ name: "Talla calzado", type: "select", values: ["47"], sizeFamily: "calzado" }])
  expect(screen.getByRole("button", { name: /47/, pressed: true })).toBeVisible()
})
it("al editar una variante, elegir otro color reemplaza el anterior", () => {
  const props = renderGenerator([{ name: "Color", type: "select", values: ["Azul"] }], { singleVariant: true })
  fireEvent.click(screen.getByRole("button", { name: "Negro" }))
  expect(props.onUpdateAttrValues).toHaveBeenCalledWith("Color", ["Negro"])
  expect(screen.queryByRole("button", { name: /Generar variantes/ })).not.toBeInTheDocument()
})
