// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { VehiclePurchaseRecord } from "@/lib/services/vehicle-purchase-history"
import type { EquipmentDetailData } from "./equipment-detail-types"

vi.mock("next/navigation", () => ({
  usePathname: () => "/mantencion/equipos/veh-1",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))
// La cabecera vive en el contexto del shell; acá sólo importa el contenido de la ficha.
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
}))
// Las acciones de servidor traen consigo la base de datos; esta prueba sólo mira lo que la ficha dibuja.
vi.mock("@/app/(app)/mantencion/equipos/actions", () => ({ updateEquipmentPlanAction: vi.fn(async () => ({ ok: false })) }))
vi.mock("@/app/(app)/mantencion/equipos/[id]/actions", () => ({ exportEquipmentHistoryAction: vi.fn() }))
vi.mock("@/app/(app)/mantencion/ot/actions", () => ({ createWorkOrderAction: vi.fn() }))

import { EquipmentDetailView } from "./equipment-detail-view"

const purchase: VehiclePurchaseRecord = {
  requestItemId: "item-1", requestId: "req-1", requestCode: "REP-2026-0042", requestType: "repuestos", itemName: "Filtro hidráulico",
  productId: null, sku: null, partNumber: null, isSparePart: false, quantity: 2, unitOfMeasure: "unidad", itemStatus: "purchased", itemStatusLabel: "Pendiente de recepción", workOrderId: "ot-1",
  workOrderFolio: "OT-BIO-0007", requestedAt: "2026-11-02T15:00:00.000Z", requesterName: "Alexis Morales", orderId: "oc-1",
  orderCode: "OC-2026-0310", orderStatus: "sent", unitPrice: 20_000, subtotal: 40_000, personalUse: false,
}

function data(overrides: Partial<EquipmentDetailData> = {}): EquipmentDetailData {
  return {
    vehicleId: "veh-1", code: "KA-107", plate: "DCHR-67", noPlate: false, typeName: "Camión", unit: "km", brandName: "Ford Cargo", model: "Ford Cargo 5032 E", year: 2011,
    worksiteName: "Santa Fe", schedule: { id: "s1", name: "Camiones y tractos" }, retired: false, retiredReason: null, initialReading: { value: 90_000, date: "2026-09-01" },
    status: {
      state: "al_dia", currentReading: { value: 98_300, date: "2026-10-27" }, nextReading: 100_000, remaining: 1_700, nextIntervalValue: 20_000,
      lastPreventive: { reading: 80_000, date: "2026-09-29", intervalValue: 40_000 },
    },
    workshop: null, recordCount: 1, life: { rows: [], totals: { active: 0, activeCorrective: 0, activePreventive: 0, activeHours: 0, voided: 0 }, hasMore: false, limit: 20 },
    gpsStatus: null, gpsReadingAt: null,
    insurance: { policyNumber: null, expiresAt: null, state: "sin_fecha", days: null, documents: [], hasData: false }, canViewFleet: true, history: [],
    purchases: null, purchaseLinks: { canOpenRequests: false, canOpenOrders: false, canOpenSpareParts: false, newRequestHref: null },
    ...overrides,
  }
}

const HEADER = { title: "KA-107", description: "Camión · Santa Fe · Operativo", breadcrumb: [{ label: "Equipos", href: "/mantencion/equipos" }, { label: "KA-107" }] }

const view = (overrides: Partial<EquipmentDetailData> = {}) => (
  <EquipmentDetailView data={data(overrides)} edit={null} canSeeSchedules={false} canExport={false} justCreated={false} header={HEADER} />
)

afterEach(cleanup)

