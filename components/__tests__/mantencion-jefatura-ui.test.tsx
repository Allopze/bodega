// @vitest-environment jsdom
import * as React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

/*
 * Humo de las pantallas de jefatura de equipos y pautas en jsdom: lo que ni el
 * tipado ni la base de datos detectan (hooks mal usados, estados controlados que
 * no responden, nombres accesibles que las E2E buscan). Las acciones de servidor
 * están simuladas: aquí se prueba la interfaz, no el servicio.
 */

const actions = vi.hoisted(() => ({
  setScheduleCellAction: vi.fn(async () => ({ ok: true, version: 2, data: {} })),
  setScheduleItemActiveAction: vi.fn(async () => ({ ok: true, version: 3, data: {} })),
  addScheduleItemAction: vi.fn(async () => ({ ok: true, version: 4, message: "Ítem agregado", data: {} })),
  setBrandRuleAction: vi.fn(async () => ({ ok: true, version: 5, data: {} })),
}))
vi.mock("@/app/(app)/mantencion/pautas/[id]/actions", () => actions)
vi.mock("@/lib/toast", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

const { ScheduleMatrix } = await import("@/components/mantencion/jefatura/pautas/schedule-matrix")
const { ScheduleBrandRules } = await import("@/components/mantencion/jefatura/pautas/schedule-brand-rules")
const { EquipmentTable } = await import("@/components/mantencion/jefatura/equipos/equipment-table")
const { ShellHeaderProvider, useSafeShellHeader } = await import("@/components/layout/header-context")

import type { EditorGroup, EditorInterval } from "@/lib/services/mantencion/schedules"
import type { EquipmentListRow } from "@/lib/services/mantencion/equipment-list"

const INTERVALS: EditorInterval[] = [
  { id: "i1", value: 10000, needsReview: false },
  { id: "i2", value: 30000, needsReview: true },
]
const GROUPS: EditorGroup[] = [
  {
    id: "g1", name: "Motor", items: [
      { id: "it1", key: "km1", name: "Inspección visual", note: null, applies: { i1: true, i2: false } },
      { id: "it2", key: "km2", name: "Escaneo electrónico", note: "Por confirmar", applies: { i1: true, i2: true } },
    ],
  },
  { id: "g2", name: "Frenos", items: [{ id: "it3", key: "km3", name: "Pastillas", note: null, applies: { i1: false, i2: false } }] },
]

beforeEach(() => { vi.clearAllMocks() })

function Search({ query }: { query: string }) {
  const { setSearchQuery } = useSafeShellHeader()
  React.useEffect(() => setSearchQuery(query), [query, setSearchQuery])
  return null
}

describe("ScheduleMatrix", () => {
  const renderMatrix = (query = "") => render(
    <ShellHeaderProvider>
      <Search query={query} />
      <ScheduleMatrix scheduleId="s1" unit="km" intervals={INTERVALS} groups={GROUPS} />
    </ShellHeaderProvider>,
  )

  it("pinta la matriz con sus casillas, la nota «Por confirmar» y el aviso de columna por revisar", () => {
    renderMatrix()
    const table = screen.getByRole("table", { name: "Actividades de la pauta por intervalo" })
    expect(within(table).getByRole("columnheader", { name: "Actividad" })).toBeDefined()
    expect(within(table).getByRole("columnheader", { name: /30\.000 km Por revisar/ })).toBeDefined()
    expect(screen.getByRole("button", { name: "Inspección visual en 10.000 km" }).getAttribute("aria-pressed")).toBe("true")
    // La columna por revisar sólo se distingue por el tinte: el nombre de sus casillas lo dice con texto.
    expect(screen.getByRole("button", { name: "Inspección visual en 30.000 km (columna por revisar)" }).getAttribute("aria-pressed")).toBe("false")
    expect(within(table).getByText("Por confirmar")).toBeDefined()
    // El pie cuenta las actividades de cada intervalo.
    const footer = within(table).getByRole("row", { name: /Actividades en el intervalo/ })
    expect(within(footer).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["2", "1", ""])
  })

  it("tocar una casilla la guarda con el valor contrario", async () => {
    renderMatrix()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pastillas en 10.000 km" })) })
    expect(actions.setScheduleCellAction).toHaveBeenCalledWith({ scheduleId: "s1", itemId: "it3", intervalId: "i1", applies: true })
  })

  it("los sistemas se pliegan con aria-expanded", () => {
    renderMatrix()
    const toggle = screen.getByRole("button", { name: /^Motor/ })
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("rowheader", { name: /Inspección visual/ })).toBeNull()
    expect(screen.getByRole("rowheader", { name: /Pastillas/ })).toBeDefined()
  })

  it("«Quitar» está en su propia columna y llama a inactivar el ítem", async () => {
    renderMatrix()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Quitar Pastillas de la pauta" })) })
    expect(actions.setScheduleItemActiveAction).toHaveBeenCalledWith({ scheduleId: "s1", itemId: "it3", active: false })
  })

  it("«+ Agregar ítem en {sistema}» abre un campo dentro de ese sistema y lo envía con su id", async () => {
    renderMatrix()
    fireEvent.click(screen.getByRole("button", { name: "+ Agregar ítem en Frenos" }))
    fireEvent.change(screen.getByLabelText("Nuevo ítem en Frenos"), { target: { value: "Discos" } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Agregar" })) })
    expect(actions.addScheduleItemAction).toHaveBeenCalledWith({ scheduleId: "s1", groupId: "g2", name: "Discos" })
  })

  it("el filtro de la barra superior busca ítems por nombre y oculta el resto", () => {
    renderMatrix("escaneo")
    expect(screen.getByRole("rowheader", { name: /Escaneo electrónico/ })).toBeDefined()
    expect(screen.queryByRole("rowheader", { name: /Pastillas/ })).toBeNull()
    // Buscando no se ofrece agregar ítems: la lista está recortada.
    expect(screen.queryByRole("button", { name: /Agregar ítem en/ })).toBeNull()
  })
})

describe("ScheduleBrandRules", () => {
  it("cada celda lleva símbolo y texto, y rota A → W → X con un clic", async () => {
    render(
      <ScheduleBrandRules
        scheduleId="s1"
        brands={[{ id: "b1", name: "Scania" }, { id: "b2", name: "Volvo" }]}
        rows={[{ activity: "Escaneo electrónico", inSchedule: true, values: { b1: "A", b2: "X" } }]}
      />,
    )
    const scania = screen.getByRole("button", { name: /Escaneo electrónico, Scania: Aplica\. Tocar para cambiar a Revisar con pauta del fabricante/ })
    expect(screen.getByRole("button", { name: /Volvo: No aplica/ })).toBeDefined()
    await act(async () => { fireEvent.click(scania) })
    expect(actions.setBrandRuleAction).toHaveBeenCalledWith({ scheduleId: "s1", activity: "Escaneo electrónico", brandId: "b1", value: "W" })
    expect(screen.getByRole("list", { name: "Significado de los símbolos" }).textContent).toContain("Revisar con pauta del fabricante")
  })
})

function equipmentRow(index: number, overrides: Partial<EquipmentListRow> = {}): EquipmentListRow {
  return {
    id: `v${index}`, code: `KA-${String(index).padStart(3, "0")}`, plate: `PL-${index}`, showPlate: true, noPlate: false,
    typeName: "Camión", brandName: "Scania", model: "R450", year: 2021, worksiteName: index % 2 ? "Arauco" : "Teno",
    scheduleName: "Camiones y tractos", hasSchedule: true, unit: "km", state: "al_dia", stateOrder: 2, reading: 12000, readingDate: "2026-10-01",
    nextReading: 20000, remaining: 8000, urgency: 0.8, nextIntervalValue: 20000, inWorkshop: false, workshopDays: null, workshopStale: false,
    ...overrides,
  }
}

describe("EquipmentTable", () => {
  const rows = Array.from({ length: 120 }, (_, index) => equipmentRow(index + 1))

  it("muestra 50, y «Mostrar 50 más» agranda la ventana sobre la lista", () => {
    render(<EquipmentTable rows={rows} canManage filtered={false} />)
    expect(screen.getByText("Mostrando 50 de 120 equipos")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Mostrar 50 más" }))
    expect(screen.getByText("Mostrando 100 de 120 equipos")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Mostrar 20 más" }))
    expect(screen.queryByRole("button", { name: /Mostrar .* más/ })).toBeNull()
  })

  it("los encabezados ordenables anuncian su orden y el tercer clic vuelve al orden por estado", () => {
    render(<EquipmentTable rows={rows.slice(0, 5)} canManage filtered={false} />)
    const header = screen.getByRole("columnheader", { name: /Faena/ })
    const button = () => within(header).getByRole("button")
    fireEvent.click(button())
    expect(header.getAttribute("aria-sort")).toBe("ascending")
    fireEvent.click(button())
    expect(header.getAttribute("aria-sort")).toBe("descending")
    fireEvent.click(button())
    expect(header.getAttribute("aria-sort")).toBeNull()
  })

  it("la búsqueda de la barra superior filtra la lista y dice cuando nada coincide", async () => {
    render(
      <ShellHeaderProvider>
        <Search query="ka-007" />
        <EquipmentTable rows={rows} canManage filtered={false} />
      </ShellHeaderProvider>,
    )
    await waitFor(() => expect(screen.getByText("Mostrando 1 de 1 equipo")).toBeDefined())
    expect(screen.getByRole("link", { name: "KA-007" })).toBeDefined()
  })

  it("el estado va con texto y el equipo sin patente lo dice", () => {
    render(<EquipmentTable rows={[equipmentRow(1, { state: "vencida", stateOrder: 0, noPlate: true, showPlate: false })]} canManage filtered={false} />)
    const row = screen.getByRole("row", { name: /KA-001/ })
    expect(within(row).getByText("Vencida")).toBeDefined()
    expect(within(row).getByText("Sin patente")).toBeDefined()
    expect(within(row).queryByText(/En taller/)).toBeNull()
  })

  it("un equipo en taller lleva «En taller · N días» junto a su estado de pauta, y «Sin actualizar» sólo si lo está", () => {
    render(<EquipmentTable rows={[
      equipmentRow(1, { state: "al_dia", inWorkshop: true, workshopDays: 15, workshopStale: true }),
      equipmentRow(2, { state: "proxima", stateOrder: 1, inWorkshop: true, workshopDays: 1, workshopStale: false }),
    ]} canManage filtered={false} />)
    const stale = screen.getByRole("row", { name: /KA-001/ })
    expect(within(stale).getByText("En taller · 15 días")).toBeDefined()
    expect(within(stale).getByText("Al día")).toBeDefined()
    expect(within(stale).getByText("Sin actualizar").className).toContain("signal-ink")
    const fresh = screen.getByRole("row", { name: /KA-002/ })
    expect(within(fresh).getByText("En taller · 1 día")).toBeDefined()
    expect(within(fresh).queryByText("Sin actualizar")).toBeNull()
  })

  it("la marca no se repite cuando el modelo ya la trae", () => {
    render(<EquipmentTable rows={[
      equipmentRow(1, { brandName: "Ford Cargo", model: "Ford Cargo 5032 E", year: 2011 }),
      equipmentRow(2, { brandName: "Scania", model: "R450", year: 2021 }),
    ]} canManage filtered={false} />)
    expect(screen.getByText("Ford Cargo 5032 E · 2011")).toBeDefined()
    expect(screen.getByText("Scania R450 · 2021")).toBeDefined()
  })

  it("sin equipos ofrece cómo llenar la lista; con filtros ofrece quitarlos", () => {
    const { unmount } = render(<EquipmentTable rows={[]} canManage filtered={false} />)
    expect(screen.getByRole("link", { name: "Nuevo equipo" }).getAttribute("href")).toBe("/mantencion/equipos/nuevo")
    expect(screen.getByRole("link", { name: "Importar desde Excel" }).getAttribute("href")).toBe("/mantencion/equipos/importar")
    unmount()
    render(<EquipmentTable rows={[]} canManage filtered />)
    expect(screen.getByRole("link", { name: "Quitar los filtros" }).getAttribute("href")).toBe("/mantencion/equipos")
  })
})

const { EquipmentForm } = await import("@/components/mantencion/jefatura/equipos/equipment-form")
import { EMPTY_EQUIPMENT_VALUES, type EquipmentFormCatalogs, type EquipmentFormValues } from "@/components/mantencion/jefatura/equipos/equipment-form-types"

const CATALOGS: EquipmentFormCatalogs = {
  types: [{ id: "t-km", name: "Camión", unit: "km" }, { id: "t-h", name: "Excavadora", unit: "h" }],
  brands: [{ id: "b1", name: "Scania" }],
  worksites: [{ id: "w1", name: "Arauco" }],
  schedules: [{ id: "s-km", name: "Camiones y tractos", unit: "km", intervalCount: 5 }, { id: "s-h", name: "Maquinaria", unit: "h", intervalCount: 4 }],
}

describe("EquipmentForm", () => {
  const values = (overrides: Partial<EquipmentFormValues> = {}): EquipmentFormValues => ({ ...EMPTY_EQUIPMENT_VALUES, ...overrides })
  const renderForm = (overrides: Partial<EquipmentFormValues> = {}, props: Partial<React.ComponentProps<typeof EquipmentForm>> = {}) => {
    const action = vi.fn(async () => ({ ok: false } as { ok: boolean }))
    render(<EquipmentForm action={action} catalogs={CATALOGS} initial={values(overrides)} submitLabel="Crear equipo" cancelHref="/mantencion/equipos" {...props} />)
    return action
  }

  it("expone cada campo con su nombre accesible y las listas cerradas", () => {
    renderForm()
    for (const label of ["Código interno", "Patente", "Modelo", "Año"]) expect(screen.getByLabelText(new RegExp(`^${label}`))).toBeDefined()
    for (const label of ["Tipo de equipo", "Marca", "Faena", "Pauta de mantención"]) expect(screen.getByRole("combobox", { name: new RegExp(`^${label}`) })).toBeDefined()
    expect(screen.getByRole("button", { name: "Crear equipo" })).toBeDefined()
    expect(screen.getByRole("link", { name: "Cancelar" }).getAttribute("href")).toBe("/mantencion/equipos")
    // En el alta no hay estado del equipo.
    expect(screen.queryByRole("radio", { name: "Dado de baja" })).toBeNull()
  })

  it("«Sin patente» deshabilita la patente y envía la marca", () => {
    const { container } = render(<EquipmentForm action={vi.fn(async () => ({ ok: false }))} catalogs={CATALOGS} initial={values({ code: "TO-37", noPlate: true })} submitLabel="Crear equipo" />)
    expect((screen.getByLabelText("Patente", { exact: true }) as HTMLInputElement).disabled).toBe(true)
    expect(container.querySelector('input[name="noPlate"]')?.getAttribute("value")).toBe("1")
    expect((screen.getByLabelText("Sin patente", { exact: true }) as HTMLInputElement).checked).toBe(true)
  })

  it("«Nueva faena…» muestra el campo del nombre, y la pauta sólo se ofrece del mismo tipo de unidad", () => {
    renderForm({ worksiteId: "__new__", equipmentTypeId: "t-h" })
    expect(screen.getByLabelText("Nombre de la faena nueva", { exact: true })).toBeDefined()
    expect(screen.getByText(/Solo aparecen pautas en horas/)).toBeDefined()
  })

  it("una pauta elegida de otra unidad se suelta cuando el tipo ya no la admite", async () => {
    const { container } = render(<EquipmentForm action={vi.fn(async () => ({ ok: false }))} catalogs={CATALOGS} initial={values({ equipmentTypeId: "t-h", scheduleId: "s-km" })} submitLabel="Crear equipo" />)
    await waitFor(() => expect(container.querySelector('input[name="scheduleId"]')?.getAttribute("value")).toBe(""))
  })

  it("al editar aparece el estado; «Dado de baja» pide el motivo y con registros la lectura queda fija", () => {
    renderForm({ retired: true, initialReading: "12.345" }, { vehicleId: "veh-1", lockedUnit: "km" })
    expect((screen.getByRole("radio", { name: "Dado de baja" }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByLabelText(/^Motivo de la baja/)).toBeDefined()
    const reading = screen.getByLabelText(/^Lectura actual/) as HTMLInputElement
    expect(reading.readOnly).toBe(true)
    expect(reading.value).toBe("12.345")
    expect(screen.getByText(/ya tiene registros/)).toBeDefined()
  })

  it("envía los campos con los nombres que lee la acción", async () => {
    const action = renderForm({ code: "KA-1", plate: "BCDF-12", equipmentTypeId: "t-km", brandId: "b1", worksiteId: "w1", model: "R450" }, { vehicleId: "veh-9" })
    await act(async () => { fireEvent.submit(screen.getByRole("button", { name: "Crear equipo" }).closest("form")!) })
    expect(action).toHaveBeenCalledTimes(1)
    const data = (action.mock.calls[0] as unknown as [unknown, FormData])[1]
    expect(Object.fromEntries([...data.entries()].filter(([, value]) => typeof value === "string"))).toMatchObject({
      vehicleId: "veh-9", code: "KA-1", plate: "BCDF-12", equipmentTypeId: "t-km", brandId: "b1", worksiteId: "w1", model: "R450", scheduleId: "", status: "activo",
    })
  })
})
