// @vitest-environment jsdom
/**
 * Estado del formulario de solicitudes: el vínculo del ítem con el equipo de flota
 * y la OT, y el despacho por defecto de los tipos con cotización.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { INITIAL_STATE } from "@/lib/form-state"
import type { SparePartOption, VehicleOption, WorksiteOption } from "./request-form.types"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("./actions", () => ({
  saveDraft: vi.fn(async () => INITIAL_STATE),
  submitRequest: vi.fn(async () => INITIAL_STATE),
  cancelRequest: vi.fn(async () => INITIAL_STATE),
  deleteRequestAction: vi.fn(async () => INITIAL_STATE),
}))

import { useRequestForm } from "./use-request-form"

afterEach(() => cleanup())

const WORKSITES: WorksiteOption[] = [{ id: "ws-1", name: "Biodiversa" }, { id: "ws-2", name: "Cholguán" }]

const VEHICLES: VehicleOption[] = [
  {
    id: "v-1", code: "KA-135", plate: "RBYD-98", label: "KA-135 · RBYD-98", hint: "Camión · Biodiversa",
    worksiteId: "ws-1", brand: "Scania", model: "R450", operationalStatus: "operativo",
    openWorkOrders: [{ id: "ot-1", folio: "OT-BIO-0007", status: "en_ejecucion" }],
  },
  {
    id: "v-2", code: "MQ-01", plate: "MQ-01", label: "MQ-01", hint: "Excavadora · Biodiversa",
    worksiteId: "ws-1", brand: null, model: null, operationalStatus: "mantencion",
    openWorkOrders: [{ id: "ot-2", folio: "OT-BIO-0011", status: "asignada" }],
  },
]

const PERMISSIONS = ["repuestos:create", "servicios:create", "requests:create"]

function setup(overrides: Partial<Parameters<typeof useRequestForm>[0]> = {}) {
  return renderHook(() => useRequestForm({
    worksites: WORKSITES, products: [], suppliers: [], maxFileSizeMb: 10,
    userPermissions: PERMISSIONS, initialRequestType: "repuestos", vehicles: VEHICLES,
    ...overrides,
  }))
}

/** El ítem tal como viajará al servidor. */
function serializedItem(form: ReturnType<typeof setup>["result"]) {
  const itemsJson = form.current.buildDraftFormData().get("itemsJson") as string
  return (JSON.parse(itemsJson) as Record<string, unknown>[])[0]!
}

