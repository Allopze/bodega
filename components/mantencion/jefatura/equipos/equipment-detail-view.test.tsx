// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
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
vi.mock("@/app/(app)/mantencion/equipos/actions", () => ({ updateEquipmentAction: vi.fn() }))
vi.mock("@/app/(app)/mantencion/equipos/[id]/actions", () => ({ exportEquipmentHistoryAction: vi.fn() }))

import { EquipmentDetailView } from "./equipment-detail-view"

const purchase: VehiclePurchaseRecord = {
  requestItemId: "item-1", requestId: "req-1", requestCode: "REP-2026-0042", requestType: "repuestos", itemName: "Filtro hidráulico",
  productId: null, sku: null, partNumber: null, isSparePart: false, quantity: 2, unitOfMeasure: "unidad", itemStatus: "purchased", itemStatusLabel: "Pendiente de recepción", workOrderId: "ot-1",
  workOrderFolio: "OT-BIO-0007", requestedAt: "2026-11-02T15:00:00.000Z", requesterName: "Alexis Morales", orderId: "oc-1",
  orderCode: "OC-2026-0310", orderStatus: "sent", unitPrice: 20_000, subtotal: 40_000,
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
    insurance: { policyNumber: null, expiresAt: null, state: "sin_fecha", days: null, documents: [], hasData: false }, canViewFleet: true, history: [],
    purchases: null, purchaseLinks: { canOpenRequests: false, canOpenOrders: false, canOpenSpareParts: false, newRequestHref: null },
    ...overrides,
  }
}

const view = (overrides: Partial<EquipmentDetailData> = {}) => (
  <EquipmentDetailView data={data(overrides)} edit={null} canSeeSchedules={false} canExport={false} justCreated={false} />
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
