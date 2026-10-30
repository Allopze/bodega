// @vitest-environment jsdom
import * as React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

/*
 * Editor de pautas (jefatura), parte de interacción: la matriz es UNA parada de
 * Tab con flechas (tabindex itinerante), quitar un intervalo pide confirmar y dice
 * el impacto, y el nombre avisa «Guardado» en línea. Las acciones de servidor
 * están simuladas: aquí se prueba la interfaz, no el servicio.
 */

const actions = vi.hoisted(() => ({
  setScheduleCellAction: vi.fn(async () => ({ ok: true, version: 2, data: {} })),
  setScheduleItemActiveAction: vi.fn(async () => ({ ok: true, version: 3, data: {} })),
  addScheduleItemAction: vi.fn(async () => ({ ok: true, version: 4, data: {} })),
  setBrandRuleAction: vi.fn(async () => ({ ok: true, version: 5, data: {} })),
  addScheduleIntervalAction: vi.fn(async () => ({ ok: true, version: 6, data: {} })),
  clearIntervalReviewAction: vi.fn(async () => ({ ok: true, version: 7, data: {} })),
  setScheduleIntervalActiveAction: vi.fn(async () => ({ ok: true, version: 8, data: {} })),
  renameScheduleAction: vi.fn(async () => ({ ok: true, version: 9, message: "Nombre guardado.", data: {} })),
}))
vi.mock("@/app/(app)/mantencion/pautas/[id]/actions", () => actions)
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: toastMock }))

const { ScheduleMatrix } = await import("@/components/mantencion/jefatura/pautas/schedule-matrix")
const { ScheduleBrandRules } = await import("@/components/mantencion/jefatura/pautas/schedule-brand-rules")
const { ScheduleIntervalsCard } = await import("@/components/mantencion/jefatura/pautas/schedule-intervals-card")
const { ScheduleNameCard } = await import("@/components/mantencion/jefatura/pautas/schedule-name-card")
const { ShellHeaderProvider } = await import("@/components/layout/header-context")

import type { EditorGroup, EditorInterval } from "@/lib/services/mantencion/schedules"

const INTERVALS: EditorInterval[] = [
  { id: "i1", value: 10000, needsReview: false },
  { id: "i2", value: 20000, needsReview: false },
  { id: "i3", value: 40000, needsReview: false },
]
const GROUPS: EditorGroup[] = [
  {
    id: "g1", name: "Motor", items: [
      { id: "it1", key: "k1", name: "Inspección visual", note: null, applies: { i1: true, i2: false, i3: true } },
      { id: "it2", key: "k2", name: "Escaneo electrónico", note: null, applies: { i1: true, i2: true, i3: true } },
    ],
  },
  { id: "g2", name: "Frenos", items: [{ id: "it3", key: "k3", name: "Pastillas", note: null, applies: { i1: false, i2: false, i3: true } }] },
]

beforeEach(() => { vi.clearAllMocks() })

/** Casillas y «Quitar» de la matriz: lo que forma la rejilla (no los botones de sistema ni «Agregar ítem»). */
const gridButtons = (root: HTMLElement) => within(root).getAllByRole("button").filter((button) => button.hasAttribute("aria-pressed") || /^Quitar .* de la pauta$/.test(button.getAttribute("aria-label") ?? ""))
const tabStops = (buttons: HTMLElement[]) => buttons.filter((button) => button.getAttribute("tabindex") === "0")

