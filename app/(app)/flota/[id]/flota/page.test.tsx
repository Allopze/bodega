// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  can: vi.fn((..._args: unknown[]) => false),
  // Áreas que quien mira ve en la ficha. Por defecto sólo Flota: así la pestaña muestra también lo que,
  // con Mantención o Combustible visibles, vive en esas pestañas (OT, compras, cómo carga).
  areas: ["flota"] as string[],
}))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(href) },
  notFound: () => { throw new Error("not found") },
}))
vi.mock("@/lib/auth/can", () => ({
  can: (...args: unknown[]) => mocks.can(...args),
}))
// La puerta de la pestaña (permiso, módulo y faena) tiene su propia prueba; aquí entra siempre.
vi.mock("../_ficha/access", () => ({
  openVehicleFichaArea: async () => ({
    // `isGlobal` y `worksiteIds` los lee `canAccessWorksite` (alcance de la faena del equipo).
    session: { user: { id: "u1", isGlobal: false, worksiteIds: ["ws-1"] } },
    // La marca de la ficha es la de la lista de Mantención si está en ella; si no, la del padrón.
    ctx: { label: "KA-115", vehicle: { id: "veh-1", brand: "Volvo" }, areas: mocks.areas, permittedAreas: mocks.areas, tabs: [], hasMaintenanceProfile: false },
  }),
}))
vi.mock("../_ficha/ficha-chrome", () => ({
  vehicleFichaDescription: () => "Camión tolva · RBYD-98 · Biodiversa · Operativo",
  vehicleFichaBreadcrumb: () => [],
  VehicleFichaTabs: () => <nav aria-label="Ficha de KA-115" />,
  VehicleFichaEditAction: () => null,
}))
vi.mock("@/lib/services/fleet", () => ({ getFleetVehicleDetail: mocks.detail }))
// La tarjeta «Contrato» lee su historial de la base; acá no interesa.
vi.mock("@/lib/services/vehicle-ficha", () => ({ loadVehicleContractCard: async () => ({ history: [], contractOptions: [] }) }))
vi.mock("@/lib/services/system-settings", () => ({ getFleetAdminSettings: async () => ({ warningDays: 30, defaultVehicleStatus: "operativo" }) }))
// La hoja «Actualizar vencimientos» importa la acción; su lógica tiene su propia prueba.
vi.mock("../../actions", () => ({ updateVehicleExpiriesAction: vi.fn() }))
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
  Breadcrumbs: () => null,
}))
vi.mock("../fleet-documents-panel", () => ({ FleetDocumentsPanel: () => null, FleetDocumentUpload: () => <button type="button">Subir documento</button> }))

import FlotaVehiclePage from "./page"

function detail(performanceUnit: string, overrides: { vehicle?: Record<string, unknown>; documents?: unknown[] } = {}) {
  return {
    vehicle: {
      id: "veh-1", plate: "RBYD-98", brand: "Volvo", model: "FMX", year: 2020, type: "camion", code: null, worksiteId: "ws-1",
      equipmentType: { name: "Camión tolva" }, worksite: { name: "Biodiversa" }, serialNumber: null, performanceUnit,
      tankCapacityLiters: null, usualFuelSupplier: null, responsibleUser: null, operationalStatus: "operativo",
      soapExpiresAt: null, technicalReviewExpiresAt: null, circulationPermitExpiresAt: null, insuranceExpiresAt: null,
      insurancePolicyNumber: null, isActive: true, notes: null,
      ...overrides.vehicle,
    },
    documents: overrides.documents ?? [],
    recentWorkOrders: null,
    workOrderConsumptionImpact: [],
    currentReading: null,
    recentOperations: [],
    providerReading: null,
    topOperators: [],
    operationalIntervals: [],
    nextExpiryDate: null,
  }
}

/** Valor de un dato de la ficha («Etiqueta ... valor»), leído desde su etiqueta. */
async function factValue(performanceUnit: string, label: string) {
  mocks.detail.mockResolvedValue(detail(performanceUnit))
  render(await FlotaVehiclePage({ params: Promise.resolve({ id: "veh-1" }) }))
  return screen.getByText(label).nextElementSibling?.textContent
}

afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.can.mockReturnValue(false); mocks.areas = ["flota"]; vi.useRealTimers() })

