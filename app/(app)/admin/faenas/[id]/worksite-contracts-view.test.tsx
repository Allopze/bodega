// @vitest-environment jsdom
import type * as React from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { WorksiteContractView } from "@/lib/services/contracts/worksite-view"
import { WorksiteContractsView } from "./worksite-contracts-view"

const actions = vi.hoisted(() => ({ save: vi.fn(), mandante: vi.fn(), assign: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/faenas/ws-1",
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock("./contract-actions", () => ({
  saveOperationalContractAction: actions.save,
  createMandanteAction: actions.mandante,
  assignVehiclesAction: actions.assign,
}))
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, description, actions: headerActions }: { title: string; description?: string; actions?: React.ReactNode }) => (
    <header><h1>{title}</h1><p>{description}</p>{headerActions}</header>
  ),
}))

afterEach(() => { cleanup(); vi.clearAllMocks() })

const TODAY = "2026-11-18"
const mandantes = { clients: [{ id: "cl-1", rut: "76543210-K", name: "Maderas Arauco" }], suggestions: [] }

const view: WorksiteContractView = {
  worksite: { id: "ws-1", name: "Cholguan - Arauco", code: "CHO" },
  contracts: [
    {
      id: "c-1", code: "CTR-2026-0001", name: "Movimiento de residuos", clientId: "cl-1", clientName: "Maderas Arauco",
      startDate: "2026-03-01", endDate: null, status: "active",
      vehicles: [{ id: "v-9", code: "CR-52", plate: "ABCD12", typeName: "Cargador", validFrom: "2026-03-01" }],
    },
    {
      id: "c-2", code: "CTR-2025-0003", name: "Carga de madera 2025", clientId: "cl-1", clientName: "Maderas Arauco",
      startDate: "2025-01-01", endDate: "2025-12-31", status: "closed", vehicles: [],
    },
  ],
  unassignedVehicles: [
    { id: "v-1", code: "GR-10", plate: "IJKL56", typeName: "Grúa" },
    { id: "v-2", code: "TO-37", plate: "EFGH34", typeName: "Tolva" },
  ],
  assignableVehicles: [
    { id: "v-1", code: "GR-10", plate: "IJKL56", typeName: "Grúa", currentContractName: null },
    { id: "v-2", code: "TO-37", plate: "EFGH34", typeName: "Tolva", currentContractName: null },
    { id: "v-9", code: "CR-52", plate: "ABCD12", typeName: "Cargador", currentContractName: "Movimiento de residuos" },
  ],
}

function renderView(overrides: Partial<React.ComponentProps<typeof WorksiteContractsView>> = {}) {
  return render(<WorksiteContractsView view={view} mandantes={mandantes} canAssign today={TODAY} {...overrides} />)
}

describe("WorksiteContractsView", () => {
  it("muestra cada contrato con su mandante y equipos, y los equipos sin contrato aparte", () => {
    renderView()

    const card = screen.getByRole("region", { name: "Movimiento de residuos" })
    expect(within(card).getByText("Maderas Arauco")).toBeInTheDocument()
    expect(within(card).getByText(/Vigente desde 01-03-2026/)).toBeInTheDocument()
    expect(within(card).getByRole("link", { name: "Ver ficha de CR-52" })).toHaveAttribute("href", "/flota/v-9/flota")
    expect(within(card).getByText("desde 01-03-2026")).toBeInTheDocument()

    const sinContrato = screen.getByRole("region", { name: "Sin contrato" })
    expect(within(sinContrato).getByText("GR-10")).toBeInTheDocument()
    expect(within(sinContrato).getByText("TO-37")).toBeInTheDocument()
    // Los cerrados quedan plegados bajo su propio rótulo.
    expect(screen.getByText("Contratos cerrados (1)")).toBeInTheDocument()
  })

  it("sin contratos muestra el estado vacío con «Nuevo contrato»", () => {
    renderView({ view: { ...view, contracts: [], unassignedVehicles: [] } })

    expect(screen.getByText("Esta faena no tiene contratos")).toBeInTheDocument()
    expect(screen.getByText("Crea un contrato por cada servicio que se presta aquí para separar sus equipos y costos.")).toBeInTheDocument()
    // Cabecera + estado vacío: dos accesos al mismo alta.
    expect(screen.getAllByRole("button", { name: "Nuevo contrato" })).toHaveLength(2)
    expect(screen.queryByRole("region", { name: "Sin contrato" })).toBeNull()
  })

  it("oculta «Asignar equipos» sin permiso de equipos", () => {
    renderView({ canAssign: false })

    expect(screen.queryByRole("button", { name: "Asignar equipos" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Asignar" })).toBeNull()
    const card = screen.getByRole("region", { name: "Movimiento de residuos" })
    expect(within(card).getByRole("button", { name: "Editar" })).toBeInTheDocument()
  })

  it("envía los equipos marcados y la fecha desde", async () => {
    actions.assign.mockResolvedValue({ ok: true, message: "2 equipos asignados", data: { warnings: [] } })
    renderView()

    fireEvent.click(screen.getByRole("button", { name: "Asignar equipos" }))
    const dialog = await screen.findByRole("dialog", { name: "Asignar equipos" })
    // El equipo que ya está en este contrato no se ofrece.
    expect(within(dialog).queryByRole("checkbox", { name: /CR-52/ })).toBeNull()
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /GR-10/ }))
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /TO-37/ }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Asignar 2 equipos" }))

    await waitFor(() => expect(actions.assign).toHaveBeenCalledTimes(1))
    expect(actions.assign).toHaveBeenCalledWith({ contractId: "c-1", vehicleIds: ["v-1", "v-2"], validFrom: "2026-11-18" })
  })
})