describe("ficha del equipo: «Repuestos y servicios comprados»", () => {
  it("sin la capacidad de ver compras (purchases null) la tarjeta no se dibuja", () => {
    render(view())
    expect(screen.queryByRole("heading", { name: "Repuestos y servicios comprados" })).toBeNull()
    expect(screen.queryByText("Sin compras vinculadas")).toBeNull()
  })

  it("con compras las lista y enlaza según los permisos que trae la ficha", () => {
    render(view({
      purchases: [purchase],
      purchaseLinks: { canOpenRequests: true, canOpenOrders: true, canOpenSpareParts: false, newRequestHref: "/solicitudes/nueva?tipo=repuestos&vehiculo=veh-1" },
    }))
    expect(screen.getByRole("heading", { name: "Repuestos y servicios comprados" })).toBeDefined()
    expect(screen.getByRole("link", { name: "REP-2026-0042" }).getAttribute("href")).toBe("/solicitudes/req-1")
    expect(screen.getByRole("link", { name: "OC-2026-0310" }).getAttribute("href")).toBe("/compras/oc-1")
    expect(screen.getByRole("link", { name: "Pedir repuestos" }).getAttribute("href")).toBe("/solicitudes/nueva?tipo=repuestos&vehiculo=veh-1")
  })

  it("sin compras y con permiso ofrece pedir repuestos; sin permiso lo dice en texto", () => {
    render(view({ purchases: [], purchaseLinks: { canOpenRequests: false, canOpenOrders: false, canOpenSpareParts: false, newRequestHref: "/solicitudes/nueva?tipo=repuestos&vehiculo=veh-1" } }))
    expect(screen.getByText("Sin compras vinculadas")).toBeDefined()
    expect(screen.getByRole("link", { name: "Pedir repuestos" })).toBeDefined()
    cleanup()
    render(view({ purchases: [] }))
    expect(screen.getByText("Nadie ha pedido repuestos ni servicios para este equipo.")).toBeDefined()
    expect(screen.queryByRole("link", { name: "Pedir repuestos" })).toBeNull()
  })

  it("el permiso del catálogo llega a la tarjeta: con repuestos:catalog el repuesto enlaza a su ficha; sin él, sólo muestra su identidad", () => {
    const catalogado: VehiclePurchaseRecord = { ...purchase, productId: "prod-1", sku: "RPT-001", partNumber: "1R-0750", isSparePart: true }
    const links = { canOpenRequests: true, canOpenOrders: true, newRequestHref: null }
    render(view({ purchases: [catalogado], purchaseLinks: { ...links, canOpenSpareParts: true } }))
    expect(screen.getByRole("link", { name: "Filtro hidráulico" }).getAttribute("href")).toBe("/mantencion/repuestos/prod-1")
    expect(screen.getByText((_, element) => element?.textContent === "RPT-001 · N° de parte 1R-0750" && element.children.length === 2)).toBeDefined()
    cleanup()
    render(view({ purchases: [catalogado], purchaseLinks: { ...links, canOpenSpareParts: false } }))
    expect(screen.queryByRole("link", { name: "Filtro hidráulico" })).toBeNull()
    expect(screen.getByText((_, element) => element?.textContent === "RPT-001 · N° de parte 1R-0750" && element.children.length === 2)).toBeDefined()
  })
})

