import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { and, asc, eq, inArray } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { getUserRbacById } from "@/lib/auth/rbac"

/**
 * Las operaciones de Bodega que deshacen o cambian una llegada recalculan las notas de pedido (NP) de lo que mueven
 * (ADR mantención 0001, D19 a D21), contra Postgres real:
 *
 *  - D19 · anular una recepción o una guía: la rebaja lleva la línea que había recibido el aporte y la nota se recalcula en la
 *    misma transacción (una nota «cerrada» porque su repuesto había llegado vuelve a esperarlo);
 *  - D20 · cotejar una guía (con diferencias o sin ellas): la nota se recalcula con el nuevo estado de la compra; la diferencia
 *    sigue sin mover stock ni reserva (GDI-001);
 *  - D21 · un ajuste de inventario que rebaja una reserva: la rebaja se atribuye a las líneas «desde stock» que la alimentaban
 *    y, ya confirmado el ajuste, otra transacción —con los bloqueos en orden— las devuelve a pendiente.
 *
 * Cada caso falla sin el arreglo y demuestra que repetirlo no cambia nada (cero diferencias). PGlite es de una sola
 * conexión: el orden de bloqueo lo cubren la revisión del servicio y el ADR, no esta suite.
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
vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn(async () => ({ ok: true })),
  sendBatchEmails: vi.fn(async () => []),
  getAppBaseUrl: () => "http://localhost",
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { IDS, seedMantFixtures } = await import("./mantencion-sync-fixtures")
const parts = await import("@/lib/services/mantencion/parts")
const { registerReceipt } = await import("@/lib/services/receiving")
const { voidReceipt } = await import("@/lib/services/receiving-void")
const { cancelDispatchGuide, confirmDispatchGuideReceipt, dispatchDispatchGuide } = await import("@/lib/services/dispatch-guides")
const { applyMovementTx, registerStockAdjustment } = await import("@/lib/services/stock-movement")
const { closePhysicalInventoryCount } = await import("@/lib/services/physical-inventory")
const resolver = await import("@/lib/services/mantencion/parts-notes/resolve")
const { loadLineStates } = await import("@/lib/services/mantencion/parts-notes/lines")
const { recalcNoteStatusTx } = await import("@/lib/services/mantencion/parts-notes/status")
const { recalcNotesOfLinesTx } = await import("@/lib/services/mantencion/parts-notes/arrival-reversal")
const { reconcileDesdeStockLinesTx, reconcileNotesAfterStockAdjustment } = await import("@/lib/services/mantencion/parts-notes/line-reconcile")
const { logger } = await import("@/lib/logger")

const now = new Date().toISOString()
const OFFICE = "ws-rev-oficina"
const ACTOR = { userId: IDS.jefe, userEmail: "jefe@chome.test" }
const SNAPSHOT = { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" as const }

/** Una OT por escenario: así lo que pasa en uno no se cuela en el siguiente. */
const OT_KEYS = ["void", "guide", "two", "cotejo", "split", "whole", "newest", "used", "late", "count", "heal", "plain"] as const
type OtKey = (typeof OT_KEYS)[number]
const OT = Object.fromEntries(OT_KEYS.map((key) => [key, `ot-rev-${key}`])) as Record<OtKey, string>

async function insertOt(key: OtKey) {
  await testDb.insert(schema.mantWorkOrders).values({
    id: OT[key], folio: `OT-REV-${key}`, vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, equipmentSnapshot: SNAPSHOT,
    repair: true, maintenance: false, requestDate: "2026-11-01", requestedByUserId: IDS.jefe, requesterName: "Alexis Morales",
    repairDescription: "Fuga hidráulica en la pluma", status: "en_ejecucion",
    assignedToUserId: IDS.mecBio, assignedByUserId: IDS.jefe, assignedAt: "2026-11-01T12:00:00Z",
    workshopKind: "interno", workshopEntryAt: "2026-11-02T08:00:00Z", estimatedDeliveryDate: "2026-12-31", startedAt: "2026-11-02T08:00:00Z", startedByUserId: IDS.mecBio,
  })
}

let productSeq = 0
async function makeProduct(name: string): Promise<string> {
  productSeq += 1
  const id = `p-rev-${productSeq}`
  await testDb.insert(schema.products).values({
    id, sku: `REP-RV-${productSeq}`, name, categoryId: "cat-rev", unitOfMeasure: "unidad", isSparePart: true, partNumber: `PN-RV-${productSeq}`, isActive: true, createdAt: now, updatedAt: now,
  })
  return id
}

let noteSeq = 0
type LineSpec = { description: string; quantity: number; resolution?: "pendiente" | "en_compra" }
/** Una NP con sus líneas, como queda tras crearla (pendientes) o tras comprarlas («en compra»). */
async function insertNote(workOrderId: string, lines: LineSpec[]): Promise<{ noteId: string; code: string; itemIds: string[] }> {
  noteSeq += 1
  const noteId = `note-rev-${noteSeq}`
  const code = `NP-2026-${String(9400 + noteSeq)}`
  const allBought = lines.every((line) => (line.resolution ?? "pendiente") === "en_compra")
  await testDb.insert(schema.mantPartsNotes).values({
    id: noteId, code, workOrderId, vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, requestedByUserId: IDS.mecBio, status: allBought ? "en_gestion" : "enviada",
  })
  const itemIds: string[] = []
  for (const [index, line] of lines.entries()) {
    const itemId = `noteitem-rev-${noteSeq}-${index}`
    itemIds.push(itemId)
    const bought = (line.resolution ?? "pendiente") === "en_compra"
    await testDb.insert(schema.mantPartsNoteItems).values({
      id: itemId, noteId, description: line.description, quantity: line.quantity, unitOfMeasure: "unidad", sortOrder: index,
      resolution: bought ? "en_compra" : "pendiente",
      ...(bought ? { resolvedByUserId: IDS.jefe, resolvedAt: now } : {}),
    })
  }
  return { noteId, code, itemIds }
}

