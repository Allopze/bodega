// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { noteRow } from "./notas-pedido-fixtures"

const mocks = vi.hoisted(() => ({ decide: vi.fn() }))
vi.mock("@/app/(app)/mantencion/notas-pedido/bulk-actions", () => ({ decideLinesInBulkAction: mocks.decide }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/mantencion/notas-pedido",
  useSearchParams: () => new URLSearchParams("estado=por_revisar"),
}))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const { PartsNotesTable } = await import("./parts-notes-table")

const line = (id: string, description: string, quantity = 1, unitOfMeasure = "unidad") => ({ id, description, quantity, unitOfMeasure })

const rows = [
  noteRow({ id: "n1", code: "NP-2026-0001", pendingLines: [line("l1", "Filtro de aceite", 2), line("l2", "Correa")], totalLines: 3 }),
  noteRow({ id: "n2", code: "NP-2026-0002", workOrderId: null, workOrderFolio: null, equipmentCode: "", equipmentPlate: "", pendingLines: [line("l3", "Grasa", 4, "kg")], totalLines: 1 }),
  noteRow({ id: "n3", code: "NP-2026-0003", status: "en_espera", pendingLines: [line("l4", "Sello")], totalLines: 1 }),
  noteRow({ id: "n4", code: "NP-2026-0004", status: "cerrada", pendingLines: [], totalLines: 2 }),
]

