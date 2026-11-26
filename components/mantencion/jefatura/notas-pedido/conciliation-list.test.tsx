// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { pendingRow } from "./notas-pedido-fixtures"

const refresh = vi.fn()
const actions = { conciliatePartAction: vi.fn() }
const toastSuccess = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
  usePathname: () => "/mantencion/notas-pedido",
  useSearchParams: () => new URLSearchParams("estado=por_conciliar"),
}))
vi.mock("@/app/(app)/mantencion/notas-pedido/actions", () => actions)
vi.mock("@/lib/toast", () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn(), warning: vi.fn() } }))

const { ConciliationList } = await import("./conciliation-list")

const table = () => within(screen.getByRole("table", { name: "Repuestos por conciliar" }))

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe("pestaña «Por conciliar»", () => {
  it("lista el registro, la OT, la faena, el repuesto, la cantidad, lo libre ahora y la nota", () => {
    render(<ConciliationList rows={[pendingRow()]} />)
    expect(table().getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Registro", "Orden de trabajo", "Faena", "Repuesto", "Cantidad", "Libres ahora", "Nota", "",
    ])
    const row = table().getAllByRole("row")[1]!
    expect(within(row).getByRole("link", { name: "MC-BIO-0007" }).getAttribute("href")).toBe("/mantencion/registros/rec-1")
    expect(within(row).getByRole("link", { name: "OT-BIO-0001" }).getAttribute("href")).toBe("/mantencion/ot/ot-1")
    expect(row.textContent).toContain("Biodiversa")
    expect(row.textContent).toContain("Filtro de aceite motor")
    expect(within(row).getByText("3 libres ahora")).toBeTruthy()
    expect(row.textContent).toContain("No había stock al sincronizar")
    expect(within(row).getByRole("button", { name: /Descontar ahora/ })).toBeTruthy()
    expect(within(row).getByRole("button", { name: /No salió de bodega/ })).toBeTruthy()
  })

  it("un registro sin folio o sin OT lo dice en texto, sin enlaces rotos", () => {
    render(<ConciliationList rows={[pendingRow({ recordFolio: null, workOrderId: null, workOrderFolio: null })]} />)
    const row = table().getAllByRole("row")[1]!
    expect(within(row).queryByRole("link")).toBeNull()
    expect(row.textContent).toContain("Sin folio")
    expect(row.textContent).toContain("Sin orden")
  })

  it("«Descontar ahora» concilia en modo aplicar, sin pedir confirmación, y refresca", async () => {
    actions.conciliatePartAction.mockResolvedValue({ ok: true, message: "Descontaste 2 de «Filtro de aceite motor»." })
    render(<ConciliationList rows={[pendingRow()]} />)
    fireEvent.click(within(table().getAllByRole("row")[1]!).getByRole("button", { name: /Descontar ahora/ }))
    await waitFor(() => expect(actions.conciliatePartAction).toHaveBeenCalledWith({ recordPartId: "rp-1", mode: "aplicar" }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toastSuccess).toHaveBeenCalledWith("Descontaste 2 de «Filtro de aceite motor».")
  })

  it("si no se puede descontar, el motivo queda en la fila", async () => {
    actions.conciliatePartAction.mockResolvedValue({ ok: false, message: "Esa línea ya fue conciliada." })
    render(<ConciliationList rows={[pendingRow()]} />)
    const row = within(table().getAllByRole("row")[1]!)
    fireEvent.click(row.getByRole("button", { name: /Descontar ahora/ }))
    expect((await row.findByRole("alert")).textContent).toContain("Esa línea ya fue conciliada.")
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it("«No salió de bodega» exige un motivo de al menos 5 caracteres y concilia sin movimiento", async () => {
    actions.conciliatePartAction.mockResolvedValue({ ok: true })
    render(<ConciliationList rows={[pendingRow()]} />)
    fireEvent.click(within(table().getAllByRole("row")[1]!).getByRole("button", { name: /No salió de bodega/ }))
    const dialog = within(await screen.findByRole("dialog"))
    const submit = dialog.getByRole("button", { name: "Registrar sin movimiento" }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(dialog.getByRole("textbox", { name: /Motivo/ }), { target: { value: "Lo trajo el taller" } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(actions.conciliatePartAction).toHaveBeenCalledWith({ recordPartId: "rp-1", mode: "sin_movimiento", reason: "Lo trajo el taller" }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("en el móvil cada repuesto es una tarjeta con las mismas dos acciones", () => {
    render(<ConciliationList rows={[pendingRow(), pendingRow({ recordPartId: "rp-2", productName: "Correa" })]} />)
    const cards = screen.getAllByRole("article")
    expect(cards).toHaveLength(2)
    expect(within(cards[1]!).getByText("Correa")).toBeTruthy()
    expect(within(cards[0]!).getByText("3 libres ahora")).toBeTruthy()
    expect(within(cards[0]!).getByRole("button", { name: /Descontar ahora/ })).toBeTruthy()
    expect(within(cards[0]!).getByRole("button", { name: /No salió de bodega/ })).toBeTruthy()
  })
})