describe("ScheduleMatrix: teclado", () => {
  const renderMatrix = () => render(
    <ShellHeaderProvider>
      <ScheduleMatrix scheduleId="s1" unit="km" intervals={INTERVALS} groups={GROUPS} />
    </ShellHeaderProvider>,
  )
  const cell = (item: string, interval: string) => screen.getByRole("button", { name: `${item} en ${interval}` })

  it("la matriz entera es una sola parada de Tab, en la primera casilla", () => {
    renderMatrix()
    const table = screen.getByRole("table", { name: /Actividades de la pauta por intervalo/ })
    const buttons = gridButtons(table)
    // 3 ítems × (3 intervalos + «Quitar»).
    expect(buttons).toHaveLength(12)
    expect(tabStops(buttons)).toEqual([cell("Inspección visual", "10.000 km")])
  })

  it("las flechas mueven el foco y el cursor; Inicio/Fin van a los extremos de la fila", () => {
    renderMatrix()
    const first = cell("Inspección visual", "10.000 km")
    first.focus()
    fireEvent.keyDown(first, { key: "ArrowRight" })
    expect(document.activeElement).toBe(cell("Inspección visual", "20.000 km"))
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" })
    expect(document.activeElement).toBe(cell("Escaneo electrónico", "20.000 km"))
    fireEvent.keyDown(document.activeElement!, { key: "End" })
    // La última columna es «Quitar»: también se alcanza con flechas.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Quitar Escaneo electrónico de la pauta" }))
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" })
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Quitar Escaneo electrónico de la pauta" }))
    fireEvent.keyDown(document.activeElement!, { key: "Home" })
    expect(document.activeElement).toBe(cell("Escaneo electrónico", "10.000 km"))

    // La parada de Tab sigue al foco.
    const table = screen.getByRole("table", { name: /Actividades de la pauta por intervalo/ })
    expect(tabStops(gridButtons(table))).toEqual([cell("Escaneo electrónico", "10.000 km")])
  })

  it("las flechas cruzan de un sistema al siguiente, y Ctrl+Fin / Ctrl+Inicio van a las esquinas", () => {
    renderMatrix()
    const last = cell("Escaneo electrónico", "40.000 km")
    last.focus()
    fireEvent.keyDown(last, { key: "ArrowDown" })
    expect(document.activeElement).toBe(cell("Pastillas", "40.000 km"))
    fireEvent.keyDown(document.activeElement!, { key: "Home", ctrlKey: true })
    expect(document.activeElement).toBe(cell("Inspección visual", "10.000 km"))
    fireEvent.keyDown(document.activeElement!, { key: "End", ctrlKey: true })
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Quitar Pastillas de la pauta" }))
  })

  it("enter y espacio siguen siendo del botón: marcar una casilla la guarda", async () => {
    renderMatrix()
    const target = cell("Pastillas", "10.000 km")
    await act(async () => { fireEvent.click(target) })
    expect(actions.setScheduleCellAction).toHaveBeenCalledWith({ scheduleId: "s1", itemId: "it3", intervalId: "i1", applies: true })
  })

  it("al plegar un sistema, la parada de Tab no queda en una casilla que ya no se ve", () => {
    renderMatrix()
    const last = cell("Pastillas", "10.000 km")
    last.focus()
    fireEvent.click(screen.getByRole("button", { name: /^Frenos/ }))
    const table = screen.getByRole("table", { name: /Actividades de la pauta por intervalo/ })
    const stops = tabStops(gridButtons(table))
    expect(stops).toHaveLength(1)
    expect(table.contains(stops[0]!)).toBe(true)
    expect(screen.queryByRole("button", { name: "Pastillas en 10.000 km" })).toBeNull()
  })

  it("las casillas llevan el nombre del ítem y del intervalo, y su estado en aria-pressed", () => {
    renderMatrix()
    expect(cell("Inspección visual", "10.000 km").getAttribute("aria-pressed")).toBe("true")
    expect(cell("Inspección visual", "20.000 km").getAttribute("aria-pressed")).toBe("false")
  })
})

describe("ScheduleBrandRules: teclado", () => {
  const renderRules = () => render(
    <ScheduleBrandRules
      scheduleId="s1"
      brands={[{ id: "b1", name: "Scania" }, { id: "b2", name: "Volvo" }]}
      rows={[
        { activity: "Escaneo electrónico", inSchedule: true, values: { b1: "A", b2: "X" } },
        { activity: "Cambio de filtros", inSchedule: true, values: { b1: "W", b2: "A" } },
      ]}
    />,
  )

  it("la tabla es una sola parada de Tab y las flechas mueven el foco", () => {
    renderRules()
    const table = screen.getByRole("table", { name: /Reglas por marca de cada actividad/ })
    const buttons = within(table).getAllByRole("button")
    expect(buttons).toHaveLength(4)
    expect(tabStops(buttons)).toEqual([buttons[0]])
    buttons[0]!.focus()
    fireEvent.keyDown(buttons[0]!, { key: "ArrowRight" })
    expect(document.activeElement).toBe(buttons[1])
    fireEvent.keyDown(buttons[1]!, { key: "ArrowDown" })
    expect(document.activeElement).toBe(buttons[3])
    expect(tabStops(buttons)).toEqual([buttons[3]])
  })
})

