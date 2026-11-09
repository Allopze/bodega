// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

Element.prototype.scrollIntoView = function scrollIntoView() {}

const createSparePartAction = vi.fn()
const updateSparePartAction = vi.fn()

vi.mock("@/app/(app)/mantencion/repuestos/actions", () => ({
  createSparePartAction: (...args: unknown[]) => createSparePartAction(...args),
  updateSparePartAction: (...args: unknown[]) => updateSparePartAction(...args),
}))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const { SparePartFormSheet, defaultUnitCode } = await import("./spare-part-form-sheet")

const UNITS = [
  { code: "kg", label: "Kilogramo" },
  { code: "unidad", label: "Unidad" },
]

const PART = {
  id: "rep-1",
  sku: "RPT-001",
  name: "Filtro de aceite",
  partNumber: "1R-0750",
  partBrand: "Caterpillar",
  unitOfMeasure: "unidad",
  referencePrice: 18990,
  notes: "Sirve para la serie C13",
}

async function sheetFor(props: Partial<React.ComponentProps<typeof SparePartFormSheet>> = {}) {
  render(<SparePartFormSheet open onClose={vi.fn()} units={UNITS} {...props} />)
  return within(await screen.findByRole("dialog"))
}

describe("SparePartFormSheet", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it("alta: parte vacío, con «Unidad» como unidad y un botón «Crear repuesto»", async () => {
    const sheet = await sheetFor()
    expect(sheet.getByText("Nuevo repuesto")).toBeTruthy()
    expect((sheet.getByRole("textbox", { name: /Nombre del repuesto/ }) as HTMLInputElement).value).toBe("")
    expect(sheet.getByRole("combobox", { name: /Unidad de medida/ }).textContent).toContain("Unidad")
    expect(sheet.getByRole("button", { name: "Crear repuesto" })).toBeTruthy()
  })

  it("edición: trae los datos del repuesto y envía su id en un campo oculto", async () => {
    updateSparePartAction.mockResolvedValue({ ok: true, message: "Repuesto RPT-001 actualizado" })
    const sheet = await sheetFor({ part: PART })
    expect(sheet.getByText("Editar repuesto")).toBeTruthy()
    expect(sheet.getByText(/RPT-001\./)).toBeTruthy()
    expect((sheet.getByRole("textbox", { name: /N° de parte/ }) as HTMLInputElement).value).toBe("1R-0750")
    expect((sheet.getByRole("textbox", { name: /Marca del repuesto/ }) as HTMLInputElement).value).toBe("Caterpillar")
    expect((sheet.getByRole("spinbutton", { name: /Precio de referencia/ }) as HTMLInputElement).value).toBe("18990")

    fireEvent.click(sheet.getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() => expect(updateSparePartAction).toHaveBeenCalled())
    expect(createSparePartAction).not.toHaveBeenCalled()
    const formData = updateSparePartAction.mock.calls[0]![1] as FormData
    expect(formData.get("id")).toBe("rep-1")
    expect(formData.get("name")).toBe("Filtro de aceite")
    expect(formData.get("unitOfMeasure")).toBe("unidad")
    expect(formData.get("referencePrice")).toBe("18990")
  })

  it("muestra cada error de validación bajo su campo, como alerta, y conserva lo escrito", async () => {
    createSparePartAction.mockResolvedValue({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: {
        name: ["Escribe el nombre del repuesto"],
        unitOfMeasure: ["Elige la unidad de medida"],
        referencePrice: ["El precio de referencia debe ser un número, 0 o más"],
      },
    })
    const sheet = await sheetFor()
    fireEvent.change(sheet.getByRole("textbox", { name: /N° de parte/ }), { target: { value: "1R-0750" } })
    fireEvent.click(sheet.getByRole("button", { name: "Crear repuesto" }))

    for (const message of ["Escribe el nombre del repuesto", "Elige la unidad de medida", "El precio de referencia debe ser un número, 0 o más"]) {
      expect((await sheet.findByText(message)).getAttribute("role")).toBe("alert")
    }
    // React 19 vacía los campos no controlados tras la acción: éste es controlado, así que no pierde lo escrito.
    expect((sheet.getByRole("textbox", { name: /N° de parte/ }) as HTMLInputElement).value).toBe("1R-0750")
    expect(sheet.getByRole("textbox", { name: /Nombre del repuesto/ }).getAttribute("aria-invalid")).toBe("true")
  })

  it("un N° de parte repetido (error del servicio) queda bajo «N° de parte»", async () => {
    createSparePartAction.mockResolvedValue({
      ok: false,
      message: "Ya existe el repuesto RPT-012 con ese N° de parte",
      fieldErrors: { partNumber: ["Ya existe el repuesto RPT-012 con ese N° de parte"] },
    })
    const sheet = await sheetFor()
    fireEvent.change(sheet.getByRole("textbox", { name: /Nombre del repuesto/ }), { target: { value: "QA_Filtro de aceite" } })
    fireEvent.change(sheet.getByRole("textbox", { name: /N° de parte/ }), { target: { value: "QA-123" } })
    fireEvent.click(sheet.getByRole("button", { name: "Crear repuesto" }))
    expect((await sheet.findByText("Ya existe el repuesto RPT-012 con ese N° de parte")).getAttribute("role")).toBe("alert")
    expect(sheet.getByRole("textbox", { name: /N° de parte/ }).getAttribute("aria-invalid")).toBe("true")
  })
})

describe("defaultUnitCode", () => {
  it("prefiere «unidad»; si el catálogo no la tiene, la primera; sin unidades, vacío", () => {
    expect(defaultUnitCode(UNITS)).toBe("unidad")
    expect(defaultUnitCode([{ code: "kg", label: "Kilogramo" }])).toBe("kg")
    expect(defaultUnitCode([])).toBe("")
  })
})
