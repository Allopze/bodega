// @vitest-environment jsdom
/**
 * Campos condicionales del ítem: el colaborador y el número de dosis aparecen
 * sólo cuando el concepto elegido los pide, sin recargar la página, y el
 * distintivo de "Costo pendiente" distingue un servicio sin precio de un
 * producto normal.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ItemEditor } from "./item-editor"
import { blankItem } from "./request-form.helpers"
import type { ItemRow, ProductOption, WorkerOption, EquipmentOption, VehicleOption, PendingCotizacion } from "./request-form.types"

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
  isService: true, unitOfMeasure: "servicio", equipmentKind: "monogas",
  attributes: [{ id: "pa-marca", name: "Marca", type: "text", isRequired: false, drivesQuantity: false, options: null }],
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

function renderItem(
  prod: ProductOption,
  overrides: Partial<ItemRow> = {},
  props: { readOnly?: boolean; equipment?: EquipmentOption[] } = {},
) {
  return render(
    <ItemEditor
      item={itemFor(prod, overrides)}
      idx={0}
      products={[CASCO, MONOGAS, VACUNA]}
      suppliers={[]}
      workers={WORKERS}
      equipment={props.equipment}
      readOnly={props.readOnly ?? false}
      requestType="otro"
      maxFileSizeMb={10}
      onUpdate={vi.fn()}
      onSelectProduct={vi.fn()}
      onSelectFreeProduct={vi.fn()}
      onClearProduct={vi.fn()}
      onUpdateAttr={vi.fn()}
      onUpdateWorker={vi.fn()}
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
    expect(screen.getByLabelText(/Código del equipo/)).toBeInTheDocument()
  })

  it("el equipo se identifica por código escrito, no eligiéndolo de una lista", () => {
    renderItem(MONOGAS)
    const campo = screen.getByLabelText(/Código del equipo/)

    // Campo de texto libre: sin él, un monogás que nadie dio de alta antes
    // dejaba la mantención imposible de pedir.
    expect(campo.tagName).toBe("INPUT")
    expect(campo).not.toHaveAttribute("role", "combobox")
    // Los códigos ya conocidos se ofrecen como sugerencias, no como opciones.
    expect(campo).toHaveAttribute("list")
  })

  it("avisa si el código escrito dará de alta un equipo nuevo", () => {
    renderItem(MONOGAS, { equipmentCode: "mg-014" }, {
      equipment: [{ id: "eq-1", code: "MG-014", name: "Detector monogás H2S", kind: "monogas", worksiteId: "ws-1" }],
    })
    expect(screen.getByText(/Ya está en el catálogo: Detector monogás H2S/)).toBeInTheDocument()

    cleanup()
    renderItem(MONOGAS, { equipmentCode: "000123456789" })
    expect(screen.getByText(/se dará de alta/i)).toBeInTheDocument()
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
    // La consulta es un resumen (dl), no un formulario deshabilitado.
    const term = screen.getByText("Colaborador:")
    expect(term.nextElementSibling).toHaveTextContent("Ana Colaboradora")
    expect(screen.queryByLabelText(/Colaborador/)).toBeNull()
    expect(screen.queryByRole("combobox")).toBeNull()
  })
})

describe("ItemEditor — variantes de una familia", () => {
  const botin = (id: string, size: string, color: string, sku: string) => product({
    id, sku, name: "Botín de seguridad", isEpp: true, unitOfMeasure: "par", familyId: "botin",
    attributes: [
      { id: `${id}-talla`, name: "Talla calzado", type: "select", isRequired: true, drivesQuantity: false, options: JSON.stringify([size]) },
      { id: `${id}-color`, name: "Color", type: "select", isRequired: true, drivesQuantity: false, options: JSON.stringify([color]) },
    ],
  })
  const BOTIN = [
    botin("42-negro", "42", "Negro", "EPP-001"),
    botin("42-cafe", "42", "Café", "EPP-002"),
    botin("43-negro", "43", "Negro", "EPP-003"),
  ]

  it("ofrece elegir el color además de la talla cuando la familia los mezcla", () => {
    render(
      <ItemEditor
        item={itemFor(BOTIN[1]!)}
        idx={0}
        products={BOTIN}
        suppliers={[]}
        workers={WORKERS}
        readOnly={false}
        requestType="epp"
        maxFileSizeMb={10}
        onUpdate={vi.fn()}
        onSelectProduct={vi.fn()}
        onSelectFreeProduct={vi.fn()}
        onClearProduct={vi.fn()}
        onUpdateAttr={vi.fn()}
        onUpdateWorker={vi.fn()}
        onRemove={vi.fn()}
        canRemove={false}
      />,
    )
    expect(screen.getByRole("combobox", { name: /Talla calzado/ })).toHaveTextContent("42")
    expect(screen.getByRole("combobox", { name: /^Color/ })).toHaveTextContent("Café")
  })
})


// ── Repuestos y servicios: equipo de flota, OT y precio estimado ─────────────

const FLEET: VehicleOption[] = [
  {
    id: "v-1", code: "KA-135", plate: "RBYD-98", label: "KA-135 · RBYD-98", hint: "Camión · Biodiversa",
    worksiteId: "ws-1", brand: "Scania", model: "R450", operationalStatus: "operativo",
    openWorkOrders: [
      { id: "ot-1", folio: "OT-BIO-0007", status: "en_ejecucion" },
      { id: "ot-2", folio: "OT-BIO-0009", status: "solicitada" },
    ],
  },
  {
    id: "v-2", code: "MQ-01", plate: "MQ-01", label: "MQ-01", hint: "Excavadora · Biodiversa",
    worksiteId: "ws-1", brand: null, model: null, operationalStatus: "mantencion", openWorkOrders: [],
  },
  {
    id: "v-3", code: "KA-200", plate: "BCDF-12", label: "KA-200 · BCDF-12", hint: "Camión · Cholguán",
    worksiteId: "ws-2", brand: "Volvo", model: "FH", operationalStatus: "operativo", openWorkOrders: [],
  },
]

function renderQuotation(
  requestType: "repuestos" | "servicios",
  overrides: Partial<ItemRow> = {},
  props: {
    readOnly?: boolean
    worksiteId?: string
    onUpdate?: (patch: Partial<ItemRow>) => void
    onSelectVehicle?: (vehicleId: string) => void
    onSelectWorkOrder?: (workOrderId: string) => void
    quotationRule?: string
    quotationNotice?: string | null
  } = {},
) {
  return render(
    <ItemEditor
      item={{ ...blankItem("k-1"), productNameFree: "Manguera hidráulica", ...overrides }}
      idx={0}
      products={[]}
      suppliers={[{ id: "sup-1", name: "Repuestos del Sur" }]}
      vehicles={FLEET}
      worksiteId={props.worksiteId ?? "ws-1"}
      readOnly={props.readOnly ?? false}
      requestType={requestType}
      maxFileSizeMb={10}
      quotationRule={props.quotationRule}
      quotationNotice={props.quotationNotice}
      onUpdate={props.onUpdate ?? vi.fn()}
      onSelectVehicle={props.onSelectVehicle ?? vi.fn()}
      onSelectWorkOrder={props.onSelectWorkOrder ?? vi.fn()}
      onSelectProduct={vi.fn()}
      onSelectFreeProduct={vi.fn()}
      onClearProduct={vi.fn()}
      onUpdateAttr={vi.fn()}
      onUpdateWorker={vi.fn()}
      onRemove={vi.fn()}
      canRemove={false}
    />,
  )
}

function pendingCotizacion(): PendingCotizacion {
  return {
    _id: "c-1", file: new File(["x"], "cot.pdf"), fileName: "cot.pdf", fileSize: 1024,
    totalAmount: "900000", supplierId: "", supplierNameFree: "Proveedor X",
  }
}

describe("ItemEditor — equipo de flota en repuestos y servicios", () => {
  beforeAll(() => {
    // Radix Select pide estas APIs del puntero y del scroll, que jsdom no trae.
    Object.assign(window.HTMLElement.prototype, {
      hasPointerCapture: () => false,
      releasePointerCapture: () => {},
      scrollIntoView: () => {},
    })
  })

  it("repuestos: muestra el combobox de flota y oculta patente libre al elegir un vehículo", () => {
    renderQuotation("repuestos")
    const flota = screen.getByRole("combobox", { name: /Equipo de flota/ })
    expect(flota).toHaveAttribute("placeholder", "Busca por código o patente")
    // Sin equipo elegido, los campos libres siguen disponibles («otro equipo»).
    expect(screen.getByLabelText(/Patente \/ código interno/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Equipo \/ máquina/)).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: /Orden de trabajo/ })).toBeNull()

    cleanup()
    renderQuotation("repuestos", { vehicleId: "v-1", vehicleLabel: "KA-135 · RBYD-98" })
    expect(screen.getByRole("combobox", { name: /Equipo de flota/ })).toHaveValue("KA-135 · RBYD-98")
    expect(screen.queryByLabelText(/Patente \/ código interno/)).toBeNull()
    expect(screen.queryByLabelText(/Equipo \/ máquina/)).toBeNull()
    expect(screen.queryByLabelText(/^Marca/)).toBeNull()
    expect(screen.queryByLabelText(/^Modelo/)).toBeNull()
    // El N.° de parte es del repuesto, no del equipo.
    expect(screen.getByLabelText(/N° de Parte/)).toBeInTheDocument()
  })

  it("ofrece sólo los equipos de la faena del formulario y avisa la elección", () => {
    const onSelectVehicle = vi.fn()
    renderQuotation("repuestos", {}, { onSelectVehicle })
    fireEvent.focus(screen.getByRole("combobox", { name: /Equipo de flota/ }))

    expect(screen.getByRole("option", { name: /KA-135 · RBYD-98/ })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /MQ-01/ })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /KA-200/ })).toBeNull()
    // «Otro equipo» devuelve el ítem a los campos libres.
    expect(screen.getByRole("option", { name: "Otro equipo (no está en flota)" })).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole("option", { name: /KA-135 · RBYD-98/ }))
    expect(onSelectVehicle).toHaveBeenCalledWith("v-1")
  })

  it("un equipo ya vinculado sigue visible aunque el catálogo no lo traiga", () => {
    renderQuotation("repuestos", { vehicleId: "v-viejo", vehicleLabel: "KA-001 · VIEJ-01" })
    expect(screen.getByRole("combobox", { name: /Equipo de flota/ })).toHaveValue("KA-001 · VIEJ-01")
  })

  it("muestra las OT abiertas del vehículo elegido", () => {
    const onSelectWorkOrder = vi.fn()
    renderQuotation("repuestos", { vehicleId: "v-1", vehicleLabel: "KA-135 · RBYD-98" }, { onSelectWorkOrder })

    const trigger = screen.getByRole("combobox", { name: /Orden de trabajo/ })
    fireEvent.keyDown(trigger, { key: "Enter" })
    expect(screen.getByRole("option", { name: "Sin OT" })).toBeInTheDocument()
    // Estado en español, nunca el valor crudo de la base.
    expect(screen.getByRole("option", { name: "OT-BIO-0007 · En taller" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "OT-BIO-0009 · Por asignar" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("option", { name: "OT-BIO-0007 · En taller" }))
    expect(onSelectWorkOrder).toHaveBeenCalledWith("ot-1")
  })

  it("un equipo sin OT abiertas lo dice en vez de ofrecer una lista vacía", () => {
    renderQuotation("repuestos", { vehicleId: "v-2", vehicleLabel: "MQ-01" })
    expect(screen.getByText("Este equipo no tiene OT abiertas.")).toBeInTheDocument()
  })

  it("repuestos: muestra proveedor sugerido y precio estimado", () => {
    const onUpdate = vi.fn()
    renderQuotation("repuestos", {}, { onUpdate })
    expect(screen.getByLabelText(/Proveedor sugerido/)).toBeInTheDocument()
    const precio = screen.getByLabelText(/Precio unitario estimado \(CLP\)/)
    expect(precio).toHaveAttribute("type", "number")
    expect(screen.getByText("Opcional. Bajo el umbral permite enviar sin cotización.")).toBeInTheDocument()

    fireEvent.change(precio, { target: { value: "35000" } })
    expect(onUpdate).toHaveBeenCalledWith({ estimatedUnitPrice: "35000" })
  })

  it("servicios: ofrece el equipo de flota pero no el precio estimado ni el proveedor sugerido", () => {
    renderQuotation("servicios")
    expect(screen.getByRole("combobox", { name: /Equipo de flota/ })).toBeInTheDocument()
    expect(screen.getByLabelText(/Ubicación/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Precio unitario estimado/)).toBeNull()
    expect(screen.queryByLabelText(/Proveedor sugerido/)).toBeNull()
  })

  it("en consulta resume el equipo, la OT, el precio estimado y el proveedor sugerido", () => {
    renderQuotation("repuestos", {
      vehicleId: "v-1", vehicleLabel: "KA-135 · RBYD-98", workOrderId: "ot-1", workOrderFolio: "OT-BIO-0007",
      estimatedUnitPrice: "35000", suggestedSupplierId: "sup-1",
    }, { readOnly: true })

    expect(screen.getByText("Equipo de flota:").nextElementSibling).toHaveTextContent("KA-135 · RBYD-98")
    expect(screen.getByText("Orden de trabajo:").nextElementSibling).toHaveTextContent("OT-BIO-0007")
    expect(screen.getByText("Precio estimado:").nextElementSibling).toHaveTextContent(/35\.000/)
    expect(screen.getByText("Proveedor sugerido:").nextElementSibling).toHaveTextContent("Repuestos del Sur")
    expect(screen.queryByRole("combobox")).toBeNull()
  })

  it("las cotizaciones explican la regla y avisan lo que falta sólo si ya hay archivos", () => {
    const rule = "Bajo $500.000 basta una cotización o el precio unitario estimado de cada ítem."
    renderQuotation("repuestos", {}, { quotationRule: rule, quotationNotice: "Sobre $500.000 se requieren 3 cotizaciones." })
    expect(screen.getByText(rule)).toBeInTheDocument()
    // Sin archivos, el pendiente vive en el resumen; bajo el ítem sería ruido.
    expect(screen.queryByText("Sobre $500.000 se requieren 3 cotizaciones.")).toBeNull()

    cleanup()
    renderQuotation("repuestos", { cotizaciones: [pendingCotizacion()] }, {
      quotationRule: rule, quotationNotice: "Sobre $500.000 se requieren 3 cotizaciones.",
    })
    expect(screen.getByText("Sobre $500.000 se requieren 3 cotizaciones.")).toBeInTheDocument()

    cleanup()
    renderQuotation("repuestos", { cotizaciones: [pendingCotizacion()] }, { quotationRule: rule, quotationNotice: null })
    expect(screen.queryByText(/se requieren 3 cotizaciones/)).toBeNull()
  })
})
