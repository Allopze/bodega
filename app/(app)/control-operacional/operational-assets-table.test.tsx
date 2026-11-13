// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { OperationalAsset } from "@/lib/services/operational-control"
import { OperationalAssetsTable } from "./operational-assets-table"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/control-operacional",
}))

afterEach(cleanup)

const asset = (overrides: Partial<OperationalAsset> = {}): OperationalAsset => ({
  key: "vehicle:v1", kind: "vehicle", id: "v1", code: "KA-115", name: "Camión · DZTH-66", plate: "DZTH-66", typeName: "Camión",
  worksiteId: "ws", worksiteName: "Faena Norte", operationalStatus: "mantencion", operationalStatusLabel: "En mantención", stateMismatch: false,
  capabilities: ["fuel", "inspections"], inspectionCount: 0, inspectionCompliancePercent: null, inspectionNonConforming: null, inspectionPartial: null,
  openFindings: 3, criticalOpenFindings: 2, openFindingsWithWorkOrder: 1, openFindingsWithoutWorkOrder: 2, overdueCapa: 0,
  nextExpiryDate: "2026-12-01", expiredDocumentTypes: [], gpsOdometer: null, gpsHourMeter: null, gpsObservedAt: null, gpsFuelLevel: null,
  gpsProvider: null, gpsProviders: [], gpsStale: false, gpsReportedAt: null, gpsOdometerAt: null, gpsHourMeterAt: null, gpsFuelLevelAt: null,
  gpsSpeedKph: null, gpsIgnition: null, gpsPerformanceValue: null, gpsPerformanceUnit: null, gpsPerformanceStatus: "not_applicable",
  gpsCostPerUnit: null, gpsMeterSource: null, gpsMeterProvider: null, gpsMaintenanceState: null, gpsMaintenanceNextReading: null,
  gpsMaintenanceRemaining: null, gpsMaintenanceReadingAt: null, fuelLiters: 150, fuelLoadCount: 3, lastFuelLoadAt: null,
  fuelPerformanceValue: 12.5, fuelPerformanceUnit: "km_per_liter", flaggedLoads: 1, openAnomalyCases: 5, criticalOpenAnomalyCases: 2,
  fuelBilledAmount: 50_000, maintenanceCost: 0, purchaseAmount: 0, totalCost: 50_000, idleHours: null, idlePct: null, litersIdle: null,
  meterMismatch: false, openWorkOrders: 2, inWorkshop: true, workshopHours: 10,
  ...overrides,
} as OperationalAsset)

const props = { canViewCosts: true, canViewInspections: true, canViewCapa: true, canViewFuel: true, canViewFleet: true, canViewWorkOrders: true, canViewPurchaseCosts: true, canViewMaintenance: true }

describe("OperationalAssetsTable", () => {
  it("por defecto muestra seis columnas más las acciones; el resto queda en «Columnas»", () => {
    render(<OperationalAssetsTable assets={[asset()]} {...props} />)

    const table = screen.getByRole("table", { name: "Activos operacionales" })
    const headers = within(table).getAllByRole("columnheader").map((header) => (header.textContent ?? "").replace(/^Ordenar por /, "").trim())
    expect(headers).toEqual(["Vehículo", "Faena", "Estado", "Próximo vencimiento", "OT abiertas", "Casos abiertos", "Acciones"])
  })

  it("cada fila emite una celda por columna declarada, con cualquier combinación de permisos (la tabla oculta por posición)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const combos = [
      props,
      { ...props, canViewCosts: false, canViewPurchaseCosts: false },
      { ...props, canViewFuel: false, canViewCapa: false },
      { ...props, canViewFleet: false, canViewWorkOrders: false, canViewMaintenance: false },
      { canViewCosts: false, canViewInspections: false, canViewCapa: false, canViewFuel: true, canViewFleet: false },
    ]
    for (const permissions of combos) {
      render(<OperationalAssetsTable assets={[asset()]} {...permissions} />)
      cleanup()
    }
    expect(warn.mock.calls.filter(([message]) => String(message).includes("[DataTable]"))).toEqual([])
    warn.mockRestore()
  })

  it("identifica el vehículo con su código, su tipo y su patente, con un enlace real a la ficha", () => {
    render(<OperationalAssetsTable assets={[asset()]} {...props} />)

    const table = screen.getByRole("table", { name: "Activos operacionales" })
    expect(within(table).getAllByRole("link", { name: "Ver ficha de KA-115" }).every((link) => link.getAttribute("href") === "/flota/v1")).toBe(true)
    expect(within(table).getByText("Camión · DZTH-66")).toBeTruthy()
    // La fila ya no repite «Vehículo / equipo móvil».
    expect(screen.queryByText("Vehículo / equipo móvil")).toBeNull()
  })

  it("el estado usa el vocabulario de flota y los casos críticos se dicen con texto", () => {
    render(<OperationalAssetsTable assets={[asset()]} {...props} />)

    const table = screen.getByRole("table", { name: "Activos operacionales" })
    expect(within(table).getByText("En mantención")).toBeTruthy()
    // Los casos críticos (visibles) y los hallazgos críticos (en «Columnas») dicen «2 críticos» con texto.
    expect(within(table).getAllByText("2 críticos").length).toBeGreaterThan(0)
  })

  it("las acciones nombran el vehículo: «Combustible de KA-115» y «Ver ficha de KA-115»", () => {
    render(<OperationalAssetsTable assets={[asset()]} {...props} />)

    const table = screen.getByRole("table", { name: "Activos operacionales" })
    expect(within(table).getByRole("link", { name: "Combustible de KA-115" }).getAttribute("href")).toBe("/combustibles/consumo/equipos/v1")
  })

  it("la tarjeta móvil lleva identidad, estado, seis datos y «Ver ficha»", () => {
    render(<OperationalAssetsTable assets={[asset()]} {...props} />)

    const card = screen.getAllByRole("article")[0]!
    for (const label of ["Faena", "Próximo vencimiento", "OT abiertas", "Casos abiertos", "Litros del período", "Rendimiento promedio"]) {
      expect(within(card).getByText(label)).toBeTruthy()
    }
    expect(within(card).getByRole("link", { name: "Ver ficha de KA-115" })).toBeTruthy()
    expect(within(card).queryByText("Cumplimiento inspecciones")).toBeNull()
  })

  it("un vehículo dado de baja figura «Inactivo»", () => {
    render(<OperationalAssetsTable assets={[asset({ operationalStatus: "inactivo", operationalStatusLabel: "Inactivo" })]} {...props} />)
    expect(within(screen.getByRole("table", { name: "Activos operacionales" })).getByText("Inactivo")).toBeTruthy()
  })

  it("la revisión de medidores GPS abre con su columna visible", () => {
    render(<OperationalAssetsTable assets={[asset({ meterMismatch: true })]} {...props} showMeterMismatch />)
    const headers = within(screen.getByRole("table", { name: "Activos operacionales" })).getAllByRole("columnheader").map((header) => header.textContent)
    expect(headers).toContain("Discrepancia GPS")
  })
})
