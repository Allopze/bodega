import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import {
  IDS,
  contextOf,
  createPartsNote,
  link,
  makeProduct,
  noteRow,
  opId,
  orderFor,
  registerReceipt,
  requestFor,
  resetState,
  setupDatabase,
  testDb,
  viewerOf,
} from "./np-transiciones-fixtures"

vi.mock("@/db", () => ({
  get db() { return (globalThis as { __db?: unknown }).__db },
  get Tx() { return undefined },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn(async () => undefined),
  sendBatchEmails: vi.fn(async () => undefined),
  getAppBaseUrl: () => "http://localhost",
}))

const query = await import("@/lib/services/mantencion/parts-notes/query")
const transitions = await import("@/lib/services/mantencion/parts-notes/transitions")
const { exportPartsNotes } = await import("@/lib/services/mantencion/parts-notes/export")

/**
 * Pestañas de la bandeja (fase 2, punto 3) y su antigüedad y urgentes (punto 4) contra Postgres de verdad. Una nota cae en UNA
 * pestaña según el recorrido de su compra: sin OC activa, «En compra»; con OC emitida o recibida en parte, «En recepción».
 * La antigüedad son días civiles de Chile desde el último evento del historial (`status_since`).
 */

beforeAll(async () => {
  await setupDatabase()
})

beforeEach(resetState)

type Line = { description: string; quantity?: number; productId?: string | null }

async function manual(input: { lines?: Line[]; urgent?: boolean; worksiteId?: string; viewerId?: string }) {
  const result = await createPartsNote(await viewerOf(input.viewerId ?? IDS.jefe), {
    clientOpId: opId(), worksiteId: input.worksiteId ?? IDS.wsBio, urgent: input.urgent ?? false,
    lines: (input.lines ?? [{ description: "Filtro de aceite" }]).map((line) => ({ unitOfMeasure: "unidad", quantity: 2, ...line })),
  })
  if (!result.ok) throw new Error(result.message)
  return result
}

const itemsOf = (noteId: string) => testDb.select().from(schema.mantPartsNoteItems).where(eq(schema.mantPartsNoteItems.noteId, noteId)).orderBy(schema.mantPartsNoteItems.sortOrder)

/** Una nota con una compra viva ligada a cada una de sus líneas (la solicitud ya enviada, sin OC todavía). */
async function boughtNote(input: { lines?: Line[]; urgent?: boolean; worksiteId?: string } = {}) {
  const note = await manual(input)
  const requests = []
  for (const item of await itemsOf(note.noteId)) {
    const request = await requestFor(item.id, "purchased")
    await link(item.id, request.itemId)
    requests.push({ noteItemId: item.id, ...request })
  }
  return { ...note, requests }
}

/** Fija desde cuándo está la nota en su estado actual: un último evento con esa fecha (el historial es de sólo agregar). */
async function sinceAt(noteId: string, createdAt: string) {
  const { status } = await noteRow(noteId)
  await testDb.insert(schema.mantPartsNoteEvents).values({ id: `ev-age-${noteId}`, noteId, kind: "migrada", fromStatus: null, toStatus: status, createdAt })
}

async function sessionOf(userId: string): Promise<Session> {
  const { viewer, userName } = await contextOf(userId)
  return { user: { id: viewer.userId, email: viewer.email, name: userName, permissions: viewer.permissions, worksiteIds: viewer.worksiteIds, isGlobal: viewer.isGlobal }, expires: "2099-01-01" } as unknown as Session
}

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id)
const page = { page: 1, pageSize: 50 }
const tabOf = async (noteId: string) => {
  const jefe = await viewerOf(IDS.jefe)
  const found: string[] = []
  for (const tab of ["por_revisar", "en_compra", "en_recepcion", "cerradas"] as const) {
    if (ids((await query.listPartsNotes(jefe, { tab, ...page })).rows).includes(noteId)) found.push(tab)
  }
  return found
}

