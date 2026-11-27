import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Las acciones de la bandeja revalidan el permiso (`mant:np:manage`), validan la entrada y delegan en los
 * servicios de L3/L4 (aquí simulados): lo que se prueba es el cableado, el alcance de «Liberar» y el refresco.
 */

const guard = vi.hoisted(() => vi.fn())
const revalidatePath = vi.hoisted(() => vi.fn())
const revalidateTag = vi.hoisted(() => vi.fn())
const viewer = vi.hoisted(() => ({ current: { userId: "u-jefe", email: "jefe@chome.cl", permissions: ["mant:np:manage"], worksiteIds: ["ws-1"], isGlobal: false } }))
const services = vi.hoisted(() => ({
  resolveNoteItemFromStock: vi.fn(),
  rejectNoteItem: vi.fn(),
  voidPartsNote: vi.fn(),
  acceptPartsNote: vi.fn(),
  holdPartsNote: vi.fn(),
  rejectPartsNote: vi.fn(),
  reopenPartsNote: vi.fn(),
  conciliatePart: vi.fn(),
  sendToPurchase: vi.fn(),
  loadWorkOrderPartsOverview: vi.fn(),
  releaseAllocationTx: vi.fn(),
  transaction: vi.fn(async (run: (tx: unknown) => unknown) => run("tx")),
}))

vi.mock("@/db", () => ({ db: { transaction: services.transaction } }))
vi.mock("next/cache", () => ({ revalidatePath, revalidateTag }))
vi.mock("@/lib/auth/can", () => ({ guardAnyPermission: guard }))
vi.mock("@/lib/services/mantencion/access", () => ({ viewerFromSession: () => viewer.current }))
vi.mock("@/lib/services/mantencion/parts-notes/resolve", () => ({
  resolveNoteItemFromStock: services.resolveNoteItemFromStock, rejectNoteItem: services.rejectNoteItem,
}))
vi.mock("@/lib/services/mantencion/parts-notes/transitions", () => ({
  acceptPartsNote: services.acceptPartsNote, holdPartsNote: services.holdPartsNote, rejectPartsNote: services.rejectPartsNote,
  reopenPartsNote: services.reopenPartsNote, voidPartsNote: services.voidPartsNote,
}))
vi.mock("@/lib/services/mantencion/parts-notes/send-to-purchase", () => ({
  sendPartsNoteLinesToPurchase: services.sendToPurchase,
  NoLinesToSendError: class NoLinesToSendError extends Error {},
}))
vi.mock("@/lib/services/mantencion/parts-notes/query", () => ({ loadWorkOrderPartsOverview: services.loadWorkOrderPartsOverview }))
vi.mock("@/lib/services/mantencion/parts/conciliation", () => ({ conciliatePart: services.conciliatePart }))
vi.mock("@/lib/services/mantencion/parts", () => ({ releaseAllocationTx: services.releaseAllocationTx }))

const actions = await import("./actions")

const SESSION = { user: { id: "u-jefe" } }
const ALLOCATION = { workOrderId: "ot-1", allocationId: "al-1", productId: "p1", name: "Filtro de aceite", partNumber: null, unit: "unidad", wholeOnly: true, worksiteId: "ws-1", worksiteName: "Santa Fe", remaining: 2 }

beforeEach(() => {
  vi.clearAllMocks()
  viewer.current = { userId: "u-jefe", email: "jefe@chome.cl", permissions: ["mant:np:manage"], worksiteIds: ["ws-1"], isGlobal: false }
  guard.mockResolvedValue({ session: SESSION, error: null })
  services.resolveNoteItemFromStock.mockResolvedValue({ ok: true, message: "Apartaste 2." })
  services.rejectNoteItem.mockResolvedValue({ ok: true })
  services.voidPartsNote.mockResolvedValue({ ok: true })
  for (const service of [services.acceptPartsNote, services.holdPartsNote, services.rejectPartsNote, services.reopenPartsNote]) service.mockResolvedValue({ ok: true, message: "Listo." })
  services.conciliatePart.mockResolvedValue({ ok: true, message: "Descontado." })
  services.sendToPurchase.mockResolvedValue({ requestId: "rq1", requestCode: "SOL-1", approved: true, lineCount: 2, message: "2 líneas a Compras (SOL-1)." })
  services.loadWorkOrderPartsOverview.mockResolvedValue({ notes: [], available: [ALLOCATION], consumptions: [] })
  services.releaseAllocationTx.mockResolvedValue({ released: 2 })
})

