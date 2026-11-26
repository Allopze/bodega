import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, asc, eq, inArray } from "drizzle-orm"
import path from "node:path"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"
import type { MantEquipmentSnapshot } from "@/db/schema"
import type { SyncPartsNote } from "@/lib/mantencion/contracts"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { configureZodLocale } from "@/lib/validation/zod-locale"
import { IDS, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * Regresiones de las reglas de las notas de pedido (NP) de Mantención (auditoría 2026-11-26), contra Postgres real:
 *
 *  - NP4-1: rechazar el ítem de la solicitud que compraba una línea la desvincula (vuelve a pendiente, o se rechaza sola si
 *    la OT terminó);
 *  - NP4-2: «por resolver» es toda nota abierta con una línea pendiente; una compra que no llegó mantiene la nota en gestión;
 *  - NP4-3: reservar menos de lo pedido resuelve sólo eso y deja el saldo como una línea pendiente nueva;
 *  - NP4-4 y NP4-6: liberar la reserva de una línea «desde stock» la devuelve a pendiente y la nota se puede anular.
 *
 * Cada caso demuestra también que repetir la operación no duplica nada (cero diferencias). PGlite es de una sola
 * conexión: el orden de bloqueo lo cubre la revisión del servicio y el ADR 0001, no esta suite.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn(async () => undefined),
  sendBatchEmails: vi.fn(async () => undefined),
  getAppBaseUrl: () => "http://localhost",
}))

const { createPartsNoteFromDevice } = await import("@/lib/services/mantencion/parts-notes/create")
const resolver = await import("@/lib/services/mantencion/parts-notes/resolve")
const query = await import("@/lib/services/mantencion/parts-notes/query")
const transitions = await import("@/lib/services/mantencion/work-orders/transitions")
const { recalcNoteStatusTx } = await import("@/lib/services/mantencion/parts-notes/status")
const { distributeRelease } = await import("@/lib/services/mantencion/parts-notes/line-release")
const { rejectItem } = await import("@/lib/services/item-state-module/approval")
const parts = await import("@/lib/services/mantencion/parts")
const { applyMovementTx } = await import("@/lib/services/stock-movement")
const { getUserRbacById } = await import("@/lib/auth/rbac")

