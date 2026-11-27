/**
 * Notas de pedido de repuestos · de la NP a la solicitud de compra (ADR mantención
 * 0001, D2 y D4), contra Postgres real (PGlite con todas las migraciones):
 *
 *  - guardar una solicitud de repuestos con ítems que compran líneas de una NP
 *    persiste `parts_note_item_id` y, en la MISMA transacción, llama a
 *    `linkNoteItemsToRequestTx` con los pares (línea de NP, ítem de solicitud);
 *  - la línea tiene que existir y ser de la misma OT del ítem: el servidor no
 *    confía en el cliente;
 *  - al enviar, la línea sigue siendo comprable (NP vigente);
 *  - la compra parcial de la OC conserva `parts_note_item_id` en el remanente;
 *  - emitir la OC exige catalogar las líneas de repuesto con OT o NP.
 *
 * `linkNoteItemsToRequestTx` lo implementa la línea L3 (notas de pedido): aquí se
 * mockea con una implementación mínima que anota las llamadas.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import type { Session } from "next-auth"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { asc, eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema })
const testGlobal = globalThis as unknown as { __db?: typeof testDb }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("@/lib/email/smtp", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))
vi.mock("server-only", () => ({}))

type LinkInput = { links: Array<{ noteItemId: string; requestItemId: string }>; actorUserId: string }
const linkNoteItemsToRequestTx = vi.hoisted(() => vi.fn(async (_tx: unknown, _input: unknown) => undefined))
const unlinkNoteItemsFromRequestTx = vi.hoisted(() => vi.fn(async (_tx: unknown, _input: unknown) => undefined))
vi.mock("@/lib/services/mantencion/parts-notes/resolve", () => ({ linkNoteItemsToRequestTx, unlinkNoteItemsFromRequestTx }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { IDS, seedMantFixtures } = await import("./mantencion-sync-fixtures")
const { createWorkOrderWithClient } = await import("@/lib/services/mantencion/work-orders/create")
const { createSparePartTx } = await import("@/lib/services/spare-parts-catalog")
const { persistRepuestoDraft, submitRepuestoRequest } = await import("@/lib/services/repuestos")
const { persistServiceDraft } = await import("@/lib/services/servicios")
const { createOrder, issueAndSendOrder } = await import("@/lib/services/purchasing")

/** Jefatura de mantención de Biodiversa: puede resolver notas de pedido en su faena (`mant:np:manage`). */
const session = {
  user: {
    id: IDS.jefe, email: "jefe@chome.test", name: "Alexis Morales",
    permissions: ["repuestos:create", "mant:np:manage"], worksiteIds: [IDS.wsBio], isGlobal: false, roles: [],
  },
} as unknown as Session
const sessionWithout = (permissions: string[], worksiteIds: string[] = [IDS.wsBio]) =>
  ({ user: { ...session.user, permissions, worksiteIds } }) as unknown as Session
const now = new Date().toISOString()

let otA = ""
let otB = ""
const noteA = { id: "np-a", code: "NP-2026-0001" }
const noteB = { id: "np-b", code: "NP-2026-0002" }
const noteVoid = { id: "np-void", code: "NP-2026-0003" }
const LINE = { a1: "npi-a1", a2: "npi-a2", a3: "npi-a3", b1: "npi-b1", rejected: "npi-rej", fromStock: "npi-stock", voided: "npi-void" } as const
let seq = 0

function draft(items: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return {
    worksiteId: IDS.wsBio, urgency: "high" as const, requiredDate: "2099-12-01", justification: null,
    items: items.map((item) => ({ description: "Manguera hidráulica", quantity: 2, unitOfMeasure: "unidad", ...item })),
    ...extra,
  }
}

/** Ítem de borrador que compra una línea de NP de una OT (equipo y OT del ítem coherentes). */
const npItem = (partsNoteItemId: string, over: Record<string, unknown> = {}) => ({
  vehicleId: IDS.truckBio, workOrderId: otA, partsNoteItemId, ...over,
})

async function message(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("Se esperaba que la operación fuera rechazada")
}

async function itemsOf(requestId: string) {
  return testDb.select().from(schema.purchaseRequestItems)
    .where(eq(schema.purchaseRequestItems.requestId, requestId))
    .orderBy(asc(schema.purchaseRequestItems.sortOrder))
}