describe("permiso", () => {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["resolveNoteItemFromStockAction", () => actions.resolveNoteItemFromStockAction({ noteId: "n1", itemId: "i1", productId: "p1", quantity: 1 })],
    ["rejectNoteItemAction", () => actions.rejectNoteItemAction({ noteId: "n1", itemId: "i1", reason: "Ya hay en la faena" })],
    ["voidPartsNoteAction", () => actions.voidPartsNoteAction({ noteId: "n1", reason: "Equipo equivocado" })],
    ["releaseAllocationAction", () => actions.releaseAllocationAction({ workOrderId: "ot-1", allocationId: "al-1", quantity: 1, reason: "Se trasladó" })],
    ["conciliatePartAction", () => actions.conciliatePartAction({ recordPartId: "rp-1", mode: "aplicar" })],
  ]

  it.each(calls)("%s exige mant:np:manage y no toca ningún servicio sin él", async (_name, call) => {
    guard.mockResolvedValue({ session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } })
    expect(await call()).toEqual({ ok: false, message: "No tienes permisos para realizar esta acción" })
    expect(guard).toHaveBeenCalledWith(["mant:np:manage"], "/mantencion/notas-pedido")
    for (const service of [services.resolveNoteItemFromStock, services.rejectNoteItem, services.voidPartsNote, services.conciliatePart, services.loadWorkOrderPartsOverview, services.transaction]) {
      expect(service).not.toHaveBeenCalled()
    }
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe("resolveNoteItemFromStockAction", () => {
  it("pasa quien actúa y la línea al servicio (sin el id de la nota) y refresca la bandeja, el detalle, las OT y el Panel", async () => {
    const result = await actions.resolveNoteItemFromStockAction({ noteId: "n1", itemId: "i1", productId: "p1", quantity: 2 })
    expect(result).toEqual({ ok: true, message: "Apartaste 2." })
    expect(services.resolveNoteItemFromStock).toHaveBeenCalledWith(viewer.current, { itemId: "i1", productId: "p1", quantity: 2 })
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/notas-pedido")
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/notas-pedido/n1")
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/ot/[id]", "page")
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/panel")
  })

  it("resolver una línea refresca «Mis pendientes» y los avisos del menú (sin la faena, invalida a todos)", async () => {
    // El `db` simulado no resuelve la faena de la nota: el refresco cae a invalidar los avisos sin acotar, que es lo seguro.
    await actions.resolveNoteItemFromStockAction({ noteId: "n1", itemId: "i1", productId: "p1", quantity: 2 })
    expect(revalidatePath).toHaveBeenCalledWith("/pendientes")
    expect(revalidateTag).toHaveBeenCalledWith("badge-counts", { expire: 0 })
  })

  it("rechaza una cantidad que no es positiva antes de llegar al servicio", async () => {
    for (const quantity of [0, -1]) {
      expect(await actions.resolveNoteItemFromStockAction({ noteId: "n1", itemId: "i1", productId: "p1", quantity })).toMatchObject({ ok: false, fieldErrors: { quantity: expect.any(Array) } })
    }
    expect(services.resolveNoteItemFromStock).not.toHaveBeenCalled()
  })

  it("un identificador con caracteres raros no llega a revalidatePath ni al servicio", async () => {
    expect(await actions.resolveNoteItemFromStockAction({ noteId: "../../admin", itemId: "i1", productId: "p1", quantity: 1 })).toMatchObject({ ok: false })
    expect(services.resolveNoteItemFromStock).not.toHaveBeenCalled()
  })

  it("el rechazo del servicio vuelve como mensaje, con su campo, y no refresca nada", async () => {
    services.resolveNoteItemFromStock.mockResolvedValue({ ok: false, message: "Sólo hay 1 libre.", field: "quantity" })
    expect(await actions.resolveNoteItemFromStockAction({ noteId: "n1", itemId: "i1", productId: "p1", quantity: 2 }))
      .toEqual({ ok: false, message: "Sólo hay 1 libre.", fieldErrors: { quantity: ["Sólo hay 1 libre."] } })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("un error inesperado del servicio no se filtra: sale el mensaje seguro", async () => {
    services.resolveNoteItemFromStock.mockRejectedValue(Object.assign(new Error("Failed query: select ..."), { query: "select ...", params: [] }))
    expect(await actions.resolveNoteItemFromStockAction({ noteId: "n1", itemId: "i1", productId: "p1", quantity: 1 }))
      .toEqual({ ok: false, message: "No se pudo reservar el repuesto de la bodega." })
  })
})

describe("rejectNoteItemAction, voidPartsNoteAction", () => {
  it("el motivo exige al menos 5 caracteres (sin contar los espacios) y viaja recortado", async () => {
    expect(await actions.rejectNoteItemAction({ noteId: "n1", itemId: "i1", reason: "  no  " })).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(Array) } })
    expect(await actions.voidPartsNoteAction({ noteId: "n1", reason: "x" })).toMatchObject({ ok: false })
    expect(services.rejectNoteItem).not.toHaveBeenCalled()
    expect(services.voidPartsNote).not.toHaveBeenCalled()

    await actions.rejectNoteItemAction({ noteId: "n1", itemId: "i1", reason: "  Ya hay en la faena  " })
    expect(services.rejectNoteItem).toHaveBeenCalledWith(viewer.current, { itemId: "i1", reason: "Ya hay en la faena" })
    await actions.voidPartsNoteAction({ noteId: "n1", reason: "Se pidió para el equipo equivocado" })
    expect(services.voidPartsNote).toHaveBeenCalledWith(viewer.current, { noteId: "n1", reason: "Se pidió para el equipo equivocado" })
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/notas-pedido/n1")
  })
})

describe("releaseAllocationAction", () => {
  const input = { workOrderId: "ot-1", allocationId: "al-1", quantity: 1, reason: "El equipo se trasladó" }

  it("libera dentro de una transacción, a nombre de quien actúa, y dice cuánto y a qué faena", async () => {
    const result = await actions.releaseAllocationAction(input)
    expect(result).toEqual({ ok: true, message: "Liberaste 2 de «Filtro de aceite»; pasa a stock libre de Santa Fe." })
    expect(services.transaction).toHaveBeenCalledTimes(1)
    expect(services.releaseAllocationTx).toHaveBeenCalledWith("tx", { allocationId: "al-1", quantity: 1, reason: "El equipo se trasladó", actorUserId: "u-jefe", userEmail: "jefe@chome.cl" })
    expect(services.loadWorkOrderPartsOverview).toHaveBeenCalledWith(viewer.current, "ot-1")
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/ot/[id]", "page")
  })

  it("dice qué líneas de nota volvieron a pendiente y refresca la ficha de cada nota (NP4-4)", async () => {
    const line = (itemId: string, noteId: string, noteCode: string, description: string, outcome: "pendiente" | "rechazada") =>
      ({ itemId, noteId, noteCode, description, quantity: 1, outcome, remainderItemId: null })
    services.releaseAllocationTx.mockResolvedValueOnce({ released: 2, returnedLines: [line("i1", "n1", "NP-2026-0002", "Filtro de combustible primario", "pendiente")] })
    expect(await actions.releaseAllocationAction(input)).toEqual({
      ok: true,
      message: "Liberaste 2 de «Filtro de aceite»; pasa a stock libre de Santa Fe. «Filtro de combustible primario» de NP-2026-0002 volvió a pendiente.",
    })
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/notas-pedido/n1")

    services.releaseAllocationTx.mockResolvedValueOnce({ released: 2, returnedLines: [line("i1", "n1", "NP-1", "Filtro", "pendiente"), line("i2", "n2", "NP-2", "Filtro", "pendiente"), line("i3", "n2", "NP-2", "Aceite", "rechazada")] })
    expect(await actions.releaseAllocationAction(input)).toEqual({
      ok: true,
      message: "Liberaste 2 de «Filtro de aceite»; pasa a stock libre de Santa Fe. 2 líneas de notas de pedido volvieron a pendiente. Una línea se rechazó sola porque la orden ya terminó.",
    })
  })

  it("una reserva que la OT no tiene (o que ya no está disponible) no se libera", async () => {
    expect(await actions.releaseAllocationAction({ ...input, allocationId: "al-ajena" })).toEqual({ ok: false, message: "Esa reserva ya no está disponible." })
    expect(services.transaction).not.toHaveBeenCalled()
  })

  it("una reserva de una faena fuera del alcance de quien actúa no se libera, aunque la lectura la devuelva", async () => {
    services.loadWorkOrderPartsOverview.mockResolvedValue({ notes: [], available: [{ ...ALLOCATION, worksiteId: "ws-9" }], consumptions: [] })
    expect(await actions.releaseAllocationAction(input)).toEqual({ ok: false, message: "No tienes permisos para realizar esta acción" })
    expect(services.transaction).not.toHaveBeenCalled()
    // Un rol global sí puede.
    viewer.current = { ...viewer.current, isGlobal: true, worksiteIds: [] }
    expect(await actions.releaseAllocationAction(input)).toMatchObject({ ok: true })
  })

  it("el motivo y la cantidad se validan antes de leer nada", async () => {
    expect(await actions.releaseAllocationAction({ ...input, reason: "no" })).toMatchObject({ ok: false })
    expect(await actions.releaseAllocationAction({ ...input, quantity: 0 })).toMatchObject({ ok: false })
    expect(services.loadWorkOrderPartsOverview).not.toHaveBeenCalled()
  })

  it("el rechazo del núcleo («Puedes liberar hasta 1») llega a la pantalla tal cual", async () => {
    services.releaseAllocationTx.mockRejectedValue(new Error("Puedes liberar hasta 1."))
    expect(await actions.releaseAllocationAction({ ...input, quantity: 2 })).toEqual({ ok: false, message: "Puedes liberar hasta 1." })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe("conciliatePartAction", () => {
  it("«aplicar» no lleva motivo; «sin_movimiento» lo exige", async () => {
    await actions.conciliatePartAction({ recordPartId: "rp-1", mode: "aplicar" })
    expect(services.conciliatePart).toHaveBeenLastCalledWith(viewer.current, { recordPartId: "rp-1", mode: "aplicar" })

    expect(await actions.conciliatePartAction({ recordPartId: "rp-1", mode: "sin_movimiento" })).toMatchObject({ ok: false })
    expect(await actions.conciliatePartAction({ recordPartId: "rp-1", mode: "sin_movimiento", reason: "ok" })).toMatchObject({ ok: false })
    expect(services.conciliatePart).toHaveBeenCalledTimes(1)

    await actions.conciliatePartAction({ recordPartId: "rp-1", mode: "sin_movimiento", reason: "Lo trajo el taller" })
    expect(services.conciliatePart).toHaveBeenLastCalledWith(viewer.current, { recordPartId: "rp-1", mode: "sin_movimiento", reason: "Lo trajo el taller" })
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/registros")
  })

  it("una conciliación rechazada no refresca nada", async () => {
    services.conciliatePart.mockResolvedValue({ ok: false, message: "Esa línea ya fue conciliada." })
    expect(await actions.conciliatePartAction({ recordPartId: "rp-1", mode: "aplicar" })).toEqual({ ok: false, message: "Esa línea ya fue conciliada." })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe("acciones de cabecera de la nota", () => {
  const HEADER: Array<[string, (input: unknown) => Promise<unknown>, ReturnType<typeof vi.fn>, string[]]> = [
    ["acceptPartsNoteAction", actions.acceptPartsNoteAction, services.acceptPartsNote, ["mant:np:manage"]],
    ["holdPartsNoteAction", actions.holdPartsNoteAction, services.holdPartsNote, ["mant:np:manage"]],
    ["rejectPartsNoteAction", actions.rejectPartsNoteAction, services.rejectPartsNote, ["mant:np:manage"]],
    ["voidPartsNoteAction", actions.voidPartsNoteAction, services.voidPartsNote, ["mant:np:manage"]],
    // Reabrir tiene su propio permiso: quien resuelve notas no necesariamente puede reabrirlas.
    ["reopenPartsNoteAction", actions.reopenPartsNoteAction, services.reopenPartsNote, ["mant:np:reopen"]],
  ]
  const input = { noteId: "n1", reason: "Se pidió para el equipo equivocado" }

  it.each(HEADER)("%s exige su permiso en el servidor y, sin él, no llama al servicio ni refresca nada", async (_name, call, service, permissions) => {
    guard.mockResolvedValue({ session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } })
    expect(await call(input)).toEqual({ ok: false, message: "No tienes permisos para realizar esta acción" })
    expect(guard).toHaveBeenCalledWith(permissions, "/mantencion/notas-pedido")
    expect(service).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("quien sólo ve notas (mant:np:view_own o view_worksite, sin manage) no llega a ningún servicio de cabecera", async () => {
    // El guard es el de la sesión real: aquí se simula con lo que devuelve para un usuario sin `mant:np:manage`.
    guard.mockImplementation(async (permissions: string[]) => (
      permissions.every((permission) => ["mant:np:view_own", "mant:np:view_worksite"].includes(permission))
        ? { session: SESSION, error: null }
        : { session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } }
    ))
    for (const [, call, service] of HEADER) {
      expect(await call(input)).toMatchObject({ ok: false })
      expect(service).not.toHaveBeenCalled()
    }
  })

  it.each(HEADER.filter(([name]) => name !== "acceptPartsNoteAction"))("%s exige un motivo de al menos 5 caracteres y viaja recortado", async (_name, call, service) => {
    expect(await call({ noteId: "n1", reason: "  no " })).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(Array) } })
    expect(await call({ noteId: "n1" })).toMatchObject({ ok: false })
    expect(service).not.toHaveBeenCalled()
    await call({ noteId: "n1", reason: "  Falta confirmar el equipo  " })
    expect(service).toHaveBeenCalledWith(viewer.current, { noteId: "n1", reason: "Falta confirmar el equipo" })
  })

  it("aceptar no pide motivo: acepta, envía sus líneas pendientes a compra y refresca la bandeja, la ficha, la cola, el Panel y Compras", async () => {
    expect(await actions.acceptPartsNoteAction({ noteId: "n1" })).toEqual({
      ok: true,
      message: "Aceptada. 2 líneas a Compras (SOL-1).",
      data: { requestId: "rq1", requestCode: "SOL-1", approved: true },
    })
    expect(services.acceptPartsNote).toHaveBeenCalledWith(viewer.current, { noteId: "n1" })
    expect(services.sendToPurchase).toHaveBeenCalledWith(SESSION, { noteId: "n1" })
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/notas-pedido")
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/notas-pedido/n1")
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/panel")
    expect(revalidatePath).toHaveBeenCalledWith("/pendientes")
    expect(revalidatePath).toHaveBeenCalledWith("/compras")
    expect(revalidatePath).toHaveBeenCalledWith("/solicitudes/rq1")
  })

  it("si la aprobación automática falla, la nota queda aceptada y el aviso dice que la solicitud espera en Aprobaciones, con su enlace", async () => {
    services.sendToPurchase.mockResolvedValue({
      requestId: "rq2", requestCode: "SOL-2", approved: false, lineCount: 1,
      message: "La solicitud SOL-2 quedó enviada a aprobación: No tienes acceso a esta faena.",
    })
    expect(await actions.acceptPartsNoteAction({ noteId: "n1" })).toEqual({
      ok: true,
      message: "Aceptada. La solicitud SOL-2 quedó enviada a aprobación: No tienes acceso a esta faena.",
      data: { requestId: "rq2", requestCode: "SOL-2", approved: false },
    })
  })

  it("una nota sin líneas pendientes queda aceptada y no hay nada que enviar: el mensaje es el de la aceptación", async () => {
    const { NoLinesToSendError } = await import("@/lib/services/mantencion/parts-notes/send-to-purchase")
    services.sendToPurchase.mockRejectedValue(new NoLinesToSendError("NP-1"))
    expect(await actions.acceptPartsNoteAction({ noteId: "n1" })).toEqual({ ok: true, message: "Listo." })
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/notas-pedido/n1")
  })

  it("si el envío a compra falla, la aceptación queda (se refresca la pantalla) y el mensaje lo dice, sin filtrar el error del motor", async () => {
    services.sendToPurchase.mockRejectedValue(new Error("El repuesto «Filtro» está inactivo"))
    expect(await actions.acceptPartsNoteAction({ noteId: "n1" })).toEqual({
      ok: false, message: "La nota quedó aceptada, pero no se pudo enviar a compra: El repuesto «Filtro» está inactivo",
    })
    expect(revalidatePath).toHaveBeenCalledWith("/mantencion/notas-pedido/n1")
    services.sendToPurchase.mockRejectedValue(Object.assign(new Error("Failed query: insert ..."), { query: "insert ...", params: [] }))
    expect(await actions.acceptPartsNoteAction({ noteId: "n1" })).toEqual({
      ok: false, message: "La nota quedó aceptada, pero no se pudo enviar a compra: error inesperado",
    })
  })

  it("si la aceptación se rechaza (estado, alcance), no se envía nada a compra ni se refresca", async () => {
    services.acceptPartsNote.mockResolvedValue({ ok: false, message: "La nota NP-1 está cerrada: no se puede aceptar." })
    expect(await actions.acceptPartsNoteAction({ noteId: "n1" })).toEqual({ ok: false, message: "La nota NP-1 está cerrada: no se puede aceptar." })
    expect(services.sendToPurchase).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("un identificador con caracteres raros no llega al servicio ni a revalidatePath", async () => {
    expect(await actions.acceptPartsNoteAction({ noteId: "../../admin" })).toMatchObject({ ok: false })
    expect(services.acceptPartsNote).not.toHaveBeenCalled()
    expect(services.sendToPurchase).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("el rechazo del servicio (estado, alcance o motivo) vuelve como mensaje y no refresca nada", async () => {
    services.holdPartsNote.mockResolvedValue({ ok: false, message: "La nota NP-1 ya está en espera." })
    expect(await actions.holdPartsNoteAction(input)).toEqual({ ok: false, message: "La nota NP-1 ya está en espera." })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("un error inesperado no se filtra: sale el mensaje seguro de cada acción", async () => {
    services.rejectPartsNote.mockRejectedValue(Object.assign(new Error("Failed query: update ..."), { query: "update ...", params: [] }))
    expect(await actions.rejectPartsNoteAction(input)).toEqual({ ok: false, message: "No se pudo rechazar la nota." })
    services.acceptPartsNote.mockRejectedValue(Object.assign(new Error("Failed query: update ..."), { query: "update ...", params: [] }))
    expect(await actions.acceptPartsNoteAction({ noteId: "n1" })).toEqual({ ok: false, message: "No se pudo aceptar la nota." })
  })
})