const SNAPSHOT: MantEquipmentSnapshot = { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" }

/** Una OT por escenario: terminar o anular una OT no se deshace. */
const OT_KEYS = ["buy", "arrive", "split", "release", "lifo", "late", "end", "void", "gone"] as const
type OtKey = (typeof OT_KEYS)[number]
const OT = Object.fromEntries(OT_KEYS.map((key) => [key, `ot-np-${key}`])) as Record<OtKey, string>

async function insertOt(key: OtKey) {
  await testDb.insert(schema.mantWorkOrders).values({
    id: OT[key], folio: `OT-NP-${key}`, vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, equipmentSnapshot: SNAPSHOT,
    repair: true, maintenance: false, requestDate: "2026-11-01", requestedByUserId: IDS.jefe, requesterName: "Alexis Morales",
    repairDescription: "Fuga hidráulica en la pluma", status: "en_ejecucion",
    assignedToUserId: IDS.mecBio, assignedByUserId: IDS.jefe, assignedAt: "2026-11-01T12:00:00Z",
    workshopKind: "interno", workshopEntryAt: "2026-11-02T08:00:00Z", estimatedDeliveryDate: "2026-12-31", startedAt: "2026-11-02T08:00:00Z", startedByUserId: IDS.mecBio,
  })
}

async function contextOf(userId: string) {
  const rbac = (await getUserRbacById(userId, true))!
  return {
    userName: rbac.name, deviceId: "dev-test-reglas", credentialId: "cred-test-reglas",
    viewer: { userId: rbac.id, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal },
  }
}
const viewerOf = async (userId: string) => (await contextOf(userId)).viewer
async function actorOf(userId: string) {
  const rbac = (await getUserRbacById(userId, true))!
  return { userId: rbac.id, name: rbac.name, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal }
}

let productSeq = 0
async function makeProduct(name: string, unit = "unidad"): Promise<string> {
  productSeq += 1
  const id = `p-reglas-${productSeq}`
  const now = new Date().toISOString()
  await testDb.insert(schema.products).values({
    id, sku: `REP-RG-${productSeq}`, name, categoryId: "cat-reglas", unitOfMeasure: unit, isSparePart: true, partNumber: `PN-RG-${productSeq}`, isActive: true, createdAt: now, updatedAt: now,
  })
  return id
}

type Line = { description: string; quantity: number }
type Created = { noteId: string; code: string; itemIds: string[] }
/** Crea una NP por el servicio (como la manda el teléfono). Por omisión, dos líneas de 2 unidades. */
async function createNote(workOrderId: string, lines: Line[] = [{ description: "Filtro de aceite", quantity: 2 }, { description: "Aceite hidráulico", quantity: 2 }], overrides: Partial<SyncPartsNote> = {}): Promise<Created> {
  const body: SyncPartsNote = {
    id: crypto.randomUUID(), workOrderId, deviceId: crypto.randomUUID(), appVersion: "test", createdAt: new Date().toISOString(),
    equipmentStopped: true, notes: "Se cortó en faena",
    lines: lines.map((line) => ({ description: line.description, quantity: line.quantity, unitOfMeasure: "unidad", partNumber: null, productId: null })),
    ...overrides,
  }
  const result = await createPartsNoteFromDevice(body, await contextOf(IDS.mecBio))
  expect(result.status).toBe(200)
  if (!result.body.ok) throw new Error(result.body.message)
  const items = await testDb.select().from(schema.mantPartsNoteItems).where(eq(schema.mantPartsNoteItems.noteId, result.body.noteId)).orderBy(schema.mantPartsNoteItems.sortOrder)
  return { noteId: result.body.noteId, code: result.body.code, itemIds: items.map((item) => item.id) }
}

async function ingress(productId: string, quantity: number) {
  await testDb.transaction((tx) => applyMovementTx(tx as unknown as Tx, {
    worksiteId: IDS.wsBio, productId, type: "ingreso_oc", quantity, performedBy: IDS.jefe, referenceType: "test", referenceId: "seed",
  }))
}

/** Un aporte a la reserva como lo hace la recepción (con o sin línea de nota). */
async function arrive(workOrderId: string, productId: string, quantity: number, noteItemId?: string) {
  return testDb.transaction(async (raw) => {
    const tx = raw as unknown as Tx
    await parts.lockForStockTx(tx, { workOrderIds: [workOrderId], worksiteId: IDS.wsBio, productIds: [productId] })
    return parts.addToAllocationTx(tx, { workOrderId, worksiteId: IDS.wsBio, productId, quantity, source: "recepcion", noteItemId, actorUserId: IDS.jefe })
  })
}

async function freeOf(productId: string): Promise<number> {
  return testDb.transaction(async (raw) => {
    const tx = raw as unknown as Tx
    await parts.lockForStockTx(tx, { worksiteId: IDS.wsBio, productIds: [productId] })
    return parts.freeStockTx(tx, IDS.wsBio, productId)
  })
}

let recordSeq = 0
async function consume(workOrderId: string, productId: string, quantity: number, allocationId: string) {
  recordSeq += 1
  const recordId = `rec-reglas-${recordSeq}`
  await testDb.insert(schema.mantRecords).values({
    id: recordId, folio: `C-RG-${recordSeq}`, kind: "C", vehicleId: IDS.truckBio, equipmentSnapshot: SNAPSHOT, worksiteId: IDS.wsBio,
    reading: 130_000 + recordSeq, unit: "km", workDate: "2026-11-03", registeredBy: IDS.mecBio, executorKind: "yo", executorUserId: IDS.mecBio,
    executorName: "Javier Roa", signedAt: "2026-11-03T16:00:00Z", receivedAt: `2026-11-03T16:00:${String(recordSeq).padStart(2, "0")}Z`, workOrderId,
  })
  await testDb.insert(schema.mantRecordCorrectives).values({
    recordId, workTypes: ["Mecánico"], oils: [], description: "Cambio de filtro", noParts: false, hours: 2, inWorkshop: false,
  })
  await testDb.transaction(async (raw) => {
    const tx = raw as unknown as Tx
    const result = await parts.consumePartTx(tx, { recordId, workOrderId, recordWorksiteId: IDS.wsBio, productId, allocationId, quantity, actorUserId: IDS.mecBio })
    expect(result.status).toBe("descontado")
    await tx.insert(schema.mantRecordParts).values({
      id: `${recordId}-${productId}`, recordId, quantity, description: "repuesto", source: "stock", productId, allocationId,
      stockStatus: "descontado", inventoryMovementId: result.status === "descontado" ? result.movementId : null,
    })
  })
}

let requestSeq = 0
/** Una compra que apunta a la línea: solicitud + ítem de solicitud (como queda tras guardar y enviar la solicitud). */
async function insertPurchase(input: { noteItemId: string; workOrderId: string; itemStatus: string; requestStatus: string; productId?: string }) {
  requestSeq += 1
  const requestId = `req-reglas-${requestSeq}`
  await testDb.insert(schema.purchaseRequests).values({
    id: requestId, code: `SOL-RG-${requestSeq}`, worksiteId: IDS.wsBio, requesterId: IDS.jefe, requestType: "repuestos", urgency: "high", status: input.requestStatus,
  })
  const itemId = `rqi-reglas-${requestSeq}`
  await testDb.insert(schema.purchaseRequestItems).values({
    id: itemId, requestId, productNameFree: "Filtro de aceite", quantity: 2, status: input.itemStatus,
    vehicleId: IDS.truckBio, workOrderId: input.workOrderId, partsNoteItemId: input.noteItemId,
  })
  return { requestId, itemId }
}

/** Deja la línea «en compra» como lo hace la solicitud (con el estado de la NP al día). */
async function markInPurchase(noteItemId: string) {
  const [line] = await testDb.update(schema.mantPartsNoteItems)
    .set({ resolution: "en_compra", resolvedByUserId: IDS.jefe, resolvedAt: new Date().toISOString() })
    .where(eq(schema.mantPartsNoteItems.id, noteItemId))
    .returning({ noteId: schema.mantPartsNoteItems.noteId })
  await testDb.transaction((tx) => recalcNoteStatusTx(tx as unknown as Tx, line!.noteId))
}

const noteRow = async (noteId: string) => (await testDb.select().from(schema.mantPartsNotes).where(eq(schema.mantPartsNotes.id, noteId)))[0]!
const itemRow = async (itemId: string) => (await testDb.select().from(schema.mantPartsNoteItems).where(eq(schema.mantPartsNoteItems.id, itemId)))[0]!
const linesOf = (noteId: string) => testDb.select().from(schema.mantPartsNoteItems).where(eq(schema.mantPartsNoteItems.noteId, noteId)).orderBy(asc(schema.mantPartsNoteItems.sortOrder))
const eventsOf = (workOrderId: string, type: string) => testDb.select().from(schema.mantWorkOrderEvents)
  .where(and(eq(schema.mantWorkOrderEvents.workOrderId, workOrderId), eq(schema.mantWorkOrderEvents.type, type))).orderBy(asc(schema.mantWorkOrderEvents.createdAt), asc(schema.mantWorkOrderEvents.id))
const auditsOf = (entityId: string) => testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, entityId))
const allocationOf = async (workOrderId: string, productId: string) =>
  (await testDb.select().from(schema.mantPartsAllocations).where(and(eq(schema.mantPartsAllocations.workOrderId, workOrderId), eq(schema.mantPartsAllocations.productId, productId))).orderBy(asc(schema.mantPartsAllocations.createdAt)))[0]!
const sourcesOf = (allocationId: string) => testDb.select().from(schema.mantPartsAllocationSources).where(eq(schema.mantPartsAllocationSources.allocationId, allocationId)).orderBy(asc(schema.mantPartsAllocationSources.createdAt), asc(schema.mantPartsAllocationSources.id))

