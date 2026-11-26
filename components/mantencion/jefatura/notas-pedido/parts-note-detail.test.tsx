// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { noteDetail, noteLine } from "./notas-pedido-fixtures"

const refresh = vi.fn()
const actions = {
  resolveNoteItemFromStockAction: vi.fn(),
  rejectNoteItemAction: vi.fn(),
  voidPartsNoteAction: vi.fn(),
}
const toastSuccess = vi.fn()

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }) }))
vi.mock("@/app/(app)/mantencion/notas-pedido/actions", () => actions)
vi.mock("@/lib/toast", () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn(), warning: vi.fn() } }))

const { PartsNoteDetailView } = await import("./parts-note-detail")
const { VoidNoteButton } = await import("./void-note-button")

const BUY = "/solicitudes/nueva?tipo=repuestos&np=n1"
/** Las filas de línea (no los renglones de compras que anidan dentro). */
const lineItems = () => {
  const list = screen.getByRole("list", { name: "Líneas del pedido" })
  return within(list).getAllByRole("listitem").filter((item) => item.parentElement === list)
}

function view(overrides: Partial<React.ComponentProps<typeof PartsNoteDetailView>> = {}) {
  return render(<PartsNoteDetailView note={noteDetail()} buyHref={BUY} canOpenWorkOrder canOpenRequests canOpenOrders {...overrides} />)
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe("PartsNoteDetailView: cabecera", () => {
  it("dice la OT, el equipo, la faena, quién la pidió y cuándo, el comentario y si el equipo está detenido", () => {
    view({ note: noteDetail({ equipmentStopped: true }) })
    const header = within(document.body)
    expect(header.getByRole("link", { name: "OT-BIO-0001" }).getAttribute("href")).toBe("/mantencion/ot/ot-1")
    expect(header.getByText("KA-135")).toBeTruthy()
    expect(header.getByText("Biodiversa")).toBeTruthy()
    expect(header.getByText(/Javier Roa · 20-11-2026/)).toBeTruthy()
    expect(header.getByText("Se rompió en la ruta; el equipo no puede salir.")).toBeTruthy()
    expect(header.getByText("Equipo detenido")).toBeTruthy()
  })

  it("sin permiso para abrir la OT el folio es texto, y una nota anulada dice su motivo y no ofrece acciones", () => {
    view({ canOpenWorkOrder: false, note: noteDetail({ status: "anulada", voidReason: "Se pidió para el equipo equivocado", lines: [noteLine({ resolution: "rechazada", resolutionReason: "Anulada", stage: "rechazado" })] }) })
    expect(screen.queryByRole("link", { name: "OT-BIO-0001" })).toBeNull()
    expect(screen.getByText("Esta nota está anulada")).toBeTruthy()
    expect(screen.getByText(/Se pidió para el equipo equivocado/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Sacar de bodega" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Comprar" })).toBeNull()
  })
})