let counter = 0
type SeedLine = { quantity: number; productId: string; workOrderId: string; partsNoteItemId: string }
/** Una solicitud con una línea por entrada y una OC que las compra (la compra de cada línea de nota). */
async function seedOrder(lines: SeedLine[], deliveryMode: "directo_faena" | "via_oficina" = "directo_faena") {
  counter += 1
  const requestId = `req-rev-${counter}`
  await testDb.insert(schema.purchaseRequests).values({
    id: requestId, code: `REP-RV-${counter}`, worksiteId: IDS.wsBio, requesterId: IDS.jefe, requestType: "repuestos",
    status: "in_purchasing", urgency: "high", deliveryMode, createdAt: now, updatedAt: now,
  })
  const orderId = `oc-rev-${counter}`
  await testDb.insert(schema.purchaseOrders).values({
    id: orderId, code: `OC-RV-${counter}`, worksiteId: IDS.wsBio, supplierId: "sup-rev", createdBy: IDS.jefe,
    status: "sent", deliveryMode, createdAt: now, updatedAt: now,
  })
  const ocItemIds: string[] = []
  const requestItemIds: string[] = []
  for (const [index, line] of lines.entries()) {
    const itemId = `item-rev-${counter}-${index}`
    requestItemIds.push(itemId)
    await testDb.insert(schema.purchaseRequestItems).values({
      id: itemId, requestId, productId: line.productId, quantity: line.quantity, unitOfMeasure: "unidad", status: "purchased", urgency: "high",
      sortOrder: index, createdAt: now, updatedAt: now, vehicleId: IDS.truckBio, workOrderId: line.workOrderId, partsNoteItemId: line.partsNoteItemId,
    })
    const ocItemId = `ocitem-rev-${counter}-${index}`
    ocItemIds.push(ocItemId)
    await testDb.insert(schema.purchaseOrderItems).values({
      id: ocItemId, purchaseOrderId: orderId, requestItemId: itemId, productId: line.productId, quantity: line.quantity, unitOfMeasure: "unidad", sortOrder: index,
    })
  }
  return { orderId, ocItemIds, requestItemIds }
}

const receive = (orderId: string, items: Array<{ ocItemId: string; quantity: number }>, stage: "office" | "faena" = "faena") => registerReceipt({
  purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage, ...(stage === "faena" ? { worksiteId: IDS.wsBio } : {}),
  items: items.map((item) => ({ purchaseOrderItemId: item.ocItemId, quantityReceived: item.quantity })),
})

async function ingress(productId: string, quantity: number, worksiteId: string = IDS.wsBio) {
  await testDb.transaction((tx) => applyMovementTx(tx as unknown as Tx, {
    worksiteId, productId, type: "ingreso_oc", quantity, performedBy: IDS.jefe, referenceType: "test", referenceId: "seed-rev",
  }))
}