/** Todo lo que estas pruebas comparan de una OT y sus notas: si dos corridas dejan lo mismo, no hubo diferencias. */
async function snapshotOf(workOrderId: string, noteIds: string[]) {
  const notes = noteIds.length ? await testDb.select().from(schema.mantPartsNotes).where(inArray(schema.mantPartsNotes.id, noteIds)).orderBy(asc(schema.mantPartsNotes.id)) : []
  const items = noteIds.length ? await testDb.select().from(schema.mantPartsNoteItems).where(inArray(schema.mantPartsNoteItems.noteId, noteIds)).orderBy(asc(schema.mantPartsNoteItems.id)) : []
  const events = await testDb.select().from(schema.mantWorkOrderEvents).where(eq(schema.mantWorkOrderEvents.workOrderId, workOrderId)).orderBy(asc(schema.mantWorkOrderEvents.id))
  const allocations = await testDb.select().from(schema.mantPartsAllocations).where(eq(schema.mantPartsAllocations.workOrderId, workOrderId)).orderBy(asc(schema.mantPartsAllocations.id))
  const sources = allocations.length
    ? await testDb.select().from(schema.mantPartsAllocationSources).where(inArray(schema.mantPartsAllocationSources.allocationId, allocations.map((row) => row.id))).orderBy(asc(schema.mantPartsAllocationSources.id))
    : []
  const audits = noteIds.length ? await testDb.select().from(schema.auditLog).where(inArray(schema.auditLog.entityId, noteIds)).orderBy(asc(schema.auditLog.id)) : []
  return { notes, items, events, allocations, sources, audits }
}

async function resetState() {
  for (const table of [
    schema.notifications, schema.auditLog, schema.rateLimits, schema.mantRecordParts, schema.mantRecords, schema.approvalDecisions, schema.statusHistory,
    schema.purchaseOrderItems, schema.purchaseOrders, schema.purchaseRequestItems, schema.purchaseRequests,
    schema.mantPartsAllocationSources, schema.mantPartsAllocations, schema.mantPartsNotes,
  ]) await testDb.delete(table)
  await testDb.delete(schema.mantWorkOrderEvents).where(inArray(schema.mantWorkOrderEvents.type, [
    "parts_note_created", "parts_note_resolved", "parts_allocated", "parts_consumed", "parts_released",
  ]))
}

beforeAll(async () => {
  configureZodLocale()
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedMantFixtures(testDb)
  await testDb.insert(schema.productCategories).values({ id: "cat-reglas", name: "Repuestos reglas", slug: "repuestos-reglas", isEpp: false, requiresPrevencion: false, sortOrder: 1 })
  for (const key of OT_KEYS) await insertOt(key)
})

beforeEach(resetState)

// ── NP4-1 · el rechazo de la compra desvincula la línea ─────────────────────────────────────────────

describe("NP4-1 · rechazar el ítem de la solicitud que compraba una línea", () => {
  it("la línea vuelve a pendiente, la nota sigue en «Pendientes» y repetirlo no cambia nada", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const note = await createNote(OT.buy)
    const [bought, other] = note.itemIds as [string, string]
    const purchase = await insertPurchase({ noteItemId: bought, workOrderId: OT.buy, itemStatus: "approved", requestStatus: "approved" })
    await markInPurchase(bought)
    await resolver.rejectNoteItem(jefe, { itemId: other, reason: "No corresponde al equipo" })
    // Con la compra viva la línea no se puede gestionar.
    expect(await resolver.rejectNoteItem(jefe, { itemId: bought, reason: "Ya no se necesita" })).toMatchObject({ ok: false })
    expect((await itemRow(bought)).resolution).toBe("en_compra")

    // Quien aprueba rechaza el ítem: la línea no se queda en «Pedido» sin acciones.
    await rejectItem(purchase.itemId, IDS.jefe, "El precio no se justifica")

    expect(await itemRow(bought)).toMatchObject({ resolution: "pendiente", resolutionReason: null, resolvedByUserId: null, resolvedAt: null })
    expect((await noteRow(note.noteId)).status).toBe("en_gestion")
    const tray = await query.listPartsNotes(jefe, { tab: "pendientes", page: 1, pageSize: 25 })
    expect(tray.rows.map((row) => [row.id, row.pendingLines])).toEqual([[note.noteId, 1]])
    expect(tray.counts).toEqual({ pendientes: 1, en_gestion: 0, cerradas: 0 })
    const detail = (await query.getPartsNote(jefe, note.noteId))!
    expect(detail.lines[0]).toMatchObject({ resolution: "pendiente", stage: "pedido" })
    // Y jefatura puede actuar otra vez sobre ella.
    const events = await eventsOf(OT.buy, "parts_note_resolved")
    const back = events.find((event) => (event.changeSet as { resolution?: string; itemId?: string } | null)?.resolution === "pendiente")
    expect(back).toMatchObject({ actorUserId: IDS.jefe, reason: expect.stringContaining("Vuelve a pendiente") })
    expect(back?.changeSet).toMatchObject({ itemId: bought, previousResolution: "en_compra" })

    // Cero diferencias: desvincular otra vez (y el rechazo ya hecho) no escribe nada más.
    const before = await snapshotOf(OT.buy, [note.noteId])
    await testDb.transaction((tx) => resolver.unlinkNoteItemsFromRequestTx(tx as unknown as Tx, { noteItemIds: [bought], actorUserId: IDS.jefe }))
    await expect(rejectItem(purchase.itemId, IDS.jefe, "El precio no se justifica")).rejects.toThrow(/Cannot reject item/)
    expect(await snapshotOf(OT.buy, [note.noteId])).toEqual(before)
    expect(await resolver.rejectNoteItem(jefe, { itemId: bought, reason: "Se compra por otro lado" })).toMatchObject({ ok: true })
  })

  it("con otra compra viva la línea sigue en compra; si la OT ya terminó, la línea se rechaza sola con su causa", async () => {
    const note = await createNote(OT.void, [{ description: "Manguera hidráulica", quantity: 2 }])
    const [line] = note.itemIds as [string]
    const first = await insertPurchase({ noteItemId: line, workOrderId: OT.void, itemStatus: "approved", requestStatus: "approved" })
    const second = await insertPurchase({ noteItemId: line, workOrderId: OT.void, itemStatus: "approved", requestStatus: "approved" })
    await markInPurchase(line)

    await rejectItem(first.itemId, IDS.jefe, "Se pidió dos veces")
    expect((await itemRow(line)).resolution).toBe("en_compra")

    // La OT se anula con la segunda compra viva: la línea en compra no se toca; al morir esa compra no hay a quién devolverla.
    expect(await transitions.voidWorkOrder(await actorOf(IDS.jefe), { workOrderId: OT.void, reason: "Se pidió para el equipo equivocado" })).toMatchObject({ ok: true })
    expect((await itemRow(line)).resolution).toBe("en_compra")
    await rejectItem(second.itemId, IDS.jefe, "La orden ya no existe")
    expect(await itemRow(line)).toMatchObject({
      resolution: "rechazada", resolutionReason: "La orden de trabajo se anuló: Se pidió para el equipo equivocado", resolvedByUserId: IDS.jefe,
    })
    expect((await noteRow(note.noteId)).status).toBe("cerrada")
    const auto = (await eventsOf(OT.void, "parts_note_resolved")).find((event) => (event.changeSet as { cause?: string } | null)?.cause === "ot_anulada")
    expect(auto?.changeSet).toMatchObject({ automatic: true, previousResolution: "en_compra", itemId: line })
  })
})