describe("useRequestForm — equipo de flota y OT del ítem", () => {
  it("elegir un equipo fija su etiqueta y suelta la OT que tuviera", () => {
    const { result } = setup()
    const key = result.current.items[0]!._key
    act(() => result.current.selectVehicle(key, "v-1"))
    act(() => result.current.selectWorkOrder(key, "ot-1"))
    expect(result.current.items[0]).toMatchObject({
      vehicleId: "v-1", vehicleLabel: "KA-135 · RBYD-98", workOrderId: "ot-1", workOrderFolio: "OT-BIO-0007",
    })

    // Otro equipo: la OT era del anterior.
    act(() => result.current.selectVehicle(key, "v-2"))
    expect(result.current.items[0]).toMatchObject({ vehicleId: "v-2", vehicleLabel: "MQ-01", workOrderId: "", workOrderFolio: "" })

    // «Otro equipo (no está en flota)» limpia el vínculo.
    act(() => result.current.selectVehicle(key, ""))
    expect(result.current.items[0]).toMatchObject({ vehicleId: "", vehicleLabel: "", workOrderId: "", workOrderFolio: "" })
  })

  it("ignora un equipo que no está en el catálogo y una OT que no es de ese equipo", () => {
    const { result } = setup()
    const key = result.current.items[0]!._key
    act(() => result.current.selectVehicle(key, "v-inexistente"))
    expect(result.current.items[0]!.vehicleId).toBe("")

    act(() => result.current.selectVehicle(key, "v-1"))
    act(() => result.current.selectWorkOrder(key, "ot-2"))
    expect(result.current.items[0]).toMatchObject({ vehicleId: "v-1", workOrderId: "", workOrderFolio: "" })
  })

  it("cambiar la faena limpia vehículo y OT del ítem", () => {
    const { result } = setup({ initialWorksiteId: "ws-1" })
    const key = result.current.items[0]!._key
    act(() => result.current.selectVehicle(key, "v-1"))
    act(() => result.current.selectWorkOrder(key, "ot-1"))
    expect(result.current.items[0]).toMatchObject({ vehicleId: "v-1", workOrderId: "ot-1" })

    act(() => result.current.setWorksiteId("ws-2"))
    expect(result.current.worksiteId).toBe("ws-2")
    expect(result.current.items[0]).toMatchObject({ vehicleId: "", vehicleLabel: "", workOrderId: "", workOrderFolio: "" })
    // Y lo que viaja al servidor tampoco los lleva.
    expect(serializedItem(result)).toMatchObject({ vehicleId: null, workOrderId: null })
  })

  it("elegir la misma faena no toca el vínculo", () => {
    const { result } = setup({ initialWorksiteId: "ws-1" })
    const key = result.current.items[0]!._key
    act(() => result.current.selectVehicle(key, "v-1"))
    act(() => result.current.setWorksiteId("ws-1"))
    expect(result.current.items[0]!.vehicleId).toBe("v-1")
  })

  it("con equipo de flota manda vehículo, OT y precio, y no los campos libres", () => {
    const { result } = setup({ initialWorksiteId: "ws-1" })
    const key = result.current.items[0]!._key
    act(() => result.current.updateItem(key, {
      productNameFree: "Manguera hidráulica", equipmentName: "Camión viejo", patent: "ZZZZ-99",
      brand: "Otra", model: "X1", partNumber: "OEM-77", estimatedUnitPrice: "35000",
    }))

    // Sin equipo de flota: los campos libres viajan como siempre y el vínculo va vacío.
    expect(serializedItem(result)).toMatchObject({
      vehicleId: null, workOrderId: null, estimatedUnitPrice: 35_000,
      equipmentName: "Camión viejo", patent: "ZZZZ-99", brand: "Otra", model: "X1", partNumber: "OEM-77",
    })

    act(() => result.current.selectVehicle(key, "v-1"))
    act(() => result.current.selectWorkOrder(key, "ot-1"))
    expect(serializedItem(result)).toMatchObject({
      vehicleId: "v-1", workOrderId: "ot-1", estimatedUnitPrice: 35_000,
      equipmentName: null, patent: null, brand: null, model: null, partNumber: "OEM-77",
    })

    // Volver a «otro equipo» recupera lo que se había escrito.
    act(() => result.current.selectVehicle(key, ""))
    expect(serializedItem(result)).toMatchObject({ vehicleId: null, equipmentName: "Camión viejo", patent: "ZZZZ-99" })
  })

  it("un precio estimado en blanco viaja como «sin precio», no como cero", () => {
    const { result } = setup()
    expect(serializedItem(result).estimatedUnitPrice).toBeNull()
  })

  it("abre con el equipo, la OT y la urgencia que trae el enlace", () => {
    const { result } = setup({
      initialWorksiteId: "ws-1", initialUrgency: "high",
      prefillItems: [{
        productId: null, productNameFree: "", quantity: 1, unitOfMeasure: "unidad", urgency: "high", notes: "",
        vehicleId: "v-1", vehicleLabel: "KA-135 · RBYD-98", workOrderId: "ot-1", workOrderFolio: "OT-BIO-0007",
      }],
    })
    expect(result.current.urgency).toBe("high")
    expect(result.current.items[0]).toMatchObject({
      vehicleId: "v-1", vehicleLabel: "KA-135 · RBYD-98", workOrderId: "ot-1", workOrderFolio: "OT-BIO-0007",
    })
  })

  it("al editar un borrador hidrata equipo, OT y precio estimado", () => {
    const { result } = setup({
      editRequest: {
        id: "req-1", code: "REP-1", worksiteId: "ws-1", requestType: "repuestos", urgency: "normal",
        deliveryMode: "directo_faena", requiredDate: "2099-12-01", status: "draft", notes: null,
        items: [{
          id: "it-1", productId: null, productNameFree: "Filtro", quantity: 2, unitOfMeasure: "unidad", urgency: "normal",
          suggestedSupplierId: null, supplierHint: null, notes: null, status: "draft", workerId: null, workerName: null,
          equipmentCode: null, equipmentLabel: null, attributes: [],
          vehicleId: "v-1", vehicleLabel: "KA-135 · RBYD-98", workOrderId: "ot-1", workOrderFolio: "OT-BIO-0007",
          estimatedUnitPrice: 12_500.5,
        }],
      },
    })
    expect(result.current.items[0]).toMatchObject({
      vehicleId: "v-1", vehicleLabel: "KA-135 · RBYD-98", workOrderId: "ot-1", workOrderFolio: "OT-BIO-0007",
      estimatedUnitPrice: "12500.5",
    })
  })
})