describe("ScheduleIntervalsCard: quitar un intervalo", () => {
  const renderCard = (props: Partial<React.ComponentProps<typeof ScheduleIntervalsCard>> = {}) => render(
    <ScheduleIntervalsCard scheduleId="s1" unit="km" intervals={INTERVALS} equipmentCount={70} {...props} />,
  )

  it("no se quita con un clic: pide confirmar y dice a cuántos equipos alcanza", async () => {
    renderCard()
    fireEvent.click(screen.getByRole("button", { name: "Quitar el intervalo de 20.000 km" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("¿Quitar el intervalo de 20.000 km?")).toBeDefined()
    expect(dialog.textContent).toContain("70 equipos asignados dejarán de tener la mantención de 20.000 km.")
    expect(dialog.textContent).toContain("Los registros ya firmados no cambian.")
    expect(actions.setScheduleIntervalActiveAction).not.toHaveBeenCalled()
  })

  it("cancelar no cambia nada", async () => {
    renderCard()
    fireEvent.click(screen.getByRole("button", { name: "Quitar el intervalo de 20.000 km" }))
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull())
    expect(actions.setScheduleIntervalActiveAction).not.toHaveBeenCalled()
  })

  it("confirmar quita el intervalo y ofrece «Deshacer»", async () => {
    renderCard()
    fireEvent.click(screen.getByRole("button", { name: "Quitar el intervalo de 20.000 km" }))
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Quitar intervalo" })) })
    expect(actions.setScheduleIntervalActiveAction).toHaveBeenCalledWith({ scheduleId: "s1", intervalId: "i2", active: false })
    // El aviso con «Deshacer» sigue: es toast(mensaje, { action }).
    await waitFor(() => expect(toastMock).toHaveBeenCalled())
    const [message, options] = toastMock.mock.calls[0] as unknown as [string, { action: { label: string; onClick: () => void } }]
    expect(message).toBe("Intervalo de 20.000 km quitado. Los registros ya firmados no cambian.")
    expect(options.action.label).toBe("Deshacer")
    await act(async () => { options.action.onClick() })
    expect(actions.setScheduleIntervalActiveAction).toHaveBeenLastCalledWith({ scheduleId: "s1", intervalId: "i2", active: true })
    expect(toastMock.success).toHaveBeenCalledWith("Intervalo de 20.000 km restituido con su columna.")
  })

  it("si nadie usa la pauta lo dice, y si es la base avisa qué pasa con el redondeo", async () => {
    renderCard({ equipmentCount: 0 })
    fireEvent.click(screen.getByRole("button", { name: "Quitar el intervalo de 10.000 km" }))
    const dialog = await screen.findByRole("dialog")
    expect(dialog.textContent).toContain("Ningún equipo usa esta pauta todavía, así que nadie deja de tener la mantención de 10.000 km.")
    expect(dialog.textContent).toContain("Es el intervalo base: la app pasará a redondear la lectura a 20.000 km.")
  })

  it("el único intervalo no se puede quitar, y el motivo se ve (no sólo en un title)", () => {
    renderCard({ intervals: [INTERVALS[0]!] })
    expect((screen.getByRole("button", { name: "Quitar el intervalo de 10.000 km" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/La pauta necesita al menos un intervalo/)).toBeDefined()
  })
})

describe("ScheduleNameCard: guardado en línea", () => {
  it("al salir del campo con otro nombre guarda y dice «Guardado» sin toast de éxito", async () => {
    render(<ScheduleNameCard scheduleId="s1" name="Camiones y tractos" origin={null} />)
    const input = screen.getByRole("textbox", { name: "Nombre de la pauta" })
    fireEvent.change(input, { target: { value: "Camiones" } })
    await act(async () => { fireEvent.blur(input) })
    expect(actions.renameScheduleAction).toHaveBeenCalledWith({ scheduleId: "s1", name: "Camiones" })
    await waitFor(() => expect(within(screen.getByRole("status")).getByText("Guardado")).toBeDefined())
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it("sin cambios no guarda ni avisa", async () => {
    render(<ScheduleNameCard scheduleId="s1" name="Camiones y tractos" origin={null} />)
    await act(async () => { fireEvent.blur(screen.getByRole("textbox", { name: "Nombre de la pauta" })) })
    expect(actions.renameScheduleAction).not.toHaveBeenCalled()
    expect(screen.getByRole("status").textContent).toBe("")
  })
})