describe("ficha de vehículo: unidad de rendimiento", () => {
  // El dato es la unidad con que se mide el rendimiento del equipo (catálogo), no una medición:
  // rotulado «Rendimiento» se leía como un valor al que le faltaba la cifra («km/L» a secas).
  it("rotula la unidad como unidad, no como «Rendimiento» sin cifra", async () => {
    expect(await factValue("km_per_liter", "Unidad de rendimiento")).toBe("km/L")
    expect(screen.queryByText("Rendimiento")).toBeNull()
  })

  it("lo mismo en litros por hora", async () => {
    expect(await factValue("liters_per_hour", "Unidad de rendimiento")).toBe("L/h")
    expect(screen.queryByText("Rendimiento")).toBeNull()
  })

  it("un equipo sin rendimiento dice «No aplica»", async () => {
    expect(await factValue("not_applicable", "Unidad de rendimiento")).toBe("No aplica")
  })
})

describe("ficha de vehículo: lecturas", () => {
  it("muestra la lectura del proveedor separada de la del log de cargas", async () => {
    mocks.detail.mockResolvedValue({
      ...detail("km_per_liter"),
      providerReading: { odometer: 12_500, hourMeter: null, occurredAt: "2026-11-01T12:00:00.000Z" },
    })
    render(await FlotaVehiclePage({ params: Promise.resolve({ id: "veh-1" }) }))

    expect(screen.getByText("Última lectura del proveedor (Copec)").nextElementSibling?.textContent).toBe("12.500 km")
    expect(screen.getByText("Fecha de lectura del proveedor").nextElementSibling?.textContent).toContain("2026")
  })
})

describe("ficha de vehículo: vencimientos", () => {
  // Solo se simula la fecha: las promesas de la página siguen su curso normal.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-05T15:00:00.000Z"))
  })

  async function renderPage(options: Parameters<typeof detail>[1] = {}) {
    mocks.detail.mockResolvedValue(detail("km_per_liter", options))
    render(await FlotaVehiclePage({ params: Promise.resolve({ id: "veh-1" }) }))
    return screen.getByRole("list", { name: "Vencimientos del equipo" })
  }
  const nameOf = (item: HTMLElement) => item.querySelector("p")?.textContent

  it("lista los cuatro documentos con lo vencido primero, lo próximo después y lo sin fecha al final", async () => {
    const list = await renderPage({
      vehicle: {
        soapExpiresAt: "2026-12-01", // por vencer (26 días)
        circulationPermitExpiresAt: "2026-10-20", // vencido
        insuranceExpiresAt: "2027-08-01", // vigente
        technicalReviewExpiresAt: null, // sin fecha
      },
    })

    expect(within(list).getAllByRole("listitem").map(nameOf)).toEqual([
      "Permiso de circulación", "SOAP", "Seguro", "Revisión técnica",
    ])
  })

  it("cada fila dice su estado con texto, no solo con color", async () => {
    const list = await renderPage({ vehicle: { circulationPermitExpiresAt: "2026-10-20", soapExpiresAt: "2026-12-01" } })

    const [permiso, soap, ...resto] = within(list).getAllByRole("listitem")
    expect(within(permiso!).getByText("Vencido")).toBeInTheDocument()
    expect(within(permiso!).getByText("venció hace 16 días")).toBeInTheDocument()
    expect(within(soap!).getByText("Por vencer")).toBeInTheDocument()
    expect(within(soap!).getByText("vence en 26 días")).toBeInTheDocument()
    expect(resto.every((item) => within(item).queryByText("Sin fecha") !== null)).toBe(true)
  })

  it("si la fecha viene de un documento subido lo dice; si el equipo tiene la suya, manda y no lo dice", async () => {
    const list = await renderPage({
      vehicle: { soapExpiresAt: "2027-03-31" },
      documents: [
        { documentType: "Revisión técnica", expiresAt: "2026-11-30", status: "current" },
        // La columna del equipo manda sobre el documento del mismo tipo.
        { documentType: "SOAP", expiresAt: "2026-01-01", status: "current" },
        // Una versión reemplazada no rige.
        { documentType: "Seguro", expiresAt: "2026-11-10", status: "replaced" },
      ],
    })

    const items = within(list).getAllByRole("listitem")
    const revision = items.find((item) => nameOf(item) === "Revisión técnica")!
    expect(within(revision).getByText("según documento subido")).toBeInTheDocument()
    expect(within(revision).getByText("Por vencer")).toBeInTheDocument()
    const soap = items.find((item) => nameOf(item) === "SOAP")!
    expect(within(soap).queryByText("según documento subido")).toBeNull()
    expect(within(soap).getByText("Vigente")).toBeInTheDocument()
    const seguro = items.find((item) => nameOf(item) === "Seguro")!
    expect(within(seguro).getByText("Sin fecha")).toBeInTheDocument()
  })

  it("sin permiso de documentos no hay «Actualizar»", async () => {
    const list = await renderPage()

    expect(within(list).queryByRole("button", { name: /^Actualizar/ })).toBeNull()
  })

  it("con permiso, una «Actualizar» por documento, nombrada por el documento", async () => {
    mocks.can.mockImplementation((_session, permission) => permission === "flota:manage_documents")
    const list = await renderPage()

    expect(within(list).getAllByRole("button", { name: /^Actualizar/ }).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Actualizar SOAP", "Actualizar Permiso de circulación", "Actualizar Revisión técnica", "Actualizar Seguro",
    ])
  })

  it("con permiso pero fuera de la faena del equipo tampoco: el alcance cuenta, no solo el permiso", async () => {
    mocks.can.mockReturnValue(true)
    const list = await renderPage({ vehicle: { worksiteId: "ws-2" } })

    expect(within(list).queryByRole("button", { name: /^Actualizar/ })).toBeNull()
  })
})

