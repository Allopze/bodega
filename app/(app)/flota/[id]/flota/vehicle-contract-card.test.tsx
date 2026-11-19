// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { VehicleAssignmentRow } from "@/lib/services/contracts/assignments"
import { VehicleContractCard } from "./vehicle-contract-card"

const action = vi.hoisted(() => ({ change: vi.fn() }))
vi.mock("../../actions", () => ({ changeVehicleContractAction: action.change }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

const TODAY = "2026-11-18"

// Más reciente primero, como lo entrega `listVehicleAssignmentHistory`.
const history: VehicleAssignmentRow[] = [
  { id: "a2", contractId: "c2", contractName: "Residuos Santa Fe", contractCode: "CTR-2026-0002", validFrom: "2026-09-01", validTo: null, reason: null },
  { id: "a1", contractId: "c1", contractName: "Cosecha Santa Fe", contractCode: "CTR-2026-0001", validFrom: "2026-03-01", validTo: "2026-08-31", reason: "Cambio de servicio" },
]
const contractOptions = [
  { id: "c1", name: "Cosecha Santa Fe", code: "CTR-2026-0001" },
  { id: "c2", name: "Residuos Santa Fe", code: "CTR-2026-0002" },
]

function renderCard(props: Partial<React.ComponentProps<typeof VehicleContractCard>> = {}) {
  return render(
    <VehicleContractCard
      vehicleId="veh-1"
      vehicleLabel="KA-90 · BPDH-67"
      history={history}
      contractOptions={contractOptions}
      today={TODAY}
      canChange
      {...props}
    />,
  )
}

describe("VehicleContractCard · tarjeta de la ficha", () => {
  it("muestra el contrato vigente y el historial", () => {
    renderCard()

    const card = screen.getByRole("heading", { name: "Contrato" }).closest("div")!.parentElement!
    expect(within(card).getByText("Residuos Santa Fe")).toBeInTheDocument()
    expect(within(card).getByText("Vigente")).toBeInTheDocument()
    expect(within(card).getByText(/desde 01-09-2026/)).toBeInTheDocument()

    // El historial lista los contratos anteriores con su vigencia, sin repetir el de hoy.
    const items = within(within(card).getByRole("list")).getAllByRole("listitem")
    expect(items).toHaveLength(1)
    expect(items[0]!.textContent).toContain("Cosecha Santa Fe")
    expect(items[0]!.textContent).toContain("Cambio de servicio")
    expect(items[0]!.textContent).toContain("01-03-2026")
    expect(items[0]!.textContent).toContain("hasta 31-08-2026")
  })

  it("sin asignación que cubra hoy dice «Sin contrato» y conserva la historia", () => {
    renderCard({ history: [{ ...history[1]!, validTo: "2026-08-31" }] })

    expect(screen.getByText("Sin contrato")).toBeInTheDocument()
    expect(screen.queryByText("Vigente")).toBeNull()
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(1)
  })

  it("sin permiso no muestra «Cambiar contrato»", () => {
    renderCard({ canChange: false })

    expect(screen.queryByRole("button", { name: "Cambiar contrato" })).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("elegir «Sin contrato» envía contractId vacío", async () => {
    renderCard()

    fireEvent.click(screen.getByRole("button", { name: "Cambiar contrato" }))
    const dialog = await screen.findByRole("dialog", { name: "Cambiar contrato" })
    expect(within(dialog).getByText("KA-90 · BPDH-67")).toBeInTheDocument()

    const form = dialog.querySelector("form")!
    // Parte en el contrato vigente: nada que guardar todavía.
    expect(new FormData(form).get("contractId")).toBe("c2")
    expect(within(dialog).getByRole("button", { name: "Guardar" })).toBeDisabled()

    fireEvent.click(within(dialog).getByRole("combobox", { name: "Contrato" }))
    fireEvent.click(screen.getByRole("option", { name: "Sin contrato" }))

    const data = new FormData(form)
    expect(data.get("contractId")).toBe("")
    expect(data.get("vehicleId")).toBe("veh-1")
    expect(data.get("validFrom")).toBe(TODAY)
    expect(within(dialog).getByRole("button", { name: "Guardar" })).toBeEnabled()
    // Dice cuándo termina el contrato que rige hoy.
    expect(within(dialog).getByText("El contrato actual termina el 17-11-2026.")).toBeInTheDocument()
  })
})
