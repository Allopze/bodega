// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { noteDetail, noteLine } from "./notas-pedido-fixtures"

const refresh = vi.fn()
const actions = {
  resolveNoteItemFromStockAction: vi.fn(),
  rejectNoteItemAction: vi.fn(),
  voidPartsNoteAction: vi.fn(),
  acceptPartsNoteAction: vi.fn(),
  holdPartsNoteAction: vi.fn(),
  rejectPartsNoteAction: vi.fn(),
  reopenPartsNoteAction: vi.fn(),
}
const toastSuccess = vi.fn()

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }) }))
vi.mock("@/app/(app)/mantencion/notas-pedido/actions", () => actions)
vi.mock("@/lib/toast", () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn(), warning: vi.fn() } }))

const { PartsNoteDetailView } = await import("./parts-note-detail")
const { NoteHeaderActions } = await import("./note-header-actions")

const BUY = "/solicitudes/nueva?tipo=repuestos&np=n1"
/** Las filas de línea (no los renglones de compras que anidan dentro). */
const lineItems = () => {
  const list = screen.getByRole("list", { name: "Líneas de la nota" })
  return within(list).getAllByRole("listitem").filter((item) => item.parentElement === list)
}

function view(overrides: Partial<React.ComponentProps<typeof PartsNoteDetailView>> = {}) {
  return render(<PartsNoteDetailView note={noteDetail()} buyHref={BUY} canOpenWorkOrder canOpenRequests canOpenOrders canOpenBodega={false} {...overrides} />)
}

beforeEach(() => vi.clearAllMocks())

