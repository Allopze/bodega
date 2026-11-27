import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { Tx } from "@/db"
import { and, eq } from "drizzle-orm"
import {
  IDS,
  NOW,
  OT_ID,
  contextOf,
  createPartsNote,
  createPartsNoteFromDevice,
  eventsOf,
  expectDbError,
  expectInvariant,
  ingress,
  insertNoteEventTx,
  itemRow,
  link,
  makeProduct,
  manualNote,
  noteRow,
  opId,
  orderFor,
  phoneNote,
  refused,
  registerReceipt,
  requestFor,
  resetState,
  setupDatabase,
  stockIn,
  testDb,
  unlinkNoteItemsFromRequestTx,
  viewerOf,
  voidReceipt,
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

/**
 * Notas de pedido SIN OT (ADR 0001, 2026-11-27) contra Postgres de verdad: el alta idempotente desde la web y el teléfono,
 * la validación de faena, equipo y centro de costo, el repuesto que no se aparta del stock, la compra sin OT, la recepción
 * en faena que la cierra, su anulación y la importación sin usuario. Las transiciones de cabecera están en
 * `np-transiciones-pglite.test.ts`.
 */

beforeAll(async () => {
  await setupDatabase()
})

beforeEach(resetState)

describe("notas sin OT (ADR 0001, 2026-11-27)", () => {
  it("el alta desde la web es idempotente por clientOpId: la misma NP, sin evento de OT y con su evento «creada»", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const clientOpId = `op-tr-web-${crypto.randomUUID()}`
    const input = { clientOpId, worksiteId: IDS.wsBio, urgent: true, notes: "Pedido de taller", lines: [{ description: "Rodamiento 6205", quantity: 4, unitOfMeasure: "unidad" }] }
    const first = await createPartsNote(jefe, input)
    const second = await createPartsNote(jefe, input)
    expect(first).toMatchObject({ ok: true, duplicate: false })
    expect(second).toMatchObject({ ok: true, duplicate: true, noteId: first.ok ? first.noteId : "" })
    const rows = await testDb.select().from(schema.mantPartsNotes).where(eq(schema.mantPartsNotes.clientOpId, clientOpId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ workOrderId: null, vehicleId: null, worksiteId: IDS.wsBio, urgent: true, requestedByUserId: IDS.jefe })
    expect((await eventsOf(rows[0]!.id)).map((event) => [event.kind, event.fromStatus, event.toStatus])).toEqual([["creada", null, "enviada"]])
    expect(await testDb.select().from(schema.mantWorkOrderEvents).where(and(eq(schema.mantWorkOrderEvents.type, "parts_note_created"), eq(schema.mantWorkOrderEvents.workOrderId, OT_ID)))).toHaveLength(0)
    expect(await expectInvariant(rows[0]!.id)).toBe("enviada")
  })

  it("el alta desde el teléfono sin OT crea la nota en la faena pedida; el payload viejo (con OT) sigue igual y lleva su urgencia", async () => {
    const mechanic = await contextOf(IDS.mecBio)
    const noOt = await createPartsNoteFromDevice(phoneNote({ workOrderId: null, worksiteId: IDS.wsBio, equipmentStopped: false, urgent: true }), mechanic)
    expect(noOt.status).toBe(200)
    const noOtRow = await noteRow((noOt.body as { noteId: string }).noteId)
    expect(noOtRow).toMatchObject({ workOrderId: null, worksiteId: IDS.wsBio, urgent: true })

    const legacy = await createPartsNoteFromDevice(phoneNote({ equipmentStopped: true }), mechanic)
    expect(legacy.status).toBe(200)
    expect(await noteRow((legacy.body as { noteId: string }).noteId)).toMatchObject({ workOrderId: OT_ID, equipmentStopped: true, urgent: true })
  })

  it("el alcance y el cargo se validan contra la faena de la nota: otra faena, centro ajeno o equipo de otra faena se rechazan", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const outside = await createPartsNote(await viewerOf(IDS.supBio), { clientOpId: opId(), worksiteId: IDS.wsCho, urgent: false, lines: [{ description: "Cable", quantity: 1, unitOfMeasure: "metro" }] })
    expect(outside).toEqual({ ok: false, message: "Esa faena no es de tu alcance.", field: "worksiteId" })

    const foreignCost = await createPartsNote(jefe, { clientOpId: opId(), worksiteId: IDS.wsBio, urgent: false, lines: [{ description: "Cable", quantity: 1, unitOfMeasure: "metro", chargeCostCenterId: "cc-tr-cho" }] })
    expect(foreignCost).toEqual({ ok: false, message: "El centro de costo de «Cable» no es de la faena de la nota.", field: "lines.0.chargeCostCenterId" })

    const foreignVehicle = await createPartsNote(jefe, { clientOpId: opId(), worksiteId: IDS.wsBio, urgent: false, lines: [{ description: "Cable", quantity: 1, unitOfMeasure: "metro", chargeVehicleId: IDS.truckCho }] })
    expect(foreignVehicle).toEqual({ ok: false, message: "El equipo de cargo de «Cable» no está hoy en la faena de la nota.", field: "lines.0.chargeVehicleId" })

    const both = await createPartsNote(jefe, { clientOpId: opId(), worksiteId: IDS.wsBio, urgent: false, lines: [{ description: "Cable", quantity: 1, unitOfMeasure: "metro", chargeVehicleId: IDS.truckBio, chargeCostCenterId: "cc-tr-bio" }] })
    expect(both).toMatchObject({ ok: false, message: "«Cable» se imputa a un equipo o a un centro de costo, no a los dos." })

    // Un cargo válido (equipo de la faena, o centro de costo de la faena) se guarda en la línea.
    const charged = await manualNote([
      { description: "Cable de acero", quantity: 1, chargeVehicleId: IDS.truckBio },
      { description: "Guantes de cuero", quantity: 2, chargeCostCenterId: "cc-tr-bio", suggestedSupplierId: "sup-tr" },
    ])
    const [byVehicle, byCenter] = await Promise.all(charged.itemIds.map(itemRow))
    expect(byVehicle).toMatchObject({ chargeVehicleId: IDS.truckBio, chargeCostCenterId: null })
    expect(byCenter).toMatchObject({ chargeVehicleId: null, chargeCostCenterId: "cc-tr-bio", suggestedSupplierId: "sup-tr" })
  })

  it("una línea sin OT no se aparta del stock (no hay reserva) y se compra sin OT", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const filter = await makeProduct("Filtro de aire")
    await ingress(filter, 5)
    const note = await manualNote([{ description: "Filtro de aire", quantity: 1, productId: filter }])
    const refusal = await refused(() => resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[0]!, productId: filter, quantity: 1 }), note.noteId)
    expect(refusal.message).toBe("Una nota sin OT no aparta stock: el repuesto ya está libre en la bodega de la faena.")

    const request = await requestFor(note.itemIds[0]!)
    await link(note.itemIds[0]!, request.itemId)
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("en_compra")
    expect(await expectInvariant(note.noteId)).toBe("en_compra")
    // Sin OT no hay evento de OT ni nada que escribir en una OT.
    expect(await testDb.select().from(schema.mantWorkOrderEvents).where(eq(schema.mantWorkOrderEvents.type, "parts_note_resolved"))).toHaveLength(0)
  })

  it("una recepción parcial en faena deja la nota recibida parcial; anularla la devuelve a esperar; la completa la cierra", async () => {
    const filter = await makeProduct("Filtro de combustible")
    const note = await manualNote([{ description: "Filtro de combustible", quantity: 3, productId: filter }])
    const request = await requestFor(note.itemIds[0]!, "purchased")
    await link(note.itemIds[0]!, request.itemId)
    expect(await expectInvariant(note.noteId)).toBe("en_compra")

    const order = await orderFor(request.itemId, filter, 3)
    const partial = await registerReceipt({
      purchaseOrderId: order.orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio,
      items: [{ purchaseOrderItemId: order.ocItemId, quantityReceived: 2 }],
    })
    expect(await expectInvariant(note.noteId)).toBe("recibida_parcial")
    expect(await stockIn(filter)).toBe(2)

    await voidReceipt({ receiptId: partial, reason: "Se registró contra la orden equivocada", voidedBy: IDS.jefe })
    expect(await expectInvariant(note.noteId)).toBe("en_compra")
    expect(await stockIn(filter)).toBe(0)
    const kinds = (await eventsOf(note.noteId)).map((event) => event.toStatus)
    expect(kinds).toEqual(["enviada", "en_compra", "recibida_parcial", "en_compra"])
  })

  it("la recepción completa en faena cierra la nota sin OT en la misma transacción", async () => {
    const filter = await makeProduct("Filtro de aire compresor")
    const note = await manualNote([{ description: "Filtro de aire compresor", quantity: 2, productId: filter }])
    const request = await requestFor(note.itemIds[0]!, "purchased")
    await link(note.itemIds[0]!, request.itemId)
    const order = await orderFor(request.itemId, filter, 2)
    await registerReceipt({
      purchaseOrderId: order.orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio,
      items: [{ purchaseOrderItemId: order.ocItemId, quantityReceived: 2 }],
    })
    expect(await expectInvariant(note.noteId)).toBe("cerrada")
    expect(await stockIn(filter)).toBe(2)
  })

  it("una línea con la compra muerta vuelve a pendiente; la nota recalcula sin tocar ninguna OT", async () => {
    const note = await manualNote([{ description: "Burlete de puerta", quantity: 1 }])
    const request = await requestFor(note.itemIds[0]!)
    await link(note.itemIds[0]!, request.itemId)
    await testDb.update(schema.purchaseRequestItems).set({ status: "rejected" }).where(eq(schema.purchaseRequestItems.id, request.itemId))
    await testDb.transaction((raw) => unlinkNoteItemsFromRequestTx(raw as unknown as Tx, { noteItemIds: [note.itemIds[0]!], actorUserId: IDS.jefe }))
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("pendiente")
    expect(await expectInvariant(note.noteId)).toBe("enviada")
  })

  it("el evento «creada» del historial de una importación sin usuario queda con su folio de origen", async () => {
    await testDb.insert(schema.mantPartsNotes).values({
      id: "np-tr-import", code: "NP-TR-IMP", worksiteId: IDS.wsBio, requestedByUserId: null, requestedByName: "Taller Biodiversa",
      externalRef: "CHOME-900", status: "enviada", createdAt: NOW, updatedAt: NOW,
    })
    await testDb.transaction((raw) => insertNoteEventTx(raw as unknown as Tx, { noteId: "np-tr-import", kind: "creada", fromStatus: null, toStatus: "enviada" }))
    expect(await expectInvariant("np-tr-import")).toBe("enviada")
    await expectDbError(() => testDb.insert(schema.mantPartsNotes).values({
      id: "np-tr-import-2", code: "NP-TR-IMP-2", worksiteId: IDS.wsBio, requestedByUserId: null, status: "enviada", createdAt: NOW, updatedAt: NOW,
    }), /mant_parts_notes_requester_valid/)
  })
})