// ── NP4-2 · «por resolver» y compras que aún no llegan ──────────────────────────────────────────────

describe("NP4-2 · «por resolver» es toda nota abierta con una línea pendiente", () => {
  it("una nota con líneas resueltas y una pendiente sigue en «Pendientes», cuenta en el Panel y conserva la prioridad del equipo detenido", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const calm = await createNote(OT.arrive, [{ description: "Perno", quantity: 1 }], { equipmentStopped: false })
    const stopped = await createNote(OT.arrive, [{ description: "Sello", quantity: 1 }, { description: "Junta", quantity: 1 }, { description: "Tapa", quantity: 1 }])
    // Tres líneas y una resuelta: antes salía de «Pendientes» y dejaba de contar.
    await resolver.rejectNoteItem(jefe, { itemId: stopped.itemIds[0]!, reason: "No corresponde al equipo" })
    expect((await noteRow(stopped.noteId)).status).toBe("en_gestion")

    const tray = await query.listPartsNotes(jefe, { tab: "pendientes", page: 1, pageSize: 25 })
    expect(tray.rows.map((row) => row.id)).toEqual([stopped.noteId, calm.noteId])
    expect(tray.rows[0]).toMatchObject({ status: "en_gestion", equipmentStopped: true, pendingLines: 2, totalLines: 3 })
    // La cifra del Panel es este mismo conteo (`hoy-tab.tsx`).
    expect(tray.counts).toEqual({ pendientes: 2, en_gestion: 0, cerradas: 0 })
    const withoutRows = await query.listPartsNotes(jefe, { tab: "pendientes", page: 1, pageSize: 1 })
    expect(withoutRows.counts.pendientes).toBe(2)

    // Resueltas todas sus líneas, sale de «Pendientes»; una anulada tampoco cuenta.
    for (const itemId of stopped.itemIds.slice(1)) await resolver.rejectNoteItem(jefe, { itemId, reason: "No corresponde al equipo" })
    await resolver.voidPartsNote(jefe, { noteId: calm.noteId, reason: "Se pidió por error" })
    const after = await query.listPartsNotes(jefe, { tab: "pendientes", page: 1, pageSize: 25 })
    expect(after.rows).toEqual([])
    expect(after.counts).toEqual({ pendientes: 0, en_gestion: 0, cerradas: 2 })
  })

  it("una nota con todas sus líneas en compra sigue en gestión hasta que el repuesto llega; al llegar completo se cierra sola", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const filter = await makeProduct("Filtro de aceite")
    await ingress(filter, 10)
    const note = await createNote(OT.arrive, [{ description: "Filtro de aceite", quantity: 2 }, { description: "Perno de culata", quantity: 1 }])
    const [bought, rejected] = note.itemIds as [string, string]
    await resolver.rejectNoteItem(jefe, { itemId: rejected, reason: "No corresponde al equipo" })
    const purchase = await insertPurchase({ noteItemId: bought, workOrderId: OT.arrive, itemStatus: "in_purchase_order", requestStatus: "in_purchasing" })
    await markInPurchase(bought)
    // No cuenta como «por resolver» ni como cerrada: espera su compra.
    expect((await noteRow(note.noteId)).status).toBe("en_gestion")
    expect(await query.listPartsNotes(jefe, { tab: "en_gestion", page: 1, pageSize: 25 })).toMatchObject({ counts: { pendientes: 0, en_gestion: 1, cerradas: 0 }, rows: [expect.objectContaining({ id: note.noteId, pendingLines: 0 })] })

    // Llega parte: sigue esperando. Llega el resto (el ítem ya está recibido): la nota se cierra en la misma transacción de la llegada.
    await arrive(OT.arrive, filter, 1, bought)
    expect((await noteRow(note.noteId)).status).toBe("en_gestion")
    await testDb.update(schema.purchaseRequestItems).set({ status: "delivered" }).where(eq(schema.purchaseRequestItems.id, purchase.itemId))
    await arrive(OT.arrive, filter, 1, bought)
    expect((await noteRow(note.noteId)).status).toBe("cerrada")
    const closed = await query.listPartsNotes(jefe, { tab: "cerradas", page: 1, pageSize: 25 })
    expect(closed.rows.map((row) => row.id)).toEqual([note.noteId])
    expect(closed.counts).toEqual({ pendientes: 0, en_gestion: 0, cerradas: 1 })

    // Cero diferencias: recalcular otra vez no escribe ni mueve `updated_at`.
    const before = await snapshotOf(OT.arrive, [note.noteId])
    await testDb.transaction((tx) => recalcNoteStatusTx(tx as unknown as Tx, note.noteId, { onlyIfChanged: true }))
    expect(await snapshotOf(OT.arrive, [note.noteId])).toEqual(before)
  })

  it("lo que Compras ya recibió no deja la nota en gestión aunque lo reservado no cubra lo pedido", async () => {
    const note = await createNote(OT.arrive, [{ description: "Filtro de aceite", quantity: 4 }])
    const purchase = await insertPurchase({ noteItemId: note.itemIds[0]!, workOrderId: OT.arrive, itemStatus: "purchased", requestStatus: "in_purchasing" })
    await markInPurchase(note.itemIds[0]!)
    expect((await noteRow(note.noteId)).status).toBe("en_gestion")
    await testDb.update(schema.purchaseRequestItems).set({ status: "received" }).where(eq(schema.purchaseRequestItems.id, purchase.itemId))
    await testDb.transaction((tx) => recalcNoteStatusTx(tx as unknown as Tx, note.noteId))
    expect((await noteRow(note.noteId)).status).toBe("cerrada")
  })

  it("al anular la OT, una nota que sólo esperaba una compra se cierra y repetir el barrido no escribe", async () => {
    const note = await createNote(OT.end, [{ description: "Manguera hidráulica", quantity: 2 }])
    await insertPurchase({ noteItemId: note.itemIds[0]!, workOrderId: OT.end, itemStatus: "approved", requestStatus: "approved" })
    await markInPurchase(note.itemIds[0]!)
    expect((await noteRow(note.noteId)).status).toBe("en_gestion")

    expect(await transitions.voidWorkOrder(await actorOf(IDS.jefe), { workOrderId: OT.end, reason: "Se dio de baja el equipo" })).toMatchObject({ ok: true })

    // La línea comprada no se toca (D13), pero la OT terminó: nadie espera esa compra.
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("en_compra")
    expect((await noteRow(note.noteId)).status).toBe("cerrada")
    expect((await query.listPartsNotes(await viewerOf(IDS.jefe), { tab: "cerradas", page: 1, pageSize: 25 })).rows.map((row) => row.id)).toEqual([note.noteId])
    const before = await snapshotOf(OT.end, [note.noteId])
    const { rejectOpenLinesOfWorkOrderTx } = await import("@/lib/services/mantencion/parts-notes/line-rejection")
    const again = await testDb.transaction((tx) => rejectOpenLinesOfWorkOrderTx(tx as unknown as Tx, { workOrderId: OT.end, actor: { userId: IDS.jefe }, end: { kind: "anulada", reason: "Se dio de baja el equipo" } }))
    expect(again).toEqual({ notes: 0, lines: 0 })
    expect(await snapshotOf(OT.end, [note.noteId])).toEqual(before)
  })
})