describe("useRequestForm — despacho por defecto", () => {
  it("repuestos nace con despacho directo a faena", () => {
    expect(setup({ initialRequestType: "repuestos" }).result.current.deliveryMode).toBe("directo_faena")
    expect(setup({ initialRequestType: "servicios" }).result.current.deliveryMode).toBe("directo_faena")
  })

  it("EPP y otros siguen vía oficina", () => {
    expect(setup({ initialRequestType: "epp" }).result.current.deliveryMode).toBe("via_oficina")
  })

  it("al cambiar el tipo, el despacho sigue al tipo mientras nadie lo haya elegido", () => {
    const { result } = setup({ initialRequestType: "epp" })
    expect(result.current.deliveryMode).toBe("via_oficina")
    act(() => result.current.setRequestType("repuestos"))
    expect(result.current.deliveryMode).toBe("directo_faena")
    act(() => result.current.setRequestType("epp"))
    expect(result.current.deliveryMode).toBe("via_oficina")
  })

  it("una elección explícita del despacho no se pisa al cambiar el tipo", () => {
    const { result } = setup({ initialRequestType: "epp" })
    act(() => result.current.setDeliveryMode("via_oficina"))
    act(() => result.current.setRequestType("repuestos"))
    expect(result.current.deliveryMode).toBe("via_oficina")
  })

  it("un borrador editado conserva el despacho que ya tenía", () => {
    const { result } = setup({
      editRequest: {
        id: "req-1", code: "REP-1", worksiteId: "ws-1", requestType: "repuestos", urgency: "normal",
        deliveryMode: "via_oficina", requiredDate: "2099-12-01", status: "draft", notes: null, items: [],
      },
    })
    expect(result.current.deliveryMode).toBe("via_oficina")
  })
})

