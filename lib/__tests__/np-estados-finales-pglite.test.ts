import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { Tx } from "@/db"
import {
  IDS,
  NOW,
  OT_ID,
  insertNoteEventTx,
  itemRow,
  itemsOf,
  link,
  makeProduct,
  manualNote,
  noteRow,
  orderFor,
  phoneOtNote,
  ingress,
  expectInvariant,
  refused,
  registerReceipt,
  requestFor,
  resetState,
  setupDatabase,
  testDb,
  unlinkNoteItemsFromRequestTx,
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

const resolver = await import("@/lib/services/mantencion/parts-notes/resolve")
const transitions = await import("@/lib/services/mantencion/parts-notes/transitions")
const query = await import("@/lib/services/mantencion/parts-notes/query")
const { assertPartsNoteLineBuyable } = await import("@/lib/requests/request-service-module/linked-parts-note")

/**
 * Notas en estado final (`cerrada`, `rechazada`, `anulada`) contra Postgres de verdad: una persona no resuelve, rechaza ni
 * compra sus líneas (sólo «Reabrir» las devuelve), aunque la línea siga «en compra» sin compra viva como las que trae
 * una nota «Cerrada» importada de CHOME ERP. Los automáticos (la compra que muere) siguen funcionando. Y el prellenado de la
 * solicitud (`?np=`) exige la faena en el alcance: ser quien pidió la nota (`view_own`) no basta para comprarla.
 */

beforeAll(async () => {
  await setupDatabase()
})

beforeEach(resetState)

let seq = 0
type FinalNote = { noteId: string; code: string; itemIds: string[] }

/**
 * Una nota que llegó ya terminada, como la importa CHOME ERP: sin solicitante en la plataforma, con su folio de origen, un
 * evento `migrada` y sus líneas «en compra» sin ninguna compra viva. `workOrderId`: con OT (para que el stock se pueda reservar).
 */
async function importedNote(status: "cerrada" | "rechazada" | "anulada", options: { workOrderId?: string | null; productId?: string | null } = {}): Promise<FinalNote> {
  seq += 1
  const id = `np-ef-${seq}`
  const workOrderId = options.workOrderId ?? null
  await testDb.insert(schema.mantPartsNotes).values({
    id, code: `NP-EF-${seq}`, workOrderId, vehicleId: workOrderId ? IDS.truckBio : null, worksiteId: IDS.wsBio,
    requestedByUserId: null, requestedByName: "Taller Biodiversa", externalRef: `CHOME-EF-${seq}`, status, createdAt: NOW, updatedAt: NOW,
    ...(status === "anulada" ? { voidedByUserId: IDS.jefe, voidedAt: NOW, voidReason: "Duplicada en el ERP" } : {}),
  })
  await testDb.insert(schema.mantPartsNoteItems).values([0, 1].map((index) => ({
    id: `${id}-i${index}`, noteId: id, description: index === 0 ? "Filtro de aceite" : "Aceite hidráulico", quantity: 2, unitOfMeasure: "unidad",
    productId: index === 0 ? options.productId ?? null : null,
    resolution: "en_compra", resolvedByUserId: IDS.jefe, resolvedAt: NOW, sortOrder: index, createdAt: NOW,
  })))
  await testDb.transaction((raw) => insertNoteEventTx(raw as unknown as Tx, { noteId: id, kind: "migrada", fromStatus: null, toStatus: status }))
  return { noteId: id, code: `NP-EF-${seq}`, itemIds: await itemsOf(id) }
}

const allocationsCount = async () => (await testDb.select().from(schema.mantPartsAllocations)).length

describe("una nota en estado final no admite acciones de personas sobre sus líneas", () => {
  it("rechazar una línea de una nota cerrada o rechazada se rechaza y no escribe nada", async () => {
    const jefe = await viewerOf(IDS.jefe)
    for (const status of ["cerrada", "rechazada"] as const) {
      for (const workOrderId of [null, OT_ID]) {
        const note = await importedNote(status, { workOrderId })
        const refusal = await refused(() => resolver.rejectNoteItem(jefe, { itemId: note.itemIds[0]!, reason: "No hace falta" }), note.noteId)
        expect(refusal.message).toBe(`La nota ${note.code} está ${status}: sus líneas ya no se resuelven. Sólo «Reabrir» las devuelve a pendiente.`)
        expect((await itemRow(note.itemIds[0]!)).resolution).toBe("en_compra")
        expect(await expectInvariant(note.noteId)).toBe(status)
      }
    }
  })

  it("una nota anulada sigue diciendo que está anulada", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const note = await importedNote("anulada")
    const refusal = await refused(() => resolver.rejectNoteItem(jefe, { itemId: note.itemIds[0]!, reason: "No hace falta" }), note.noteId)
    expect(refusal.message).toBe(`La nota ${note.code} está anulada.`)
  })

  it("no se aparta del stock una línea «en compra» sin compra de una nota cerrada con OT (antes se reservaba)", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const filter = await makeProduct("Filtro de aceite de la importada")
    await ingress(filter, 5)
    const note = await importedNote("cerrada", { workOrderId: OT_ID, productId: filter })
    const refusal = await refused(() => resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[0]!, productId: filter, quantity: 1 }), note.noteId)
    expect(refusal.message).toContain("está cerrada")
    expect(await allocationsCount()).toBe(0)
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("en_compra")
  })

  it("«Reabrir» es la salida: la nota rechazada reabierta vuelve a admitir resolver sus líneas", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const note = await manualNote([{ description: "Rodamiento 6205", quantity: 2 }])
    expect(await transitions.rejectPartsNote(jefe, { noteId: note.noteId, reason: "Lo trae el proveedor" })).toMatchObject({ ok: true })
    expect(await expectInvariant(note.noteId)).toBe("rechazada")
    // Cerrada la puerta: la línea ya está rechazada y la nota también.
    expect((await refused(() => resolver.rejectNoteItem(jefe, { itemId: note.itemIds[0]!, reason: "Otra vez no" }), note.noteId)).message).toContain("ya está rechazada")

    expect(await transitions.reopenPartsNote(jefe, { noteId: note.noteId, reason: "Sí se necesita, se volvió a pedir" })).toMatchObject({ ok: true })
    expect(await expectInvariant(note.noteId)).toBe("enviada")
    expect(await resolver.rejectNoteItem(jefe, { itemId: note.itemIds[0]!, reason: "Ahora sí lo rechazo" })).toMatchObject({ ok: true })
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("rechazada")
  })

  it("una nota cerrada legítima cuya compra se cancela después sigue funcionando: la línea vuelve a pendiente y la nota se reabre sola", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const filter = await makeProduct("Filtro de aire de la cerrada")
    const note = await manualNote([{ description: "Filtro de aire", quantity: 2, productId: filter }])
    const request = await requestFor(note.itemIds[0]!, "purchased")
    await link(note.itemIds[0]!, request.itemId)
    const order = await orderFor(request.itemId, filter, 2)
    await registerReceipt({
      purchaseOrderId: order.orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio,
      items: [{ purchaseOrderItemId: order.ocItemId, quantityReceived: 2 }],
    })
    expect(await expectInvariant(note.noteId)).toBe("cerrada")

    // Lo automático no pasa por el bloqueo de las personas: la compra muere y la línea vuelve a gestión.
    await testDb.update(schema.purchaseRequestItems).set({ status: "rejected" }).where(eq(schema.purchaseRequestItems.id, request.itemId))
    await testDb.transaction((raw) => unlinkNoteItemsFromRequestTx(raw as unknown as Tx, { noteItemIds: [note.itemIds[0]!], actorUserId: IDS.jefe }))
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("pendiente")
    expect(await expectInvariant(note.noteId)).toBe("enviada")
    expect(await resolver.rejectNoteItem(jefe, { itemId: note.itemIds[0]!, reason: "Ya no se necesita" })).toMatchObject({ ok: true })
  })
})