describe("ficha del equipo: crear una orden de trabajo y el enlace a Flota", () => {
  const newOrder = {
    equipment: [{ id: "veh-1", code: "KA-107", plate: "DCHR-67", typeName: "Camión", worksiteId: "ws-1", worksiteName: "Santa Fe", unit: "km" as const }],
    mechanics: null,
    worksiteMechanics: [{ id: "m-1", name: "Javier Roa", worksiteId: "ws-1" }],
    today: "2026-11-13",
    defaultRequesterName: "Ana Pérez",
    defaultVehicleId: "veh-1",
  }

  it("«Crear orden de trabajo» abre el formulario con el equipo ya elegido", async () => {
    render(<EquipmentDetailView data={data()} edit={null} canSeeSchedules={false} canExport={false} justCreated={false} newOrder={newOrder} header={HEADER} />)
    fireEvent.click(screen.getByRole("button", { name: /Crear orden de trabajo/ }))
    const sheet = within(await screen.findByRole("dialog"))
    expect((sheet.getByRole("combobox", { name: /Equipo/ }) as HTMLInputElement).value).toContain("KA-107")
    // Con el equipo elegido, el botón de crear no queda apagado por falta de equipo.
    // La faena de imputación es la del equipo y se muestra de sólo lectura (Trinorma, R4).
    expect((sheet.getByLabelText("Faena de imputación") as HTMLInputElement).value).toBe("Santa Fe")
  })

  it("sin permiso para crear órdenes (o con el equipo dado de baja) no hay botón", () => {
    render(view())
    expect(screen.queryByRole("button", { name: /Crear orden de trabajo/ })).toBeNull()
  })

  it("la ficha no enlaza a «la ficha en Flota»: las dos son pestañas de la misma ficha (crítica 2026-11-15)", () => {
    render(view({ canViewFleet: true }))
    expect(screen.queryByRole("link", { name: /^Ver la ficha de .+ en Flota$/ })).toBeNull()
  })

  it("la cabecera y las pestañas son las de la ficha; el seguro sólo para quien no ve la pestaña Flota", () => {
    const { unmount } = render(<EquipmentDetailView data={data()} edit={null} canSeeSchedules={false} canExport={false} justCreated={false} header={HEADER} tabs={<nav aria-label="Ficha de KA-107" />} showInsurance={false} />)
    expect(screen.getByRole("heading", { level: 1, name: "KA-107" })).toBeDefined()
    expect(screen.getByRole("navigation", { name: "Ficha de KA-107" })).toBeDefined()
    expect(screen.queryByRole("heading", { name: "Seguro" })).toBeNull()
    unmount()
    render(view())
    expect(screen.getByRole("heading", { name: "Seguro" })).toBeDefined()
  })

  it("«Editar mantención» cambia la columna por la pauta, la lectura y la baja; «Editar vehículo» llega de la ficha (paso 4b)", () => {
    const edit = {
      schedules: [{ id: "s1", name: "Camiones y tractos", unit: "km" as const, intervalCount: 5 }],
      initial: { scheduleId: "s1", initialReading: "90.000", initialReadingDate: "2026-09-01", retired: false, retiredReason: "" },
    }
    render(
      <EquipmentDetailView
        data={data()} edit={edit} canSeeSchedules={false} canExport={false} justCreated={false} header={HEADER}
        fichaActions={<button type="button">Editar vehículo</button>}
      />,
    )
    expect(screen.queryByRole("button", { name: "Editar ficha" })).toBeNull()
    expect(screen.getByRole("button", { name: "Editar vehículo" })).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Editar mantención" }))
    const form = screen.getByRole("form", { name: "Editar mantención" })
    expect(within(form).getByRole("combobox", { name: /^Pauta de mantención/ })).toBeDefined()
    expect(within(form).queryByLabelText(/^Código interno/)).toBeNull()
    // Con registros la lectura inicial queda fija.
    expect((within(form).getByLabelText(/^Lectura actual/) as HTMLInputElement).readOnly).toBe(true)
    fireEvent.click(within(form).getByRole("button", { name: "Cancelar" }))
    expect(screen.queryByRole("form", { name: "Editar mantención" })).toBeNull()
  })

  it("sin permiso para administrar equipos no hay «Editar mantención»", () => {
    render(view())
    expect(screen.queryByRole("button", { name: "Editar mantención" })).toBeNull()
  })
})

