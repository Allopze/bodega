// @vitest-environment jsdom
/**
 * Campos condicionales del ítem: el colaborador y el número de dosis aparecen
 * sólo cuando el concepto elegido los pide, sin recargar la página, y el
 * distintivo de "Costo pendiente" distingue un servicio sin precio de un
 * producto normal.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { ItemEditor } from "./item-editor"
import { blankItem } from "./request-form.helpers"
import type { ItemRow, ProductOption, WorkerOption } from "./request-form.types"

vi.mock("./actions", () => ({
  getWorkerEppStatusAction: vi.fn(async () => ({ activeRequest: null, lastDelivery: null })),
}))

afterEach(() => cleanup())

const WORKERS: WorkerOption[] = [
  { id: "w-1", firstName: "Ana", lastName: "Colaboradora", rut: "11.111.111-1", sizeTop: null, sizeBottom: null, sizeShoe: null, sizeGloves: null, sizeHelmet: null },
  { id: "w-2", firstName: "Beto", lastName: "Operario", rut: "22.222.222-2", sizeTop: null, sizeBottom: null, sizeShoe: null, sizeGloves: null, sizeHelmet: null },
]

function product(overrides: Partial<ProductOption>): ProductOption {
  return {
    id: "prod-x", sku: "SKU-X", name: "Producto", isEpp: false, isService: false, requiresWorker: false,
    equipmentKind: null,
    unitOfMeasure: "unidad", categoryName: "cat", referencePrice: null, familyId: null,
    preferredSupplierId: null, attributes: [],
    ...overrides,
  }
}

const VACUNA = product({
  id: "prod-srv-vacuna", sku: "SRV-VACUNA", name: "Vacuna",
  isService: true, requiresWorker: true, unitOfMeasure: "dosis",
  // El nº de dosis gobierna la cantidad del ítem: son el mismo número.
  attributes: [{ id: "pa-dosis", name: "Número de dosis", type: "integer", isRequired: true, drivesQuantity: true, options: null }],
})

const MONOGAS = product({
  id: "prod-srv-monogas", sku: "SRV-MONOGAS", name: "Mantención de monogás",
  isService: true, unitOfMeasure: "servicio",
  attributes: [{ id: "pa-serie", name: "Código interno / N° de serie", type: "text", isRequired: true, drivesQuantity: false, options: null }],
})

const CASCO = product({ id: "prod-casco", sku: "EPP-1", name: "Casco", isEpp: true })

function itemFor(prod: ProductOption, overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    ...blankItem("k-1"),
    productId: prod.id,
    productName: prod.name,
    isEpp: prod.isEpp,
    unitOfMeasure: prod.unitOfMeasure,
    attributes: prod.attributes.map((attribute) => ({
      attributeId: attribute.id, attributeName: attribute.name, value: "",
      isRequired: attribute.isRequired, type: attribute.type, options: [],
      drivesQuantity: attribute.drivesQuantity,
    })),
    ...overrides,
  }
}

function renderItem(prod: ProductOption, overrides: Partial<ItemRow> = {}, props: { readOnly?: boolean } = {}) {
  return render(
    <ItemEditor
      item={itemFor(prod, overrides)}
      idx={0}
      products={[CASCO, MONOGAS, VACUNA]}
      suppliers={[]}
      workers={WORKERS}
      readOnly={props.readOnly ?? false}
      requestType="otro"
      maxFileSizeMb={10}
      onUpdate={vi.fn()}
      onSelectProduct={vi.fn()}
      onSelectFreeProduct={vi.fn()}
      onClearProduct={vi.fn()}
      onUpdateAttr={vi.fn()}
      onUpdateWorker={vi.fn()}
      onUpdateEquipment={vi.fn()}
      onRemove={vi.fn()}
      canRemove={false}
    />,
  )
}

describe("ItemEditor — campos condicionales de servicio", () => {
  it("una vacuna muestra Colaborador y Número de dosis", () => {
    renderItem(VACUNA)

    expect(screen.getByLabelText(/Colaborador/)).toBeInTheDocument()
    const dosis = screen.getByLabelText(/Número de dosis/)
    expect(dosis).toBeInTheDocument()
    // Entero ≥ 1: el control no ofrece decimales ni negativos.
    expect(dosis).toHaveAttribute("type", "number")
    expect(dosis).toHaveAttribute("min", "1")
    expect(dosis).toHaveAttribute("step", "1")
  })

  it("un servicio que no es nominado no pide colaborador", () => {
    renderItem(MONOGAS)

    expect(screen.queryByLabelText(/Colaborador/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Número de dosis/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Código interno/)).toBeInTheDocument()
  })

  it("un EPP corriente en una solicitud 'otro' no muestra ninguno de los dos", () => {
    renderItem(CASCO)

    expect(screen.queryByLabelText(/Colaborador/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Número de dosis/)).not.toBeInTheDocument()
  })

  it("marca los servicios como costo pendiente y no como $0", () => {
    renderItem(VACUNA)
    expect(screen.getByText("Costo pendiente")).toBeInTheDocument()

    cleanup()
    renderItem(CASCO)
    expect(screen.queryByText("Costo pendiente")).not.toBeInTheDocument()
  })

  it("el colaborador se busca por nombre o RUT en vez de recorrer una lista", () => {
    renderItem(VACUNA)
    const picker = screen.getByLabelText(/Colaborador/)
    expect(picker).toHaveAttribute("role", "combobox")
    expect(picker).toHaveAttribute("aria-expanded", "false")
  })

  it("en consulta muestra el colaborador asignado sin ofrecer el selector", () => {
    renderItem(VACUNA, { workerId: "w-1", workerName: "Ana Colaboradora" }, { readOnly: true })
    const field = screen.getByLabelText(/Colaborador/)
    expect(field).toHaveValue("Ana Colaboradora")
    expect(field).toBeDisabled()
  })
})