describe("la ficha no ofrece repuestos para reservar en una nota en estado final", () => {
  it("una nota abierta con OT ofrece los repuestos con stock libre; la misma nota cerrada, rechazada o anulada no", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const filter = await makeProduct("Filtro de la ficha")
    await ingress(filter, 5)
    const open = await phoneOtNote()
    expect((await query.getPartsNote(jefe, open.noteId))?.stockOptions).toEqual(expect.arrayContaining([expect.objectContaining({ productId: filter, free: 5 })]))
    for (const status of ["cerrada", "rechazada", "anulada"] as const) {
      const note = await importedNote(status, { workOrderId: OT_ID, productId: filter })
      expect(await query.getPartsNote(jefe, note.noteId), status).toMatchObject({ status, canManage: true, actions: [], stockOptions: [] })
    }
  })
})

describe("la solicitud de repuestos no compra lo de una nota en estado final", () => {
  const assertBuyable = (itemId: string, options: { alreadySaved?: boolean } = {}) => testDb.transaction((raw) => assertPartsNoteLineBuyable(
    raw as unknown as Tx, { partsNoteItemId: itemId, workOrderId: null, worksiteId: IDS.wsBio }, options,
  ))

  it("una línea «en compra» sin compra de una nota cerrada o rechazada no se vuelve a comprar; el borrador ya guardado no falla, lo frena el envío", async () => {
    for (const status of ["cerrada", "rechazada"] as const) {
      const note = await importedNote(status)
      await expect(assertBuyable(note.itemIds[0]!)).rejects.toThrow(`La nota de pedido ${note.code} está ${status}: ya no se compra con ella`)
      await expect(assertBuyable(note.itemIds[0]!, { alreadySaved: true })).resolves.toEqual({ workOrderId: null, chargeVehicleId: null })
    }
  })

  it("una nota abierta sigue admitiendo comprar sus líneas", async () => {
    const note = await manualNote([{ description: "Burlete de puerta", quantity: 1 }])
    await expect(assertBuyable(note.itemIds[0]!)).resolves.toEqual({ workOrderId: null, chargeVehicleId: null })
  })
})