describe("ficha del equipo: preventiva declarada, anterior a la plataforma", () => {
  const prior = { date: "2026-03-10", reading: 60_000, intervalValue: 20_000, evidence: "OT-1234", declaredByName: "Marta Rojas", source: "Editar mantención" }

  it("si manda la declarada, dice «Declarada, anterior a la plataforma», el respaldo y quién la declaró; nunca un folio", () => {
    render(view({
      status: { ...data().status, lastPreventive: { reading: 60_000, date: "2026-03-10", intervalValue: 20_000, origin: "declarada", evidence: "OT-1234" } },
      priorPreventive: prior,
    }))
    expect(screen.getByText("Declarada, anterior a la plataforma")).toBeDefined()
    expect(screen.getByText(/Respaldo: OT-1234/)).toBeDefined()
    expect(screen.getByText(/Declarada por Marta Rojas/)).toBeDefined()
    expect(screen.queryByText(/Folio/)).toBeNull()
    expect(screen.queryByText("Preventiva declarada")).toBeNull()
  })

  it("la firmada muestra su folio y, si hay una declarada guardada que ya no manda, ésta sale aparte y rotulada", () => {
    render(view({
      status: { ...data().status, lastPreventive: { reading: 80_000, date: "2026-09-29", intervalValue: 40_000, origin: "firmada", evidence: "MANT-BIO-0012" } },
      priorPreventive: prior,
    }))
    expect(screen.getByText("Folio MANT-BIO-0012")).toBeDefined()
    expect(screen.getByText("Preventiva declarada")).toBeDefined()
    expect(screen.getByText("Declarada, anterior a la plataforma")).toBeDefined()
    expect(screen.getByText(/Respaldo: OT-1234/)).toBeDefined()
  })

  it("«Editar mantención» trae la sección con lo guardado, el servicio de la pauta y la marca de que la sección viene", () => {
    const edit = {
      schedules: [{ id: "s1", name: "Camiones y tractos", unit: "km" as const, intervalCount: 2 }],
      initial: { scheduleId: "s1", initialReading: "90.000", initialReadingDate: "2026-09-01", retired: false, retiredReason: "" },
      scheduleIntervals: { s1: [20_000, 40_000] },
      priorPreventive: { date: "2026-03-10", reading: "60.000", interval: "20000", evidence: "OT-1234" },
    }
    render(<EquipmentDetailView data={data({ priorPreventive: prior })} edit={edit} canSeeSchedules={false} canExport={false} justCreated={false} header={HEADER} />)
    fireEvent.click(screen.getByRole("button", { name: "Editar mantención" }))
    const form = screen.getByRole("form", { name: "Editar mantención" })
    expect(within(form).getByText("Preventiva anterior a la plataforma (declarada)")).toBeDefined()
    expect(within(form).getByText(/no un registro firmado/)).toBeDefined()
    expect((form.querySelector('input[name="priorPreventiveForm"]') as HTMLInputElement).value).toBe("1")
    expect((within(form).getByLabelText(/^Respaldo/) as HTMLInputElement).value).toBe("OT-1234")
    expect((within(form).getByLabelText(/^Lectura de la preventiva/) as HTMLInputElement).value).toBe("60.000")
    expect((form.querySelector('input[name="priorPreventiveInterval"]') as HTMLInputElement).value).toBe("20000")
    expect((form.querySelector('input[name="priorPreventiveDate"]') as HTMLInputElement).value).toBe("2026-03-10")
  })

  it("sin pauta la sección lo dice y no deja elegir el servicio", () => {
    const edit = {
      schedules: [],
      initial: { scheduleId: "", initialReading: "", initialReadingDate: "", retired: false, retiredReason: "" },
    }
    render(<EquipmentDetailView data={data({ schedule: null })} edit={edit} canSeeSchedules={false} canExport={false} justCreated={false} header={HEADER} />)
    fireEvent.click(screen.getByRole("button", { name: "Editar mantención" }))
    const form = screen.getByRole("form", { name: "Editar mantención" })
    expect(within(form).getByText(/no tiene pauta: asígnale una/)).toBeDefined()
    expect(within(form).getByRole("combobox", { name: /^Servicio de la pauta/ }).hasAttribute("disabled")).toBe(true)
  })
})