describe("pestañas: el recorrido de la compra", () => {
  it("una nota recién enviada está «Por revisar» y trae sus líneas pendientes; en las demás pestañas la fila no las trae", async () => {
    const note = await manual({ lines: [{ description: "Filtro de aceite", quantity: 2 }, { description: "Correa", quantity: 1 }] })
    const jefe = await viewerOf(IDS.jefe)
    const [first, second] = await itemsOf(note.noteId)
    const inbox = await query.listPartsNotes(jefe, { tab: "por_revisar", ...page })
    expect(inbox.rows).toHaveLength(1)
    expect(inbox.rows[0]).toMatchObject({ id: note.noteId, status: "enviada", totalLines: 2 })
    expect(inbox.rows[0]!.pendingLines).toEqual([
      { id: first!.id, description: "Filtro de aceite", quantity: 2, unitOfMeasure: "unidad" },
      { id: second!.id, description: "Correa", quantity: 1, unitOfMeasure: "unidad" },
    ])
    expect(inbox.counts).toEqual({ por_revisar: 1, en_compra: 0, en_recepcion: 0, cerradas: 0 })
    expect(await tabOf(note.noteId)).toEqual(["por_revisar"])
  })

  it("con la compra sin OC está «En compra»; al emitirse la OC pasa a «En recepción» aunque su estado siga siendo «en compra»", async () => {
    const note = await boughtNote()
    const jefe = await viewerOf(IDS.jefe)
    expect((await noteRow(note.noteId)).status).toBe("en_compra")
    expect(await tabOf(note.noteId)).toEqual(["en_compra"])
    const waiting = await query.listPartsNotes(jefe, { tab: "en_compra", ...page })
    expect(waiting.counts).toEqual({ por_revisar: 0, en_compra: 1, en_recepcion: 0, cerradas: 0 })
    // Sin nada por resolver, la fila no lleva líneas pendientes.
    expect(waiting.rows[0]).toMatchObject({ id: note.noteId, pendingLines: [], totalLines: 1 })

    const [bought] = note.requests as [typeof note.requests[number]]
    const order = await orderFor(bought.itemId, null, 2)
    expect((await noteRow(note.noteId)).status).toBe("en_compra")
    expect(await tabOf(note.noteId)).toEqual(["en_recepcion"])
    expect((await query.listPartsNotes(jefe, { tab: "en_recepcion", ...page })).counts).toEqual({ por_revisar: 0, en_compra: 0, en_recepcion: 1, cerradas: 0 })

    // La OC se anula: la compra vuelve a quedar sin orden activa y la nota, a «En compra».
    await testDb.update(schema.purchaseOrders).set({ status: "cancelled" }).where(eq(schema.purchaseOrders.id, order.orderId))
    expect(await tabOf(note.noteId)).toEqual(["en_compra"])
    await testDb.update(schema.purchaseOrders).set({ status: "sent" }).where(eq(schema.purchaseOrders.id, order.orderId))
    expect(await tabOf(note.noteId)).toEqual(["en_recepcion"])
    // Una línea de OC anulada tampoco cubre la compra; borrar la OC (soft delete), tampoco.
    await testDb.update(schema.purchaseOrderItems).set({ status: "cancelled" }).where(eq(schema.purchaseOrderItems.id, order.ocItemId))
    expect(await tabOf(note.noteId)).toEqual(["en_compra"])
    await testDb.update(schema.purchaseOrderItems).set({ status: "issued" }).where(eq(schema.purchaseOrderItems.id, order.ocItemId))
    await testDb.update(schema.purchaseOrders).set({ deletedAt: new Date().toISOString() }).where(eq(schema.purchaseOrders.id, order.orderId))
    expect(await tabOf(note.noteId)).toEqual(["en_compra"])
  })

  it("recibida en parte está «En recepción» y al llegar todo, «Cerradas»; ninguna nota cae en dos pestañas", async () => {
    const product = await makeProduct("Filtro de combustible")
    const note = await boughtNote({ lines: [{ description: "Filtro de combustible", quantity: 3, productId: product }] })
    const [bought] = note.requests as [typeof note.requests[number]]
    const order = await orderFor(bought.itemId, product, 3)
    await registerReceipt({ purchaseOrderId: order.orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio, items: [{ purchaseOrderItemId: order.ocItemId, quantityReceived: 1 }] })
    expect((await noteRow(note.noteId)).status).toBe("recibida_parcial")
    expect(await tabOf(note.noteId)).toEqual(["en_recepcion"])

    await registerReceipt({ purchaseOrderId: order.orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio, items: [{ purchaseOrderItemId: order.ocItemId, quantityReceived: 2 }] })
    expect((await noteRow(note.noteId)).status).toBe("cerrada")
    expect(await tabOf(note.noteId)).toEqual(["cerradas"])
  })

  it("rechazadas y anuladas van a «Cerradas»; «En espera» y «Aceptada» siguen «Por revisar»", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const rejected = await manual({})
    await transitions.rejectPartsNote(jefe, { noteId: rejected.noteId, reason: "Ya hay en la faena" })
    const voided = await manual({})
    await transitions.voidPartsNote(jefe, { noteId: voided.noteId, reason: "Se pidió por error" })
    const accepted = await manual({})
    await transitions.acceptPartsNote(jefe, { noteId: accepted.noteId })
    const held = await manual({})
    await transitions.holdPartsNote(jefe, { noteId: held.noteId, reason: "Falta cotizar con el proveedor" })
    expect(await tabOf(rejected.noteId)).toEqual(["cerradas"])
    expect(await tabOf(accepted.noteId)).toEqual(["por_revisar"])
    expect(await tabOf(held.noteId)).toEqual(["por_revisar"])
  })

  it("sólo cuentan las compras vivas: un ítem rechazado o una solicitud cancelada sin OC no dejan la nota «En compra»", async () => {
    const note = await boughtNote({ lines: [{ description: "Filtro de aceite" }, { description: "Correa" }, { description: "Sello" }] })
    const [first, second, third] = note.requests as [typeof note.requests[number], typeof note.requests[number], typeof note.requests[number]]
    await orderFor(first.itemId, null, 2)
    // Las otras dos compras murieron sin OC (el estado de la nota ya está calculado: sólo se mira la compra viva).
    await testDb.update(schema.purchaseRequestItems).set({ status: "rejected" }).where(eq(schema.purchaseRequestItems.id, second.itemId))
    await testDb.update(schema.purchaseRequests).set({ status: "cancelled" }).where(eq(schema.purchaseRequests.id, third.requestId))
    expect(await tabOf(note.noteId)).toEqual(["en_recepcion"])
    // Una compra viva sin OC (aunque otra ya tenga la suya) la deja «En compra».
    await testDb.update(schema.purchaseRequestItems).set({ status: "purchased" }).where(eq(schema.purchaseRequestItems.id, second.itemId))
    expect(await tabOf(note.noteId)).toEqual(["en_compra"])
  })

  it("el alcance lo pone el servidor: quien sólo ve su faena no ve las pestañas de otra, y los conteos tampoco", async () => {
    await boughtNote()
    await boughtNote({ worksiteId: IDS.wsCho, viewerId: IDS.mecCho })
    const jefe = await viewerOf(IDS.jefe)
    const supervisor = await viewerOf(IDS.supBio)
    expect((await query.listPartsNotes(jefe, { tab: "en_compra", ...page })).counts.en_compra).toBe(2)
    const own = await query.listPartsNotes(supervisor, { tab: "en_compra", ...page })
    expect(own.counts.en_compra).toBe(1)
    expect(own.rows.map((row) => row.worksiteId)).toEqual([IDS.wsBio])
    expect((await query.listPartsNotes(supervisor, { tab: "en_compra", worksiteId: IDS.wsCho, ...page })).rows).toEqual([])
  })
})