describe("PartsNoteDetailView: líneas", () => {
  it("una fila por línea con su etapa en texto, «Llegó n · Usado m» y sus compras con enlaces a la solicitud y a la OC", () => {
    view({
      note: noteDetail({
        lines: [
          noteLine({
            resolution: "en_compra", stage: "en_bodega", arrived: 2, used: 1,
            purchases: [{ requestItemId: "ri-1", requestId: "req-1", requestCode: "REP-0007", status: "purchased", orderId: "ord-1", orderCode: "OC-2026-0100" }],
          }),
          noteLine({ id: "i2", description: "Correa", resolution: "rechazada", resolutionReason: "Ya hay en la faena", stage: "rechazado", resolvedByName: "Ana Pérez", resolvedAt: "2026-11-21T10:00:00.000Z", productId: null, freeInWorksite: null }),
        ],
      }),
    })
    const items = lineItems()
    expect(items).toHaveLength(2)
    const first = within(items[0]!)
    expect(first.getByText("Filtro de aceite")).toBeTruthy()
    expect(first.getByText("En bodega")).toBeTruthy()
    expect(first.getByText("Llegó 2 · Usado 1")).toBeTruthy()
    expect(first.getByRole("link", { name: "REP-0007" }).getAttribute("href")).toBe("/solicitudes/req-1")
    expect(first.getByRole("link", { name: "OC-2026-0100" }).getAttribute("href")).toBe("/compras/ord-1")
    // El estado de la compra sale en español, nunca el valor crudo.
    expect(first.getByText("Pendiente de recepción")).toBeTruthy()
    expect(first.queryByText("purchased")).toBeNull()
    const second = within(items[1]!)
    expect(second.getByText("Rechazada")).toBeTruthy()
    expect(second.getByText(/Ya hay en la faena/)).toBeTruthy()
    expect(second.getByText(/Ana Pérez · 21-11-2026/)).toBeTruthy()
  })

  it("sin permiso de solicitudes ni de compras, los códigos son texto", () => {
    view({
      canOpenRequests: false, canOpenOrders: false,
      note: noteDetail({ lines: [noteLine({ resolution: "en_compra", stage: "en_compra", purchases: [{ requestItemId: "ri-1", requestId: "req-1", requestCode: "REP-0007", status: "approved", orderId: "ord-1", orderCode: "OC-2026-0100" }] })] }),
    })
    expect(screen.getByText("REP-0007")).toBeTruthy()
    expect(screen.getByText("OC-2026-0100")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "REP-0007" })).toBeNull()
    expect(screen.queryByRole("link", { name: "OC-2026-0100" })).toBeNull()
  })

  it("las tres acciones sólo con canManage y sólo en una línea pendiente", () => {
    view({
      note: noteDetail({ lines: [noteLine(), noteLine({ id: "i2", description: "Correa", resolution: "en_compra", stage: "en_compra", productId: null, freeInWorksite: null })] }),
    })
    const [pending, resolved] = lineItems().map((item) => within(item))
    expect(pending!.getByRole("button", { name: "Sacar de bodega" })).toBeTruthy()
    expect(pending!.getByRole("link", { name: "Comprar" }).getAttribute("href")).toBe(BUY)
    expect(pending!.getByRole("button", { name: "Rechazar" })).toBeTruthy()
    expect(resolved!.queryByRole("button")).toBeNull()
    expect(resolved!.queryByRole("link", { name: "Comprar" })).toBeNull()
  })

  it("sin canManage sólo se ve el estado; sin permiso para pedir no hay «Comprar»", () => {
    view({ note: noteDetail({ canManage: false }) })
    expect(screen.queryByRole("button", { name: "Sacar de bodega" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Rechazar" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Comprar" })).toBeNull()
    cleanup()
    view({ buyHref: null })
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Comprar" })).toBeNull()
  })

  it("una línea en texto libre sin repuestos con stock en la faena no se saca de la bodega: lo dice y deja «Comprar»", () => {
    view({ note: noteDetail({ lines: [noteLine({ productId: null, freeInWorksite: null })], stockOptions: [] }) })
    expect((screen.getByRole("button", { name: "Sacar de bodega" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/No hay repuestos con stock libre en Biodiversa/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Comprar" })).toBeTruthy()
  })

  it("una línea en texto libre se saca de la bodega eligiendo el repuesto entre los que tienen stock (lo encontró la E2E)", async () => {
    actions.resolveNoteItemFromStockAction.mockResolvedValue({ ok: true, message: "Apartado." })
    view({ note: noteDetail({
      lines: [noteLine({ productId: null, productName: null, freeInWorksite: null, description: "Filtro de aceite motor", quantity: 1 })],
      stockOptions: [{ productId: "p9", name: "Filtro de aceite FA-1", partNumber: "FA-1", unit: "unidad", free: 3 }],
    }) })
    fireEvent.click(screen.getByRole("button", { name: "Sacar de bodega" }))
    const dialog = within(await screen.findByRole("dialog"))
    expect(dialog.getByText(/El mecánico pidió «Filtro de aceite motor»/)).toBeTruthy()
    expect(dialog.getByText("3 libres en Biodiversa")).toBeTruthy()
    fireEvent.click(dialog.getByRole("button", { name: "Sacar de bodega" }))
    await waitFor(() => expect(actions.resolveNoteItemFromStockAction).toHaveBeenCalledWith({ noteId: "n1", itemId: "i1", productId: "p9", quantity: 1 }))
  })
})

describe("«Sacar de bodega»", () => {
  it("muestra lo libre en la faena, pide cantidad y llama a resolver desde el stock", async () => {
    actions.resolveNoteItemFromStockAction.mockResolvedValue({ ok: true, message: "Apartaste 2 de «Filtro de aceite» para la OT." })
    view()
    fireEvent.click(screen.getByRole("button", { name: "Sacar de bodega" }))
    const dialog = within(await screen.findByRole("dialog"))
    expect(dialog.getByText("5 libres en Biodiversa")).toBeTruthy()
    // Por omisión, lo pedido (tope: lo libre).
    const quantity = dialog.getByRole("textbox", { name: /Cantidad/ }) as HTMLInputElement
    expect(quantity.value).toBe("2")
    fireEvent.change(quantity, { target: { value: "9" } })
    expect((dialog.getByRole("button", { name: "Sacar de bodega" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(quantity, { target: { value: "2" } })
    fireEvent.click(dialog.getByRole("button", { name: "Sacar de bodega" }))
    await waitFor(() => expect(actions.resolveNoteItemFromStockAction).toHaveBeenCalledWith({ noteId: "n1", itemId: "i1", productId: "p1", quantity: 2 }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toastSuccess).toHaveBeenCalledWith("Apartaste 2 de «Filtro de aceite» para la OT.")
  })

  it("con menos stock libre que lo pedido, el tope es lo libre; sin nada libre no se puede confirmar", async () => {
    view({ note: noteDetail({ lines: [noteLine({ quantity: 4, freeInWorksite: 3 })] }) })
    fireEvent.click(screen.getByRole("button", { name: "Sacar de bodega" }))
    let dialog = within(await screen.findByRole("dialog"))
    expect((dialog.getByRole("textbox", { name: /Cantidad/ }) as HTMLInputElement).value).toBe("3")
    fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }))
    cleanup()

    view({ note: noteDetail({ lines: [noteLine({ freeInWorksite: 0 })] }) })
    fireEvent.click(screen.getByRole("button", { name: "Sacar de bodega" }))
    dialog = within(await screen.findByRole("dialog"))
    expect(dialog.getByText("0 libres en Biodiversa")).toBeTruthy()
    expect((dialog.getByRole("button", { name: "Sacar de bodega" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("el error del servidor queda dentro del diálogo, que sigue abierto", async () => {
    actions.resolveNoteItemFromStockAction.mockResolvedValue({ ok: false, message: "Otra orden ya reservó ese repuesto." })
    view()
    fireEvent.click(screen.getByRole("button", { name: "Sacar de bodega" }))
    const dialog = within(await screen.findByRole("dialog"))
    fireEvent.click(dialog.getByRole("button", { name: "Sacar de bodega" }))
    expect((await dialog.findByRole("alert")).textContent).toContain("Otra orden ya reservó ese repuesto.")
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})

describe("«Rechazar»", () => {
  it("exige un motivo de al menos 5 caracteres antes de llamar al servidor", async () => {
    actions.rejectNoteItemAction.mockResolvedValue({ ok: true })
    view()
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }))
    const dialog = within(await screen.findByRole("dialog"))
    const submit = dialog.getByRole("button", { name: "Rechazar" }) as HTMLButtonElement
    const reason = dialog.getByRole("textbox", { name: /Motivo/ })
    expect(submit.disabled).toBe(true)
    fireEvent.change(reason, { target: { value: "Ya" } })
    expect(submit.disabled).toBe(true)
    fireEvent.change(reason, { target: { value: "    " } })
    expect(submit.disabled).toBe(true)
    fireEvent.change(reason, { target: { value: "Ya hay en la faena" } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(actions.rejectNoteItemAction).toHaveBeenCalledWith({ noteId: "n1", itemId: "i1", reason: "Ya hay en la faena" }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toastSuccess).toHaveBeenCalledWith("Línea rechazada")
  })

  it("el rechazo del servidor se ve en el diálogo", async () => {
    actions.rejectNoteItemAction.mockResolvedValue({ ok: false, message: "La línea ya fue resuelta por otra persona." })
    view()
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }))
    const dialog = within(await screen.findByRole("dialog"))
    fireEvent.change(dialog.getByRole("textbox", { name: /Motivo/ }), { target: { value: "No corresponde" } })
    fireEvent.click(dialog.getByRole("button", { name: "Rechazar" }))
    expect((await dialog.findByRole("alert")).textContent).toContain("La línea ya fue resuelta por otra persona.")
  })
})

describe("VoidNoteButton", () => {
  it("«Anular nota» pide el motivo y anula la nota", async () => {
    actions.voidPartsNoteAction.mockResolvedValue({ ok: true })
    render(<VoidNoteButton noteId="n1" code="NP-2026-0001" />)
    fireEvent.click(screen.getByRole("button", { name: "Anular nota" }))
    const dialog = within(await screen.findByRole("dialog"))
    expect(dialog.getByText("Anular NP-2026-0001")).toBeTruthy()
    const submit = dialog.getByRole("button", { name: "Anular nota" }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(dialog.getByRole("textbox", { name: /Motivo/ }), { target: { value: "Se pidió para el equipo equivocado" } })
    fireEvent.click(submit)
    await waitFor(() => expect(actions.voidPartsNoteAction).toHaveBeenCalledWith({ noteId: "n1", reason: "Se pidió para el equipo equivocado" }))
    expect(toastSuccess).toHaveBeenCalledWith("Nota anulada")
  })
})