describe("ficha de vehículo: repuestos y servicios comprados", () => {
  const purchase = {
    requestItemId: "item-1", requestId: "req-1", requestCode: "REP-2026-0042", requestType: "repuestos", itemName: "Filtro hidráulico",
    quantity: 2, unitOfMeasure: "unidad", itemStatus: "purchased", itemStatusLabel: "Pendiente de recepción", workOrderId: "ot-1",
    workOrderFolio: "OT-BIO-0007", requestedAt: "2026-11-02T15:00:00.000Z", requesterName: "Alexis Morales", orderId: "oc-1",
    orderCode: "OC-2026-0310", orderStatus: "sent", unitPrice: 20_000, subtotal: 40_000,
  }

  async function renderWith(recentPurchases: unknown, vehicle: Record<string, unknown> = {}) {
    mocks.detail.mockResolvedValue({ ...detail("km_per_liter", { vehicle }), recentPurchases })
    render(await FlotaVehiclePage({ params: Promise.resolve({ id: "veh-1" }) }))
  }

  it("sin purchasing:view (recentPurchases null) no dibuja la tarjeta: no dice «sin compras»", async () => {
    await renderWith(null)

    expect(screen.queryByRole("heading", { name: "Repuestos y servicios comprados" })).toBeNull()
    expect(screen.queryByText("Sin compras vinculadas")).toBeNull()
  })

  it("con compras, las lista con su OC y el botón «Pedir repuestos» sólo si puede crear solicitudes", async () => {
    mocks.can.mockImplementation((_session, permission) => permission === "repuestos:create" || permission === "repuestos:view_all")
    await renderWith([purchase])

    const heading = screen.getByRole("heading", { name: "Repuestos y servicios comprados" })
    expect(heading).toBeInTheDocument()
    expect(screen.getByText("Filtro hidráulico")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "REP-2026-0042" }).getAttribute("href")).toBe("/solicitudes/req-1")
    expect(screen.getByRole("link", { name: "OC-2026-0310" }).getAttribute("href")).toBe("/compras/oc-1")
    expect(screen.getByRole("link", { name: "Pedir repuestos" }).getAttribute("href")).toBe("/solicitudes/nueva?tipo=repuestos&vehiculo=veh-1")
  })

  it("sin repuestos:create no hay botón, y sin repuestos:view_all la solicitud es texto", async () => {
    await renderWith([purchase])

    expect(screen.queryByRole("link", { name: "Pedir repuestos" })).toBeNull()
    expect(screen.queryByRole("link", { name: "REP-2026-0042" })).toBeNull()
    expect(screen.getByText("REP-2026-0042")).toBeInTheDocument()
  })

  it("un equipo dado de baja no ofrece pedir repuestos", async () => {
    mocks.can.mockReturnValue(true)
    await renderWith([], { isActive: false })

    expect(screen.getByText("Sin compras vinculadas")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Pedir repuestos" })).toBeNull()
  })
})