let recordSeq = 0
/** Lo que hace el registro del mecánico: consume de la reserva y guarda la línea con su movimiento. */
async function consume(workOrderId: string, productId: string, quantity: number, allocationId: string) {
  recordSeq += 1
  const recordId = `rec-rev-${recordSeq}`
  await testDb.insert(schema.mantRecords).values({
    id: recordId, folio: `C-RV-${recordSeq}`, kind: "C", vehicleId: IDS.truckBio, equipmentSnapshot: SNAPSHOT, worksiteId: IDS.wsBio,
    reading: 140_000 + recordSeq, unit: "km", workDate: "2026-11-03", registeredBy: IDS.mecBio, executorKind: "yo", executorUserId: IDS.mecBio,
    executorName: "Javier Roa", signedAt: "2026-11-03T16:00:00Z", receivedAt: `2026-11-03T16:00:${String(recordSeq).padStart(2, "0")}Z`, workOrderId,
  })
  await testDb.insert(schema.mantRecordCorrectives).values({
    recordId, workTypes: ["Mecánico"], oils: [], description: "Cambio de repuesto", noParts: false, hours: 2, inWorkshop: false,
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

async function viewerOf(userId: string) {
  const rbac = (await getUserRbacById(userId, true))!
  return { userId: rbac.id, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal }
}

const noteRow = async (noteId: string) => (await testDb.select().from(schema.mantPartsNotes).where(eq(schema.mantPartsNotes.id, noteId)))[0]!
const itemRow = async (itemId: string) => (await testDb.select().from(schema.mantPartsNoteItems).where(eq(schema.mantPartsNoteItems.id, itemId)))[0]!
const linesOf = (noteId: string) => testDb.select().from(schema.mantPartsNoteItems).where(eq(schema.mantPartsNoteItems.noteId, noteId)).orderBy(asc(schema.mantPartsNoteItems.sortOrder))
const allocationOf = async (workOrderId: string, productId: string) =>
  (await testDb.select().from(schema.mantPartsAllocations).where(and(eq(schema.mantPartsAllocations.workOrderId, workOrderId), eq(schema.mantPartsAllocations.productId, productId))))[0]!
const sourcesOf = (allocationId: string) => testDb.select().from(schema.mantPartsAllocationSources)
  .where(eq(schema.mantPartsAllocationSources.allocationId, allocationId)).orderBy(asc(schema.mantPartsAllocationSources.createdAt), asc(schema.mantPartsAllocationSources.id))
const sourceSummary = async (allocationId: string) => (await sourcesOf(allocationId)).map((row) => [row.source, Number(row.quantity), row.noteItemId] as const)
const itemStatus = async (requestItemId: string) =>
  (await testDb.select({ status: schema.purchaseRequestItems.status }).from(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.id, requestItemId)))[0]?.status
const stockOf = async (productId: string, worksiteId: string = IDS.wsBio) => {
  const [row] = await testDb.select({ quantity: schema.worksiteStock.quantity }).from(schema.worksiteStock)
    .where(and(eq(schema.worksiteStock.worksiteId, worksiteId), eq(schema.worksiteStock.productId, productId)))
  return Math.round(Number(row?.quantity ?? 0) * 100) / 100
}
/** Lo que la línea dice que llegó (la cifra «Llegó» de la ficha), calculado como lo hace la bandeja. */
async function arrivedOf(itemId: string): Promise<number> {
  const item = await itemRow(itemId)
  const note = await noteRow(item.noteId)
  const states = await loadLineStates([{
    id: item.id, noteId: item.noteId, workOrderId: note.workOrderId, productId: item.productId, resolution: item.resolution, sortOrder: item.sortOrder, noteCreatedAt: note.createdAt,
  }], testDb as unknown as Tx)
  return states.get(itemId)?.arrived ?? 0
}
/** `audit_log.old_state` y `new_state` son texto JSON. */
const json = (value: string | null): unknown => JSON.parse(value ?? "null")
const noteAudits = (noteId: string) => testDb.select().from(schema.auditLog)
  .where(and(eq(schema.auditLog.entityId, noteId), eq(schema.auditLog.entityType, "mant_parts_note"))).orderBy(asc(schema.auditLog.createdAt), asc(schema.auditLog.id))
const trailOf = (workOrderId: string) => testDb.select().from(schema.mantWorkOrderEvents)
  .where(and(eq(schema.mantWorkOrderEvents.workOrderId, workOrderId), eq(schema.mantWorkOrderEvents.type, "parts_note_resolved"))).orderBy(asc(schema.mantWorkOrderEvents.createdAt), asc(schema.mantWorkOrderEvents.id))

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

beforeAll(async () => {
  await seedMantFixtures(testDb)
  await testDb.insert(schema.worksites).values({ id: OFFICE, name: "Oficina CHOME", code: "OF-REV", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.suppliers).values({ id: "sup-rev", name: "Repuestos del Sur", rut: "76.000.333-3", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.productCategories).values({ id: "cat-rev", name: "Repuestos reversas", slug: "repuestos-reversas", isEpp: false, requiresPrevencion: false, sortOrder: 1 })
  for (const key of OT_KEYS) await insertOt(key)
})

beforeEach(() => { vi.restoreAllMocks() })
afterAll(async () => { await pg.close() })

// ── D19 · anular una recepción ──────────────────────────────────────────────────────────────────────

describe("D19 · anular una recepción recalcula la nota", () => {
  it("la línea pierde lo que la recepción había aportado y la nota vuelve a esperar su repuesto", async () => {
    const filter = await makeProduct("Filtro hidráulico")
    // La línea pide 2; la compra, 4. Llegan 2 (recepción parcial): lo reservado cubre la línea y la nota se cierra.
    const note = await insertNote(OT.void, [{ description: "Filtro hidráulico", quantity: 2, resolution: "en_compra" }])
    const order = await seedOrder([{ quantity: 4, productId: filter, workOrderId: OT.void, partsNoteItemId: note.itemIds[0]! }])
    const receiptId = await receive(order.orderId, [{ ocItemId: order.ocItemIds[0]!, quantity: 2 }])
    expect(await itemStatus(order.requestItemIds[0]!)).toBe("partially_received")
    expect((await noteRow(note.noteId)).status).toBe("cerrada")
    expect(await arrivedOf(note.itemIds[0]!)).toBe(2)

    await voidReceipt({ receiptId, reason: "Se registró contra la orden equivocada", voidedBy: IDS.jefe })

    // La compra vuelve a estar viva y sin llegar: la nota deja «Cerradas» y espera; la línea ya no dice «Llegó 2».
    expect(await itemStatus(order.requestItemIds[0]!)).toBe("purchased")
    expect((await noteRow(note.noteId)).status).toBe("en_gestion")
    expect(await arrivedOf(note.itemIds[0]!)).toBe(0)
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("en_compra")
    // La rebaja lleva la línea (con su recepción); la reserva quedó en cero.
    const allocation = await allocationOf(OT.void, filter)
    expect(await sourcesOf(allocation.id)).toMatchObject([
      { source: "recepcion", quantity: 2, noteItemId: note.itemIds[0], receiptId },
      { source: "anulacion_recepcion", quantity: -2, noteItemId: note.itemIds[0], receiptId },
    ])
    expect(await parts.allocationRemainingTx(testDb as unknown as Tx, allocation.id)).toBe(0)
    expect(await stockOf(filter)).toBe(0)
    // Rastro: la nota deja su cambio de estado con la causa, y la auditoría de la recepción el resumen.
    const receiptCode = (await testDb.select().from(schema.receipts).where(eq(schema.receipts.id, receiptId)))[0]!.code
    const audits = await noteAudits(note.noteId)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      action: "status_change", userId: IDS.jefe, reason: `Anulación de la recepción ${receiptCode}: Se registró contra la orden equivocada`,
    })
    expect(json(audits[0]!.oldState)).toEqual({ status: "cerrada" })
    expect(json(audits[0]!.newState)).toEqual({ status: "en_gestion" })
    const receiptAudit = (await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, receiptId), eq(schema.auditLog.entityType, "receipt")))).at(-1)
    expect(json(receiptAudit!.newState)).toMatchObject({ status: "voided", notesRecalculated: [{ noteId: note.noteId, code: note.code, from: "cerrada", to: "en_gestion" }] })

    // Cero diferencias: anularla otra vez se rechaza y recalcular de nuevo no escribe nada.
    const before = await snapshotOf(OT.void, [note.noteId])
    await expect(voidReceipt({ receiptId, reason: "Se registró contra la orden equivocada", voidedBy: IDS.jefe })).rejects.toThrow("ya está anulada")
    expect(await testDb.transaction((tx) => recalcNotesOfLinesTx(tx as unknown as Tx, {
      noteItemIds: note.itemIds, reason: "otra vez", actorUserId: IDS.jefe,
    }))).toEqual([])
    expect(await snapshotOf(OT.void, [note.noteId])).toEqual(before)
  })

  it("la rebaja se reparte entre las líneas que la recepción había atendido, cada una con lo suyo", async () => {
    const hose = await makeProduct("Manguera")
    const first = await insertNote(OT.two, [{ description: "Manguera corta", quantity: 1, resolution: "en_compra" }])
    const second = await insertNote(OT.two, [{ description: "Manguera larga", quantity: 2, resolution: "en_compra" }])
    const order = await seedOrder([
      { quantity: 3, productId: hose, workOrderId: OT.two, partsNoteItemId: first.itemIds[0]! },
      { quantity: 4, productId: hose, workOrderId: OT.two, partsNoteItemId: second.itemIds[0]! },
    ])
    const receiptId = await receive(order.orderId, [{ ocItemId: order.ocItemIds[0]!, quantity: 1 }, { ocItemId: order.ocItemIds[1]!, quantity: 2 }])
    expect([(await noteRow(first.noteId)).status, (await noteRow(second.noteId)).status]).toEqual(["cerrada", "cerrada"])
    const allocation = await allocationOf(OT.two, hose)
    expect(Number(allocation.quantity)).toBe(3)

    await voidReceipt({ receiptId, reason: "Se registró contra la orden equivocada", voidedBy: IDS.jefe })

    const rows = (await sourcesOf(allocation.id)).filter((row) => row.source === "anulacion_recepcion")
    expect(rows.map((row) => [row.noteItemId, Number(row.quantity)]).sort()).toEqual([[first.itemIds[0], -1], [second.itemIds[0], -2]].sort())
    expect(await arrivedOf(first.itemIds[0]!)).toBe(0)
    expect(await arrivedOf(second.itemIds[0]!)).toBe(0)
    expect([(await noteRow(first.noteId)).status, (await noteRow(second.noteId)).status]).toEqual(["en_gestion", "en_gestion"])
    expect(Number((await allocationOf(OT.two, hose)).quantity)).toBe(0)
  })
})

