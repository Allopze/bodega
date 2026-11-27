import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import ExcelJS from "exceljs"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import type { Tx } from "@/db"
import * as schema from "@/db/schema"
import {
  IDS,
  NOW,
  contextOf,
  createPartsNote,
  eventsOf,
  insertNoteEventTx,
  link,
  makeProduct,
  opId,
  orderFor,
  phoneOtNote,
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
const { NOTE_ACTION_LABELS } = await import("@/components/mantencion/jefatura/notas-pedido/parts-notes-format")

/**
 * Bandeja y exportación de notas de pedido (R14 y R16) contra Postgres de verdad: cada filtro nuevo (estado exacto, urgencia,
 * fechas en hora de Chile, solicitante, equipo por cargo de línea, repuesto), el alcance que ningún filtro amplía, el orden de
 * «Pendientes», «desde cuándo» a partir del último evento, el detalle (historial, motivo de la espera, acciones, modo lectura de
 * `view_own`) y el Excel: una fila por línea, compras, fechas de cada estado y la hoja «Historial».
 */

beforeAll(async () => {
  await setupDatabase()
})

beforeEach(resetState)

type Line = { description: string; quantity?: number; productId?: string | null; chargeVehicleId?: string; chargeCostCenterId?: string; suggestedSupplierId?: string; partNumber?: string }

async function manual(input: { lines: Line[]; urgent?: boolean; viewerId?: string; worksiteId?: string; createdAt?: string; notes?: string }) {
  const result = await createPartsNote(await viewerOf(input.viewerId ?? IDS.jefe), {
    clientOpId: opId(), worksiteId: input.worksiteId ?? IDS.wsBio, urgent: input.urgent ?? false, ...(input.notes ? { notes: input.notes } : {}),
    lines: input.lines.map((line) => ({ unitOfMeasure: "unidad", quantity: 2, ...line })),
  })
  if (!result.ok) throw new Error(result.message)
  if (input.createdAt) await testDb.update(schema.mantPartsNotes).set({ createdAt: input.createdAt }).where(eq(schema.mantPartsNotes.id, result.noteId))
  return result
}

async function items(noteId: string) {
  return testDb.select().from(schema.mantPartsNoteItems).where(eq(schema.mantPartsNoteItems.noteId, noteId)).orderBy(schema.mantPartsNoteItems.sortOrder)
}

async function sessionOf(userId: string, mutate?: (permissions: string[]) => string[]): Promise<Session> {
  const { viewer, userName } = await contextOf(userId, mutate)
  return { user: { id: viewer.userId, email: viewer.email, name: userName, permissions: viewer.permissions, worksiteIds: viewer.worksiteIds, isGlobal: viewer.isGlobal }, expires: "2099-01-01" } as unknown as Session
}

/**
 * El tablero de pruebas. Estados: n1 aceptada (urgente, 26-nov Chile), n2 en espera (10-nov), n3 enviada con OT y equipo detenido
 * (20-nov), n4 importada sin usuario, n5 en compra con una recepción parcial, n6 rechazada, n7 de Cholguán.
 */
async function seedBoard() {
  const jefe = await viewerOf(IDS.jefe)
  // 27-nov 02:30 UTC es el 26-nov 23:30 en Chile (UTC-3): el día civil lo decide la hora de Chile, no la de UTC.
  const n1 = await manual({ urgent: true, createdAt: "2026-11-27T02:30:00.000Z", lines: [{ description: "Cable de acero", chargeVehicleId: IDS.truckBio }] })
  await transitions.acceptPartsNote(jefe, { noteId: n1.noteId })
  const n2 = await manual({ createdAt: "2026-11-10T15:00:00.000Z", lines: [{ description: "Guantes de cuero", chargeCostCenterId: "cc-tr-bio", suggestedSupplierId: "sup-tr" }] })
  await transitions.holdPartsNote(jefe, { noteId: n2.noteId, reason: "Falta cotizar con el proveedor" })
  const n3 = await phoneOtNote({ equipmentStopped: true, lines: [
    { description: "Filtro de aceite", quantity: 2, unitOfMeasure: "unidad", partNumber: "FA-1", productId: null },
    { description: "Aceite hidráulico", quantity: 20, unitOfMeasure: "litro", partNumber: null, productId: null },
  ] })
  await testDb.update(schema.mantPartsNotes).set({ createdAt: "2026-11-20T15:00:00.000Z" }).where(eq(schema.mantPartsNotes.id, n3.noteId))
  await testDb.insert(schema.mantPartsNotes).values({
    id: "np-tr-import", code: "NP-TR-IMP", worksiteId: IDS.wsBio, requestedByUserId: null, requestedByName: "Taller Biodiversa", externalRef: "CHOME-900",
    status: "enviada", createdAt: NOW, updatedAt: NOW,
  })
  await testDb.insert(schema.mantPartsNoteItems).values({ id: "npi-tr-import", noteId: "np-tr-import", description: "Rodamiento 6205", quantity: 4, unitOfMeasure: "unidad", chargeText: "CR43-51-52", sortOrder: 0 })
  await testDb.transaction((raw) => insertNoteEventTx(raw as unknown as Tx, { noteId: "np-tr-import", kind: "creada", fromStatus: null, toStatus: "enviada" }))

  const product = await makeProduct("Filtro de combustible")
  const n5 = await manual({ lines: [{ description: "Filtro de combustible", quantity: 3, productId: product, partNumber: "FC-77", suggestedSupplierId: "sup-tr" }] })
  const [n5Item] = await items(n5.noteId)
  const request = await requestFor(n5Item!.id, "purchased")
  await link(n5Item!.id, request.itemId)
  const order = await orderFor(request.itemId, product, 3)
  await registerReceipt({ purchaseOrderId: order.orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio, items: [{ purchaseOrderItemId: order.ocItemId, quantityReceived: 1 }] })

  const n6 = await manual({ lines: [{ description: "Burlete de puerta" }] })
  await transitions.rejectPartsNote(jefe, { noteId: n6.noteId, reason: "Ya hay en la faena" })
  const n7 = await manual({ viewerId: IDS.mecCho, worksiteId: IDS.wsCho, lines: [{ description: "Manguera hidráulica" }] })
  return { n1, n2, n3, n4: { noteId: "np-tr-import" }, n5, n6, n7, product, order, request }
}

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id)
const page = { page: 1, pageSize: 50 }

