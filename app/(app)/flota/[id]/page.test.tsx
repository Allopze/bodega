// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ detail: vi.fn(), can: vi.fn((..._args: unknown[]) => false) }))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(href) },
  notFound: () => { throw new Error("not found") },
}))
vi.mock("@/lib/auth/can", () => ({
  // `isGlobal` y `worksiteIds` los lee `canAccessWorksite` (alcance de la faena del equipo).
  requirePermission: async () => ({ user: { id: "u1", isGlobal: false, worksiteIds: ["ws-1"] } }),
  can: (...args: unknown[]) => mocks.can(...args),
}))
vi.mock("@/lib/services/fleet", () => ({ getFleetVehicleDetail: mocks.detail }))
vi.mock("@/lib/services/system-settings", () => ({ getFleetAdminSettings: async () => ({ warningDays: 30, defaultVehicleStatus: "operativo" }) }))
// La hoja «Actualizar vencimientos» importa la acción; su lógica tiene su propia prueba.
vi.mock("../actions", () => ({ updateVehicleExpiriesAction: vi.fn() }))
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
  Breadcrumbs: () => null,
}))
vi.mock("./fleet-documents-panel", () => ({ FleetDocumentsPanel: () => null }))

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

afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.can.mockReturnValue(false); vi.useRealTimers() })

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
