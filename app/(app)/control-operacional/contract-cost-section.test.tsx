// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { ContractCostBreakdown, ContractCostRow, WorksiteContractCosts } from "@/lib/services/contracts/contract-costs"
import { ContractCostSection } from "./contract-cost-section"

afterEach(cleanup)

const period = { from: "2026-11-01", to: "2026-11-30" }

const row = (overrides: Partial<ContractCostRow> = {}): ContractCostRow => ({
  kind: "contract", contractId: "c1", label: "Movimiento de residuos", clientName: "Maderas Arauco", status: "active",
  vehicleCount: 6, fuel: 15_100_000, workOrders: 1_000_000, purchases: 5_400_000, total: 21_500_000, partial: false,
  ...overrides,
})

const worksite = (overrides: Partial<WorksiteContractCosts> = {}): WorksiteContractCosts => ({
  worksiteId: "w1", worksiteName: "Cholguan - Arauco", total: 48_200_000, partial: false,
  rows: [
    row(),
    row({ contractId: "c2", label: "Carga y descarga de madera", vehicleCount: 9, fuel: 14_000_000, workOrders: 0, purchases: 5_800_000, total: 19_800_000 }),
    row({ kind: "unassigned", contractId: null, label: "Sin contrato", clientName: null, status: null, vehicleCount: 1, fuel: 1_900_000, workOrders: 0, purchases: 500_000, total: 2_400_000 }),
    row({ kind: "pending", contractId: null, label: "Por repartir", clientName: null, status: null, vehicleCount: 0, fuel: 0, workOrders: 0, purchases: 100_000, total: 100_000 }),
    row({ kind: "no_equipment", contractId: null, label: "Compras sin equipo", clientName: null, status: null, vehicleCount: 0, fuel: null, workOrders: null, purchases: 4_500_000, total: 4_500_000 }),
  ],
  ...overrides,
})

const breakdown = (overrides: Partial<ContractCostBreakdown> = {}): ContractCostBreakdown => ({
  worksites: [worksite(), worksite({ worksiteId: "w2", worksiteName: "Santa Fe", total: 100_000, rows: [row({ contractId: "c3", label: "Grúas", total: 100_000 })] })],
  availability: { fuel: true, workOrders: true, purchases: true },
  contractOptions: [], windows: [],
  ...overrides,
})

describe("ContractCostSection", () => {
  it("agrupa por faena con subtotal y filas Sin contrato, Por repartir y Compras sin equipo", () => {
    render(<ContractCostSection breakdown={breakdown()} period={period} selectedContractId={null} />)

    const section = screen.getByRole("region", { name: "Costo por contrato" })
    const tables = within(section).getAllByRole("table")
    expect(tables).toHaveLength(2)
    const first = tables[0]!
    // Subtotal de la faena en la fila de la faena.
    const worksiteRow = within(first).getByText("Cholguan - Arauco").closest("tr")!
    expect(worksiteRow.textContent).toContain("48.200.000")
    for (const label of ["Movimiento de residuos", "Carga y descarga de madera", "Sin contrato", "Por repartir", "Compras sin equipo"]) {
      expect(within(first).getByText(label)).toBeTruthy()
    }
    expect(within(first).getAllByText("Maderas Arauco").length).toBeGreaterThan(0)
    expect(within(tables[1]!).getByText("Santa Fe")).toBeTruthy()
    // Cabeceras de los tres componentes disponibles.
    const headers = within(first).getAllByRole("columnheader").map((header) => header.textContent)
    expect(headers).toEqual(["Contrato", "Mandante", "Equipos", "Combustible", "Mano de obra (OT)", "Compras", "Total"])
  })

  it("el nombre del contrato enlaza a ?contrato= conservando el período", () => {
    render(<ContractCostSection breakdown={breakdown()} period={period} selectedContractId={null} />)

    const link = screen.getByRole("link", { name: "Movimiento de residuos" })
    expect(link.getAttribute("href")).toBe("/control-operacional?desde=2026-11-01&hasta=2026-11-30&contrato=c1")
    // Las cubetas no son contratos: no son enlaces.
    expect(screen.queryByRole("link", { name: "Sin contrato" })).toBeNull()
  })

  it("marca el contrato elegido", () => {
    render(<ContractCostSection breakdown={breakdown()} period={period} selectedContractId="c2" />)
    expect(screen.getByRole("link", { name: "Carga y descarga de madera" }).getAttribute("aria-current")).toBe("true")
    expect(screen.getByRole("link", { name: "Movimiento de residuos" }).getAttribute("aria-current")).toBeNull()
  })

  it("marca «parcial» y muestra — cuando falta un componente", () => {
    const partial = breakdown({
      availability: { fuel: false, workOrders: true, purchases: true },
      worksites: [worksite({
        partial: true,
        rows: [row({ fuel: null, total: 6_400_000, partial: true })],
      })],
    })
    render(<ContractCostSection breakdown={partial} period={period} selectedContractId={null} />)

    expect(screen.getAllByText("parcial").length).toBeGreaterThan(0)
    // Sin permiso de combustible la columna ni se dibuja; el «—» aparece donde el dato falta de una fila disponible.
    expect(within(screen.getByRole("table")).queryByRole("columnheader", { name: "Combustible" })).toBeNull()
  })

  it("muestra — en lugar de $0 cuando un valor no está disponible", () => {
    const missing = breakdown({
      worksites: [worksite({ rows: [row({ fuel: null, total: 6_400_000, partial: true })] })],
    })
    render(<ContractCostSection breakdown={missing} period={period} selectedContractId={null} />)

    const contractRow = screen.getByRole("link", { name: "Movimiento de residuos" }).closest("tr")!
    expect(within(contractRow).getByText("—")).toBeTruthy()
    expect(contractRow.textContent).not.toContain("$0")
  })

  it("no se muestra sin faenas con contratos", () => {
    const { container } = render(
      <ContractCostSection breakdown={breakdown({ worksites: [] })} period={period} selectedContractId={null} />,
    )
    expect(container.innerHTML).toBe("")
  })

  it("no se muestra si ningún componente de costo está disponible", () => {
    const { container } = render(
      <ContractCostSection
        breakdown={breakdown({ availability: { fuel: false, workOrders: false, purchases: false } })}
        period={period}
        selectedContractId={null}
      />,
    )
    expect(container.innerHTML).toBe("")
  })
})