describe("bandeja: filtros nuevos (R14)", () => {
  it("«Pendientes» pone primero lo urgente y, dentro de cada grupo, lo más antiguo", async () => {
    const board = await seedBoard()
    const jefe = await viewerOf(IDS.jefe)
    const pendientes = await query.listPartsNotes(jefe, { tab: "pendientes", ...page })
    // n3 (urgente, 20-nov) → n1 (urgente, 26-nov) → n2 (10-nov) → n4 (importada, NOW).
    expect(ids(pendientes.rows)).toEqual([board.n3.noteId, board.n1.noteId, board.n2.noteId, "np-tr-import", board.n7.noteId].filter((id) => ids(pendientes.rows).includes(id)))
    expect(ids(pendientes.rows).slice(0, 4)).toEqual([board.n3.noteId, board.n1.noteId, board.n2.noteId, "np-tr-import"])
    expect(pendientes.rows[0]).toMatchObject({ urgent: true, status: "enviada", equipmentCode: "KA-135" })
  })

  it("el estado exacto afina dentro de la pestaña; el total pagina lo que se ve y los conteos no lo tienen en cuenta", async () => {
    const board = await seedBoard()
    const jefe = await viewerOf(IDS.jefe)
    const all = await query.listPartsNotes(jefe, { tab: "pendientes", ...page })
    const accepted = await query.listPartsNotes(jefe, { tab: "pendientes", status: "aceptada", ...page })
    expect(ids(accepted.rows)).toEqual([board.n1.noteId])
    expect(accepted.total).toBe(1)
    expect(accepted.counts).toEqual(all.counts)
    expect((await query.listPartsNotes(jefe, { tab: "pendientes", status: "en_espera", ...page })).rows.map((row) => row.status)).toEqual(["en_espera"])
    // Un estado que no es de la pestaña no devuelve nada (la pantalla sólo ofrece los de la pestaña).
    expect((await query.listPartsNotes(jefe, { tab: "pendientes", status: "cerrada", ...page })).rows).toEqual([])
    expect(ids((await query.listPartsNotes(jefe, { tab: "en_gestion", status: "recibida_parcial", ...page })).rows)).toEqual([board.n5.noteId])
    expect((await query.listPartsNotes(jefe, { tab: "en_gestion", status: "en_compra", ...page })).total).toBe(0)
    expect(ids((await query.listPartsNotes(jefe, { tab: "cerradas", status: "rechazada", ...page })).rows)).toEqual([board.n6.noteId])
  })

  it("urgencia: sólo urgentes, sólo normales", async () => {
    const board = await seedBoard()
    const jefe = await viewerOf(IDS.jefe)
    expect(ids((await query.listPartsNotes(jefe, { tab: "pendientes", urgent: true, ...page })).rows)).toEqual([board.n3.noteId, board.n1.noteId])
    const normal = ids((await query.listPartsNotes(jefe, { tab: "pendientes", urgent: false, ...page })).rows)
    expect(normal).toContain(board.n2.noteId)
    expect(normal).not.toContain(board.n1.noteId)
    expect(normal).not.toContain(board.n3.noteId)
  })

  it("el rango de fechas es por día civil de Chile, ambos extremos incluidos", async () => {
    const board = await seedBoard()
    const jefe = await viewerOf(IDS.jefe)
    const created = async (filters: { from?: string; to?: string }) => ids((await query.listPartsNotes(jefe, { tab: "pendientes", ...filters, ...page })).rows)
    // n1 se creó el 27-nov a las 02:30 UTC = 26-nov 23:30 en Chile.
    expect(await created({ from: "2026-11-26", to: "2026-11-26" })).toEqual([board.n1.noteId])
    expect(await created({ from: "2026-11-27", to: "2026-11-27" })).not.toContain(board.n1.noteId)
    expect(await created({ from: "2026-11-10", to: "2026-11-20" })).toEqual([board.n3.noteId, board.n2.noteId])
    expect(await created({ to: "2026-11-09" })).toEqual([])
    expect(await created({ from: "2026-11-21", to: "2026-11-26" })).toEqual([board.n1.noteId])
  })

  it("solicitante: por el nombre del usuario o por el nombre de una nota importada", async () => {
    const board = await seedBoard()
    const jefe = await viewerOf(IDS.jefe)
    expect(ids((await query.listPartsNotes(jefe, { tab: "pendientes", requester: "javier", ...page })).rows)).toEqual([board.n3.noteId])
    expect(ids((await query.listPartsNotes(jefe, { tab: "pendientes", requester: "Taller Biodiversa", ...page })).rows)).toEqual(["np-tr-import"])
    const byJefe = ids((await query.listPartsNotes(jefe, { tab: "pendientes", requester: "Alexis", ...page })).rows)
    expect(byJefe).toEqual(expect.arrayContaining([board.n1.noteId, board.n2.noteId]))
    expect(byJefe).not.toContain(board.n3.noteId)
  })

  it("equipo: el de la nota (código o patente), el de cargo de una línea y el cargo original sin calce", async () => {
    const board = await seedBoard()
    const jefe = await viewerOf(IDS.jefe)
    const find = async (equipment: string) => ids((await query.listPartsNotes(jefe, { tab: "pendientes", equipment, ...page })).rows)
    // KA-135 es el equipo de la OT de n3 y el equipo de cargo de la línea de n1.
    expect(await find("KA-135")).toEqual(expect.arrayContaining([board.n3.noteId, board.n1.noteId]))
    expect(await find("ka-135")).toHaveLength(2)
    expect(await find("RBYD-98")).toEqual(expect.arrayContaining([board.n3.noteId, board.n1.noteId]))
    // El texto de cargo que no calzó con ningún equipo.
    expect(await find("CR43")).toEqual(["np-tr-import"])
    expect(await find("KA-NO-EXISTE")).toEqual([])
    // Los comodines de LIKE no se interpretan.
    expect(await find("%")).toEqual([])
  })

  it("repuesto: por el texto de la línea, el N° de parte, y el nombre o el SKU del producto del catálogo", async () => {
    const board = await seedBoard()
    const jefe = await viewerOf(IDS.jefe)
    const find = async (tab: "pendientes" | "en_gestion", article: string) => ids((await query.listPartsNotes(jefe, { tab, article, ...page })).rows)
    expect(await find("pendientes", "hidráulico")).toEqual([board.n3.noteId])
    expect(await find("pendientes", "FA-1")).toEqual([board.n3.noteId])
    expect(await find("pendientes", "rodamiento")).toEqual(["np-tr-import"])
    expect(await find("en_gestion", "FC-77")).toEqual([board.n5.noteId])
    expect(await find("en_gestion", "combustible")).toEqual([board.n5.noteId])
    const sku = (await testDb.select({ sku: schema.products.sku }).from(schema.products).where(eq(schema.products.id, board.product)))[0]!.sku
    expect(await find("en_gestion", sku)).toEqual([board.n5.noteId])
    expect(await find("pendientes", "100%")).toEqual([])
  })

  it("la búsqueda libre ahora también encuentra el folio externo y el solicitante", async () => {
    const board = await seedBoard()
    const jefe = await viewerOf(IDS.jefe)
    const find = async (q: string) => ids((await query.listPartsNotes(jefe, { tab: "pendientes", q, ...page })).rows)
    expect(await find("CHOME-900")).toEqual(["np-tr-import"])
    expect(await find("Javier")).toEqual([board.n3.noteId])
    expect(await find("OT-TR-1")).toEqual([board.n3.noteId])
  })

  it("ningún filtro amplía el alcance: quien ve sólo su faena no ve la de otra, ni pidiéndola", async () => {
    const board = await seedBoard()
    const supervisor = await viewerOf(IDS.supBio)
    const mine = await query.listPartsNotes(supervisor, { tab: "pendientes", ...page })
    expect(ids(mine.rows)).not.toContain(board.n7.noteId)
    expect((await query.listPartsNotes(supervisor, { tab: "pendientes", worksiteId: IDS.wsCho, ...page })).rows).toEqual([])
    expect((await query.listPartsNotes(supervisor, { tab: "pendientes", requester: "Pedro", ...page })).rows).toEqual([])
    expect((await query.listPartsNotes(supervisor, { tab: "pendientes", article: "Manguera", ...page })).rows).toEqual([])
    // El jefe (alcance global) sí ve la de Cholguán, y el filtro de faena la acota.
    const jefe = await viewerOf(IDS.jefe)
    expect(ids((await query.listPartsNotes(jefe, { tab: "pendientes", worksiteId: IDS.wsCho, ...page })).rows)).toEqual([board.n7.noteId])
  })

  it("cada fila trae desde cuándo está en su estado (el último evento), su folio externo y el cargo de sus líneas", async () => {
    const board = await seedBoard()
    const jefe = await viewerOf(IDS.jefe)
    const rows = (await query.listPartsNotes(jefe, { tab: "pendientes", ...page })).rows
    const n1 = rows.find((row) => row.id === board.n1.noteId)!
    const last = (await eventsOf(board.n1.noteId)).at(-1)!
    expect(n1.status).toBe("aceptada")
    expect(n1.statusSince).toBe(new Date(last.createdAt).toISOString())
    // La nota se creó antes (con otra fecha puesta a mano): «en este estado» no es la antigüedad de la nota.
    expect(new Date(n1.statusSince).getTime()).toBeGreaterThan(new Date(n1.createdAt).getTime())
    expect(n1.charges).toEqual(["KA-135"])
    expect(rows.find((row) => row.id === board.n2.noteId)!.charges).toEqual(["Taller Biodiversa"])
    expect(rows.find((row) => row.id === "np-tr-import")).toMatchObject({ externalRef: "CHOME-900", charges: ["CR43-51-52"], workOrderId: null, workOrderFolio: null, equipmentCode: "", requestedByName: "Taller Biodiversa" })
  })
})

