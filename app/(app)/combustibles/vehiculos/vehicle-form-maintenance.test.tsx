// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PadronMaintenance } from "@/lib/mantencion/padron-identity"

/**
 * El formulario del padrón con un vehículo que está en Mantención (crítica 2026-11-15, paso 4b):
 * la identidad se edita sólo aquí, con las reglas de Mantención. Lo que el servidor exige lo
 * fija `padron-identidad-mantencion-pglite.test.ts`; aquí, que el formulario lo ofrezca.
 */

const update = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({ createFuelVehicleAction: vi.fn(), updateFuelVehicleAction: update }))
vi.mock("@/lib/toast", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

import { VehicleForm, type VehicleForEdit } from "./vehicle-form"

const VEHICLE: VehicleForEdit = {
  id: "veh-1", plate: "RSTV-12", code: "KA-800", type: "camion", equipmentTypeId: "t-km", meterType: "odometer", performanceUnit: "km_per_liter",
  tankCapacityLiters: null, comparisonGroup: null, usualFuelSupplierId: null, compatibleProductIds: ["fuel-diesel"], operatingSchedule: null,
  brand: "VOLVO FH", model: "FH 460", year: 2020, serialNumber: null, worksiteId: "ws-1", responsibleUserId: null, operationalStatus: "operativo",
  soapExpiresAt: null, technicalReviewExpiresAt: null, circulationPermitExpiresAt: null, insurancePolicyNumber: null, insuranceExpiresAt: null, notes: null,
}

const MAINTENANCE: PadronMaintenance = { brandId: "b-volvo", noPlate: false, unit: "km", unitFixedBy: { kind: "registros" }, canChangeProfile: true }

function renderForm(maintenance: PadronMaintenance | null) {
  return render(
    <VehicleForm
      open
      onClose={vi.fn()}
      worksites={[{ id: "ws-1", name: "Arauco" }]}
      users={[]}
      equipmentTypes={[{ id: "t-km", name: "Camión", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter", isActive: true }]}
      suppliers={[]}
      products={[{ id: "fuel-diesel", name: "Diésel", unit: "L", isActive: true }]}
      editVehicle={{ ...VEHICLE, maintenance }}
      maintenanceBrands={[{ id: "b-volvo", name: "Volvo", isActive: true }, { id: "b-old", name: "Marca vieja", isActive: false }]}
    />,
  )
}

const hidden = (name: string) => document.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)

afterEach(cleanup)

describe("padrón: vehículo en Mantención", () => {
  it("la marca es de la lista y el código es obligatorio; dice que sigue las reglas de Mantención", () => {
    renderForm(MAINTENANCE)
    expect(screen.getByText(/Está en Mantención: estos datos siguen sus reglas/)).toBeDefined()
    expect(screen.getByRole("combobox", { name: /^Marca/ })).toBeDefined()
    expect(document.querySelector('input[name="brand"]')).toBeNull()
    expect((screen.getByLabelText(/^Código interno/) as HTMLInputElement).value).toBe("KA-800")
    expect(screen.getByText(/ya tiene registros de mantención/)).toBeDefined()
  })

  it("«Sin patente» deja la patente en el código y lo envía", () => {
    renderForm(MAINTENANCE)
    expect(hidden("noPlate")?.value).toBe("0")
    fireEvent.click(screen.getByLabelText("Sin patente"))
    const plate = screen.getByLabelText(/^Patente/) as HTMLInputElement
    expect(plate.disabled).toBe(true)
    expect(plate.value).toBe("KA-800")
    expect(plate.getAttribute("name")).toBeNull()
    expect(hidden("noPlate")?.value).toBe("1")
  })

  it("sin permiso de Mantención la marca y «Sin patente» se ven pero no se cambian", () => {
    renderForm({ ...MAINTENANCE, canChangeProfile: false })
    expect((screen.getByLabelText("Sin patente") as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole("combobox", { name: /^Marca/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("La cambia quien administra los equipos de Mantención.")).toBeDefined()
  })
})

describe("padrón: vehículo que no está en Mantención", () => {
  it("la marca sigue en texto libre y no hay «Sin patente»", () => {
    renderForm(null)
    expect((document.querySelector('input[name="brand"]') as HTMLInputElement).value).toBe("VOLVO FH")
    expect(screen.queryByLabelText("Sin patente")).toBeNull()
    expect(screen.queryByText(/Está en Mantención/)).toBeNull()
  })
})

describe("un error de otra pestaña no queda escondido", () => {
  it("al volver con errores abre la pestaña que los tiene y la marca", async () => {
    update.mockResolvedValue({ ok: false, message: "Revisa los datos", fieldErrors: { compatibleProductIds: ["Selecciona al menos un producto compatible"] } })
    renderForm(MAINTENANCE)
    expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true")
    await act(async () => { fireEvent.submit(document.querySelector("form")!) })
    const fuel = screen.getByRole("tab", { name: /^Combustible\s*\(con errores\)$/ })
    expect(fuel.getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("alert").textContent).toBe("Selecciona al menos un producto compatible")
    // Después se puede volver a «General» sin que la devuelvan.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "General" }))
    expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true")
  })
})

describe("un guardado rechazado no borra lo escrito (CatalogFormSheet)", () => {
  it("el modelo nuevo sigue ahí después de que el servidor pide los productos", async () => {
    update.mockResolvedValue({ ok: false, message: "Revisa los datos", fieldErrors: { compatibleProductIds: ["Selecciona al menos un producto compatible"] } })
    renderForm(MAINTENANCE)
    fireEvent.change(screen.getByLabelText(/^Modelo/), { target: { value: "FH 540" } })
    // Con clic en el botón, como la persona: es el camino en que React vaciaba un `<form action>`.
    await act(async () => { screen.getByRole("button", { name: "Guardar cambios" }).click() })
    expect(update).toHaveBeenCalled()
    expect((screen.getByLabelText(/^Modelo/) as HTMLInputElement).value).toBe("FH 540")
    const sent = update.mock.calls.at(-1)![1] as FormData
    expect(sent.get("model")).toBe("FH 540")
  })
})
