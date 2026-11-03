// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ detail: vi.fn() }))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(href) },
  notFound: () => { throw new Error("not found") },
}))
vi.mock("@/lib/auth/can", () => ({
  requirePermission: async () => ({ user: { id: "u1" } }),
  can: () => false,
}))
vi.mock("@/lib/services/fleet", () => ({ getFleetVehicleDetail: mocks.detail }))
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
  Breadcrumbs: () => null,
}))
vi.mock("./fleet-documents-panel", () => ({ FleetDocumentsPanel: () => null }))

import FlotaVehiclePage from "./page"

function detail(performanceUnit: string) {
  return {
    vehicle: {
      id: "veh-1", plate: "RBYD-98", brand: "Volvo", model: "FMX", year: 2020, type: "camion", code: null,
      equipmentType: { name: "Camión tolva" }, worksite: { name: "Biodiversa" }, serialNumber: null, performanceUnit,
      tankCapacityLiters: null, usualFuelSupplier: null, responsibleUser: null, operationalStatus: "operativo",
      soapExpiresAt: null, technicalReviewExpiresAt: null, circulationPermitExpiresAt: null, insuranceExpiresAt: null,
      insurancePolicyNumber: null, isActive: true, notes: null,
    },
    documents: [],
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

afterEach(() => { cleanup(); vi.clearAllMocks() })

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