describe("detalle: historial, espera y acciones por permiso", () => {
  it("trae el historial completo en orden, el motivo de la espera y la referencia externa; cada línea, su cargo y su proveedor sugerido", async () => {
    const board = await seedBoard()
    const jefe = await viewerOf(IDS.jefe)
    const n2 = (await query.getPartsNote(jefe, board.n2.noteId))!
    expect(n2).toMatchObject({ status: "en_espera", holdReason: "Falta cotizar con el proveedor", workOrderId: null, equipmentCode: "" })
    expect(n2.events.map((event) => [event.kind, event.fromStatus, event.toStatus, event.reason, event.actorName])).toEqual([
      ["creada", null, "enviada", null, "Alexis Morales"],
      ["transicion", "enviada", "en_espera", "Falta cotizar con el proveedor", "Alexis Morales"],
    ])
    expect(n2.statusSince).toBe(n2.events.at(-1)!.createdAt)
    expect(n2.lines[0]).toMatchObject({ charge: { label: "Taller Biodiversa" }, suggestedSupplierId: "sup-tr", suggestedSupplierName: "Repuestos Tr" })

    const imported = (await query.getPartsNote(jefe, "np-tr-import"))!
    expect(imported).toMatchObject({ externalRef: "CHOME-900", requestedByName: "Taller Biodiversa" })
    expect(imported.lines[0]!.charge).toMatchObject({ label: "CR43-51-52" })
  })

  it("lo que llegó a la faena avanza la nota y lo dice el historial; un evento sin quien lo hizo se lee como «sin actor»", async () => {
    const board = await seedBoard()
    const jefe = await viewerOf(IDS.jefe)
    const n5 = (await query.getPartsNote(jefe, board.n5.noteId))!
    expect(n5.status).toBe("recibida_parcial")
    expect(n5.events.map((event) => [event.fromStatus, event.toStatus])).toEqual([[null, "enviada"], ["enviada", "en_compra"], ["en_compra", "recibida_parcial"]])
    expect(n5.lines[0]).toMatchObject({ arrived: 1 })
    // La importada trae su «creada» sin usuario (no hubo quien la pidiera en CHOME): actor nulo.
    const imported = (await query.getPartsNote(jefe, "np-tr-import"))!
    expect(imported.events).toEqual([expect.objectContaining({ kind: "creada", actorName: null, toStatus: "enviada" })])
  })

  it("las acciones de cabecera son las que valen para el estado y para el permiso de quien mira, con su alcance", async () => {
    const board = await seedBoard()
    const actionsFor = async (viewerId: string, noteId: string, mutate?: (permissions: string[]) => string[]) =>
      (await query.getPartsNote(await viewerOf(viewerId, mutate), noteId))!.actions
    expect(await actionsFor(IDS.jefe, board.n3.noteId)).toEqual(["aceptar", "en_espera", "rechazar", "anular"])
    expect(await actionsFor(IDS.jefe, board.n1.noteId)).toEqual(["en_espera", "rechazar", "anular"])
    expect(await actionsFor(IDS.jefe, board.n2.noteId)).toEqual(["aceptar", "rechazar", "anular"])
    expect(await actionsFor(IDS.jefe, board.n5.noteId)).toEqual(["anular"])
    // Reabrir: sólo con su permiso, y la nota rechazada tiene líneas rechazadas.
    expect(await actionsFor(IDS.jefe, board.n6.noteId)).toEqual(["reabrir"])
    expect(await actionsFor(IDS.jefe, board.n6.noteId, (permissions) => permissions.filter((permission) => permission !== "mant:np:reopen"))).toEqual([])
    // Sin `manage`: ninguna acción de gestión.
    expect(await actionsFor(IDS.jefe, board.n3.noteId, (permissions) => permissions.filter((permission) => permission !== "mant:np:manage"))).toEqual([])
    // El supervisor de Biodiversa puede gestionar las de su faena (no reabrir: no tiene el permiso).
    expect(await actionsFor(IDS.supBio, board.n3.noteId)).toEqual(["aceptar", "en_espera", "rechazar", "anular"])
    expect(await actionsFor(IDS.supBio, board.n6.noteId)).toEqual([])
  })

  it("las etiquetas de las acciones de la pantalla son las del servicio (no se separan)", () => {
    for (const key of transitions.NOTE_ACTION_KEYS) expect(NOTE_ACTION_LABELS[key]).toBe(transitions.NOTE_ACTIONS[key].label)
  })

  it("view_own: ve SU nota en modo lectura (sin acciones de cabecera, de línea ni de compra) y no ve las de otros", async () => {
    const board = await seedBoard()
    // Un mecánico sólo con «ver las propias» (sin ver ni gestionar las de su faena): la nota que pidió él (n3) y ninguna más.
    const own = await viewerOf(IDS.mecBio, (permissions) => permissions.filter((permission) => !["mant:np:view_worksite", "mant:np:manage", "mant:np:purchase"].includes(permission)))
    expect(own.permissions).toContain("mant:np:view_own")
    const note = (await query.getPartsNote(own, board.n3.noteId))!
    expect(note).toMatchObject({ code: expect.any(String), canManage: false, canBuy: false, actions: [], stockOptions: [] })
    expect(note.lines.length).toBeGreaterThan(0)
    // De otra persona o de otra faena: la misma respuesta que «no existe».
    expect(await query.getPartsNote(own, board.n1.noteId)).toBeNull()
    expect(await query.getPartsNote(own, board.n7.noteId)).toBeNull()
    expect(await query.getPartsNote(own, "np-tr-import")).toBeNull()
    const tray = await query.listPartsNotes(own, { tab: "pendientes", ...page })
    expect(ids(tray.rows)).toEqual([board.n3.noteId])
    // Y el servidor no le deja ejecutar nada sobre ella, aunque llame a la acción a mano.
    expect(await transitions.acceptPartsNote(own, { noteId: board.n3.noteId })).toEqual({ ok: false, message: "No tienes permiso para resolver notas de pedido." })
    expect(await transitions.voidPartsNote(own, { noteId: board.n3.noteId, reason: "Quiero anularla" })).toMatchObject({ ok: false })
    expect(await transitions.reopenPartsNote(own, { noteId: board.n3.noteId, reason: "Quiero reabrirla" })).toMatchObject({ ok: false })
    expect((await testDb.select().from(schema.mantPartsNotes).where(eq(schema.mantPartsNotes.id, board.n3.noteId)))[0]!.status).toBe("enviada")
  })

  it("un gestor que abre SU nota de una faena fuera de su alcance la ve en lectura: el permiso sin la faena no habilita nada", async () => {
    const board = await seedBoard()
    // La nota n7 es de Cholguán; el supervisor de Biodiversa no la ve, pero si la hubiera pedido él (view_own) sería de lectura.
    await testDb.update(schema.mantPartsNotes).set({ requestedByUserId: IDS.supBio }).where(eq(schema.mantPartsNotes.id, board.n7.noteId))
    const supervisor = await viewerOf(IDS.supBio)
    const note = (await query.getPartsNote(supervisor, board.n7.noteId))!
    expect(note).toMatchObject({ worksiteId: IDS.wsCho, canManage: false, canBuy: false, actions: [], stockOptions: [] })
    // Y el servicio tampoco le deja ejecutarlas.
    expect(await transitions.acceptPartsNote(supervisor, { noteId: board.n7.noteId })).toEqual({ ok: false, message: "Esta nota de pedido es de una faena que no es de tu alcance." })
    expect((await testDb.select().from(schema.mantPartsNotes).where(eq(schema.mantPartsNotes.id, board.n7.noteId)))[0]!.status).toBe("enviada")
  })

  it("quien sólo compra (mant:np:purchase) puede comprar pero no resolver; sin OT no hay stock que ofrecer", async () => {
    const board = await seedBoard()
    const buyer = await viewerOf(IDS.adminBio, (permissions) => [...permissions.filter((permission) => permission !== "mant:np:manage"), "mant:np:purchase"])
    const note = (await query.getPartsNote(buyer, board.n2.noteId))!
    expect(note).toMatchObject({ canManage: false, canBuy: true, actions: [], stockOptions: [] })
    const manager = (await query.getPartsNote(await viewerOf(IDS.jefe), board.n2.noteId))!
    expect(manager).toMatchObject({ canManage: true, canBuy: true, stockOptions: [] })
  })
})