// ── D19 · anular una guía ───────────────────────────────────────────────────────────────────────────

describe("D19 · anular una guía despachada recalcula la nota", () => {
  it("la línea pierde lo que la guía había reservado y la nota vuelve a esperar su repuesto en la oficina", async () => {
    const seal = await makeProduct("Sello")
    const note = await insertNote(OT.guide, [{ description: "Sello de pistón", quantity: 3, resolution: "en_compra" }])
    const order = await seedOrder([{ quantity: 3, productId: seal, workOrderId: OT.guide, partsNoteItemId: note.itemIds[0]! }], "via_oficina")
    const officeReceipt = await receive(order.orderId, [{ ocItemId: order.ocItemIds[0]!, quantity: 3 }], "office")
    const [guide] = await testDb.select().from(schema.dispatchGuides).where(eq(schema.dispatchGuides.receiptId, officeReceipt))
    await dispatchDispatchGuide(guide!.id, ACTOR)
    // Despachada: lo reservado cubre la línea y la nota se cierra aunque el ítem siga en oficina hasta el cotejo.
    expect(await itemStatus(order.requestItemIds[0]!)).toBe("office_received")
    expect((await noteRow(note.noteId)).status).toBe("cerrada")
    expect(await arrivedOf(note.itemIds[0]!)).toBe(3)

    await cancelDispatchGuide(guide!.id, { reason: "Se despachó por error de bodega" }, ACTOR)

    expect((await noteRow(note.noteId)).status).toBe("en_gestion")
    expect(await arrivedOf(note.itemIds[0]!)).toBe(0)
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("en_compra")
    const allocation = await allocationOf(OT.guide, seal)
    expect(await sourcesOf(allocation.id)).toMatchObject([
      { source: "traslado", quantity: 3, noteItemId: note.itemIds[0], dispatchGuideId: guide!.id },
      { source: "anulacion_guia", quantity: -3, noteItemId: note.itemIds[0], dispatchGuideId: guide!.id },
    ])
    expect(await stockOf(seal)).toBe(0)
    expect(await stockOf(seal, OFFICE)).toBe(3)
    const guideAudit = (await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, guide!.id), eq(schema.auditLog.entityType, "dispatch_guide"), eq(schema.auditLog.action, "cancel")))).at(-1)
    expect(json(guideAudit!.newState)).toMatchObject({ status: "cancelled", notesRecalculated: [{ noteId: note.noteId, from: "cerrada", to: "en_gestion" }] })

    // Cero diferencias: anularla otra vez se rechaza y recalcular de nuevo no escribe nada.
    const before = await snapshotOf(OT.guide, [note.noteId])
    await expect(cancelDispatchGuide(guide!.id, { reason: "Se despachó por error de bodega" }, ACTOR)).rejects.toThrow("ya está anulada")
    expect(await testDb.transaction((tx) => recalcNotesOfLinesTx(tx as unknown as Tx, { noteItemIds: note.itemIds, reason: "otra vez", actorUserId: IDS.jefe }))).toEqual([])
    expect(await snapshotOf(OT.guide, [note.noteId])).toEqual(before)
  })
})

