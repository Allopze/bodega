// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CheckDetail, EquipmentCheckDetail, PeriodCheck } from "@/lib/services/mantencion/looker/equipment-check-summary"

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), search: "pestana=preventivo&ficha=v-1" }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/mantencion/panel",
  useRouter: () => ({ replace: nav.replace, push: nav.push, back: nav.back }),
  useSearchParams: () => new URLSearchParams(nav.search),
}))

import { EquipmentCheckSheet, FichaSessionMark } from "./equipment-check-sheet"

const period = (over: Partial<PeriodCheck>): PeriodCheck => ({
  id: "r:rec-1", source: "registro", date: "2026-12-10", level: "40.000 km", mechanic: "Mecánico Nativo", done: 1, notDone: 1, notApplicable: 1,
  percent: 50, folio: "MR-P-77", recordId: "rec-1", ...over,
})
const selected: CheckDetail = {
  ...period({}),
  reading: 151_000,
  observations: "Pauta de diciembre",
  itemDetail: "full",
  items: [
    { name: "Cambio aceite motor", system: "Motor", state: "realizado", reason: null },
    { name: "Revisión frenos", system: "Frenos", state: "no_realizado", reason: "Sin repuesto" },
    { name: "Revisión ABS", system: "Frenos", state: "no_aplica", reason: null },
  ],
  filtersPhoto: { status: "native", id: "ph-1", stampedAt: "2026-12-10T15:00:00Z", receivedAt: "2026-12-10T15:00:00Z" },
  stickerPhoto: { status: "missing" },
}
const detail: EquipmentCheckDetail = {
  vehicle: { id: "v-1", code: "KA-F1", plate: "FICHA-01", typeName: "Camión", worksiteName: "Faena A" },
  period: { from: "2026-10-01", to: "2026-12-31" },
  checks: [period({}), period({ id: "h:h-1", source: "historial", date: "2026-10-15", level: "40.000 KM", notDone: 0, folio: null, recordId: null })],
  pending: [{ name: "Revisión frenos", system: "Frenos", notDoneCount: 2, applicableCount: 2, dates: ["2026-12-10", "2026-10-15"], doneSince: false }],
  selected,
}

const renderSheet = (over: Partial<Parameters<typeof EquipmentCheckSheet>[0]> = {}) =>
  render(<EquipmentCheckSheet vehicleId="v-1" detail={detail} historyHref="/mantencion/registros/historicos?equipo=v-1&tipo=preventiva" {...over} />)

beforeEach(() => { nav.search = "pestana=preventivo&ficha=v-1" })
afterEach(() => { cleanup(); nav.replace.mockReset(); nav.push.mockReset(); nav.back.mockReset() })