describe("useRequestForm — repuesto del catálogo", () => {
  const FILTRO: SparePartOption = {
    id: "rpt-1", sku: "RPT-001", name: "Filtro de aceite", partNumber: "1R-0750", partBrand: "Caterpillar",
    unitOfMeasure: "juego", lastPrice: 35_000.4, preferredSupplierId: "sup-1", purchasedForVehicleIds: ["v-1"],
  }
  const PASTILLA: SparePartOption = {
    id: "rpt-2", sku: "RPT-002", name: "Pastilla de freno", partNumber: "PF-200", partBrand: null,
    unitOfMeasure: "unidad", lastPrice: 18_900, preferredSupplierId: null, purchasedForVehicleIds: [],
  }
  const SIN_PRECIO: SparePartOption = {
    id: "rpt-3", sku: "RPT-003", name: "O-ring", partNumber: null, partBrand: null,
    unitOfMeasure: "unidad", lastPrice: null, preferredSupplierId: null, purchasedForVehicleIds: [],
  }
  const SPARE_PARTS = [FILTRO, PASTILLA, SIN_PRECIO]

  function setupCatalog(overrides: Partial<Parameters<typeof useRequestForm>[0]> = {}) {
    return setup({ initialWorksiteId: "ws-1", spareParts: SPARE_PARTS, ...overrides })
  }

  it("elegir un repuesto fija producto, unidad y proveedor, y precarga el último precio en pesos enteros", () => {
    const { result } = setupCatalog()
    const key = result.current.items[0]!._key
    act(() => result.current.updateItem(key, { productNameFree: "filtro", partNumber: "OEM-77" }))

    act(() => result.current.selectProduct(key, "rpt-1"))
    expect(result.current.items[0]).toMatchObject({
      productId: "rpt-1", productName: "Filtro de aceite", productNameFree: "", unitOfMeasure: "juego",
      estimatedUnitPrice: "35000", suggestedSupplierId: "sup-1", isEpp: false,
      // El N° de parte lo dice el repuesto: lo escrito antes no viaja.
      partNumber: "",
    })
    // Lo que viaja al servidor: el producto, sin nombre libre ni N° de parte.
    expect(serializedItem(result)).toMatchObject({
      productId: "rpt-1", productNameFree: null, partNumber: null, estimatedUnitPrice: 35_000,
    })
  })

  it("no pisa un precio que la persona ya escribió", () => {
    const { result } = setupCatalog()
    const key = result.current.items[0]!._key
    act(() => result.current.updateItem(key, { estimatedUnitPrice: "12000" }))
    act(() => result.current.selectProduct(key, "rpt-1"))
    expect(result.current.items[0]!.estimatedUnitPrice).toBe("12000")
  })

  it("un repuesto sin precio conocido deja el estimado como estaba", () => {
    const { result } = setupCatalog()
    const key = result.current.items[0]!._key
    act(() => result.current.selectProduct(key, "rpt-3"))
    expect(result.current.items[0]).toMatchObject({ productId: "rpt-3", estimatedUnitPrice: "", suggestedSupplierId: "" })
    expect(serializedItem(result).estimatedUnitPrice).toBeNull()
  })

  it("no pisa el proveedor que la persona eligió antes", () => {
    const { result } = setupCatalog()
    const key = result.current.items[0]!._key
    act(() => result.current.updateItem(key, { suggestedSupplierId: "sup-9" }))
    act(() => result.current.selectProduct(key, "rpt-1"))
    expect(result.current.items[0]!.suggestedSupplierId).toBe("sup-9")

    // Ni el que escribió a mano.
    const second = setupCatalog()
    const secondKey = second.result.current.items[0]!._key
    act(() => second.result.current.updateItem(secondKey, { supplierHint: "treck" }))
    act(() => second.result.current.selectProduct(secondKey, "rpt-1"))
    expect(second.result.current.items[0]).toMatchObject({ supplierHint: "treck", suggestedSupplierId: "" })
  })

  it("cambiar de repuesto reemplaza el precio que había precargado el anterior, no uno escrito a mano", () => {
    const { result } = setupCatalog()
    const key = result.current.items[0]!._key
    act(() => result.current.selectProduct(key, "rpt-1"))
    expect(result.current.items[0]!.estimatedUnitPrice).toBe("35000")
    act(() => result.current.selectProduct(key, "rpt-2"))
    expect(result.current.items[0]!.estimatedUnitPrice).toBe("18900")
    // Al pasar a uno sin precio, el del anterior no se queda como si fuera suyo.
    act(() => result.current.selectProduct(key, "rpt-3"))
    expect(result.current.items[0]!.estimatedUnitPrice).toBe("")

    act(() => result.current.selectProduct(key, "rpt-1"))
    act(() => result.current.updateItem(key, { estimatedUnitPrice: "41000" }))
    act(() => result.current.selectProduct(key, "rpt-2"))
    expect(result.current.items[0]!.estimatedUnitPrice).toBe("41000")
  })

  it("«Cambiar» suelta el precio y el proveedor precargados, y conserva los escritos", () => {
    const { result } = setupCatalog()
    const key = result.current.items[0]!._key
    act(() => result.current.selectProduct(key, "rpt-1"))
    act(() => result.current.clearProduct(key))
    expect(result.current.items[0]).toMatchObject({
      productId: null, productName: "", productNameFree: "", estimatedUnitPrice: "", suggestedSupplierId: "",
    })

    act(() => result.current.selectProduct(key, "rpt-1"))
    act(() => result.current.updateItem(key, { estimatedUnitPrice: "41000", suggestedSupplierId: "sup-9" }))
    act(() => result.current.clearProduct(key))
    expect(result.current.items[0]).toMatchObject({ productId: null, estimatedUnitPrice: "41000", suggestedSupplierId: "sup-9" })
  })

  it("el texto libre sigue viajando como descripción, sin producto", () => {
    const { result } = setupCatalog()
    const key = result.current.items[0]!._key
    act(() => result.current.selectProduct(key, "rpt-1"))
    act(() => result.current.clearProduct(key))
    act(() => result.current.updateItem(key, { productNameFree: "Manguera hidráulica", productId: null, partNumber: "MH-9" }))
    expect(serializedItem(result)).toMatchObject({ productId: null, productNameFree: "Manguera hidráulica", partNumber: "MH-9" })
    expect(result.current.missingItems.some((issue) => issue.includes("selecciona o describe"))).toBe(false)
  })

  it("el umbral de cotizaciones usa el precio precargado", () => {
    const { result } = setupCatalog({ quotationThresholdClp: 100_000 })
    const key = result.current.items[0]!._key
    act(() => result.current.updateItem(key, { quantity: "4" }))
    // 4 × $35.000 = $140.000 supera el umbral: sin cotizaciones no se puede enviar.
    act(() => result.current.selectProduct(key, "rpt-1"))
    expect(result.current.missingItems.some((issue) => /cotizaci/i.test(issue))).toBe(true)

    act(() => result.current.updateItem(key, { quantity: "2" }))
    expect(result.current.missingItems.some((issue) => /cotizaci/i.test(issue))).toBe(false)
  })

  it("al editar un borrador hidrata el nombre del repuesto desde el catálogo", () => {
    const { result } = setupCatalog({
      editRequest: {
        id: "req-1", code: "REP-1", worksiteId: "ws-1", requestType: "repuestos", urgency: "normal",
        deliveryMode: "directo_faena", requiredDate: "2099-12-01", status: "draft", notes: null,
        items: [{
          id: "it-1", productId: "rpt-1", productNameFree: null, quantity: 2, unitOfMeasure: "juego", urgency: "normal",
          suggestedSupplierId: null, supplierHint: null, notes: null, status: "draft", workerId: null, workerName: null,
          equipmentCode: null, equipmentLabel: null, attributes: [], estimatedUnitPrice: 33_000,
        }],
      },
    })
    expect(result.current.items[0]).toMatchObject({
      productId: "rpt-1", productName: "Filtro de aceite", productNameFree: "", estimatedUnitPrice: "33000",
    })
  })

  it("un id que no es del catálogo de repuestos se busca en el catálogo general, como siempre", () => {
    const casco = {
      id: "prod-casco", sku: "EPP-1", name: "Casco", isEpp: true, isService: false, requiresWorker: false, equipmentKind: null,
      unitOfMeasure: "unidad", categoryName: "cat", referencePrice: null, familyId: null, preferredSupplierId: null, attributes: [],
    }
    const { result } = setupCatalog({ products: [casco], initialRequestType: "epp" })
    const key = result.current.items[0]!._key
    act(() => result.current.selectProduct(key, "prod-casco"))
    expect(result.current.items[0]).toMatchObject({ productId: "prod-casco", productName: "Casco", isEpp: true })
  })
})