describe("urgentes abiertas del alcance", () => {
  it("cuenta las urgentes de las tres pestañas abiertas, repartidas por pestaña, sin las cerradas ni las normales", async () => {
    const jefe = await viewerOf(IDS.jefe)
    await manual({ urgent: true })
    await manual({})
    const buying = await boughtNote({ urgent: true })
    const receiving = await boughtNote({ urgent: true })
    await orderFor(receiving.requests[0]!.itemId, null, 2)
    const closed = await manual({ urgent: true })
    await transitions.rejectPartsNote(jefe, { noteId: closed.noteId, reason: "Ya hay en la faena" })
    await boughtNote({ worksiteId: IDS.wsCho, viewerId: IDS.mecCho, urgent: true })

    const all = await query.listPartsNotes(jefe, { tab: "por_revisar", ...page })
    expect(all.urgentByTab).toEqual({ por_revisar: 1, en_compra: 2, en_recepcion: 1, cerradas: 0 })
    expect(all.urgentOpen).toBe(4)
    // La faena elegida acota la cifra; el resto de los filtros (la pestaña, la búsqueda) no.
    const onlyBio = await query.listPartsNotes(jefe, { tab: "cerradas", worksiteId: IDS.wsBio, q: "no-existe", ...page })
    expect(onlyBio.urgentByTab).toEqual({ por_revisar: 1, en_compra: 1, en_recepcion: 1, cerradas: 0 })
    expect(onlyBio.urgentOpen).toBe(3)
    // Quien ve una sola faena sólo cuenta las suyas.
    expect((await query.listPartsNotes(await viewerOf(IDS.supBio), { tab: "por_revisar", ...page })).urgentOpen).toBe(3)
    expect(buying.noteId).toBeTruthy()
  })

  it("el filtro de urgencia afina la pestaña; «sólo urgentes» deja primero lo más antiguo", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const calm = await boughtNote({})
    const urgentOld = await boughtNote({ urgent: true })
    const urgentNew = await boughtNote({ urgent: true })
    await testDb.update(schema.mantPartsNotes).set({ createdAt: "2026-11-01T15:00:00.000Z" }).where(eq(schema.mantPartsNotes.id, urgentOld.noteId))
    const both = await query.listPartsNotes(jefe, { tab: "en_compra", ...page })
    // Las tres pestañas abiertas ponen primero lo urgente y lo más antiguo.
    expect(ids(both.rows)).toEqual([urgentOld.noteId, urgentNew.noteId, calm.noteId])
    expect(ids((await query.listPartsNotes(jefe, { tab: "en_compra", urgent: true, ...page })).rows)).toEqual([urgentOld.noteId, urgentNew.noteId])
    expect(ids((await query.listPartsNotes(jefe, { tab: "en_compra", urgent: false, ...page })).rows)).toEqual([calm.noteId])
  })
})