// ── NP4-3 · reservar menos de lo pedido ─────────────────────────────────────────────────────────────

describe("NP4-3 · reservar de la bodega menos de lo pedido", () => {
  it("resuelve sólo lo reservado y deja el saldo como una línea pendiente nueva que se puede comprar", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const filter = await makeProduct("Filtro de aire")
    await ingress(filter, 2)
    const note = await createNote(OT.split, [{ description: "Filtro de aire", quantity: 4 }, { description: "Aceite", quantity: 1 }])

    const result = await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[0]!, productId: filter, quantity: 2 })
    expect(result).toEqual({ ok: true, message: "Se reservaron 2 de «Filtro de aire» del stock de Biodiversa para la orden OT-NP-split. El saldo (2) quedó como una línea pendiente de la nota." })

    const lines = await linesOf(note.noteId)
    // Lo pedido suma lo mismo: 4 = 2 reservados + 2 por resolver; la línea nueva va al final, con su propio orden.
    expect(lines.map((line) => [line.sortOrder, line.description, Number(line.quantity), line.resolution])).toEqual([
      [0, "Filtro de aire", 2, "desde_stock"], [1, "Aceite", 1, "pendiente"], [2, "Filtro de aire", 2, "pendiente"],
    ])
    const remainder = lines[2]!
    expect(remainder).toMatchObject({ unitOfMeasure: "unidad", productId: null, resolvedByUserId: null, resolvedAt: null })
    expect((await noteRow(note.noteId)).status).toBe("en_gestion")
    const detail = (await query.getPartsNote(jefe, note.noteId))!
    expect(detail.lines.map((line) => [line.quantity, line.resolution, line.stage, line.arrived])).toEqual([[2, "desde_stock", "en_bodega", 2], [1, "pendiente", "pedido", 0], [2, "pendiente", "pedido", 0]])
    // El rastro dice de dónde sale el saldo.
    const [event] = await eventsOf(OT.split, "parts_note_resolved")
    expect(event?.changeSet).toMatchObject({ itemId: note.itemIds[0], resolution: "desde_stock", quantity: 2, originalQuantity: 4, remainderItemId: remainder.id, remainderQuantity: 2 })
    expect((await auditsOf(note.noteId)).find((row) => row.action === "update")).toBeTruthy()
    // El saldo se puede comprar (queda «en compra» como cualquier línea) o rechazar.
    const purchase = await insertPurchase({ noteItemId: remainder.id, workOrderId: OT.split, itemStatus: "draft", requestStatus: "draft" })
    await testDb.transaction((tx) => resolver.linkNoteItemsToRequestTx(tx as unknown as Tx, { links: [{ noteItemId: remainder.id, requestItemId: purchase.itemId }], actorUserId: IDS.jefe }))
    expect((await itemRow(remainder.id)).resolution).toBe("en_compra")
    expect((await query.loadPartsNotePrefill(jefe, note.noteId))?.items.map((item) => item.partsNoteItemId)).toEqual([note.itemIds[1]])
  })

  it("repetir la reserva de la misma línea se rechaza y no deja otro saldo ni otro movimiento", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const filter = await makeProduct("Filtro de aire")
    await ingress(filter, 6)
    const note = await createNote(OT.split, [{ description: "Filtro de aire", quantity: 4 }])
    expect((await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[0]!, productId: filter, quantity: 3 })).ok).toBe(true)
    const before = await snapshotOf(OT.split, [note.noteId])
    const again = await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[0]!, productId: filter, quantity: 3 })
    expect(again).toMatchObject({ ok: false, message: expect.stringContaining("ya se apartó") })
    expect(await snapshotOf(OT.split, [note.noteId])).toEqual(before)
    expect((await linesOf(note.noteId)).map((line) => Number(line.quantity))).toEqual([3, 1])
  })

  it("una línea con la compra muerta también parte su saldo; varias partidas de una nota llevan órdenes distintos", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const filter = await makeProduct("Filtro de aire")
    await ingress(filter, 3)
    const note = await createNote(OT.split, [{ description: "Filtro de aire", quantity: 3 }, { description: "Filtro de aire grande", quantity: 2 }])
    const dead = await insertPurchase({ noteItemId: note.itemIds[0]!, workOrderId: OT.split, itemStatus: "rejected", requestStatus: "rejected" })
    expect(dead.itemId).toBeTruthy()
    await markInPurchase(note.itemIds[0]!)
    expect((await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[0]!, productId: filter, quantity: 1 })).ok).toBe(true)
    expect((await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[1]!, productId: filter, quantity: 1 })).ok).toBe(true)
    const lines = await linesOf(note.noteId)
    expect(lines.map((line) => [line.sortOrder, Number(line.quantity), line.resolution])).toEqual([[0, 1, "desde_stock"], [1, 1, "desde_stock"], [2, 2, "pendiente"], [3, 1, "pendiente"]])
  })
})