describe("ficha de vehículo: documentos y encabezado", () => {
  async function renderFicha(overrides: Parameters<typeof detail>[1] = {}, extra: Record<string, unknown> = {}) {
    mocks.detail.mockResolvedValue({ ...detail("km_per_liter", overrides), ...extra })
    render(await FlotaVehiclePage({ params: Promise.resolve({ id: "veh-1" }) }))
  }

  it("la cabecera y las pestañas son las de la ficha única: el nombre sale del contexto, no de la pestaña", async () => {
    await renderFicha({ vehicle: { code: "KA-115" } })
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("KA-115")
    expect(screen.getByRole("navigation", { name: "Ficha de KA-115" })).toBeInTheDocument()
    // Los botones «Combustible», «Ficha de mantención» y «Ver órdenes de trabajo» eran la navegación entre
    // fichas: ahora son pestañas.
    expect(screen.queryByRole("link", { name: "Ficha de mantención" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Combustible" })).toBeNull()
  })

  it("vencimientos, seguro y archivos son una sola tarjeta «Documentos», sin «Próximo vencimiento» repetido", async () => {
    await renderFicha({ vehicle: { soapExpiresAt: "2027-03-31", insurancePolicyNumber: "POL-123" } })

    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toContain("Documentos")
    expect(screen.queryByRole("heading", { name: "Vencimientos", level: 2 })).toBeNull()
    expect(screen.queryByRole("heading", { name: "Seguro", level: 2 })).toBeNull()
    expect(screen.queryByText("Próximo vencimiento")).toBeNull()
    expect(screen.getByText("Póliza del seguro").nextElementSibling?.textContent).toBe("POL-123")
  })

  it("marca, modelo, año y notas viven en «Datos del vehículo»; el estado va en la cabecera y no se repite", async () => {
    await renderFicha({ vehicle: { operationalStatus: "mantencion", notes: "Revisar frenos" } })

    expect(screen.getByRole("heading", { name: "Datos del vehículo", level: 2 })).toBeInTheDocument()
    expect(screen.getByText("Marca y modelo").nextElementSibling?.textContent).toBe("Volvo FMX")
    expect(screen.getByText("Año").nextElementSibling?.textContent).toBe("2020")
    expect(screen.getByText("Notas").nextElementSibling?.textContent).toBe("Revisar frenos")
    expect(screen.queryByText("Estado")).toBeNull()
    expect(screen.queryByText("Faena")).toBeNull()
  })

  it("con la pestaña Combustible visible, cómo carga (unidad, capacidad, proveedor) queda allá", async () => {
    mocks.areas = ["flota", "combustible"]
    await renderFicha()
    expect(screen.queryByText("Unidad de rendimiento")).toBeNull()
    expect(screen.queryByText("Capacidad")).toBeNull()
    expect(screen.queryByText("Proveedor habitual")).toBeNull()
  })

  it("con la pestaña Mantención visible no carga ni muestra las OT ni las compras: viven allá", async () => {
    mocks.areas = ["flota", "mantencion"]
    await renderFicha()
    expect(mocks.detail).toHaveBeenCalledWith(expect.anything(), "veh-1", { includeMaintenance: false })
    cleanup()
    mocks.areas = ["flota"]
    await renderFicha()
    expect(mocks.detail).toHaveBeenLastCalledWith(expect.anything(), "veh-1", { includeMaintenance: true })
  })

  it("sólo quien gestiona documentos ve «Subir documento»", async () => {
    await renderFicha()
    expect(screen.queryByRole("button", { name: "Subir documento" })).toBeNull()
    cleanup()

    mocks.can.mockImplementation((_session, permission) => permission === "flota:manage_documents")
    await renderFicha()
    expect(screen.getByRole("button", { name: "Subir documento" })).toBeInTheDocument()
  })

  it("el rendimiento antes y después de una OT lleva coma decimal y la unidad del equipo", async () => {
    await renderFicha({}, {
      recentWorkOrders: [{ id: "ot-1", folio: "OT-1", status: "cerrada", repair: true, maintenance: false, requestDate: "2026-10-01", workshopEntryAt: null, workshopExitAt: null }],
      workOrderConsumptionImpact: [{ workOrderId: "ot-1", avgBefore: 5.4321, avgAfter: 6.1 }],
    })

    expect(screen.getByText("5,43 → 6,1 km/L")).toBeInTheDocument()
    expect(screen.queryByText(/5\.43/)).toBeNull()
  })
})