describe("Ficha del equipo", () => {
  it("el encabezado dice patente y «código · tipo · faena»; lo pendiente lista el ítem con su sistema y cuántas veces", () => {
    renderSheet()
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByRole("heading", { name: "FICHA-01" })).toBeTruthy()
    expect(within(dialog).getByText("KA-F1 · Camión · Faena A")).toBeTruthy()
    expect(within(dialog).getByRole("heading", { name: "Pendiente en el período" })).toBeTruthy()
    const item = within(dialog).getByText("Revisión frenos", { selector: "li > span" }).closest("li")!
    expect(item.textContent).toBe("Revisión frenos · Frenos · No se hizo en 2 de 2 pautas")
  })

  it("sin pendientes lo dice en una línea; con cantidades pero sin nombres no afirma que todo se hizo", () => {
    renderSheet({ detail: { ...detail, pending: [], checks: [period({ notDone: 0 })] } })
    expect(screen.getByText("Todo se hizo en las pautas del período.")).toBeTruthy()
    cleanup()
    renderSheet({ detail: { ...detail, pending: [], checks: [period({ notDone: 3 })] } })
    expect(screen.getByText(/Hay 3 ítems sin hacer, pero los formularios no traen su detalle/)).toBeTruthy()
    expect(screen.queryByText("Todo se hizo en las pautas del período.")).toBeNull()
  })

  it("las pautas son pestañas: la elegida está seleccionada y cada una dice fecha, nivel y cuántas quedaron sin hacer", () => {
    renderSheet()
    const tabs = screen.getAllByRole("tab")
    expect(screen.getByRole("tablist").getAttribute("aria-label")).toMatch(/la más reciente primero/)
    expect(tabs.map((tab) => tab.textContent)).toEqual(["10-12-2026 · 40.000 km1 sin hacer", "15-10-2026 · 40.000 KM0 sin hacer"])
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true")
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("false")
  })

  it("elegir otra pauta actualiza `pauta` con replace y sin mover el scroll", () => {
    renderSheet()
    fireEvent.mouseDown(screen.getAllByRole("tab")[1]!)
    expect(nav.replace).toHaveBeenCalledWith("/mantencion/panel?pestana=preventivo&ficha=v-1&pauta=h%3Ah-1", { scroll: false })
  })

  it("las flechas cambian de pauta", async () => {
    renderSheet()
    const first = screen.getAllByRole("tab")[0]!
    first.focus()
    fireEvent.keyDown(first, { key: "ArrowRight" })
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/mantencion/panel?pestana=preventivo&ficha=v-1&pauta=h%3Ah-1", { scroll: false }))
  })

  it("el detalle pone lo no realizado primero con su sistema y su motivo, y la foto que falta en rojo con su texto", () => {
    renderSheet()
    const panel = screen.getByRole("tabpanel")
    const text = panel.textContent ?? ""
    expect(text.indexOf("No realizado: Revisión frenos")).toBeLessThan(text.indexOf("Cambio aceite motor"))
    expect(within(panel).getByText(/Frenos · Motivo: Sin repuesto/)).toBeTruthy()
    expect(within(panel).getByText("Falta la foto: la pauta no debió cerrarse")).toBeTruthy()
    expect(within(panel).getByRole("button", { name: /Ampliar: foto de los filtros/ })).toBeTruthy()
    expect(within(panel).getByText("No aplica en este nivel (1)").closest("details")).toBeTruthy()
    expect(within(panel).getByText("Pauta de diciembre")).toBeTruthy()
  })

  it("el pie lleva al historial del equipo y, en una pauta de la plataforma, al registro con su folio", () => {
    renderSheet()
    expect(screen.getByRole("link", { name: "Historial del equipo" }).getAttribute("href")).toBe("/mantencion/registros/historicos?equipo=v-1&tipo=preventiva")
    expect(screen.getByRole("link", { name: "Ver el registro MR-P-77" }).getAttribute("href")).toBe("/mantencion/registros/rec-1")
    cleanup()
    renderSheet({ detail: { ...detail, selected: { ...selected, source: "historial", recordId: null, folio: null } } })
    expect(screen.queryByRole("link", { name: /Ver el registro/ })).toBeNull()
  })

  it("un equipo que no se puede ver dice que no está disponible", () => {
    renderSheet({ detail: null })
    expect(screen.getByRole("heading", { name: "Equipo no disponible" })).toBeTruthy()
    expect(screen.getByText(/No se encontró el equipo o no tienes acceso/)).toBeTruthy()
  })
})

describe("Ficha del equipo · cerrar", () => {
  // La marca de «ya hubo navegación» es de módulo: la primera prueba corre antes de montar `FichaSessionMark`.
  it("abierta al cargar la pantalla (enlace compartido o recarga), Escape quita ficha y pauta con replace", () => {
    renderSheet()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(nav.replace).toHaveBeenCalledWith("/mantencion/panel?pestana=preventivo", { scroll: false })
    expect(nav.back).not.toHaveBeenCalled()
  })

  it("abierta con un push dentro de la pantalla, el botón Cerrar vuelve atrás", () => {
    render(<FichaSessionMark />)
    act(() => {})
    renderSheet()
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }))
    expect(nav.back).toHaveBeenCalledTimes(1)
    expect(nav.replace).not.toHaveBeenCalled()
  })
})
