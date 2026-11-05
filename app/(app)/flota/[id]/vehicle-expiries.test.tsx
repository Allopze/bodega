// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { VehicleExpiries } from "./vehicle-expiries"
import type { VehicleExpiryRow } from "./vehicle-expiries-sheet"

const action = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock("../actions", () => ({ updateVehicleExpiriesAction: action.update }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

const TODAY = "2026-11-05"
const rows: VehicleExpiryRow[] = [
  { field: "soapExpiresAt", label: "SOAP", declared: "2027-03-31", documentExpiresAt: null },
  { field: "circulationPermitExpiresAt", label: "Permiso de circulación", declared: null, documentExpiresAt: null },
  { field: "technicalReviewExpiresAt", label: "Revisión técnica", declared: "2026-11-01", documentExpiresAt: null },
  { field: "insuranceExpiresAt", label: "Seguro", declared: null, documentExpiresAt: "2026-11-20" },
]

function renderCard(canEdit = true) {
  render(<VehicleExpiries vehicleId="veh-1" vehicleLabel="KA-90 · BPDH-67" rows={rows} today={TODAY} warningDays={30} canEdit={canEdit} />)
}

describe("VehicleExpiries · tarjeta de la ficha", () => {
  it("ordena por urgencia sin alterar el orden fijo que usa la hoja", () => {
    renderCard()

    const items = within(screen.getByRole("list", { name: "Vencimientos del equipo" })).getAllByRole("listitem")
    // Vencido, por vencer (documento), vigente, sin fecha.
    expect(items.map((item) => item.querySelector("p")?.textContent)).toEqual([
      "Revisión técnica", "Seguro", "SOAP", "Permiso de circulación",
    ])
    expect(rows.map((row) => row.field)).toEqual(["soapExpiresAt", "circulationPermitExpiresAt", "technicalReviewExpiresAt", "insuranceExpiresAt"])
  })

  it("dice «según documento subido» solo donde la fecha no es del equipo", () => {
    renderCard()

    expect(screen.getAllByText("según documento subido")).toHaveLength(1)
    const seguro = screen.getByText("Seguro").closest("li")!
    expect(within(seguro).getByText("según documento subido")).toBeInTheDocument()
  })

  it("sin permiso no hay acciones ni hoja", () => {
    renderCard(false)

    expect(screen.queryByRole("button", { name: /^Actualizar/ })).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("«Actualizar» abre la hoja con el foco en el campo de esa fila", async () => {
    renderCard()

    fireEvent.click(screen.getByRole("button", { name: "Actualizar Revisión técnica" }))

    const dialog = await screen.findByRole("dialog", { name: "Actualizar vencimientos" })
    expect(within(dialog).getByText("KA-90 · BPDH-67")).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement?.id).toBe("vehicle-expiry-technicalReviewExpiresAt"))
  })

  it("la hoja muestra las cuatro fechas en el orden de la ficha, con lo que quedará", async () => {
    renderCard()
    fireEvent.click(screen.getByRole("button", { name: "Actualizar SOAP" }))

    const dialog = await screen.findByRole("dialog", { name: "Actualizar vencimientos" })
    const labels = ["SOAP", "Permiso de circulación", "Revisión técnica", "Seguro"]
    for (const label of labels) {
      expect(within(dialog).getByText(label, { selector: "label" })).toBeInTheDocument()
    }
    expect(within(dialog).getAllByText("Quedará:")).toHaveLength(4)
    // El seguro no tiene fecha propia: queda la del documento subido, y la hoja lo dice.
    expect(within(dialog).getByText("según documento subido")).toBeInTheDocument()
  })

  it("«Guardar» está apagado hasta que algo cambia, y «Quitar fecha» actualiza lo que quedará", async () => {
    renderCard()
    fireEvent.click(screen.getByRole("button", { name: "Actualizar SOAP" }))
    const dialog = await screen.findByRole("dialog", { name: "Actualizar vencimientos" })

    const save = within(dialog).getByRole("button", { name: "Guardar" })
    expect(save).toBeDisabled()

    fireEvent.click(within(dialog).getByRole("button", { name: "Quitar fecha de SOAP" }))

    expect(save).toBeEnabled()
    // El campo vacío viaja vacío: el servidor lo guarda como «sin fecha».
    expect(new FormData(dialog.querySelector("form")!).get("soapExpiresAt")).toBe("")
  })
})
