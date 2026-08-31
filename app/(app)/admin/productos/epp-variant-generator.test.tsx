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
import type { AttributeMultiValues } from "./product-form.types"

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
}))

function renderGenerator(wizAttrs: AttributeMultiValues[], overrides: Partial<Parameters<typeof VariantGenerator>[0]> = {}) {
  const props = {
    wizAttrs,
    isEpp: true,
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
