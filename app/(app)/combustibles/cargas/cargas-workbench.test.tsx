// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { describeFuelPeriod } from "@/lib/combustibles/period/parse"
import type { EnrichedRow } from "../bitacora/bitacora-table"
import { CargasWorkbench } from "./cargas-workbench"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/combustibles/cargas",
}))
// El filtro y la tabla reales tienen sus propias pruebas: acá se mide la
// decisión de la mesa de trabajo entre «vacío» y «tabla» cuando falta el total.
vi.mock("./cargas-filters", () => ({ CargasFilters: () => <div data-testid="filtros" /> }))
vi.mock("../bitacora/bitacora-table", () => ({
  rowKey: (row: { source: string; id: string }) => `${row.source}:${row.id}`,
  BitacoraTable: ({ rows }: { rows: unknown[] }) => <table data-testid="bitacora"><tbody><tr><td>{rows.length} filas</td></tr></tbody></table>,
}))
vi.mock("../bitacora/export-button", () => ({ CargasExportButton: () => null }))
vi.mock("@/components/combustibles/add-fuel-data-button", () => ({ AddFuelDataButton: () => null }))
vi.mock("@/components/combustibles/fuel-header-actions", () => ({ FuelHeaderActions: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))
vi.mock("@/components/combustibles/fuel-breadcrumbs", () => ({ FuelBreadcrumbs: () => null }))
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <header><h1>{title}</h1><div>{actions}</div></header>
  ),
}))

const period = describeFuelPeriod({ kind: "month", year: 2026, month: 10 }, "url", "2026-10-31")

function row(overrides: Partial<EnrichedRow> = {}): EnrichedRow {
  return {
    id: "tae-1", detailId: "tae-1", source: "tae_pwa", occurredAt: "2026-10-01T12:00:00.000Z",
    worksiteName: "Faena A", supplierId: null, supplierName: null, loadingPointName: null,
    equipmentCode: "CC-1", plate: "AB-1234", equipmentTypeId: null, equipmentTypeName: "Camión",
    driverName: null, supervisorName: null, productId: null, productName: "Diésel",
    liters: 40, meterReading: 182310, meterLabel: "Odómetro", performanceValue: null, performanceUnit: null,
    sealRemoved: null, sealInstalled: null, evidenceCount: 4, notes: null, statusLabel: "submitted",
    createdByName: null, updatedByName: null, createdAt: null, updatedAt: null,
    anomalyCount: null, reviewMark: null, reviewMarkNotes: null, reviewMarkId: null, reviewMarkedBy: null,
    origin: "qr", worksiteId: "w-1", vehicleId: "veh-1", equipmentLoadId: "el-1", reviewFlagged: null, reviewFlagReason: null,
    hrefs: { detail: "/combustibles/cargas/terreno/tae-1", equipment: null, history: null, evidence: null, decide: null, requested: null, cases: null },
    ...overrides,
  } as EnrichedRow
}

function renderWorkbench({ rows, totalItems, filtered = false }: { rows: EnrichedRow[]; totalItems: number; filtered?: boolean }) {
  return render(
    <CargasWorkbench
      period={period}
      rows={rows}
      pagination={{ totalItems, from: totalItems === 0 ? 0 : 1, to: totalItems === 0 ? 0 : rows.length }}
      exportFilters={{}}
      canExport={false}
      canRegister
      addDataOptions={[]}
      lookups={{ worksites: [], suppliers: [], products: [], equipmentTypes: [], loadingPoints: [], anomalyRules: [], anomalyAssignees: [], equipmentLabel: null }}
      canViewPersonal={false}
      currentUserId="u-1"
      canWithdrawOthers={false}
      filtered={filtered}
    />,
  )
}

describe("CargasWorkbench: el conteo caído no esconde las filas (6.1)", () => {
  it("con total=0 y filas presentes pinta la tabla y avisa que falta el total", () => {
    renderWorkbench({ rows: [row()], totalItems: 0 })

    expect(screen.getByTestId("bitacora")).toBeInTheDocument()
    expect(screen.getByTestId("bitacora")).toHaveTextContent("1 filas")
    expect(screen.getByRole("status")).toHaveTextContent("No pudimos obtener el total de cargas")
    expect(screen.queryByText(/Aún no hay cargas/)).not.toBeInTheDocument()
    expect(screen.queryByText("Ninguna carga coincide con estos filtros")).not.toBeInTheDocument()
    // El encabezado tampoco afirma «Ninguna carga» cuando la tabla sí tiene filas.
    expect(screen.queryByText("Ninguna carga")).not.toBeInTheDocument()
    expect(screen.getByText(/mostrando/)).toHaveTextContent("mostrando 1 carga")
  })

  it("sin filas mantiene el estado vacío real", () => {
    renderWorkbench({ rows: [], totalItems: 0 })

    expect(screen.queryByTestId("bitacora")).not.toBeInTheDocument()
    expect(screen.getByText(/Aún no hay cargas/)).toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("sin filas y con filtros explica que no hay coincidencias", () => {
    renderWorkbench({ rows: [], totalItems: 0, filtered: true })

    expect(screen.getByText("Ninguna carga coincide con estos filtros")).toBeInTheDocument()
  })

  it("con el total disponible muestra la cifra y la tabla", () => {
    renderWorkbench({ rows: [row()], totalItems: 3 })

    expect(screen.getByTestId("bitacora")).toBeInTheDocument()
    expect(document.querySelector("p[aria-live]")).toHaveTextContent("3 cargas")
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })
})