describe("loadPartsNotePrefill: comprar exige faena en el alcance y una nota abierta", () => {
  it("una nota cerrada o rechazada no precarga la solicitud, aunque sus líneas sigan «en compra» sin compra viva", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const open = await manualNote([{ description: "Burlete de puerta", quantity: 1 }])
    expect((await query.loadPartsNotePrefill(jefe, open.noteId))?.items).toHaveLength(1)
    for (const status of ["cerrada", "rechazada", "anulada"] as const) {
      const note = await importedNote(status)
      expect(await query.loadPartsNotePrefill(jefe, note.noteId), status).toBeNull()
    }
  })

  it("quien pidió la nota y tiene «comprar» pero no la faena en su alcance no la precarga (view_own por autoría no basta)", async () => {
    const note = await manualNote([{ description: "Cable de acero", quantity: 1 }], IDS.mecBio)
    expect((await noteRow(note.noteId)).requestedByUserId).toBe(IDS.mecBio)
    const withPurchase = (permissions: string[]) => [...new Set([...permissions, "mant:np:view_own", "mant:np:purchase"])]

    const inScope = await viewerOf(IDS.mecBio, withPurchase)
    expect((await query.loadPartsNotePrefill(inScope, note.noteId))?.noteId).toBe(note.noteId)
    expect(await query.loadPartsNotePrefill({ ...inScope, worksiteIds: [IDS.wsCho] }, note.noteId)).toBeNull()
    expect(await query.loadPartsNotePrefill({ ...inScope, worksiteIds: [] }, note.noteId)).toBeNull()

    // Sin comprar ni resolver, la autoría tampoco basta aunque la faena sea suya (como siempre).
    const onlyOwn = await viewerOf(IDS.mecBio, (permissions) => permissions.filter((permission) => permission !== "mant:np:manage" && permission !== "mant:np:purchase"))
    expect(await query.loadPartsNotePrefill(onlyOwn, note.noteId)).toBeNull()
  })
})