const workbookOf = async (buffer: ArrayBuffer) => new ExcelJS.Workbook().xlsx.load(buffer)
type Row = Record<string, ExcelJS.CellValue>
function rowsOf(sheet: ExcelJS.Worksheet): Row[] {
  const header = (sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1)
  const rows: Row[] = []
  sheet.eachRow((row, index) => {
    if (index === 1) return
    const values = (row.values as ExcelJS.CellValue[]).slice(1)
    rows.push(Object.fromEntries(header.map((name, column) => [String(name), values[column] ?? null])))
  })
  return rows
}

describe("exportación a Excel (R16)", () => {
  it("sin mant:np:export no se genera nada y la respuesta es un rechazo explícito (y no deja rastro de exportación)", async () => {
    await seedBoard()
    const sinPermiso = await sessionOf(IDS.supBio)
    expect(sinPermiso.user.permissions).not.toContain("mant:np:export")
    expect(await exportPartsNotes({ session: sinPermiso, filters: {} })).toEqual({ ok: false, reason: "forbidden", message: "No tienes permiso para exportar notas de pedido." })
    // Tener `manage` o `view_own` no basta.
    const gestor = await sessionOf(IDS.jefe, (permissions) => permissions.filter((permission) => permission !== "mant:np:export"))
    expect((await exportPartsNotes({ session: gestor, filters: {} })).ok).toBe(false)
    expect(await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_parts_notes_export"))).toHaveLength(0)
  })

  it("una fila por línea con la cabecera de su nota, el cargo, el proveedor, la resolución, lo que llegó y la compra que la atiende", async () => {
    const board = await seedBoard()
    const result = await exportPartsNotes({ session: await sessionOf(IDS.jefe), filters: {} })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.filename).toMatch(/^notas-de-pedido-\d{4}-\d{2}-\d{2}\.xlsx$/)
    const workbook = await workbookOf(result.buffer)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Notas de pedido", "Historial", "Metadatos"])
    const rows = rowsOf(workbook.getWorksheet("Notas de pedido")!)
    // n1 (1) + n2 (1) + n3 (2) + importada (1) + n5 (1) + n6 (1) + n7 (1) = 8 líneas.
    expect(rows).toHaveLength(8)
    const header = (workbook.getWorksheet("Notas de pedido")!.getRow(1).values as string[]).slice(1)
    expect(header.slice(0, 12)).toEqual(["Nota", "Referencia externa", "Faena", "Solicitante", "OT", "Equipo de la nota", "Urgente", "Equipo detenido", "Observación", "Estado actual", "En este estado desde", "Creada"])
    expect(header).toEqual(expect.arrayContaining(["Descripción", "N° de parte", "Artículo del catálogo", "Cantidad", "Unidad", "Cargo", "Proveedor sugerido", "Resolución", "Llegó a la faena", "Solicitud de compra", "OC", "Proveedor de la OC"]))

    const code = async (noteId: string) => (await testDb.select({ code: schema.mantPartsNotes.code }).from(schema.mantPartsNotes).where(eq(schema.mantPartsNotes.id, noteId)))[0]!.code
    const byDescription = (description: string) => rows.find((row) => row["Descripción"] === description)!

    expect(byDescription("Cable de acero")).toMatchObject({
      Nota: await code(board.n1.noteId), Faena: "Biodiversa", Solicitante: "Alexis Morales", OT: "Sin OT", Urgente: "Sí", "Estado actual": "Aceptada", Cargo: "KA-135", Resolución: "Pendiente", "Llegó a la faena": 0,
    })
    expect(byDescription("Guantes de cuero")).toMatchObject({ "Estado actual": "En espera", "Motivo de la espera": "Falta cotizar con el proveedor", Cargo: "Taller Biodiversa", "Proveedor sugerido": "Repuestos Tr" })
    expect(byDescription("Filtro de aceite")).toMatchObject({ OT: "OT-TR-1", "Equipo de la nota": "KA-135", "Equipo detenido": "Sí", Solicitante: "Javier Roa", "N° de parte": "FA-1", Cantidad: 2 })
    expect(byDescription("Aceite hidráulico")).toMatchObject({ Unidad: "litro", Cantidad: 20 })
    expect(byDescription("Rodamiento 6205")).toMatchObject({ "Referencia externa": "CHOME-900", Solicitante: "Taller Biodiversa", Cargo: "CR43-51-52", OT: "Sin OT" })
    expect(byDescription("Burlete de puerta")).toMatchObject({ "Estado actual": "Rechazada", Resolución: "Rechazada", "Motivo de la resolución": "Ya hay en la faena" })
    expect(byDescription("Filtro de combustible")).toMatchObject({
      "Estado actual": "Recibida parcial", Resolución: "En compra", "Artículo del catálogo": "Filtro de combustible", "Llegó a la faena": 1,
      "Solicitud de compra": expect.stringMatching(/^SOL-TR-/), OC: expect.stringMatching(/^OC-TR-/), "Proveedor de la OC": "Repuestos Tr",
    })
  })

  it("las fechas son celdas de fecha de Excel en hora de Chile, y hay una columna por cada estado alcanzado", async () => {
    const board = await seedBoard()
    const result = await exportPartsNotes({ session: await sessionOf(IDS.jefe), filters: {} })
    if (!result.ok) throw new Error(result.message)
    const sheet = (await workbookOf(result.buffer)).getWorksheet("Notas de pedido")!
    const rows = rowsOf(sheet)
    const header = (sheet.getRow(1).values as string[]).slice(1)
    expect(header.slice(-9)).toEqual(["Enviada el", "Aceptada el", "En espera el", "En gestión el", "En compra el", "Recibida parcial el", "Cerrada el", "Rechazada el", "Anulada el"])

    const cable = rows.find((row) => row["Descripción"] === "Cable de acero")!
    // 27-nov 02:30 UTC = 26-nov 23:30 hora de pared de Chile.
    const created = cable.Creada as Date
    expect(created).toBeInstanceOf(Date)
    expect(created.toISOString().slice(0, 16)).toBe("2026-11-26T23:30")
    expect(sheet.getRow(2).getCell(header.indexOf("Creada") + 1).numFmt).toBe("dd-mm-yyyy hh:mm")
    // Alcanzó «Enviada» y «Aceptada»; no «Cerrada».
    expect(cable["Enviada el"]).toBeInstanceOf(Date)
    expect(cable["Aceptada el"]).toBeInstanceOf(Date)
    expect(cable["Cerrada el"] ?? "").toBe("")
    const parcial = rows.find((row) => row["Descripción"] === "Filtro de combustible")!
    expect(parcial["En compra el"]).toBeInstanceOf(Date)
    expect(parcial["Recibida parcial el"]).toBeInstanceOf(Date)
    expect(board.n5.noteId).toBeTruthy()
  })

  it("la hoja «Historial» trae cada evento: de qué estado a cuál, el motivo y quién (o «Automático»)", async () => {
    await seedBoard()
    const result = await exportPartsNotes({ session: await sessionOf(IDS.jefe), filters: {} })
    if (!result.ok) throw new Error(result.message)
    const workbook = await workbookOf(result.buffer)
    const history = rowsOf(workbook.getWorksheet("Historial")!)
    expect((workbook.getWorksheet("Historial")!.getRow(1).values as string[]).slice(1)).toEqual(["Nota", "Faena", "Fecha", "Evento", "Estado anterior", "Estado nuevo", "Motivo", "Quién", "Línea"])
    const hold = history.find((row) => row["Estado nuevo"] === "En espera")!
    expect(hold).toMatchObject({ Evento: "Cambio de estado", "Estado anterior": "Enviada", Motivo: "Falta cotizar con el proveedor", Quién: "Alexis Morales" })
    expect(hold.Fecha).toBeInstanceOf(Date)
    const created = history.filter((row) => row.Evento === "Creada")
    expect(created.length).toBeGreaterThanOrEqual(6)
    // Sin quien lo hizo (la nota importada), el historial dice «Automático».
    expect(history.find((row) => row.Nota === "NP-TR-IMP")).toMatchObject({ Evento: "Creada", Quién: "Automático" })
    expect(history.find((row) => row["Estado nuevo"] === "Recibida parcial")).toMatchObject({ "Estado anterior": "En compra", Evento: "Cambio de estado" })
    // Un renglón por evento: los de cada nota juntos y en orden.
    const withDate = history.filter((row) => row.Fecha instanceof Date)
    expect(withDate).toHaveLength(history.length)
  })

  it("exporta lo mismo que la bandeja con los mismos filtros: pestaña, estado exacto, urgencia, fechas, equipo, repuesto y solicitante", async () => {
    const board = await seedBoard()
    const jefe = await viewerOf(IDS.jefe)
    const session = await sessionOf(IDS.jefe)
    const exported = async (filters: Parameters<typeof exportPartsNotes>[0]["filters"]) => {
      const result = await exportPartsNotes({ session, filters })
      if (!result.ok) throw new Error(result.message)
      return { result, rows: rowsOf((await workbookOf(result.buffer)).getWorksheet("Notas de pedido")!) }
    }
    const cases: Array<[Parameters<typeof exportPartsNotes>[0]["filters"], Parameters<typeof query.listPartsNotes>[1]]> = [
      [{ tab: "pendientes" }, { tab: "pendientes", ...page }],
      [{ tab: "pendientes", status: "en_espera" }, { tab: "pendientes", status: "en_espera", ...page }],
      [{ tab: "pendientes", urgent: true }, { tab: "pendientes", urgent: true, ...page }],
      [{ tab: "pendientes", from: "2026-11-10", to: "2026-11-20" }, { tab: "pendientes", from: "2026-11-10", to: "2026-11-20", ...page }],
      [{ tab: "pendientes", equipment: "KA-135" }, { tab: "pendientes", equipment: "KA-135", ...page }],
      [{ tab: "en_gestion", article: "FC-77" }, { tab: "en_gestion", article: "FC-77", ...page }],
      [{ tab: "pendientes", requester: "Javier" }, { tab: "pendientes", requester: "Javier", ...page }],
      [{ tab: "cerradas" }, { tab: "cerradas", ...page }],
    ]
    for (const [exportFilters, listFilters] of cases) {
      const { result, rows } = await exported(exportFilters)
      const list = await query.listPartsNotes(jefe, listFilters)
      expect(result.ok && result.noteCount, JSON.stringify(exportFilters)).toBe(list.rows.length)
      const exportedCodes = new Set(rows.map((row) => row.Nota))
      expect(exportedCodes, JSON.stringify(exportFilters)).toEqual(new Set(list.rows.map((row) => row.code)))
    }
    // Sin pestaña: todas las notas que ve quien exporta.
    const all = await exported({})
    expect(all.result.ok && all.result.noteCount).toBe(7)
    expect(board.n1.noteId).toBeTruthy()
  })

  it("exporta sólo lo que quien exporta puede ver: con export pero sin la faena de Cholguán, esa nota no sale", async () => {
    const board = await seedBoard()
    const session = await sessionOf(IDS.supBio, (permissions) => [...permissions, "mant:np:export"])
    const result = await exportPartsNotes({ session, filters: {} })
    if (!result.ok) throw new Error(result.message)
    const rows = rowsOf((await workbookOf(result.buffer)).getWorksheet("Notas de pedido")!)
    expect(rows.map((row) => row.Descripción)).not.toContain("Manguera hidráulica")
    expect(rows.every((row) => row.Faena === "Biodiversa")).toBe(true)
    expect(result.noteCount).toBe(6)
    expect(board.n7.noteId).toBeTruthy()
  })

  it("sin notas devuelve un libro con sus encabezados (no una descarga fallida) y deja la exportación en la bitácora", async () => {
    const session = await sessionOf(IDS.jefe)
    const result = await exportPartsNotes({ session, filters: { tab: "pendientes", equipment: "NO-EXISTE" } })
    if (!result.ok) throw new Error(result.message)
    expect(result.noteCount).toBe(0)
    const workbook = await workbookOf(result.buffer)
    expect(rowsOf(workbook.getWorksheet("Notas de pedido")!)).toEqual([])
    expect(workbook.getWorksheet("Notas de pedido")!.getRow(1).getCell(1).value).toBe("Nota")
    const audit = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_parts_notes_export"))
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: "export", userId: IDS.jefe })
    const state = typeof audit[0]!.newState === "string" ? JSON.parse(audit[0]!.newState) : audit[0]!.newState
    expect(state).toMatchObject({ noteCount: 0, filters: { tab: "pendientes", equipment: "NO-EXISTE" } })
  })
})
