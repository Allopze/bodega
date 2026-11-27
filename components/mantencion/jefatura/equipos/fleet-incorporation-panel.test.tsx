// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import type { IncorporationCandidate } from "@/lib/services/mantencion/fleet-incorporation"

/*
 * «Incorporar desde la flota» pregunta la unidad por fila y para los marcados (2026-11-26). Cada vehículo nace con la
 * unidad de su tipo; la pauta sigue la unidad elegida y se suelta si ya no calza; el pedido al servidor lleva la unidad.
 */

Element.prototype.scrollIntoView = function scrollIntoView() {}
Element.prototype.hasPointerCapture = () => false
Element.prototype.releasePointerCapture = () => {}

const incorporate = vi.hoisted(() => vi.fn())
vi.mock("@/app/(app)/mantencion/equipos/actions", () => ({ incorporateFleetAction: incorporate }))
// `PageHeader` usa el router de Next (no montado en jsdom); sólo importa el botón de acción que arma el panel.
vi.mock("@/components/ui/page-header", () => ({ PageHeader: ({ actions }: { actions?: ReactNode }) => <header>{actions}</header> }))
vi.mock("@/lib/toast", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

const { FleetIncorporationPanel } = await import("./fleet-incorporation-panel")

const candidate = (over: Partial<IncorporationCandidate>): IncorporationCandidate => ({
  vehicleId: "v-1", code: "KA-1", plate: "BCDF-12", typeName: "Camión", unit: "km", worksiteId: "w-1", worksiteName: "Santa Fe",
  fleetBrand: "Volvo", model: null, year: null, suggestedBrandId: "b-volvo", suggestedScheduleId: "s-km", blocker: null, ...over,
})
const CANDIDATES = [
  candidate({}),
  candidate({ vehicleId: "v-2", code: "EX-1", plate: "EX-1", typeName: "Excavadora", unit: "h", suggestedScheduleId: "s-h" }),
]
const SCHEDULES = [
  { id: "s-km", name: "Camiones y tractos", unit: "km" as const },
  { id: "s-h", name: "Maquinaria pesada", unit: "h" as const },
]

function renderPanel() {
  return render(
    <FleetIncorporationPanel
      candidates={CANDIDATES}
      brands={[{ id: "b-volvo", name: "Volvo" }]}
      schedules={SCHEDULES}
      today="2026-11-26"
    />,
  )
}

afterEach(() => { cleanup(); incorporate.mockReset() })

// La tabla y las tarjetas viven a la vez en el DOM (jsdom no aplica el CSS que oculta una): se usa la primera, la tabla.
const unitSelect = (code: string) => screen.getAllByRole("combobox", { name: `Unidad de ${code}` })[0]!
const scheduleSelect = (code: string) => screen.getAllByRole("combobox", { name: `Pauta de ${code}` })[0]!

async function pick(control: HTMLElement, option: RegExp | string) {
  fireEvent.click(control)
  await act(async () => { fireEvent.click(await screen.findByRole("option", { name: option })) })
}

describe("«Incorporar desde la flota»: la unidad por fila", () => {
  it("cada vehículo nace con la unidad de su tipo y con la pauta de esa unidad", () => {
    renderPanel()
    expect(unitSelect("KA-1").textContent).toContain("Kilómetros")
    expect(unitSelect("EX-1").textContent).toContain("Horas")
    expect(scheduleSelect("KA-1").textContent).toContain("Camiones y tractos")
    expect(scheduleSelect("EX-1").textContent).toContain("Maquinaria pesada")
  })

  it("cambiar la unidad de una fila suelta la pauta que ya no calza y avisa cuál es la del tipo", async () => {
    renderPanel()
    await pick(unitSelect("KA-1"), "Horas")
    expect(unitSelect("KA-1").textContent).toContain("Horas")
    expect(scheduleSelect("KA-1").textContent).not.toContain("Camiones y tractos")
    expect(screen.getAllByText(/El tipo se mide en kilómetros\./).length).toBeGreaterThan(0)
    // Las pautas que se ofrecen a esa fila son las de horas.
    fireEvent.click(scheduleSelect("KA-1"))
    expect(await screen.findByRole("option", { name: "Maquinaria pesada" })).toBeTruthy()
    expect(screen.queryByRole("option", { name: "Camiones y tractos" })).toBeNull()
  })

  it("el pedido al servidor lleva la unidad de cada fila: la elegida o, si no, la del tipo", async () => {
    incorporate.mockResolvedValue({ ok: true, message: "2 equipos incorporados", data: { incorporated: 2, rows: [] } })
    renderPanel()
    await pick(unitSelect("KA-1"), "Horas")
    for (const code of ["KA-1", "EX-1"]) fireEvent.click(screen.getAllByRole("checkbox", { name: `Incorporar ${code}` })[0]!)
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Incorporar 2 equipos" })) })
    expect(incorporate).toHaveBeenCalledTimes(1)
    const rows = (incorporate.mock.calls[0]![0] as { rows: Array<{ vehicleId: string; unit: string; scheduleId: string | null }> }).rows
    expect(rows.map((row) => [row.vehicleId, row.unit, row.scheduleId])).toEqual([["v-1", "h", null], ["v-2", "h", "s-h"]])
  })

  it("«Unidad para todos los marcados» cambia la unidad de los marcados y suelta su pauta", async () => {
    renderPanel()
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Incorporar KA-1" })[0]!)
    await pick(screen.getByRole("combobox", { name: "Unidad para todos los marcados" }), "Horas")
    expect(unitSelect("KA-1").textContent).toContain("Horas")
    expect(scheduleSelect("KA-1").textContent).not.toContain("Camiones y tractos")
    // El que no estaba marcado no cambia.
    expect(unitSelect("EX-1").textContent).toContain("Horas")
    await pick(unitSelect("EX-1"), "Kilómetros")
    expect(unitSelect("EX-1").textContent).toContain("Kilómetros")
    expect(unitSelect("KA-1").textContent).toContain("Horas")
  })
})
