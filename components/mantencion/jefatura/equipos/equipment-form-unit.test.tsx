// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { EMPTY_EQUIPMENT_VALUES, type EquipmentFormCatalogs } from "./equipment-form-types"

/*
 * La unidad de un equipo la fijan el tipo y la faena (2026-11-25): los camiones y tractos de producción miden en
 * horas y los de Biodiversa en kilómetros. El servidor aplica esa regla al crear el equipo, así que el formulario
 * tiene que ofrecer las pautas de esa unidad y rotular la lectura inicial con ella; si no, dice «km» y sólo deja
 * elegir pautas en km para un equipo que el servidor crea en horas y rechaza esas pautas.
 */

vi.mock("@/lib/toast", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

const { EquipmentForm } = await import("./equipment-form")

const CATALOGS: EquipmentFormCatalogs = {
  types: [
    { id: "t-camion", name: "Camión", unit: "km", meterType: "odometer", family: "camiones" },
    { id: "t-camioneta", name: "Camioneta", unit: "km", meterType: "odometer", family: "cargadores_camionetas" },
  ],
  brands: [{ id: "b1", name: "Volvo" }],
  worksites: [
    { id: "w-sf", name: "Santa Fe", code: "SANTA-FE" },
    { id: "w-bio", name: "Biodiversa", code: "BIODIVERSA" },
  ],
  schedules: [
    { id: "s-km", name: "Camiones y tractos", unit: "km", intervalCount: 5 },
    { id: "s-h", name: "Maquinaria pesada", unit: "h", intervalCount: 4 },
  ],
}

const renderForm = (equipmentTypeId: string, worksiteId: string) => render(
  <EquipmentForm
    action={vi.fn(async () => ({ ok: false }))}
    catalogs={CATALOGS}
    initial={{ ...EMPTY_EQUIPMENT_VALUES, equipmentTypeId, worksiteId }}
    submitLabel="Crear equipo"
  />,
)

describe("«Nuevo equipo»: la unidad sale del tipo y de la faena", () => {
  it("un camión de producción se mide en horas: ofrece pautas y lectura inicial en horas", () => {
    renderForm("t-camion", "w-sf")
    expect(screen.getByText("Se mide en horas.")).toBeTruthy()
    expect(screen.getByText(/Sólo aparecen pautas en horas\./)).toBeTruthy()
    expect(screen.getByLabelText("Lectura inicial (h)")).toBeTruthy()
  })

  it("un camión de Biodiversa se mide en kilómetros", () => {
    renderForm("t-camion", "w-bio")
    expect(screen.getByText("Se mide en kilómetros.")).toBeTruthy()
    expect(screen.getByText(/Sólo aparecen pautas en kilómetros\./)).toBeTruthy()
    expect(screen.getByLabelText("Lectura inicial (km)")).toBeTruthy()
  })

  it("otro tipo mide como su tipo en cualquier faena", () => {
    renderForm("t-camioneta", "w-sf")
    expect(screen.getByText("Se mide en kilómetros.")).toBeTruthy()
    expect(screen.getByLabelText("Lectura inicial (km)")).toBeTruthy()
  })

  it("un camión sin faena elegida avisa que depende de ella, en vez de decir «km»", () => {
    renderForm("t-camion", "")
    expect(screen.getByText(/Los camiones miden en horas; los de Biodiversa, en kilómetros\. Elige la faena\./)).toBeTruthy()
  })

  it("un catálogo sin medidor ni código (los antiguos) sigue usando la unidad del tipo", () => {
    render(
      <EquipmentForm
        action={vi.fn(async () => ({ ok: false }))}
        catalogs={{ ...CATALOGS, types: [{ id: "t-viejo", name: "Camión", unit: "km" }], worksites: [{ id: "w1", name: "Santa Fe" }] }}
        initial={{ ...EMPTY_EQUIPMENT_VALUES, equipmentTypeId: "t-viejo", worksiteId: "w1" }}
        submitLabel="Crear equipo"
      />,
    )
    expect(screen.getByText("Se mide en kilómetros.")).toBeTruthy()
  })
})