// ── NP4-4 y NP4-6 · liberar la reserva devuelve la línea ────────────────────────────────────────────

describe("NP4-4 y NP4-6 · liberar la reserva de una línea «desde stock»", () => {
  const release = (allocationId: string, quantity: number, reason = "Se reservó por error") =>
    testDb.transaction((tx) => parts.releaseAllocationTx(tx as unknown as Tx, { allocationId, quantity, reason, actorUserId: IDS.jefe, userEmail: "jefe@chome.test" }))

  it("devuelve la línea a pendiente, recalcula la nota, libera el stock y deja la nota anulable; repetir no cambia nada", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const filter = await makeProduct("Filtro de combustible")
    await ingress(filter, 4)
    const note = await createNote(OT.release, [{ description: "Filtro de combustible", quantity: 2 }, { description: "Aceite", quantity: 1 }])
    const [line, other] = note.itemIds as [string, string]
    expect((await resolver.resolveNoteItemFromStock(jefe, { itemId: line, productId: filter, quantity: 2 })).ok).toBe(true)
    const allocation = await allocationOf(OT.release, filter)
    expect(await freeOf(filter)).toBe(2)
    // Hoy la nota no se puede anular: la línea sigue «desde stock».
    expect(await resolver.voidPartsNote(jefe, { noteId: note.noteId, reason: "Se pidió por error" })).toMatchObject({ ok: false, message: expect.stringContaining("libera esa reserva") })

    const outcome = await release(allocation.id, 2)

    expect(outcome.released).toBe(2)
    expect(outcome.returnedLines).toEqual([{ itemId: line, noteId: note.noteId, noteCode: note.code, description: "Filtro de combustible", quantity: 2, outcome: "pendiente", remainderItemId: null }])
    expect(await itemRow(line)).toMatchObject({ resolution: "pendiente", resolutionReason: null, resolvedByUserId: null, resolvedAt: null })
    // Las dos líneas pendientes: la nota vuelve a «enviada» y la ficha ya no dice «Llegó 2».
    expect((await noteRow(note.noteId)).status).toBe("enviada")
    const detail = (await query.getPartsNote(jefe, note.noteId))!
    expect(detail.lines[0]).toMatchObject({ resolution: "pendiente", stage: "pedido", arrived: 0, used: 0 })
    // La reserva queda cerrada en cero; el stock vuelve a estar libre; la rebaja lleva la línea.
    expect(await allocationOf(OT.release, filter)).toMatchObject({ status: "liberada", releasedByUserId: IDS.jefe, releaseReason: "Se reservó por error" })
    expect(Number((await allocationOf(OT.release, filter)).quantity)).toBe(0)
    expect(await freeOf(filter)).toBe(4)
    const sources = await sourcesOf(allocation.id)
    expect(sources.map((row) => [row.source, Number(row.quantity), row.noteItemId])).toEqual([["stock_existente", 2, line], ["liberacion", -2, line]])
    // Rastro: evento y auditoría de la nota, con el motivo; evento de la liberación con la línea.
    const events = await eventsOf(OT.release, "parts_note_resolved")
    const back = events.find((event) => (event.changeSet as { resolution?: string } | null)?.resolution === "pendiente")
    expect(back).toMatchObject({ actorUserId: IDS.jefe, reason: "Reserva liberada: Se reservó por error" })
    expect(back?.changeSet).toMatchObject({ itemId: line, previousResolution: "desde_stock", releasedQuantity: 2, allocationId: allocation.id })
    expect((await auditsOf(note.noteId)).filter((row) => row.action === "update").length).toBeGreaterThanOrEqual(2)
    const [released] = await eventsOf(OT.release, "parts_released")
    expect(released?.changeSet).toMatchObject({ lines: [{ itemId: line, noteCode: note.code, quantity: 2, outcome: "pendiente" }] })

    // La nota ya se puede anular (NP4-6).
    // Antes, repetir la liberación: la reserva ya no está activa y nada cambia (cero diferencias).
    const before = await snapshotOf(OT.release, [note.noteId])
    await expect(release(allocation.id, 2)).rejects.toThrow("Esa reserva ya no está activa")
    expect(await snapshotOf(OT.release, [note.noteId])).toEqual(before)
    expect(await resolver.voidPartsNote(jefe, { noteId: note.noteId, reason: "Se pidió por error" })).toMatchObject({ ok: true })
    expect(await noteRow(note.noteId)).toMatchObject({ status: "anulada", voidedByUserId: IDS.jefe })
    expect(other).toBeTruthy()
  })

  it("NP4-6 · con la reserva ya liberada la nota se puede anular (antes decía «libera esa reserva» aunque ya no hubiera nada que liberar)", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const gasket = await makeProduct("Empaquetadura de culata")
    await ingress(gasket, 2)
    const note = await createNote(OT.release, [{ description: "Empaquetadura de culata", quantity: 2 }])
    expect((await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[0]!, productId: gasket, quantity: 2 })).ok).toBe(true)
    const refusal = await resolver.voidPartsNote(jefe, { noteId: note.noteId, reason: "Se pidió por error" })
    expect(refusal).toMatchObject({ ok: false, message: expect.stringContaining("libera esa reserva") })

    await release((await allocationOf(OT.release, gasket)).id, 2)

    expect(await resolver.voidPartsNote(jefe, { noteId: note.noteId, reason: "Se pidió por error" })).toMatchObject({ ok: true })
    expect(await noteRow(note.noteId)).toMatchObject({ status: "anulada", voidReason: "Se pidió por error" })
    // Una nota anulada no vuelve a abrirse con otra operación sobre sus líneas.
    expect(await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[0]!, productId: gasket, quantity: 1 })).toMatchObject({ ok: false })
  })

  it("el reparto de lo liberado: la línea más nueva primero, sin pasar de lo que no se usó, y desempata por orden de la nota", () => {
    const candidate = (itemId: string, held: number, used: number, resolvedAt: string, sortOrder = 0) =>
      ({ itemId, held, used, resolvedAt, noteCreatedAt: "2026-11-01T10:00:00.000Z", sortOrder })
    const a = candidate("a", 2, 1, "2026-11-02T10:00:00.000Z")
    const b = candidate("b", 3, 0, "2026-11-03T10:00:00.000Z")
    expect(distributeRelease([a, b], 4)).toEqual({ shares: [{ itemId: "b", quantity: 3 }, { itemId: "a", quantity: 1 }], unattributed: 0 })
    expect(distributeRelease([a, b], 2)).toEqual({ shares: [{ itemId: "b", quantity: 2 }], unattributed: 0 })
    // Lo que sobra de lo que las líneas pueden ceder no es de ninguna.
    expect(distributeRelease([a, b], 6)).toEqual({ shares: [{ itemId: "b", quantity: 3 }, { itemId: "a", quantity: 1 }], unattributed: 2 })
    // Sin nada que ceder (todo usado) o sin líneas, todo queda sin línea.
    expect(distributeRelease([candidate("c", 2, 2, "2026-11-04T10:00:00.000Z")], 1)).toEqual({ shares: [], unattributed: 1 })
    expect(distributeRelease([], 1.5)).toEqual({ shares: [], unattributed: 1.5 })
    // Misma hora de resolución: gana la de mayor orden en la nota, y luego el id; el resultado no depende del orden de entrada.
    const same = [candidate("x", 1, 0, "2026-11-05T10:00:00.000Z", 0), candidate("y", 1, 0, "2026-11-05T10:00:00.000Z", 1), candidate("z", 1, 0, "2026-11-05T10:00:00.000Z", 1)]
    expect(distributeRelease(same, 2).shares.map((share) => share.itemId)).toEqual(["z", "y"])
    expect(distributeRelease([...same].reverse(), 2).shares.map((share) => share.itemId)).toEqual(["z", "y"])
    // Centésimas: sin deriva de punto flotante.
    expect(distributeRelease([candidate("d", 0.3, 0.1, "2026-11-06T10:00:00.000Z")], 0.2)).toEqual({ shares: [{ itemId: "d", quantity: 0.2 }], unattributed: 0 })
  })

  it("lo liberado se reparte de la línea más nueva a la más vieja y cada línea sólo cede lo que no se usó; la que conserva parte parte su saldo", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const hose = await makeProduct("Manguera")
    await ingress(hose, 10)
    const first = await createNote(OT.lifo, [{ description: "Manguera", quantity: 2 }])
    const second = await createNote(OT.lifo, [{ description: "Manguera", quantity: 3 }])
    // La primera se resolvió antes: el consumo la llena primero y es la última en ceder.
    expect((await resolver.resolveNoteItemFromStock(jefe, { itemId: first.itemIds[0]!, productId: hose, quantity: 2 })).ok).toBe(true)
    expect((await resolver.resolveNoteItemFromStock(jefe, { itemId: second.itemIds[0]!, productId: hose, quantity: 3 })).ok).toBe(true)
    const allocation = await allocationOf(OT.lifo, hose)
    expect(Number(allocation.quantity)).toBe(5)
    await consume(OT.lifo, hose, 1, allocation.id)

    // Se liberan 3 de los 4 restantes: salen de la segunda línea, entera; la primera (con 1 usado) no cede.
    const one = await release(allocation.id, 3, "Ya no hace falta esa manguera")
    expect(one.returnedLines.map((line) => [line.itemId, line.quantity, line.outcome, line.remainderItemId])).toEqual([[second.itemIds[0], 3, "pendiente", null]])
    expect(await itemRow(second.itemIds[0]!)).toMatchObject({ resolution: "pendiente", quantity: 3 })
    expect(await itemRow(first.itemIds[0]!)).toMatchObject({ resolution: "desde_stock", quantity: 2 })
    expect((await noteRow(second.noteId)).status).toBe("enviada")
    expect((await noteRow(first.noteId)).status).toBe("cerrada")

    // Se libera el último restante: la primera línea (2, con 1 usado) cede 1 y conserva el usado; lo liberado pasa a una línea pendiente.
    const two = await release(allocation.id, 1, "Se devuelve la que sobra")
    expect(two.returnedLines).toHaveLength(1)
    expect(two.returnedLines[0]).toMatchObject({ itemId: first.itemIds[0], quantity: 1, outcome: "pendiente", remainderItemId: expect.any(String) })
    const firstLines = await linesOf(first.noteId)
    expect(firstLines.map((line) => [line.sortOrder, Number(line.quantity), line.resolution])).toEqual([[0, 1, "desde_stock"], [1, 1, "pendiente"]])
    expect((await noteRow(first.noteId)).status).toBe("en_gestion")
    const detail = (await query.getPartsNote(jefe, first.noteId))!
    expect(detail.lines[0]).toMatchObject({ resolution: "desde_stock", arrived: 1, used: 1 })
    expect(detail.lines[1]).toMatchObject({ resolution: "pendiente", stage: "pedido", arrived: 0 })
    // La reserva sigue activa (queda lo consumido); la rebaja de cada liberación lleva la línea que cedió.
    expect(await allocationOf(OT.lifo, hose)).toMatchObject({ status: "activa" })
    expect(Number((await allocationOf(OT.lifo, hose)).quantity)).toBe(1)
    expect((await sourcesOf(allocation.id)).filter((row) => row.source === "liberacion").map((row) => [Number(row.quantity), row.noteItemId])).toEqual([[-3, second.itemIds[0]], [-1, first.itemIds[0]]])
  })

  it("lo liberado que no es de ninguna línea sigue siendo una rebaja sin línea, y una línea en compra que ya llegó no se toca", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const bolt = await makeProduct("Perno")
    await ingress(bolt, 10)
    const note = await createNote(OT.late, [{ description: "Perno", quantity: 1 }, { description: "Perno comprado", quantity: 2 }])
    const [fromStock, bought] = note.itemIds as [string, string]
    expect((await resolver.resolveNoteItemFromStock(jefe, { itemId: fromStock, productId: bolt, quantity: 1 })).ok).toBe(true)
    const purchase = await insertPurchase({ noteItemId: bought, workOrderId: OT.late, itemStatus: "delivered", requestStatus: "closed" })
    expect(purchase.itemId).toBeTruthy()
    await markInPurchase(bought)
    await arrive(OT.late, bolt, 2, bought)
    // Una llegada sin nota, de otra compra de la misma OT.
    await arrive(OT.late, bolt, 3)
    const allocation = await allocationOf(OT.late, bolt)
    expect(Number(allocation.quantity)).toBe(6)

    // Se liberan 5: 1 de la línea «desde stock» (que vuelve a pendiente) y 4 sin línea; la línea en compra sigue con lo suyo.
    const outcome = await release(allocation.id, 5, "Se devuelve a la bodega")
    expect(outcome.returnedLines.map((line) => [line.itemId, line.quantity, line.outcome])).toEqual([[fromStock, 1, "pendiente"]])
    // Las dos filas salen de la misma transacción (misma hora): se comparan sin depender del orden.
    const released = (await sourcesOf(allocation.id)).filter((row) => row.source === "liberacion").map((row) => [Number(row.quantity), row.noteItemId] as const)
    expect(released).toHaveLength(2)
    expect(released).toEqual(expect.arrayContaining([[-1, fromStock], [-4, null]]))
    expect(released.reduce((sum, [quantity]) => sum + quantity, 0)).toBe(-5)
    expect((await itemRow(bought)).resolution).toBe("en_compra")
    const detail = (await query.getPartsNote(jefe, note.noteId))!
    expect(detail.lines[1]).toMatchObject({ resolution: "en_compra", arrived: 2 })
    expect(Number((await allocationOf(OT.late, bolt)).quantity)).toBe(1)
  })

  it("una reserva de recepciones sin líneas de nota se libera como siempre: una sola rebaja sin línea y ninguna nota cambia", async () => {
    const seal = await makeProduct("Sello")
    await ingress(seal, 5)
    const note = await createNote(OT.late, [{ description: "Sello", quantity: 1 }])
    await arrive(OT.late, seal, 4)
    const allocation = await allocationOf(OT.late, seal)
    const before = await snapshotOf(OT.late, [note.noteId])
    const outcome = await release(allocation.id, 3, "Sobraron en la orden")
    expect(outcome).toEqual({ released: 3, returnedLines: [] })
    const after = await snapshotOf(OT.late, [note.noteId])
    expect(after.items).toEqual(before.items)
    expect(after.notes).toEqual(before.notes)
    expect((await sourcesOf(allocation.id)).filter((row) => row.source === "liberacion").map((row) => [Number(row.quantity), row.noteItemId])).toEqual([[-3, null]])
    expect(await allocationOf(OT.late, seal)).toMatchObject({ status: "activa" })
  })

  it("si la OT ya terminó, la línea no vuelve a una bandeja que nadie atiende: se rechaza sola con su causa", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const gasket = await makeProduct("Empaquetadura")
    await ingress(gasket, 3)
    const note = await createNote(OT.gone, [{ description: "Empaquetadura", quantity: 2 }])
    expect((await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[0]!, productId: gasket, quantity: 2 })).ok).toBe(true)
    const allocation = await allocationOf(OT.gone, gasket)
    // Una OT anulada con la reserva todavía activa no ocurre en la práctica (anular la libera); se fuerza el estado para probar la regla.
    await testDb.update(schema.mantWorkOrders).set({ status: "anulada", voidedByUserId: IDS.jefe, voidedAt: new Date().toISOString(), voidReason: "Se dio de baja el equipo" }).where(eq(schema.mantWorkOrders.id, OT.gone))

    const outcome = await release(allocation.id, 2)

    expect(outcome.returnedLines).toEqual([expect.objectContaining({ itemId: note.itemIds[0], outcome: "rechazada" })])
    expect(await itemRow(note.itemIds[0]!)).toMatchObject({ resolution: "rechazada", resolutionReason: "La orden de trabajo se anuló: Se dio de baja el equipo" })
    expect((await noteRow(note.noteId)).status).toBe("cerrada")
    const auto = (await eventsOf(OT.gone, "parts_note_resolved")).find((event) => (event.changeSet as { cause?: string } | null)?.cause === "ot_anulada")
    expect(auto?.changeSet).toMatchObject({ automatic: true, previousResolution: "desde_stock", releasedQuantity: 2 })
  })
})