async function note(
  id: string, code: string, workOrderId: string, vehicleId: string, lines: Array<{ id: string; description: string }>,
  worksiteId: string = IDS.wsBio,
) {
  await testDb.insert(schema.mantPartsNotes).values({
    id, code, workOrderId, vehicleId, worksiteId, requestedByUserId: IDS.mecBio, status: "enviada",
  })
  await testDb.insert(schema.mantPartsNoteItems).values(lines.map((line, index) => ({
    id: line.id, noteId: id, description: line.description, quantity: 2, unitOfMeasure: "unidad", sortOrder: index,
  })))
}

describe("solicitud de repuestos desde una nota de pedido", () => {
  beforeAll(async () => {
    await seedMantFixtures(testDb as unknown as DB)
    const actor = { userId: IDS.jefe, name: "Alexis Morales" }
    const open = (vehicleId: string, repairDescription: string) => testDb.transaction((tx) => createWorkOrderWithClient(tx as never, {
      vehicleId, inspectionFindingId: null, repair: true, maintenance: false, repairDescription, observations: null, requesterName: "Alexis Morales",
    }, actor))
    otA = (await open(IDS.truckBio, "Fuga hidráulica")).id
    otB = (await open(IDS.machineBio, "Cadena floja")).id

    await note(noteA.id, noteA.code, otA, IDS.truckBio, [
      { id: LINE.a1, description: "Manguera hidráulica 1/2" },
      { id: LINE.a2, description: "Abrazadera de acero" },
      { id: LINE.a3, description: "Filtro de aceite" },
    ])
    await note(noteB.id, noteB.code, otB, IDS.machineBio, [{ id: LINE.b1, description: "Cadena de oruga" }])

    // Una línea rechazada y otra resuelta desde stock: ya no se compran.
    await note("np-resolved", "NP-2026-0004", otA, IDS.truckBio, [
      { id: LINE.rejected, description: "Sello de bomba" },
      { id: LINE.fromStock, description: "Perno M12" },
    ])
    const stockPart = await testDb.transaction((tx) => createSparePartTx(tx as unknown as Tx, {
      name: "Perno M12 x 40", partNumber: "PM-12", unitOfMeasure: "unidad", createdByUserId: IDS.jefe,
    }))
    await testDb.update(schema.mantPartsNoteItems).set({
      resolution: "rechazada", resolutionReason: "No corresponde al equipo", resolvedByUserId: IDS.jefe, resolvedAt: now,
    }).where(eq(schema.mantPartsNoteItems.id, LINE.rejected))
    await testDb.update(schema.mantPartsNoteItems).set({
      resolution: "desde_stock", productId: stockPart.id, resolvedByUserId: IDS.jefe, resolvedAt: now,
    }).where(eq(schema.mantPartsNoteItems.id, LINE.fromStock))

    // Una NP anulada.
    await note(noteVoid.id, noteVoid.code, otA, IDS.truckBio, [{ id: LINE.voided, description: "Correa del alternador" }])
    await testDb.update(schema.mantPartsNotes).set({
      status: "anulada", voidedAt: now, voidedByUserId: IDS.jefe, voidReason: "El mecánico la envió por error",
    }).where(eq(schema.mantPartsNotes.id, noteVoid.id))

    // Una nota de otra faena (Cholguán), sobre la misma OT: fuera del alcance de la jefatura de Biodiversa.
    await note("np-cho", "NP-2026-0005", otA, IDS.truckBio, [{ id: "npi-cho", description: "Termostato" }], IDS.wsCho)

    await testDb.insert(schema.suppliers).values({
      id: "sup-np", name: "Repuestos del Sur", rut: "76.000.111-1", isActive: true, createdAt: now, updatedAt: now,
    })
  })

  afterAll(async () => {
    await pg.close()
  })

  beforeEach(() => {
    linkNoteItemsToRequestTx.mockClear()
    linkNoteItemsToRequestTx.mockImplementation(async () => undefined)
  })

  describe("al guardar el borrador (persistDraft)", () => {
    it("guarda parts_note_item_id por ítem y vincula cada línea en la misma transacción", async () => {
      const requestId = await persistRepuestoDraft(session, draft([
        npItem(LINE.a1, { description: "Manguera hidráulica 1/2" }),
        npItem(LINE.a2, { description: "Abrazadera de acero" }),
        { description: "Un repuesto sin nota" },
      ]))

      const saved = await itemsOf(requestId)
      expect(saved.map((item) => item.partsNoteItemId)).toEqual([LINE.a1, LINE.a2, null])
      expect(saved[0]).toMatchObject({ vehicleId: IDS.truckBio, workOrderId: otA })

      expect(linkNoteItemsToRequestTx).toHaveBeenCalledTimes(1)
      const [tx, input] = linkNoteItemsToRequestTx.mock.calls[0] as unknown as [Tx, LinkInput]
      expect(input.actorUserId).toBe(IDS.jefe)
      expect(input.links).toEqual([
        { noteItemId: LINE.a1, requestItemId: saved[0]!.id },
        { noteItemId: LINE.a2, requestItemId: saved[1]!.id },
      ])
      // Dentro de la transacción de la solicitud, no sobre la conexión suelta.
      expect(tx).not.toBe(testDb)
    })

    it("una solicitud sin líneas de NP no llama al servicio de notas", async () => {
      await persistRepuestoDraft(session, draft([{ vehicleId: IDS.truckBio, workOrderId: otA }]))
      expect(linkNoteItemsToRequestTx).not.toHaveBeenCalled()
    })

    it("una línea de la NP de otra OT se rechaza con un mensaje legible y no deja rastro", async () => {
      const before = (await testDb.select({ id: schema.purchaseRequests.id }).from(schema.purchaseRequests)).length
      // La línea b1 es de la OT B (otro equipo): el ítem dice la OT A.
      expect(await message(() => persistRepuestoDraft(session, draft([npItem(LINE.b1)]))))
        .toBe("La línea de la nota de pedido no es de la OT elegida: abre la solicitud desde la nota de pedido")
      expect((await testDb.select({ id: schema.purchaseRequests.id }).from(schema.purchaseRequests)).length).toBe(before)
      expect(linkNoteItemsToRequestTx).not.toHaveBeenCalled()
    })

    it("una línea inexistente se rechaza", async () => {
      expect(await message(() => persistRepuestoDraft(session, draft([npItem("npi-fantasma")]))))
        .toBe("La línea de la nota de pedido ya no existe: quita ese ítem de la solicitud")
    })

    it("una línea rechazada, resuelta desde stock o de una NP anulada ya no se compra", async () => {
      expect(await message(() => persistRepuestoDraft(session, draft([npItem(LINE.rejected, { description: "Sello de bomba" })]))))
        .toBe("La línea «Sello de bomba» de la nota de pedido NP-2026-0004 fue rechazada: quita ese ítem de la solicitud")
      expect(await message(() => persistRepuestoDraft(session, draft([npItem(LINE.fromStock, { description: "Perno M12" })]))))
        .toBe("La línea «Perno M12» de la nota de pedido NP-2026-0004 se resolvió desde el stock de la faena: quita ese ítem de la solicitud")
      expect(await message(() => persistRepuestoDraft(session, draft([npItem(LINE.voided, { description: "Correa del alternador" })]))))
        .toBe("La nota de pedido NP-2026-0003 fue anulada: quita ese ítem de la solicitud")
    })

    it("sin permiso para resolver notas de pedido no se compra lo que una nota pidió", async () => {
      const before = (await testDb.select({ id: schema.purchaseRequests.id }).from(schema.purchaseRequests)).length
      // Puede crear solicitudes de repuestos (p. ej. Compras), pero no resuelve notas: el id del formulario no basta.
      expect(await message(() => persistRepuestoDraft(sessionWithout(["repuestos:create"]), draft([npItem(LINE.a1)]))))
        .toBe("No tienes permiso para comprar lo que pidió una nota de pedido: quita ese ítem de la solicitud")
      expect((await testDb.select({ id: schema.purchaseRequests.id }).from(schema.purchaseRequests)).length).toBe(before)
      expect(linkNoteItemsToRequestTx).not.toHaveBeenCalled()
    })

    it("una línea de una nota de otra faena se informa como inexistente", async () => {
      expect(await message(() => persistRepuestoDraft(session, draft([npItem("npi-cho")]))))
        .toBe("La línea de la nota de pedido ya no existe: quita ese ítem de la solicitud")
      expect(linkNoteItemsToRequestTx).not.toHaveBeenCalled()
    })

    it("un ítem con línea de NP pero sin equipo ni OT guarda la línea en null y no vincula nada", async () => {
      const requestId = await persistRepuestoDraft(session, draft([{ partsNoteItemId: LINE.a1 }]))
      const [item] = await itemsOf(requestId)
      expect(item).toMatchObject({ vehicleId: null, workOrderId: null, partsNoteItemId: null })
      expect(linkNoteItemsToRequestTx).not.toHaveBeenCalled()
    })

    it("servicios no compra líneas de NP: la ignora", async () => {
      const requestId = await persistServiceDraft(session, draft([
        npItem(LINE.a1, { description: "Cambio de manguera", location: "Taller" }),
      ]))
      const [item] = await itemsOf(requestId)
      expect(item).toMatchObject({ workOrderId: otA, partsNoteItemId: null })
      expect(linkNoteItemsToRequestTx).not.toHaveBeenCalled()
    })

    it("si el servicio de notas falla, la solicitud entera se deshace", async () => {
      linkNoteItemsToRequestTx.mockRejectedValueOnce(new Error("La línea ya está en compra en otra solicitud"))
      const before = (await testDb.select({ id: schema.purchaseRequests.id }).from(schema.purchaseRequests)).length
      expect(await message(() => persistRepuestoDraft(session, draft([npItem(LINE.a3, { description: "Filtro de aceite" })]))))
        .toBe("La línea ya está en compra en otra solicitud")
      expect((await testDb.select({ id: schema.purchaseRequests.id }).from(schema.purchaseRequests)).length).toBe(before)
      const orphans = await testDb.select().from(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.partsNoteItemId, LINE.a3))
      expect(orphans).toHaveLength(0)
    })

    it("volver a guardar el borrador conserva la línea y sólo vincula las nuevas", async () => {
      const requestId = await persistRepuestoDraft(session, draft([npItem(LINE.a1, { description: "Manguera hidráulica 1/2" })]))
      linkNoteItemsToRequestTx.mockClear()

      // El autoguardado reenvía los ítems SIN id (el formulario no conoce los que guardó): el
      // servidor los recrea con ids nuevos, la línea se conserva y no hay nada que vincular.
      await persistRepuestoDraft(session, draft([npItem(LINE.a1, { quantity: 5 })], { id: requestId }))
      const [resaved] = await itemsOf(requestId)
      expect(resaved).toMatchObject({ partsNoteItemId: LINE.a1, quantity: 5 })
      expect(linkNoteItemsToRequestTx).not.toHaveBeenCalled()

      // Agregar una línea nueva vincula sólo esa, con el id con que quedó el ítem.
      await persistRepuestoDraft(session, draft([
        npItem(LINE.a1, { id: resaved!.id }),
        npItem(LINE.a2, { description: "Abrazadera de acero" }),
      ], { id: requestId }))
      const saved = await itemsOf(requestId)
      expect(saved.map((item) => item.partsNoteItemId)).toEqual([LINE.a1, LINE.a2])
      expect(linkNoteItemsToRequestTx).toHaveBeenCalledTimes(1)
      expect((linkNoteItemsToRequestTx.mock.calls[0] as unknown as [Tx, LinkInput])[1].links)
        .toEqual([{ noteItemId: LINE.a2, requestItemId: saved[1]!.id }])
    })

    it("quitar del borrador el ítem de una línea de NP la devuelve a «pendiente» (si nadie más la compra)", async () => {
      const requestId = await persistRepuestoDraft(session, draft([
        npItem(LINE.a1, { description: "Manguera hidráulica 1/2" }),
        npItem(LINE.a2, { description: "Abrazadera de acero" }),
      ]))
      unlinkNoteItemsFromRequestTx.mockClear()
      await persistRepuestoDraft(session, draft([npItem(LINE.a1, { description: "Manguera hidráulica 1/2" })], { id: requestId }))
      expect(unlinkNoteItemsFromRequestTx).toHaveBeenCalledTimes(1)
      expect((unlinkNoteItemsFromRequestTx.mock.calls[0] as unknown as [Tx, { noteItemIds: string[] }])[1].noteItemIds).toEqual([LINE.a2])
    })
  })

  describe("al enviar la solicitud (submitRequest)", () => {
    it("una línea de NP que dejó de ser comprable frena el envío; guardar el borrador de nuevo no falla", async () => {
      const requestId = await persistRepuestoDraft(session, draft([npItem(LINE.b1, { vehicleId: IDS.machineBio, workOrderId: otB, description: "Cadena de oruga" })]))
      // La jefatura anula la NP después de que se guardó el borrador.
      await testDb.update(schema.mantPartsNotes).set({
        status: "anulada", voidedAt: now, voidedByUserId: IDS.jefe, voidReason: "Se compró por otra vía",
      }).where(eq(schema.mantPartsNotes.id, noteB.id))

      // El autoguardado reenvía el mismo ítem (sin id): se conserva y no falla, como un repuesto desactivado.
      await persistRepuestoDraft(session, draft([
        npItem(LINE.b1, { vehicleId: IDS.machineBio, workOrderId: otB, quantity: 3 }),
      ], { id: requestId }))
      expect((await itemsOf(requestId))[0]).toMatchObject({ partsNoteItemId: LINE.b1, quantity: 3 })

      // Enviar sí lo frena, diciendo qué hacer, y la solicitud sigue en borrador.
      await expect(submitRepuestoRequest({ requestId, userId: IDS.jefe }))
        .rejects.toThrow("La nota de pedido NP-2026-0002 fue anulada: quita ese ítem de la solicitud")
      const [request] = await testDb.select({ status: schema.purchaseRequests.status }).from(schema.purchaseRequests)
        .where(eq(schema.purchaseRequests.id, requestId))
      expect(request?.status).toBe("draft")
    })

    it("con la NP vigente y la OT abierta el envío sigue su curso", async () => {
      // Una línea que ninguna otra solicitud compra (a2 ya la compran borradores de las pruebas de arriba: doble compra).
      await note("np-submit", "NP-2026-0099", otA, IDS.truckBio, [{ id: "npi-submit", description: "Abrazadera de acero" }])
      const requestId = await persistRepuestoDraft(session, draft([npItem("npi-submit", { description: "Abrazadera de acero", estimatedUnitPrice: 10_000 })]))
      await submitRepuestoRequest({ requestId, userId: IDS.jefe })
      const [request] = await testDb.select({ status: schema.purchaseRequests.status }).from(schema.purchaseRequests)
        .where(eq(schema.purchaseRequests.id, requestId))
      expect(request?.status).toBe("submitted")
      expect((await itemsOf(requestId))[0]).toMatchObject({ partsNoteItemId: "npi-submit", status: "requested" })
    })

    it("una línea que otra solicitud ya cubrió entretanto frena el envío (doble compra): el borrador sigue en borrador", async () => {
      await note("np-double", "NP-2026-0098", otA, IDS.truckBio, [{ id: "npi-double", description: "Filtro de combustible" }])
      const requestId = await persistRepuestoDraft(session, draft([npItem("npi-double", { description: "Filtro de combustible", estimatedUnitPrice: 10_000 })]))
      // Otra solicitud (por otra vía) pasa a comprar las 2 unidades de la línea mientras el borrador esperaba.
      await testDb.insert(schema.purchaseRequests).values({
        id: "req-double", code: "SOL-2026-0098", worksiteId: IDS.wsBio, requesterId: IDS.jefe, requestType: "repuestos", urgency: "high", status: "submitted",
      })
      await testDb.insert(schema.purchaseRequestItems).values({
        id: "rqi-double", requestId: "req-double", productNameFree: "Filtro de combustible", quantity: 2, unitOfMeasure: "unidad", status: "approved", partsNoteItemId: "npi-double",
      })
      expect(await message(() => submitRepuestoRequest({ requestId, userId: IDS.jefe })))
        .toBe("La línea «Filtro de combustible» de NP-2026-0098 ya se está comprando en SOL-2026-0098: quita ese ítem de la solicitud.")
      const [request] = await testDb.select({ status: schema.purchaseRequests.status }).from(schema.purchaseRequests)
        .where(eq(schema.purchaseRequests.id, requestId))
      expect(request?.status).toBe("draft")

      // Comprar en partes sigue permitido: si lo vivo no cubre lo pedido, el envío pasa.
      await testDb.update(schema.purchaseRequestItems).set({ quantity: 1 }).where(eq(schema.purchaseRequestItems.id, "rqi-double"))
      await submitRepuestoRequest({ requestId, userId: IDS.jefe })
      expect((await testDb.select({ status: schema.purchaseRequests.status }).from(schema.purchaseRequests).where(eq(schema.purchaseRequests.id, requestId)))[0]?.status).toBe("submitted")
    })
  })

  describe("compra parcial de la OC", () => {
    it("el remanente conserva parts_note_item_id (y la OT y el equipo)", async () => {
      await testDb.insert(schema.purchaseRequests).values({
        id: "req-split-np", code: "REP-NP-SPLIT", worksiteId: IDS.wsBio, requesterId: IDS.jefe, requestType: "repuestos",
        status: "approved", urgency: "high", deliveryMode: "directo_faena", createdAt: now, updatedAt: now,
      })
      await testDb.insert(schema.purchaseRequestItems).values({
        id: "item-split-np", requestId: "req-split-np", productNameFree: "Manguera hidráulica 1/2", quantity: 4, status: "approved",
        vehicleId: IDS.truckBio, workOrderId: otA, partsNoteItemId: LINE.a1, createdAt: now, updatedAt: now,
      })

      await createOrder({
        worksiteId: IDS.wsBio, supplierId: "sup-np", createdBy: IDS.jefe,
        items: [{ requestItemId: "item-split-np", productId: null, productNameFree: "Manguera hidráulica 1/2", quantity: 1, unitOfMeasure: "unidad", unitPrice: 34_000 }],
      })

      const siblings = await testDb.select().from(schema.purchaseRequestItems)
        .where(eq(schema.purchaseRequestItems.splitFromItemId, "item-split-np"))
      expect(siblings).toHaveLength(1)
      expect(siblings[0]).toMatchObject({ quantity: 3, vehicleId: IDS.truckBio, workOrderId: otA, partsNoteItemId: LINE.a1 })
      const [original] = await testDb.select().from(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.id, "item-split-np"))
      expect(original).toMatchObject({ quantity: 1, partsNoteItemId: LINE.a1 })
    })
  })

  describe("emitir la OC exige catalogar los repuestos con OT o NP (D4)", () => {
    async function approvedItem(over: {
      requestType?: string; vehicleId?: string | null; workOrderId?: string | null; partsNoteItemId?: string | null
      productNameFree?: string; quantity?: number
    } = {}) {
      seq += 1
      const requestId = `req-d4-${seq}`
      const itemId = `item-d4-${seq}`
      await testDb.insert(schema.purchaseRequests).values({
        id: requestId, code: `REP-D4-${seq}`, worksiteId: IDS.wsBio, requesterId: IDS.jefe, requestType: over.requestType ?? "repuestos",
        status: "approved", urgency: "normal", deliveryMode: "directo_faena", createdAt: now, updatedAt: now,
      })
      await testDb.insert(schema.purchaseRequestItems).values({
        id: itemId, requestId, productNameFree: over.productNameFree ?? "Manguera hidráulica", quantity: over.quantity ?? 2, status: "approved",
        vehicleId: over.vehicleId === undefined ? IDS.truckBio : over.vehicleId,
        workOrderId: over.workOrderId === undefined ? null : over.workOrderId,
        partsNoteItemId: over.partsNoteItemId ?? null,
        createdAt: now, updatedAt: now,
      })
      return itemId
    }

    const orderOf = (...lines: Array<{ itemId: string; productId?: string | null; name?: string }>) => createOrder({
      worksiteId: IDS.wsBio, supplierId: "sup-np", createdBy: IDS.jefe,
      items: lines.map((entry) => ({
        requestItemId: entry.itemId, productId: entry.productId ?? null, productNameFree: entry.name ?? "Manguera hidráulica",
        quantity: 2, unitOfMeasure: "unidad", unitPrice: 10_000,
      })),
    })

    async function orderStatus(orderId: string) {
      const [row] = await testDb.select({ status: schema.purchaseOrders.status }).from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, orderId))
      return row?.status
    }

    it("rechaza una línea con NP sin producto de catálogo y la OC sigue en borrador", async () => {
      const itemId = await approvedItem({ workOrderId: otA, partsNoteItemId: LINE.a1, productNameFree: "Manguera hidráulica 1/2" })
      const orderId = await orderOf({ itemId, name: "Manguera hidráulica 1/2" })
      await expect(issueAndSendOrder(orderId, IDS.jefe))
        .rejects.toThrow("Cataloga el repuesto antes de emitir la OC: Manguera hidráulica 1/2.")
      expect(await orderStatus(orderId)).toBe("draft")
    })

    it("rechaza una línea con OT (sin NP) sin producto de catálogo", async () => {
      const itemId = await approvedItem({ workOrderId: otA, productNameFree: "Sensor de presión" })
      const orderId = await orderOf({ itemId, name: "Sensor de presión" })
      await expect(issueAndSendOrder(orderId, IDS.jefe))
        .rejects.toThrow("Cataloga el repuesto antes de emitir la OC: Sensor de presión.")
      expect(await orderStatus(orderId)).toBe("draft")
    })

    it("el mensaje nombra todas las líneas que faltan", async () => {
      const first = await approvedItem({ workOrderId: otA, productNameFree: "Sensor de presión" })
      const second = await approvedItem({ workOrderId: otA, partsNoteItemId: LINE.a2, productNameFree: "Abrazadera de acero" })
      const orderId = await orderOf({ itemId: first, name: "Sensor de presión" }, { itemId: second, name: "Abrazadera de acero" })
      const failure = await message(() => issueAndSendOrder(orderId, IDS.jefe))
      expect(failure).toMatch(/^Cataloga el repuesto antes de emitir la OC: /)
      expect(failure).toContain("Sensor de presión")
      expect(failure).toContain("Abrazadera de acero")
      expect(failure.endsWith(".")).toBe(true)
    })

    it("con el repuesto catalogado la OC se emite", async () => {
      const part = await testDb.transaction((tx) => createSparePartTx(tx as unknown as Tx, {
        name: "Manguera hidráulica 1/2 pulgada", partNumber: "MH-12", unitOfMeasure: "unidad", createdByUserId: IDS.jefe,
      }))
      const itemId = await approvedItem({ workOrderId: otA, partsNoteItemId: LINE.a1 })
      // Catalogar al armar la OC: el producto llega a la línea de la OC.
      const orderId = await orderOf({ itemId, productId: part.id })
      await issueAndSendOrder(orderId, IDS.jefe)
      expect(await orderStatus(orderId)).toBe("sent")
    })

    it("un repuesto ya catalogado desde la solicitud también se emite", async () => {
      const part = await testDb.transaction((tx) => createSparePartTx(tx as unknown as Tx, {
        name: "Abrazadera de acero inoxidable", partNumber: "AB-77", unitOfMeasure: "unidad", createdByUserId: IDS.jefe,
      }))
      const itemId = await approvedItem({ workOrderId: otA, partsNoteItemId: LINE.a2 })
      await testDb.update(schema.purchaseRequestItems).set({ productId: part.id, productNameFree: null }).where(eq(schema.purchaseRequestItems.id, itemId))
      const orderId = await orderOf({ itemId, productId: part.id })
      await issueAndSendOrder(orderId, IDS.jefe)
      expect(await orderStatus(orderId)).toBe("sent")
    })

    it("un repuesto sin OT ni NP en texto libre se emite como siempre", async () => {
      const itemId = await approvedItem({ vehicleId: IDS.truckBio })
      const orderId = await orderOf({ itemId })
      await issueAndSendOrder(orderId, IDS.jefe)
      expect(await orderStatus(orderId)).toBe("sent")
    })

    it("un servicio con OT no se bloquea: los servicios no tienen repuesto de catálogo", async () => {
      const itemId = await approvedItem({ requestType: "servicios", workOrderId: otA, productNameFree: "Rectificado de culata" })
      const orderId = await orderOf({ itemId, name: "Rectificado de culata" })
      await issueAndSendOrder(orderId, IDS.jefe)
      expect(await orderStatus(orderId)).toBe("sent")
    })
  })
})