// ── D20 · cotejar una guía ──────────────────────────────────────────────────────────────────────────

describe("D20 · cotejar una guía (con diferencias) recalcula la nota", () => {
  it("la compra se da por recibida al completar el cotejo: la nota deja de esperar; la diferencia, entre medio, no mueve la reserva", async () => {
    const gasket = await makeProduct("Empaquetadura")
    // La línea pide 5 y la compra trae 3: lo que Compras da por recibido manda, aunque lo reservado no cubra lo pedido.
    const note = await insertNote(OT.cotejo, [{ description: "Empaquetadura", quantity: 5, resolution: "en_compra" }])
    const order = await seedOrder([{ quantity: 3, productId: gasket, workOrderId: OT.cotejo, partsNoteItemId: note.itemIds[0]! }], "via_oficina")
    const officeReceipt = await receive(order.orderId, [{ ocItemId: order.ocItemIds[0]!, quantity: 3 }], "office")
    const [guide] = await testDb.select().from(schema.dispatchGuides).where(eq(schema.dispatchGuides.receiptId, officeReceipt))
    await dispatchDispatchGuide(guide!.id, ACTOR)
    const [guideLine] = await testDb.select().from(schema.dispatchGuideItems).where(eq(schema.dispatchGuideItems.guideId, guide!.id))
    const allocation = await allocationOf(OT.cotejo, gasket)
    expect((await noteRow(note.noteId)).status).toBe("en_gestion")
    const sourcesBefore = await sourceSummary(allocation.id)

    // Primer cotejo, con diferencia: llegan 2 de 3. La compra sigue sin darse por recibida: la nota sigue esperando,
    // y la reserva no se toca (GDI-001: la diferencia no mueve stock ni reserva).
    await confirmDispatchGuideReceipt(guide!.id, { items: [{ guideItemId: guideLine!.id, quantityReceived: 2, differenceReason: "Una unidad llegó rota en el traslado" }] }, ACTOR)
    expect(await itemStatus(order.requestItemIds[0]!)).toBe("partially_received")
    expect((await noteRow(note.noteId)).status).toBe("en_gestion")
    expect(await sourceSummary(allocation.id)).toEqual(sourcesBefore)
    expect(Number((await allocationOf(OT.cotejo, gasket)).quantity)).toBe(3)

    // Segundo cotejo: llega la unidad que faltaba. La compra queda recibida y la nota se cierra en la misma transacción del cotejo.
    await confirmDispatchGuideReceipt(guide!.id, { items: [{ guideItemId: guideLine!.id, quantityReceived: 1 }] }, ACTOR)
    expect(await itemStatus(order.requestItemIds[0]!)).toBe("delivered")
    expect((await noteRow(note.noteId)).status).toBe("cerrada")
    const audits = await noteAudits(note.noteId)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ action: "status_change", userId: IDS.jefe, reason: expect.stringContaining(`Cotejo de la guía ${guide!.code}`) })
    expect(json(audits[0]!.oldState)).toEqual({ status: "en_gestion" })
    expect(json(audits[0]!.newState)).toEqual({ status: "cerrada" })

    // Cero diferencias: un tercer cotejo se rechaza (la guía ya está recibida) y recalcular otra vez no escribe nada.
    const before = await snapshotOf(OT.cotejo, [note.noteId])
    await expect(confirmDispatchGuideReceipt(guide!.id, { items: [{ guideItemId: guideLine!.id, quantityReceived: 1 }] }, ACTOR)).rejects.toThrow("ya fue confirmada")
    expect(await testDb.transaction((tx) => recalcNotesOfLinesTx(tx as unknown as Tx, { noteItemIds: note.itemIds, reason: "otra vez", actorUserId: IDS.jefe }))).toEqual([])
    expect(await snapshotOf(OT.cotejo, [note.noteId])).toEqual(before)
  })
})