// El selector de repuesto (Radix) desplaza la opción activa; jsdom no implementa `scrollIntoView`.
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true, value: vi.fn() })
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

  it("las dos tarjetas se llaman «Datos de la nota» y «Líneas de la nota», sin descripciones que repitan los botones", () => {
    view()
    expect(screen.getByRole("heading", { name: "Datos de la nota" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Líneas de la nota" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Pedido" })).toBeNull()
    expect(screen.queryByText(/Resuelve cada línea/)).toBeNull()
    cleanup()
    view({ note: noteDetail({ canManage: false, canBuy: false }) })
    expect(screen.queryByText(/Dónde está cada repuesto pedido/)).toBeNull()
  })

  it("sin permiso para abrir la OT el folio es texto, y una nota anulada dice su motivo y no ofrece acciones", () => {
    view({ canOpenWorkOrder: false, note: noteDetail({ status: "anulada", voidReason: "Se pidió para el equipo equivocado", lines: [noteLine({ resolution: "rechazada", resolutionReason: "Anulada", stage: "rechazado" })] }) })
    expect(screen.queryByRole("link", { name: "OT-BIO-0001" })).toBeNull()
    expect(screen.getByText("Esta nota está anulada")).toBeTruthy()
    expect(screen.getByText(/Se pidió para el equipo equivocado/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Reservar de bodega" })).toBeNull()
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
    expect(first.getByText("Reservado")).toBeTruthy()
    // La cadena de avance de la línea: lo que llegó y lo usado, sobre lo pedido.
    expect(first.getByText("Llegó 2/2")).toBeTruthy()
    expect(first.getByText("Usado 1/2")).toBeTruthy()
    expect(first.getByRole("link", { name: "REP-0007" }).getAttribute("href")).toBe("/solicitudes/req-1")
    expect(first.getByRole("link", { name: "OC-2026-0100" }).getAttribute("href")).toBe("/compras/ord-1")
    // El estado de la compra sale en español, nunca el valor crudo.
    expect(first.getByText("Pendiente de recepción")).toBeTruthy()
    expect(first.queryByText("purchased")).toBeNull()
    const second = within(items[1]!)
    expect(second.getByText("Rechazado")).toBeTruthy()
    expect(second.getByText(/Ya hay en la faena/)).toBeTruthy()
    expect(second.getByText(/Ana Pérez · 21-11-2026/)).toBeTruthy()
  })

  it("NAV-7: cada línea del catálogo enlaza a Bodega, filtrada por su producto y por la faena de la OT", () => {
    view({
      canOpenBodega: true,
      note: noteDetail({
        worksiteId: "ws-cab",
        lines: [
          noteLine({ id: "i1", description: "Filtro de aceite", productId: "prod-1" }),
          noteLine({ id: "i2", description: "Correa", productId: "prod-2", resolution: "rechazada", stage: "rechazado", resolutionReason: "Ya hay en la faena" }),
          // Texto libre del mecánico: no hay producto que mirar.
          noteLine({ id: "i3", description: "Sello a medida", productId: null, freeInWorksite: null }),
        ],
      }),
    })
    const [first, second, free] = lineItems().map((item) => within(item))
    expect(first!.getByRole("link", { name: "Ver en bodega: Filtro de aceite" }).getAttribute("href")).toBe("/bodega?vista=kardex&producto=prod-1&faena=ws-cab")
    expect(first!.getByText("Ver en bodega")).toBeTruthy()
    // También las líneas ya resueltas: mirar el stock no depende de que la línea siga pendiente.
    expect(second!.getByRole("link", { name: "Ver en bodega: Correa" }).getAttribute("href")).toBe("/bodega?vista=kardex&producto=prod-2&faena=ws-cab")
    expect(free!.queryByRole("link", { name: /Ver en bodega/ })).toBeNull()
  })

  it("NAV-7: sin el permiso de Bodega no se ofrece el enlace, aunque la línea tenga producto", () => {
    view({ canOpenBodega: false })
    expect(screen.queryByRole("link", { name: /Ver en bodega/ })).toBeNull()
    expect(screen.queryByText("Ver en bodega")).toBeNull()
  })

  it("una línea reservada del stock dice «Reservado» y quién la reservó, no «En bodega» ni «Sacada de la bodega»", () => {
    view({
      note: noteDetail({
        lines: [noteLine({ resolution: "desde_stock", stage: "en_bodega", arrived: 2, resolvedByName: "Ana Pérez", resolvedAt: "2026-11-21T10:00:00.000Z" })],
      }),
    })
    const line = within(lineItems()[0]!)
    expect(line.getByText("Reservado")).toBeTruthy()
    expect(line.getByText(/^Reservado por Ana Pérez · 21-11-2026/)).toBeTruthy()
    expect(line.queryByText(/En bodega|Sacada de la bodega/)).toBeNull()
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
    expect(pending!.getByRole("button", { name: "Reservar de bodega" })).toBeTruthy()
    expect(pending!.getByRole("link", { name: "Comprar" }).getAttribute("href")).toBe(BUY)
    expect(pending!.getByRole("button", { name: "Rechazar" })).toBeTruthy()
    expect(resolved!.queryByRole("button")).toBeNull()
    expect(resolved!.queryByRole("link", { name: "Comprar" })).toBeNull()
  })

  it("sin canManage sólo se ve el estado; sin permiso para pedir no hay «Comprar»", () => {
    view({ note: noteDetail({ canManage: false, canBuy: false }) })
    expect(screen.queryByRole("button", { name: "Reservar de bodega" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Rechazar" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Comprar" })).toBeNull()
    cleanup()
    view({ buyHref: null })
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Comprar" })).toBeNull()
  })

  it("una línea en texto libre sin repuestos con stock en la faena no se reserva de la bodega: lo dice y deja «Comprar»", () => {
    view({ note: noteDetail({ lines: [noteLine({ productId: null, freeInWorksite: null })], stockOptions: [] }) })
    expect((screen.getByRole("button", { name: "Reservar de bodega" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/No hay repuestos con stock libre en Biodiversa/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Comprar" })).toBeTruthy()
  })

  it("una línea en texto libre se reserva de la bodega eligiendo el repuesto entre los que tienen stock (lo encontró la E2E)", async () => {
    actions.resolveNoteItemFromStockAction.mockResolvedValue({ ok: true, message: "Reservado." })
    view({ note: noteDetail({
      lines: [noteLine({ productId: null, productName: null, freeInWorksite: null, description: "Filtro de aceite motor", quantity: 1 })],
      stockOptions: [{ productId: "p9", name: "Filtro de aceite FA-1", partNumber: "FA-1", unit: "unidad", free: 3 }],
    }) })
    fireEvent.click(screen.getByRole("button", { name: "Reservar de bodega" }))
    const dialog = within(await screen.findByRole("dialog"))
    expect(dialog.getByText(/El mecánico pidió «Filtro de aceite motor»/)).toBeTruthy()
    // Aunque haya un solo repuesto con stock, no se preselecciona: puede no ser el que pidió el mecánico.
    expect((dialog.getByRole("button", { name: "Reservar de bodega" }) as HTMLButtonElement).disabled).toBe(true)
    // Sin repuesto elegido no se muestra saldo (ni el «no hay stock», que confundía).
    expect(dialog.queryByText(/libres en Biodiversa/)).toBeNull()
    expect(dialog.queryByText(/No hay stock libre/)).toBeNull()
    fireEvent.click(dialog.getByRole("combobox", { name: "Repuesto de la bodega" }))
    fireEvent.click(await screen.findByRole("option", { name: /Filtro de aceite FA-1/ }))
    expect(dialog.getByText("3 libres en Biodiversa")).toBeTruthy()
    fireEvent.click(dialog.getByRole("button", { name: "Reservar de bodega" }))
    await waitFor(() => expect(actions.resolveNoteItemFromStockAction).toHaveBeenCalledWith({ noteId: "n1", itemId: "i1", productId: "p9", quantity: 1 }))
  })
})

describe("«Reservar de bodega»", () => {
  it("muestra lo libre en la faena, pide cantidad y llama a resolver desde el stock", async () => {
    actions.resolveNoteItemFromStockAction.mockResolvedValue({ ok: true, message: "Reservaste 2 de «Filtro de aceite» para la OT." })
    view()
    fireEvent.click(screen.getByRole("button", { name: "Reservar de bodega" }))
    expect(await screen.findByRole("dialog", { name: "Reservar de bodega" })).toBeTruthy()
    const dialog = within(screen.getByRole("dialog"))
    expect(dialog.getByText("5 libres en Biodiversa")).toBeTruthy()
    // Por omisión, lo pedido (tope: lo libre).
    const quantity = dialog.getByRole("textbox", { name: /Cantidad a reservar/ }) as HTMLInputElement
    expect(quantity.value).toBe("2")
    // Se reserva todo lo pedido: no queda saldo que avisar.
    expect(dialog.queryByText(/queda como una línea pendiente nueva/)).toBeNull()
    fireEvent.change(quantity, { target: { value: "9" } })
    expect(dialog.getByText("Puedes reservar hasta 2.")).toBeTruthy()
    expect((dialog.getByRole("button", { name: "Reservar de bodega" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(quantity, { target: { value: "2" } })
    fireEvent.click(dialog.getByRole("button", { name: "Reservar de bodega" }))
    await waitFor(() => expect(actions.resolveNoteItemFromStockAction).toHaveBeenCalledWith({ noteId: "n1", itemId: "i1", productId: "p1", quantity: 2 }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toastSuccess).toHaveBeenCalledWith("Reservaste 2 de «Filtro de aceite» para la OT.")
  })

  it("con menos stock libre que lo pedido, el tope es lo libre; sin nada libre no se puede confirmar", async () => {
    view({ note: noteDetail({ lines: [noteLine({ quantity: 4, freeInWorksite: 3 })] }) })
    fireEvent.click(screen.getByRole("button", { name: "Reservar de bodega" }))
    let dialog = within(await screen.findByRole("dialog"))
    const quantity = dialog.getByRole("textbox", { name: /Cantidad/ }) as HTMLInputElement
    expect(quantity.value).toBe("3")
    // Reservar menos de lo pedido resuelve sólo esa cantidad: el diálogo avisa, antes de confirmar, que el saldo queda como una línea pendiente nueva (NP4-3).
    expect(dialog.getByText("Reservas 3 de 4: el saldo (1) queda como una línea pendiente nueva de esta nota, para comprarlo o rechazarlo.")).toBeTruthy()
    fireEvent.change(quantity, { target: { value: "1,5" } })
    expect(dialog.getByText("Reservas 1,5 de 4: el saldo (2,5) queda como una línea pendiente nueva de esta nota, para comprarlo o rechazarlo.")).toBeTruthy()
    fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }))
    cleanup()

    view({ note: noteDetail({ lines: [noteLine({ freeInWorksite: 0 })] }) })
    fireEvent.click(screen.getByRole("button", { name: "Reservar de bodega" }))
    dialog = within(await screen.findByRole("dialog"))
    expect(dialog.getByText("0 libres en Biodiversa")).toBeTruthy()
    expect((dialog.getByRole("button", { name: "Reservar de bodega" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("el error del servidor queda dentro del diálogo, que sigue abierto", async () => {
    actions.resolveNoteItemFromStockAction.mockResolvedValue({ ok: false, message: "Otra orden ya reservó ese repuesto." })
    view()
    fireEvent.click(screen.getByRole("button", { name: "Reservar de bodega" }))
    const dialog = within(await screen.findByRole("dialog"))
    fireEvent.click(dialog.getByRole("button", { name: "Reservar de bodega" }))
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

describe("NoteHeaderActions", () => {
  const mount = (keys: React.ComponentProps<typeof NoteHeaderActions>["actions"]) => render(<NoteHeaderActions noteId="n1" code="NP-2026-0001" actions={keys} />)
  const buttons = () => screen.queryAllByRole("button").map((button) => button.textContent)

  it("muestra sólo las acciones que se le pasan, en su orden, y nada si no hay ninguna", () => {
    mount(["aceptar", "en_espera", "rechazar", "anular"])
    expect(buttons()).toEqual(["Aceptar", "Poner en espera", "Rechazar nota", "Anular nota"])
    cleanup()
    mount(["reabrir"])
    expect(buttons()).toEqual(["Reabrir"])
    cleanup()
    const { container } = mount([])
    expect(container.textContent).toBe("")
  })

  it("«Aceptar» llama a la acción de inmediato: sin diálogo de confirmación ni motivo", async () => {
    actions.acceptPartsNoteAction.mockResolvedValue({ ok: true, message: "La nota NP-2026-0001 quedó aceptada." })
    mount(["aceptar"])
    fireEvent.click(screen.getByRole("button", { name: "Aceptar" }))
    await waitFor(() => expect(actions.acceptPartsNoteAction).toHaveBeenCalledWith({ noteId: "n1" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toastSuccess).toHaveBeenCalledWith("La nota NP-2026-0001 quedó aceptada.")
  })

  it("si «Aceptar» se rechaza en el servidor, la página no se refresca ni se cierra nada", async () => {
    actions.acceptPartsNoteAction.mockResolvedValue({ ok: false, message: "La nota NP-2026-0001 está cerrada: no se puede aceptar." })
    mount(["aceptar"])
    fireEvent.click(screen.getByRole("button", { name: "Aceptar" }))
    await waitFor(() => expect(actions.acceptPartsNoteAction).toHaveBeenCalled())
    expect(refresh).not.toHaveBeenCalled()
  })

  it.each([
    ["Poner en espera", "holdPartsNoteAction", "Poner NP-2026-0001 en espera", "Nota en espera"],
    ["Rechazar nota", "rejectPartsNoteAction", "Rechazar NP-2026-0001", "Nota rechazada"],
    ["Anular nota", "voidPartsNoteAction", "Anular NP-2026-0001", "Nota anulada"],
    ["Reabrir", "reopenPartsNoteAction", "Reabrir NP-2026-0001", "Nota reabierta"],
  ] as const)("«%s» pide un motivo de al menos 5 caracteres antes de llamar a %s", async (label, action, title, success) => {
    actions[action].mockResolvedValue({ ok: true })
    mount([label === "Poner en espera" ? "en_espera" : label === "Rechazar nota" ? "rechazar" : label === "Anular nota" ? "anular" : "reabrir"])
    fireEvent.click(screen.getByRole("button", { name: label }))
    const dialog = within(await screen.findByRole("dialog"))
    expect(dialog.getByText(title)).toBeTruthy()
    const submit = dialog.getByRole("button", { name: label }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(dialog.getByRole("textbox", { name: /Motivo/ }), { target: { value: "no" } })
    expect(submit.disabled).toBe(true)
    fireEvent.change(dialog.getByRole("textbox", { name: /Motivo/ }), { target: { value: "  Falta confirmar el equipo  " } })
    fireEvent.click(submit)
    await waitFor(() => expect(actions[action]).toHaveBeenCalledWith({ noteId: "n1", reason: "Falta confirmar el equipo" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(success))
  })

  it("el rechazo del servidor queda dentro del diálogo, con lo escrito, y el diálogo sigue abierto", async () => {
    actions.voidPartsNoteAction.mockResolvedValue({ ok: false, message: "«Filtro» tiene una compra en curso: anula esa solicitud antes de anular la nota NP-2026-0001." })
    mount(["anular"])
    fireEvent.click(screen.getByRole("button", { name: "Anular nota" }))
    const dialog = within(await screen.findByRole("dialog"))
    fireEvent.change(dialog.getByRole("textbox", { name: /Motivo/ }), { target: { value: "Se pidió para el equipo equivocado" } })
    fireEvent.click(dialog.getByRole("button", { name: "Anular nota" }))
    expect((await dialog.findByRole("alert")).textContent).toContain("tiene una compra en curso")
    expect((dialog.getByRole("textbox", { name: /Motivo/ }) as HTMLTextAreaElement).value).toBe("Se pidió para el equipo equivocado")
  })
})

describe("PartsNoteDetailView: estado, historial y notas sin OT", () => {
  const events = [
    { id: "e1", kind: "creada" as const, fromStatus: null, toStatus: "enviada" as const, reason: null, actorName: "Javier Roa", itemDescription: null, createdAt: "2026-11-20T15:00:00.000Z" },
    { id: "e2", kind: "transicion" as const, fromStatus: "enviada" as const, toStatus: "aceptada" as const, reason: null, actorName: "Ana Pérez", itemDescription: null, createdAt: "2026-11-21T09:30:00.000Z" },
    { id: "e3", kind: "transicion" as const, fromStatus: "aceptada" as const, toStatus: "en_espera" as const, reason: "Falta confirmar el equipo", actorName: "Ana Pérez", itemDescription: null, createdAt: "2026-11-21T10:00:00.000Z" },
    { id: "e4", kind: "transicion" as const, fromStatus: "en_espera" as const, toStatus: "aceptada" as const, reason: null, actorName: null, itemDescription: "Filtro de aceite", createdAt: "2026-11-22T08:15:00.000Z" },
  ]

  it("«Historial» lista cada evento con fecha y hora, de qué estado a cuál, el motivo y quién (o «Automático»)", () => {
    view({ note: noteDetail({ status: "aceptada", events }) })
    expect(screen.getByRole("heading", { name: "Historial" })).toBeTruthy()
    const items = within(screen.getByRole("list", { name: "Historial de la nota" })).getAllByRole("listitem")
    expect(items).toHaveLength(4)
    expect(items[0]!.textContent).toContain("20-11-2026")
    expect(items[0]!.textContent).toContain("Nota creada")
    expect(items[0]!.textContent).toContain("Enviada")
    expect(items[0]!.textContent).toContain("Javier Roa")
    expect(items[1]!.textContent).toMatch(/Enviada.*Aceptada/)
    expect(items[1]!.textContent).toContain("Ana Pérez")
    expect(items[2]!.textContent).toMatch(/Aceptada.*En espera/)
    expect(items[2]!.textContent).toContain("Motivo: Falta confirmar el equipo")
    // Sin quien actuó, lo hizo el sistema; y dice qué línea lo causó.
    expect(items[3]!.textContent).toContain("Automático")
    expect(items[3]!.textContent).toContain("Línea: Filtro de aceite")
    // La hora viaja en un <time> con la fecha completa.
    expect(items[0]!.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-20T15:00:00.000Z")
  })

  it("una nota en espera muestra el motivo de la espera, y quien la administra lee que se acepta para seguir", () => {
    view({ note: noteDetail({ status: "en_espera", holdReason: "Falta confirmar el equipo" }) })
    expect(screen.getByText("Esta nota está en espera")).toBeTruthy()
    expect(screen.getByText(/Motivo: Falta confirmar el equipo/)).toBeTruthy()
    expect(screen.getByText(/Acéptala para seguir resolviendo/)).toBeTruthy()
    // En espera las líneas no se resuelven: el servidor lo rechaza y la pantalla no ofrece los botones.
    expect(screen.queryByRole("button", { name: "Reservar de bodega" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Rechazar" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Comprar" })).toBeNull()
    cleanup()
    view({ note: noteDetail({ status: "en_espera", holdReason: "Falta confirmar el equipo", canManage: false, canBuy: false }) })
    expect(screen.getByText(/Motivo: Falta confirmar el equipo/)).toBeTruthy()
    expect(screen.queryByText(/Acéptala para seguir/)).toBeNull()
  })

  it("dice el estado con su insignia y desde cuándo, y la referencia externa de una nota importada", () => {
    view({ note: noteDetail({ status: "en_compra", externalRef: "CHOME-123", statusSince: "2026-11-20T15:00:00.000Z" }) })
    const estado = screen.getByText("Estado", { selector: "dt" }).parentElement!
    expect(within(estado).getByText("En compra")).toBeTruthy()
    expect(screen.getByText("CHOME-123")).toBeTruthy()
  })

  it("sin OT: «Sin OT», «Sin equipo», cargo y proveedor sugerido por línea, y sin «Reservar de bodega»", () => {
    view({
      note: noteDetail({
        workOrderId: null, workOrderFolio: null, equipmentCode: "", equipmentPlate: "", urgent: true,
        lines: [
          noteLine({ charge: { vehicleId: "v1", costCenterId: null, label: "KA-135 · RBYD-98" }, suggestedSupplierId: "s1", suggestedSupplierName: "Repuestos Tr", supplierHint: "Repuestos Tr" }),
          noteLine({ id: "i2", description: "Grasa", productId: null, freeInWorksite: null, charge: { vehicleId: null, costCenterId: null, label: "CR43-51-52" }, supplierHint: "Don Pepe" }),
        ],
      }),
    })
    expect(screen.getByText("Sin OT")).toBeTruthy()
    expect(screen.getByText("Sin equipo")).toBeTruthy()
    expect(screen.queryByRole("link", { name: /OT-BIO/ })).toBeNull()
    expect(screen.getByText("Urgente")).toBeTruthy()
    const [first, second] = lineItems().map((item) => within(item))
    expect(first!.getByText("KA-135 · RBYD-98")).toBeTruthy()
    expect(first!.getByText("Repuestos Tr")).toBeTruthy()
    expect(second!.getByText("CR43-51-52")).toBeTruthy()
    expect(second!.getByText("Don Pepe")).toBeTruthy()
    // Sin OT no hay reserva: sólo comprar o rechazar.
    expect(screen.queryByRole("button", { name: "Reservar de bodega" })).toBeNull()
    expect(first!.getByRole("link", { name: "Comprar" })).toBeTruthy()
    expect(first!.getByRole("button", { name: "Rechazar" })).toBeTruthy()
  })

  it("sin OT lo que llegó queda «En la faena» y la cadena de avance termina en «Llegó» (no hay consumo de una reserva)", () => {
    view({
      note: noteDetail({
        workOrderId: null, workOrderFolio: null,
        lines: [noteLine({ resolution: "en_compra", stage: "en_bodega", arrived: 2, quantity: 2, purchases: [] })],
      }),
    })
    const line = within(lineItems()[0]!)
    expect(line.getByText("En la faena")).toBeTruthy()
    expect(line.queryByText("Reservado")).toBeNull()
    expect(line.getByText("Llegó 2/2")).toBeTruthy()
    expect(line.queryByText(/^Usado/)).toBeNull()
  })

  it("quien sólo compra (mant:np:purchase) ve «Comprar» pero no «Reservar de bodega» ni «Rechazar»", () => {
    view({ note: noteDetail({ canManage: false, canBuy: true }) })
    const line = within(lineItems()[0]!)
    expect(line.getByRole("link", { name: "Comprar" }).getAttribute("href")).toBe(BUY)
    expect(line.queryByRole("button", { name: "Reservar de bodega" })).toBeNull()
    expect(line.queryByRole("button", { name: "Rechazar" })).toBeNull()
  })

  it("modo lectura (view_own): ningún botón de línea ni «Comprar», aunque la página tuviera un enlace", () => {
    view({ note: noteDetail({ canManage: false, canBuy: false }) })
    expect(screen.queryAllByRole("button")).toHaveLength(0)
    expect(screen.queryByRole("link", { name: "Comprar" })).toBeNull()
  })
})