describe("antigüedad en el estado actual", () => {
  // 1-dic 02:30 UTC es el 30-nov 23:30 en Chile (UTC-3): para la bandeja «hoy» es el 30 de noviembre.
  const NOW_CL = new Date("2026-12-01T02:30:00.000Z")

  async function agedBoard() {
    const fresh = await manual({})
    const edge = await manual({})
    const week = await manual({})
    const old = await manual({})
    const oldest = await manual({})
    await sinceAt(fresh.noteId, "2026-12-01T01:00:00.000Z") // 30-nov 22:00 en Chile: 0 días
    // 28-nov 15:00 UTC = 28-nov 12:00 en Chile: 2 días en Chile (0–2); contados con el día UTC de hoy (1-dic) serían 3 (3–6).
    await sinceAt(edge.noteId, "2026-11-28T15:00:00.000Z")
    await sinceAt(week.noteId, "2026-11-20T15:00:00.000Z") // 10 días
    await sinceAt(old.noteId, "2026-11-16T15:00:00.000Z") // 14 días: el límite del último tramo
    await sinceAt(oldest.noteId, "2026-10-01T15:00:00.000Z")
    return { fresh, edge, week, old, oldest }
  }

  it("reparte la pestaña en los cuatro tramos con el día de hoy en Chile, no el de UTC, y cada fila trae sus días", async () => {
    const board = await agedBoard()
    const jefe = await viewerOf(IDS.jefe)
    const inbox = await query.listPartsNotes(jefe, { tab: "por_revisar", now: NOW_CL, ...page })
    expect(inbox.ageCounts).toEqual({ "0-2": 2, "3-6": 0, "7-13": 1, "14+": 2 })
    const days = Object.fromEntries(inbox.rows.map((row) => [row.id, row.ageDays]))
    expect(days).toEqual({ [board.fresh.noteId]: 0, [board.edge.noteId]: 2, [board.week.noteId]: 10, [board.old.noteId]: 14, [board.oldest.noteId]: 60 })
  })

  it("cada tramo filtra la lista; el gráfico no pierde sus cifras al elegir un tramo, pero las pestañas sí lo respetan", async () => {
    const board = await agedBoard()
    const jefe = await viewerOf(IDS.jefe)
    const filtered = async (age: "0-2" | "3-6" | "7-13" | "14+") => query.listPartsNotes(jefe, { tab: "por_revisar", age, now: NOW_CL, ...page })
    expect(ids((await filtered("0-2")).rows).sort()).toEqual([board.fresh.noteId, board.edge.noteId].sort())
    expect(ids((await filtered("3-6")).rows)).toEqual([])
    expect(ids((await filtered("7-13")).rows)).toEqual([board.week.noteId])
    const oldest = await filtered("14+")
    expect(ids(oldest.rows).sort()).toEqual([board.old.noteId, board.oldest.noteId].sort())
    // El total pagina lo que se ve; los tramos del gráfico siguen mostrando toda la pestaña (es su selector).
    expect(oldest.total).toBe(2)
    expect(oldest.ageCounts).toEqual({ "0-2": 2, "3-6": 0, "7-13": 1, "14+": 2 })
    // Los conteos de las pestañas dicen cuánto hay con el resto de los filtros, también el de antigüedad.
    expect(oldest.counts).toEqual({ por_revisar: 2, en_compra: 0, en_recepcion: 0, cerradas: 0 })
    // Se suma al estado exacto y al resto de los filtros.
    expect(ids((await query.listPartsNotes(jefe, { tab: "por_revisar", age: "14+", status: "en_espera", now: NOW_CL, ...page })).rows)).toEqual([])
  })

  it("la antigüedad se mide desde el último evento, no desde la creación, y es de la pestaña que se mira", async () => {
    const note = await boughtNote()
    const jefe = await viewerOf(IDS.jefe)
    // Creada hace 40 días pero llegó a «En compra» hace 1: cuenta 1 día.
    await testDb.update(schema.mantPartsNotes).set({ createdAt: "2026-10-21T15:00:00.000Z" }).where(eq(schema.mantPartsNotes.id, note.noteId))
    await sinceAt(note.noteId, "2026-11-29T15:00:00.000Z")
    const waiting = await query.listPartsNotes(jefe, { tab: "en_compra", now: NOW_CL, ...page })
    expect(waiting.rows[0]).toMatchObject({ id: note.noteId, ageDays: 1 })
    expect(waiting.ageCounts).toEqual({ "0-2": 1, "3-6": 0, "7-13": 0, "14+": 0 })
    // Las otras pestañas no tienen esta nota: su gráfico está vacío.
    expect((await query.listPartsNotes(jefe, { tab: "en_recepcion", now: NOW_CL, ...page })).ageCounts).toEqual({ "0-2": 0, "3-6": 0, "7-13": 0, "14+": 0 })
  })

  it("el Excel sigue la pestaña activa: «En compra», «En recepción» y el tramo de antigüedad traen las mismas notas que la bandeja", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const buying = await boughtNote()
    const receiving = await boughtNote()
    await orderFor(receiving.requests[0]!.itemId, null, 2)
    await manual({})
    const session = await sessionOf(IDS.jefe)
    for (const [exportFilters, listFilters] of [
      [{ tab: "en_compra" }, { tab: "en_compra" }],
      [{ tab: "en_recepcion" }, { tab: "en_recepcion" }],
      [{ tab: "por_revisar", age: "0-2" }, { tab: "por_revisar", age: "0-2" }],
      [{ tab: "en_compra", age: "14+" }, { tab: "en_compra", age: "14+" }],
    ] as const) {
      const result = await exportPartsNotes({ session, filters: { ...exportFilters } })
      const list = await query.listPartsNotes(jefe, { ...listFilters, ...page })
      expect(result.ok && result.noteCount, JSON.stringify(exportFilters)).toBe(list.rows.length)
    }
    const waiting = await exportPartsNotes({ session, filters: { tab: "en_compra" } })
    expect(waiting.ok && waiting.noteCount).toBe(1)
    expect(buying.noteId).toBeTruthy()
  })
})