// ── D21 · un ajuste de inventario que rebaja una reserva ────────────────────────────────────────────

describe("D21 · un ajuste que rebaja una reserva devuelve a pendiente las líneas «desde stock»", () => {
  const adjust = (productId: string, quantity: number, reason = "Conteo físico: faltan repuestos") =>
    registerStockAdjustment({ worksiteId: IDS.wsBio, productId, type: "ajuste", quantity, performedBy: IDS.jefe, userEmail: "jefe@chome.test", reason })

  /** La NP con sus líneas pedidas y reservadas de la bodega, como las deja jefatura. */
  async function reservedNote(workOrderId: string, productId: string, reserved: number[], stock: number) {
    await ingress(productId, stock)
    const note = await insertNote(workOrderId, reserved.map((quantity, index) => ({ description: `Repuesto ${index + 1}`, quantity })))
    const jefe = await viewerOf(IDS.jefe)
    for (const [index, quantity] of reserved.entries()) {
      const result = await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[index]!, productId, quantity })
      expect(result.ok).toBe(true)
    }
    return note
  }

  it("rebaja parte de la reserva: la línea conserva lo que retiene y el saldo pasa a una línea pendiente nueva", async () => {
    const filter = await makeProduct("Filtro de aire")
    const note = await reservedNote(OT.split, filter, [2], 4)
    expect((await noteRow(note.noteId)).status).toBe("cerrada")
    const allocation = await allocationOf(OT.split, filter)

    // El conteo encuentra 1 de los 4: la realidad física manda y baja la reserva de 2 a 1.
    await adjust(filter, -3)

    expect(await stockOf(filter)).toBe(1)
    expect(Number((await allocationOf(OT.split, filter)).quantity)).toBe(1)
    // La rebaja lleva la línea que cedió, y la línea se parte: lo retenido queda resuelto y lo perdido vuelve a pendiente.
    expect(await sourceSummary(allocation.id)).toEqual([["stock_existente", 2, note.itemIds[0]], ["ajuste", -1, note.itemIds[0]]])
    expect((await linesOf(note.noteId)).map((line) => [line.sortOrder, Number(line.quantity), line.resolution])).toEqual([[0, 1, "desde_stock"], [1, 1, "pendiente"]])
    expect((await noteRow(note.noteId)).status).toBe("en_gestion")
    expect(await arrivedOf(note.itemIds[0]!)).toBe(1)
    const trail = (await trailOf(OT.split)).find((event) => event.reason?.startsWith("Reserva rebajada por un ajuste de inventario") ?? false)
    expect(trail).toMatchObject({ actorUserId: IDS.jefe, reason: expect.stringMatching(/^Reserva rebajada por un ajuste de inventario: AJU-.*: Conteo físico: faltan repuestos$/) })
    expect(trail?.changeSet).toMatchObject({
      itemId: note.itemIds[0], resolution: "desde_stock", quantity: 1, releasedQuantity: 1, originalQuantity: 2, returned: "lo que ya no está en la reserva pasa a una línea pendiente",
    })

    // Cero diferencias: volver a reconciliar no encuentra nada por corregir ni escribe.
    const before = await snapshotOf(OT.split, [note.noteId])
    const again = await testDb.transaction((tx) => reconcileDesdeStockLinesTx(tx as unknown as Tx, { worksiteId: IDS.wsBio, productIds: [filter], actor: { userId: IDS.jefe }, reason: "otra vez" }))
    expect(again).toEqual([])
    expect(await snapshotOf(OT.split, [note.noteId])).toEqual(before)
  })

  it("rebaja toda la reserva de la línea: la línea vuelve entera a pendiente y la nota a «enviada», y se puede anular", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const bolt = await makeProduct("Perno de culata")
    const note = await reservedNote(OT.whole, bolt, [2], 4)
    expect(await resolver.voidPartsNote(jefe, { noteId: note.noteId, reason: "Se pidió por error" })).toMatchObject({ ok: false, message: expect.stringContaining("libera esa reserva") })

    await adjust(bolt, -4, "Se perdió todo el lote")

    expect(await itemRow(note.itemIds[0]!)).toMatchObject({ resolution: "pendiente", resolutionReason: null, resolvedByUserId: null, resolvedAt: null })
    expect(Number((await itemRow(note.itemIds[0]!)).quantity)).toBe(2)
    expect((await noteRow(note.noteId)).status).toBe("enviada")
    expect(await arrivedOf(note.itemIds[0]!)).toBe(0)
    const allocation = await allocationOf(OT.whole, bolt)
    expect(await sourceSummary(allocation.id)).toEqual([["stock_existente", 2, note.itemIds[0]], ["ajuste", -2, note.itemIds[0]]])
    // La línea ya no está atada a una reserva que no existe: la nota se puede anular (NP4-6).
    expect(await resolver.voidPartsNote(jefe, { noteId: note.noteId, reason: "Se pidió por error" })).toMatchObject({ ok: true })

    // Cero diferencias.
    const before = await snapshotOf(OT.whole, [note.noteId])
    expect(await testDb.transaction((tx) => reconcileDesdeStockLinesTx(tx as unknown as Tx, { worksiteId: IDS.wsBio, productIds: [bolt], actor: { userId: IDS.jefe }, reason: "otra vez" }))).toEqual([])
    expect(await snapshotOf(OT.whole, [note.noteId])).toEqual(before)
  })

  it("la rebaja sale de la línea más nueva primero y no toca a la más vieja ni lo que llegó sin línea", async () => {
    const hose = await makeProduct("Manguera de combustible")
    const note = await reservedNote(OT.newest, hose, [2, 3], 10)
    // Una llegada sin nota (otra compra de la misma OT) suma a la misma reserva.
    await testDb.transaction(async (raw) => {
      const tx = raw as unknown as Tx
      await parts.lockForStockTx(tx, { workOrderIds: [OT.newest], worksiteId: IDS.wsBio, productIds: [hose] })
      await parts.addToAllocationTx(tx, { workOrderId: OT.newest, worksiteId: IDS.wsBio, productId: hose, quantity: 2, source: "recepcion", actorUserId: IDS.jefe })
    })
    const allocation = await allocationOf(OT.newest, hose)
    expect(Number(allocation.quantity)).toBe(7)

    // Quedan 5 en la bodega con 7 reservados: la reserva baja 2, y salen de la línea que se reservó última.
    await adjust(hose, -5)

    expect(await sourceSummary(allocation.id)).toEqual([
      ["stock_existente", 2, note.itemIds[0]], ["stock_existente", 3, note.itemIds[1]], ["recepcion", 2, null], ["ajuste", -2, note.itemIds[1]],
    ])
    expect((await linesOf(note.noteId)).map((line) => [line.sortOrder, Number(line.quantity), line.resolution])).toEqual([[0, 2, "desde_stock"], [1, 1, "desde_stock"], [2, 2, "pendiente"]])
    expect(await arrivedOf(note.itemIds[0]!)).toBe(2)
    expect(await arrivedOf(note.itemIds[1]!)).toBe(1)
  })

  it("lo ya usado nunca se devuelve: la línea conserva lo consumido y sólo cede lo que seguía reservado", async () => {
    const pump = await makeProduct("Bomba de agua")
    const note = await reservedNote(OT.used, pump, [3], 5)
    const allocation = await allocationOf(OT.used, pump)
    // El mecánico ya usó 1 de las 3 reservadas: quedan 2 reservadas y 4 en la bodega.
    await consume(OT.used, pump, 1, allocation.id)
    expect(await stockOf(pump)).toBe(4)

    // El conteo encuentra la bodega vacía: se rebaja todo lo que seguía reservado (2), no lo que ya se usó.
    await adjust(pump, -4)

    expect(await stockOf(pump)).toBe(0)
    expect(await sourceSummary(allocation.id)).toEqual([["stock_existente", 3, note.itemIds[0]], ["ajuste", -2, note.itemIds[0]]])
    expect((await linesOf(note.noteId)).map((line) => [line.sortOrder, Number(line.quantity), line.resolution])).toEqual([[0, 1, "desde_stock"], [1, 2, "pendiente"]])
    expect(await arrivedOf(note.itemIds[0]!)).toBe(1)
    expect((await noteRow(note.noteId)).status).toBe("en_gestion")

    // Cero diferencias.
    const before = await snapshotOf(OT.used, [note.noteId])
    expect(await testDb.transaction((tx) => reconcileDesdeStockLinesTx(tx as unknown as Tx, { worksiteId: IDS.wsBio, productIds: [pump], actor: { userId: IDS.jefe }, reason: "otra vez" }))).toEqual([])
    expect(await snapshotOf(OT.used, [note.noteId])).toEqual(before)
  })

  it("lo que ninguna línea alimentó sigue siendo una rebaja sin línea y ninguna nota cambia", async () => {
    const seal = await makeProduct("Sello de bomba")
    const note = await insertNote(OT.plain, [{ description: "Sello de bomba", quantity: 1 }])
    await ingress(seal, 5)
    await testDb.transaction(async (raw) => {
      const tx = raw as unknown as Tx
      await parts.lockForStockTx(tx, { workOrderIds: [OT.plain], worksiteId: IDS.wsBio, productIds: [seal] })
      await parts.addToAllocationTx(tx, { workOrderId: OT.plain, worksiteId: IDS.wsBio, productId: seal, quantity: 4, source: "recepcion", actorUserId: IDS.jefe })
    })
    const before = await snapshotOf(OT.plain, [note.noteId])

    await adjust(seal, -3)

    const allocation = await allocationOf(OT.plain, seal)
    expect(await sourceSummary(allocation.id)).toEqual([["recepcion", 4, null], ["ajuste", -2, null]])
    const after = await snapshotOf(OT.plain, [note.noteId])
    expect(after.items).toEqual(before.items)
    expect(after.notes).toEqual(before.notes)
  })

  it("si la OT terminó entre el ajuste y su segundo paso, la línea se rechaza sola con su causa", async () => {
    const gasket = await makeProduct("Junta de tapa")
    const note = await reservedNote(OT.late, gasket, [2], 3)
    // El ajuste se confirma (sin el segundo paso) y, antes de que corra, la OT se anula.
    await testDb.transaction((tx) => applyMovementTx(tx as unknown as Tx, {
      worksiteId: IDS.wsBio, productId: gasket, type: "ajuste", quantity: -3, performedBy: IDS.jefe, reason: "Se perdió el lote", referenceType: "test", referenceId: "late",
    }))
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("desde_stock")
    // Una OT anulada con la reserva todavía activa no ocurre en la práctica (anular la libera); se fuerza el estado para probar la regla.
    await testDb.update(schema.mantWorkOrders).set({ status: "anulada", voidedByUserId: IDS.jefe, voidedAt: now, voidReason: "Se dio de baja el equipo" }).where(eq(schema.mantWorkOrders.id, OT.late))

    const returned = await reconcileNotesAfterStockAdjustment({ worksiteId: IDS.wsBio, productIds: [gasket], actor: { userId: IDS.jefe }, reason: "AJU-TEST: Se perdió el lote" })

    expect(returned).toEqual([expect.objectContaining({ itemId: note.itemIds[0], outcome: "rechazada" })])
    expect(await itemRow(note.itemIds[0]!)).toMatchObject({ resolution: "rechazada", resolutionReason: "La orden de trabajo se anuló: Se dio de baja el equipo" })
    expect((await noteRow(note.noteId)).status).toBe("cerrada")
    const auto = (await trailOf(OT.late)).find((event) => (event.changeSet as { cause?: string } | null)?.cause === "ot_anulada")
    expect(auto?.changeSet).toMatchObject({ automatic: true, previousResolution: "desde_stock", releasedQuantity: 2 })
  })

  it("el cierre de un conteo físico que baja el stock hace lo mismo", async () => {
    const pin = await makeProduct("Pasador")
    const note = await reservedNote(OT.count, pin, [2], 4)

    const closed = await closePhysicalInventoryCount(
      { user: { id: IDS.jefe, email: "jefe@chome.test" } } as unknown as Parameters<typeof closePhysicalInventoryCount>[0],
      { worksiteId: IDS.wsBio, items: [{ productId: pin, countedQuantity: 0 }] },
      "all",
    )

    expect(closed.adjustmentCount).toBe(1)
    expect(await stockOf(pin)).toBe(0)
    expect(await itemRow(note.itemIds[0]!)).toMatchObject({ resolution: "pendiente" })
    expect((await noteRow(note.noteId)).status).toBe("enviada")
    expect((await trailOf(OT.count)).at(-1)?.reason).toBe(`Reserva rebajada por un ajuste de inventario: Conteo físico ${closed.code}`)
  })

  it("si el segundo paso falla, el ajuste queda y la línea se corrige en la siguiente pasada (lo que decide es lo escrito)", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined)
    const gear = await makeProduct("Engranaje")
    const note = await reservedNote(OT.heal, gear, [2], 2)
    await testDb.transaction((tx) => applyMovementTx(tx as unknown as Tx, {
      worksiteId: IDS.wsBio, productId: gear, type: "ajuste", quantity: -2, performedBy: IDS.jefe, reason: "Se perdió el lote", referenceType: "test", referenceId: "heal",
    }))

    // Un fallo del segundo paso (aquí, un actor que no existe) no revierte el ajuste ni lo hace fallar: se anota y la línea queda como estaba.
    expect(await reconcileNotesAfterStockAdjustment({ worksiteId: IDS.wsBio, productIds: [gear], actor: { userId: "u-no-existe" }, reason: "AJU-TEST: Se perdió el lote" })).toEqual([])
    expect(error).toHaveBeenCalledTimes(1)
    expect(await stockOf(gear)).toBe(0)
    expect(await itemRow(note.itemIds[0]!)).toMatchObject({ resolution: "desde_stock" })
    expect((await noteRow(note.noteId)).status).toBe("cerrada")

    // La siguiente pasada sobre ese repuesto en esa faena la corrige, porque la rebaja ya quedó escrita con su línea.
    const returned = await reconcileNotesAfterStockAdjustment({ worksiteId: IDS.wsBio, productIds: [gear], actor: { userId: IDS.jefe }, reason: "AJU-TEST: Se perdió el lote" })
    expect(returned).toEqual([expect.objectContaining({ itemId: note.itemIds[0], outcome: "pendiente" })])
    expect(await itemRow(note.itemIds[0]!)).toMatchObject({ resolution: "pendiente" })
    expect((await noteRow(note.noteId)).status).toBe("enviada")
    expect(error).toHaveBeenCalledTimes(1)
    // Y una tercera no hace nada.
    const before = await snapshotOf(OT.heal, [note.noteId])
    expect(await reconcileNotesAfterStockAdjustment({ worksiteId: IDS.wsBio, productIds: [gear], actor: { userId: IDS.jefe }, reason: "otra vez" })).toEqual([])
    expect(await snapshotOf(OT.heal, [note.noteId])).toEqual(before)
  })

  it("un ajuste que sube el stock, o que no toca reservas, no cambia ninguna nota", async () => {
    const nut = await makeProduct("Tuerca")
    const note = await reservedNote(OT.plain, nut, [1], 6)
    const before = await snapshotOf(OT.plain, [note.noteId])
    // Sobran 2 libres: el faltante cabe en lo libre y la reserva no se toca.
    await adjust(nut, -2)
    await adjust(nut, +3)
    expect(await snapshotOf(OT.plain, [note.noteId])).toEqual(before)
    expect(await recalcNoteStatusTx(testDb as unknown as Tx, note.noteId, { onlyIfChanged: true })).toBe("cerrada")
  })
})