beforeEach(() => {
  mocks.decide.mockResolvedValue({ ok: true, message: "3 líneas enviadas a compra.", result: { ok: 3, failed: [], requests: [{ code: "SOL-0001", id: "req-1", approved: true }, { code: "SOL-0002", id: "req-2", approved: true }] } })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const table = () => within(screen.getByRole("table", { name: "Notas de pedido" }))
const cards = () => screen.getAllByRole("article")
// La tabla con scroll es también una región (sin nombre): la barra se busca por el suyo.
const BAR = { name: "Acciones sobre las líneas elegidas" }
const region = () => screen.getByRole("region", BAR)
const noBar = () => expect(screen.queryByRole("region", BAR)).toBeNull()
const noteBox = (code: string, count: number) => table().getByRole("checkbox", { name: `Elegir ${count === 1 ? "la línea pendiente" : `las ${count} líneas pendientes`} de ${code}` }) as HTMLInputElement
const allBox = (count: number) => screen.getByRole("checkbox", { name: `Elegir las ${count} líneas pendientes de esta página` }) as HTMLInputElement

describe("PartsNotesTable sin selección", () => {
  it("no pinta casillas, ni «elegir todo» ni barra, y las columnas no cambian", () => {
    render(<PartsNotesTable rows={rows} />)
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
    noBar()
    expect(table().getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Nota", "Equipo y OT", "Faena", "Pedida por", "Estado", "En este estado", "Líneas pendientes",
    ])
    expect(table().queryByRole("button", { name: /líneas pendientes de/ })).toBeNull()
  })
})

describe("PartsNotesTable seleccionable", () => {
  it("cada nota con líneas pendientes lleva su casilla; la que está en espera, deshabilitada con el motivo; la cerrada, ninguna", () => {
    render(<PartsNotesTable rows={rows} selectable />)
    expect(noteBox("NP-2026-0001", 2).disabled).toBe(false)
    expect(noteBox("NP-2026-0002", 1).disabled).toBe(false)
    const held = table().getByRole("checkbox", { name: "NP-2026-0003 está en espera: acéptala para decidir sus líneas" }) as HTMLInputElement
    expect(held.disabled).toBe(true)
    expect(held.title).toMatch(/acéptala/)
    expect(within(table().getAllByRole("row")[4]!).queryByRole("checkbox")).toBeNull()
    // Sin selección no hay barra.
    noBar()
  })

  it("marcar la casilla de una nota elige todas sus líneas y la barra cuenta líneas y notas", () => {
    render(<PartsNotesTable rows={rows} selectable />)
    fireEvent.click(noteBox("NP-2026-0001", 2))
    expect(region().textContent).toContain("2 líneas de 1 nota")
    expect(noteBox("NP-2026-0001", 2).checked).toBe(true)
    fireEvent.click(noteBox("NP-2026-0002", 1))
    expect(region().textContent).toContain("3 líneas de 2 notas")
    fireEvent.click(noteBox("NP-2026-0001", 2))
    expect(region().textContent).toContain("1 línea de 1 nota")
    expect(noteBox("NP-2026-0001", 2).checked).toBe(false)
  })

  it("se despliega para marcar líneas sueltas y la casilla de la nota queda en estado mixto", () => {
    render(<PartsNotesTable rows={rows} selectable />)
    const toggle = table().getByRole("button", { name: "Ver las líneas pendientes de NP-2026-0001" })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(toggle.textContent).toBe("2 de 3")
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    const list = within(table().getByRole("list", { name: "Líneas pendientes de NP-2026-0001" }))
    // El rótulo de cada línea trae la descripción y la cantidad pedida (con su unidad si no es «unidad»).
    expect(list.getAllByRole("checkbox").map((box) => box.parentElement?.textContent)).toEqual(["Filtro de aceite × 2", "Correa × 1"])
    fireEvent.click(list.getByRole("checkbox", { name: /Correa/ }))
    expect(region().textContent).toContain("1 línea de 1 nota")
    expect(noteBox("NP-2026-0001", 2).indeterminate).toBe(true)
    expect(noteBox("NP-2026-0001", 2).checked).toBe(false)
    fireEvent.click(list.getByRole("checkbox", { name: /Filtro de aceite/ }))
    expect(noteBox("NP-2026-0001", 2).indeterminate).toBe(false)
    expect(noteBox("NP-2026-0001", 2).checked).toBe(true)
    fireEvent.click(table().getByRole("button", { name: "Ocultar las líneas pendientes de NP-2026-0001" }))
    expect(table().queryByRole("list", { name: "Líneas pendientes de NP-2026-0001" })).toBeNull()
  })

  it("la unidad que no es «unidad» se dice en la línea (4 kg)", () => {
    render(<PartsNotesTable rows={rows} selectable />)
    fireEvent.click(table().getByRole("button", { name: "Ver las líneas pendientes de NP-2026-0002" }))
    expect(table().getByRole("checkbox", { name: /Grasa/ }).parentElement?.textContent).toBe("Grasa × 4 kg")
  })

  it("una nota en espera no se despliega ni entra en «elegir todo»", () => {
    render(<PartsNotesTable rows={rows} selectable />)
    expect(table().queryByRole("button", { name: "Ver las líneas pendientes de NP-2026-0003" })).toBeNull()
    fireEvent.click(allBox(3))
    expect(region().textContent).toContain("3 líneas de 2 notas")
    expect((table().getByRole("checkbox", { name: /NP-2026-0003 está en espera/ }) as HTMLInputElement).checked).toBe(false)
  })

  it("«elegir todo» de la página elige las líneas de todas las notas y se vuelve a quitar; parcial = mixta", () => {
    render(<PartsNotesTable rows={rows} selectable />)
    expect(allBox(3).checked).toBe(false)
    fireEvent.click(noteBox("NP-2026-0002", 1))
    expect(allBox(3).indeterminate).toBe(true)
    fireEvent.click(allBox(3))
    expect(allBox(3).checked).toBe(true)
    expect(allBox(3).indeterminate).toBe(false)
    expect(noteBox("NP-2026-0001", 2).checked).toBe(true)
    fireEvent.click(allBox(3))
    noBar()
    expect(noteBox("NP-2026-0001", 2).checked).toBe(false)
  })

  it("con una sola nota elegible no hay «elegir todo» (basta la casilla de la nota)", () => {
    render(<PartsNotesTable rows={[rows[0]!, rows[3]!]} selectable />)
    expect(screen.queryByRole("checkbox", { name: /de esta página/ })).toBeNull()
    expect(noteBox("NP-2026-0001", 2)).toBeTruthy()
  })

  it("«Sacar de bodega» sólo se ofrece si alguna nota elegida tiene OT", () => {
    render(<PartsNotesTable rows={rows} selectable />)
    fireEvent.click(noteBox("NP-2026-0002", 1))
    expect((screen.getByRole("button", { name: "Sacar de bodega" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(noteBox("NP-2026-0001", 2))
    expect((screen.getByRole("button", { name: "Sacar de bodega" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("«Enviar a compra» manda los ids de las líneas de varias notas y, con el resultado, la selección queda limpia", async () => {
    render(<PartsNotesTable rows={rows} selectable />)
    fireEvent.click(noteBox("NP-2026-0001", 2))
    fireEvent.click(noteBox("NP-2026-0002", 1))
    fireEvent.click(screen.getByRole("button", { name: "Enviar a compra" }))
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith({ lineIds: ["l1", "l2", "l3"], decision: "comprar" }))
    await waitFor(() => expect(noteBox("NP-2026-0001", 2).checked).toBe(false))
    expect(noteBox("NP-2026-0002", 1).checked).toBe(false)
    // Queda el resultado, con los enlaces a las solicitudes, sin controles de selección.
    expect(within(region()).getByText("3 líneas enviadas a compra.")).toBeTruthy()
    expect(within(region()).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/solicitudes/req-1", "/solicitudes/req-2"])
    expect(within(region()).queryByRole("button", { name: "Enviar a compra" })).toBeNull()
  })

  it("en el móvil cada tarjeta lleva la casilla de su nota con el rótulo a la vista, y comparte la selección con la tabla", () => {
    render(<PartsNotesTable rows={rows} selectable />)
    const first = within(cards()[0]!)
    expect(first.getByText("2 de 3")).toBeTruthy()
    const box = first.getByRole("checkbox", { name: "Elegir las 2 líneas pendientes" }) as HTMLInputElement
    expect(box.parentElement?.textContent).toBe("Elegir las 2 líneas pendientes")
    fireEvent.click(box)
    expect(region().textContent).toContain("2 líneas de 1 nota")
    expect(noteBox("NP-2026-0001", 2).checked).toBe(true)
    // Desplegar las líneas en la tarjeta.
    fireEvent.click(first.getByRole("button", { name: "Ver las líneas pendientes de NP-2026-0001" }))
    fireEvent.click(first.getByRole("checkbox", { name: /Correa/ }))
    expect(region().textContent).toContain("1 línea de 1 nota")
    expect(box.indeterminate).toBe(true)
    // La nota en espera no se elige tampoco en la tarjeta; la cerrada no ofrece casilla.
    expect((within(cards()[2]!).getByRole("checkbox") as HTMLInputElement).disabled).toBe(true)
    expect(within(cards()[3]!).queryByRole("checkbox")).toBeNull()
  })

  it("lo elegido que ya no está en la página (se resolvió, otra pestaña) sale solo de la selección", () => {
    const { rerender } = render(<PartsNotesTable rows={rows} selectable />)
    fireEvent.click(allBox(3))
    expect(region().textContent).toContain("3 líneas de 2 notas")
    rerender(<PartsNotesTable rows={[rows[1]!, rows[2]!, rows[3]!]} selectable />)
    expect(region().textContent).toContain("1 línea de 1 nota")
    rerender(<PartsNotesTable rows={[rows[3]!]} selectable />)
    noBar()
  })
})
