// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkOrderPartsRequest } from "@/lib/services/mantencion/work-orders/types"
import { otDetail } from "../ot/ot-fixtures"
import { availablePart, partsOverview } from "./notas-pedido-fixtures"

const refresh = vi.fn()
const actions = { releaseAllocationAction: vi.fn() }
const toastSuccess = vi.fn()

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }) }))
vi.mock("@/app/(app)/mantencion/notas-pedido/actions", () => actions)
vi.mock("@/lib/toast", () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn(), warning: vi.fn() } }))

const { OtPartsOverview, OtConsumptions } = await import("./ot-parts-overview")
const { OtPartsRequestsSection } = await import("../ot/ot-sections")

const OPENABLE = ["rec-1"]
const notes = () => within(screen.getByRole("list", { name: "Notas de pedido de esta orden" }))

function overviewView(props: Partial<React.ComponentProps<typeof OtPartsOverview>> = {}) {
  return render(<OtPartsOverview workOrderId="ot-1" overview={partsOverview()} canOpenNotes canManage {...props} />)
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe("«Repuestos» de la OT: notas de pedido", () => {
  it("cada nota enlaza a su detalle, dice si el equipo está detenido y muestra el avance de cada línea", () => {
    overviewView()
    expect(screen.getByRole("heading", { name: "Notas de pedido" })).toBeTruthy()
    // El primer elemento es la nota; los siguientes son sus líneas (anidadas).
    const note = notes().getAllByRole("listitem")[0]!
    expect(within(note).getByRole("link", { name: "NP-2026-0001" }).getAttribute("href")).toBe("/mantencion/notas-pedido/n1")
    expect(within(note).getByText("En gestión")).toBeTruthy()
    expect(within(note).getByText("Equipo detenido")).toBeTruthy()
    const chains = within(note).getAllByRole("list", { name: "Avance de la línea" })
    expect(chains).toHaveLength(2)
    expect(chains[0]!.textContent).toBe("Pedido → En compra → Llegó 2/2 → Usado 1/2")
    expect(within(chains[0]!).getByText("Usado 1/2").closest("li")!.getAttribute("aria-current")).toBe("step")
    expect(chains[1]!.textContent).toBe("Pedido → En compra → Llegó → Usado")
    expect(within(note).getByText("Rechazado: Ya hay en la faena")).toBeTruthy()
  })

  it("sin permiso para ver la bandeja el código es texto; una nota ya cerrada no lleva el naranja", () => {
    const overview = partsOverview()
    overview.notes[0] = { ...overview.notes[0]!, status: "cerrada" }
    overviewView({ canOpenNotes: false, overview })
    expect(screen.queryByRole("link", { name: "NP-2026-0001" })).toBeNull()
    expect(screen.getByText("NP-2026-0001")).toBeTruthy()
    expect(screen.queryByText("Equipo detenido")).toBeNull()
  })

  it("sin notas, reservas ni consumos no dibuja nada", () => {
    const { container } = overviewView({ overview: partsOverview({ notes: [], available: [], consumptions: [] }) })
    expect(container).toBeEmptyDOMElement()
  })
})

describe("«Repuestos» de la OT: reservados sin usar", () => {
  it("dice cuánto queda reservado en qué faena y ofrece «Liberar» sólo con mant:np:manage", () => {
    overviewView()
    expect(screen.getByRole("heading", { name: "Reservados sin usar" })).toBeTruthy()
    const reserved = within(screen.getByRole("list", { name: "Repuestos reservados sin usar" }))
    expect(reserved.getByText("2 × Filtro de aceite")).toBeTruthy()
    expect(reserved.getByText(/Santa Fe/)).toBeTruthy()
    expect(reserved.getByRole("button", { name: "Liberar Filtro de aceite" })).toBeTruthy()
    cleanup()
    overviewView({ canManage: false })
    expect(screen.queryByRole("button", { name: /Liberar/ })).toBeNull()
    expect(screen.getByText("2 × Filtro de aceite")).toBeTruthy()
  })

  it("«Liberar» pide cantidad y motivo (≥5) y libera la reserva", async () => {
    actions.releaseAllocationAction.mockResolvedValue({ ok: true, message: "Liberaste 1 de «Filtro de aceite»; pasa a stock libre de Santa Fe." })
    overviewView({ overview: partsOverview({ available: [availablePart({ wholeOnly: false })] }) })
    fireEvent.click(screen.getByRole("button", { name: "Liberar Filtro de aceite" }))
    const dialog = within(await screen.findByRole("dialog"))
    expect(dialog.getByText(/pasa a stock libre de Santa Fe/)).toBeTruthy()
    expect(dialog.getByText(/deja de estar reservado para esta orden/)).toBeTruthy()
    // La línea de nota que lo reservó vuelve a pendiente (NP4-4): el diálogo lo avisa antes de confirmar.
    expect(dialog.getByText(/Si una nota de pedido lo reservó, esa línea vuelve a pendiente\./)).toBeTruthy()
    const quantity = dialog.getByRole("textbox", { name: /Cantidad a liberar/ }) as HTMLInputElement
    expect(quantity.value).toBe("2")
    const submit = dialog.getByRole("button", { name: "Liberar" }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(dialog.getByRole("textbox", { name: /Motivo/ }), { target: { value: "El equipo se trasladó" } })
    expect(submit.disabled).toBe(false)
    // Más de lo reservado no se puede liberar.
    fireEvent.change(quantity, { target: { value: "3" } })
    expect(submit.disabled).toBe(true)
    fireEvent.change(quantity, { target: { value: "1" } })
    fireEvent.click(submit)
    await waitFor(() => expect(actions.releaseAllocationAction).toHaveBeenCalledWith({ workOrderId: "ot-1", allocationId: "al-1", quantity: 1, reason: "El equipo se trasladó" }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toastSuccess).toHaveBeenCalledWith("Liberaste 1 de «Filtro de aceite»; pasa a stock libre de Santa Fe.")
  })

  it("una reserva ya liberada o agotada no se lista", () => {
    overviewView({ overview: partsOverview({ available: [availablePart({ remaining: 0 })] }) })
    expect(screen.queryByRole("heading", { name: "Reservados sin usar" })).toBeNull()
  })
})

describe("«Repuestos» de la OT: consumos", () => {
  it("cada repuesto declarado dice su estado de stock: Descontado, Pendiente de conciliar (con la nota), Revertido o Sin movimiento", () => {
    render(<OtConsumptions consumptions={partsOverview().consumptions} openableRecordIds={OPENABLE} />)
    const items = within(screen.getByRole("list", { name: "Repuestos declarados en los registros" })).getAllByRole("listitem")
    expect(items).toHaveLength(4)
    expect(items[0]!.textContent).toContain("1 × Filtro de aceite")
    expect(items[0]!.textContent).toContain("Descontado")
    expect(items[1]!.textContent).toContain("Pendiente de conciliar: No había stock al sincronizar")
    expect(items[2]!.textContent).toContain("Sin movimiento")
    expect(items[3]!.textContent).toContain("Revertido")
    // El folio enlaza al registro sólo cuando quien mira puede abrirlo; sin folio dice «Registro».
    expect(within(items[0]!).getByRole("link", { name: "MC-BIO-0007" }).getAttribute("href")).toBe("/mantencion/registros/rec-1")
    expect(within(items[1]!).queryByRole("link")).toBeNull()
    expect(items[3]!.textContent).toContain("Registro")
  })

  it("un repuesto de texto libre (sin movimiento de stock) no lleva insignia", () => {
    render(<OtConsumptions consumptions={[{ recordPartId: "rp-9", recordId: "rec-1", recordFolio: "MC-BIO-0007", productId: null, description: "Grasa", quantity: 1, source: "texto", stockStatus: "no_aplica", stockNote: null }]} openableRecordIds={OPENABLE} />)
    const item = within(screen.getByRole("list", { name: "Repuestos declarados en los registros" })).getByRole("listitem")
    expect(item.textContent).toBe("1 × Grasa · MC-BIO-0007")
  })
})

describe("OtPartsRequestsSection con el resumen unificado", () => {
  const request: WorkOrderPartsRequest = {
    requestId: "req-1", requestCode: "REP-0007", requestStatus: "approved", itemId: "it-1", description: "Filtro hidráulico", productId: null, sku: null, partNumber: null, isSparePart: false,
    quantity: 3, unitOfMeasure: "unidad", itemStatus: "purchased", itemStatusLabel: "Pendiente de recepción", orderId: "oc-1", orderCode: "OC-2026-0100", orderStatus: "sent",
    estimatedDelivery: "2099-01-15", quantityReceived: 1, requestedAt: "2026-11-02T10:00:00.000Z",
  }

  it("la tarjeta pasa a llamarse «Repuestos» y reúne notas, reservados, solicitudes y consumos", () => {
    const detail = otDetail({ partsRequests: [request], partsUsed: [{ recordId: "rec-1", recordFolio: "MC-BIO-0007", quantity: 9, description: "Texto viejo" }] })
    render(<OtPartsRequestsSection detail={detail} canOpenRequests partsRequestHref={null} overview={partsOverview()} canOpenNotes canManageNotes />)
    expect(screen.getByRole("heading", { name: "Repuestos", level: 2 })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Notas de pedido" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Reservados sin usar" })).toBeTruthy()
    // La tabla de solicitudes sigue ahí, con el nombre que dice lo que contiene.
    expect(screen.getByRole("heading", { name: "Solicitudes de compra" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "Solicitudes de compra" })).toBeTruthy()
    // Con el resumen, lo declarado sale de los consumos (con su estado), no del texto de los registros.
    expect(screen.getByRole("heading", { name: "Declarados en los registros" })).toBeTruthy()
    expect(screen.getByText("Descontado")).toBeTruthy()
    expect(screen.queryByText(/Texto viejo/)).toBeNull()
  })

  it("sin el resumen (sin permiso de notas) conserva lo de siempre", () => {
    const detail = otDetail({ partsRequests: [request], partsUsed: [{ recordId: "rec-1", recordFolio: "MC-BIO-0007", quantity: 2, description: "Manguera" }] })
    render(<OtPartsRequestsSection detail={detail} canOpenRequests partsRequestHref={null} />)
    expect(screen.getByRole("heading", { name: "Repuestos", level: 2 })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Notas de pedido" })).toBeNull()
    expect(screen.getByText("2 × Manguera")).toBeTruthy()
  })
})
