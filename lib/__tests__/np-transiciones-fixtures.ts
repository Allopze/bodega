import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, asc, desc, eq, sql } from "drizzle-orm"
import path from "node:path"
import { expect } from "vitest"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"
import type { MantEquipmentSnapshot } from "@/db/schema"
import type { SyncPartsNote } from "@/lib/mantencion/contracts"
import { getUserRbacById } from "@/lib/auth/rbac"
import { createPartsNote } from "@/lib/services/mantencion/parts-notes/create-manual"
import { createPartsNoteFromDevice } from "@/lib/services/mantencion/parts-notes/create"
import { linkNoteItemsToRequestTx, unlinkNoteItemsFromRequestTx } from "@/lib/services/mantencion/parts-notes/request-link"
import { insertNoteEventTx } from "@/lib/services/mantencion/parts-notes/set-status"
import { registerReceipt } from "@/lib/services/receiving"
import { voidReceipt } from "@/lib/services/receiving-void"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { configureZodLocale } from "@/lib/validation/zod-locale"
import { IDS, seedMantFixtures } from "./mantencion-sync-fixtures"
import { clearNoteHistory } from "./np-history-reset"

/**
 * Banco de pruebas de las transiciones de la nota de pedido y de las notas sin OT (ADR 0001, 2026-11-27): una base PGlite
 * por suite, la semilla de mantención, y los helpers de alta, compra, recepción e historial que comparten
 * `np-transiciones-pglite.test.ts` y `np-sin-ot-pglite.test.ts`. Cada suite declara su propio `vi.mock("@/db")` (hoisted)
 * apuntando a `globalThis.__db`, que este módulo fija al cargar.
 */

export const pg = new PGlite()
export const testDb = drizzle(pg, { schema }) as unknown as DB
;(globalThis as typeof globalThis & { __db?: DB }).__db = testDb

export { createPartsNote, createPartsNoteFromDevice, linkNoteItemsToRequestTx, unlinkNoteItemsFromRequestTx }
export { insertNoteEventTx, registerReceipt, voidReceipt }
export { IDS }

/** Semilla de la suite: migraciones completas, mantención y la OT de Javier en Biodiversa. */
export async function setupDatabase(): Promise<void> {
  configureZodLocale()
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedMantFixtures(testDb)
  await testDb.insert(schema.suppliers).values({ id: "sup-tr", name: "Repuestos Tr", rut: "76.000.444-4", isActive: true, createdAt: NOW, updatedAt: NOW })
  await testDb.insert(schema.productCategories).values({ id: "cat-tr", name: "Repuestos TR", slug: "repuestos-tr", isEpp: false, requiresPrevencion: false, sortOrder: 1 })
  await testDb.insert(schema.costCenters).values([
    { id: "cc-tr-bio", code: "CC-TR-BIO", name: "Taller Biodiversa", worksiteId: IDS.wsBio, isActive: true, createdAt: NOW, updatedAt: NOW },
    { id: "cc-tr-cho", code: "CC-TR-CHO", name: "Taller Cholguán", worksiteId: IDS.wsCho, isActive: true, createdAt: NOW, updatedAt: NOW },
  ])
  await insertOt()
}

export const NOW = "2026-11-27T10:00:00.000Z"
export const OT_ID = "ot-tr-1"
export const SNAPSHOT: MantEquipmentSnapshot = { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" }
export const MIGRATION_0405 = path.resolve(process.cwd(), "db/migrations/0405_friendly_vampiro.sql")

export async function contextOf(userId: string, mutate?: (permissions: string[]) => string[]) {
  const rbac = (await getUserRbacById(userId, true))!
  return {
    userName: rbac.name, deviceId: "dev-test-tr", credentialId: "cred-test-tr",
    viewer: {
      userId: rbac.id, email: rbac.email, permissions: mutate ? mutate([...rbac.permissions]) : rbac.permissions,
      worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal,
    },
  }
}
export const viewerOf = async (userId: string, mutate?: (permissions: string[]) => string[]) => (await contextOf(userId, mutate)).viewer

export async function insertOt() {
  await testDb.insert(schema.mantWorkOrders).values({
    id: OT_ID, folio: "OT-TR-1", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, equipmentSnapshot: SNAPSHOT,
    repair: true, maintenance: false, requestDate: "2026-11-01", requestedByUserId: IDS.jefe, requesterName: "Alexis Morales",
    repairDescription: "Fuga hidráulica en la pluma", status: "en_ejecucion",
    assignedToUserId: IDS.mecBio, assignedByUserId: IDS.jefe, assignedAt: "2026-11-01T12:00:00Z",
    workshopKind: "interno", workshopEntryAt: "2026-11-02T08:00:00Z", estimatedDeliveryDate: "2026-12-31",
    startedAt: "2026-11-02T08:00:00Z", startedByUserId: IDS.mecBio,
  })
}

let productSeq = 0
export async function makeProduct(name: string): Promise<string> {
  productSeq += 1
  const id = `p-tr-${productSeq}`
  await testDb.insert(schema.products).values({
    id, sku: `REP-TR-${productSeq}`, name, categoryId: "cat-tr", unitOfMeasure: "unidad", isSparePart: true,
    partNumber: `PN-TR-${productSeq}`, isActive: true, createdAt: NOW, updatedAt: NOW,
  })
  return id
}

/** Un ingreso directo a la faena (stock existente), para que la reserva o el repuesto tengan de dónde salir. */
export async function ingress(productId: string, quantity: number) {
  await testDb.insert(schema.worksiteStock).values({ id: `ws-stock-${productId}`, worksiteId: IDS.wsBio, productId, quantity, updatedAt: NOW })
}

let opSeq = 0
export const opId = () => `op-tr-${++opSeq}-${crypto.randomUUID()}`

/** Nota desde el teléfono: con OT (lo de siempre) o sin OT (`worksiteId`). */
export function phoneNote(overrides: Partial<SyncPartsNote> = {}): SyncPartsNote {
  return {
    id: crypto.randomUUID(), workOrderId: OT_ID, deviceId: crypto.randomUUID(), appVersion: "test", createdAt: NOW,
    equipmentStopped: false, notes: null,
    lines: [
      { description: "Filtro de aceite", quantity: 2, unitOfMeasure: "unidad", partNumber: "FA-1", productId: null },
      { description: "Aceite hidráulico", quantity: 20, unitOfMeasure: "litro", partNumber: null, productId: null },
    ],
    ...overrides,
  }
}

type NoteIds = { noteId: string; code: string; itemIds: string[] }

export async function itemsOf(noteId: string): Promise<string[]> {
  const rows = await testDb.select({ id: schema.mantPartsNoteItems.id }).from(schema.mantPartsNoteItems)
    .where(eq(schema.mantPartsNoteItems.noteId, noteId)).orderBy(asc(schema.mantPartsNoteItems.sortOrder))
  return rows.map((row) => row.id)
}

/** Alta desde el teléfono con OT (la NP es de Javier, mecánico asignado). */
export async function phoneOtNote(overrides: Partial<SyncPartsNote> = {}): Promise<NoteIds> {
  const result = await createPartsNoteFromDevice(phoneNote(overrides), await contextOf(IDS.mecBio))
  expect(result.status).toBe(200)
  if (!result.body.ok) throw new Error(result.body.message)
  return { noteId: result.body.noteId, code: result.body.code, itemIds: await itemsOf(result.body.noteId) }
}

/** Alta desde la web, sin OT, en la faena de Biodiversa. */
export async function manualNote(lines: Array<{ description: string; quantity?: number; productId?: string | null; chargeVehicleId?: string; chargeCostCenterId?: string; suggestedSupplierId?: string }> = [{ description: "Filtro de aceite", quantity: 2 }], viewerId: string = IDS.jefe): Promise<NoteIds> {
  const result = await createPartsNote(await viewerOf(viewerId), {
    clientOpId: opId(), worksiteId: IDS.wsBio, urgent: false,
    lines: lines.map((line) => ({ unitOfMeasure: "unidad", quantity: 2, ...line })),
  })
  if (!result.ok) throw new Error(result.message)
  return { noteId: result.noteId, code: result.code, itemIds: await itemsOf(result.noteId) }
}

/** Drizzle envuelve el error del motor: el texto útil (el del trigger o el CHECK) viene en `cause`. */
export async function expectDbError(run: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  const error = await run().then(() => null, (caught: unknown) => caught)
  expect(error, "debía fallar").toBeInstanceOf(Error)
  const cause = (error as { cause?: { message?: string } }).cause
  expect(`${(error as Error).message} ${cause?.message ?? ""}`).toMatch(pattern)
}

export const noteRow = async (noteId: string) => (await testDb.select().from(schema.mantPartsNotes).where(eq(schema.mantPartsNotes.id, noteId)))[0]!
export const itemRow = async (itemId: string) => (await testDb.select().from(schema.mantPartsNoteItems).where(eq(schema.mantPartsNoteItems.id, itemId)))[0]!
export const eventsOf = (noteId: string) => testDb.select().from(schema.mantPartsNoteEvents)
  .where(eq(schema.mantPartsNoteEvents.noteId, noteId)).orderBy(asc(schema.mantPartsNoteEvents.seq))

/** La invariante del historial: el estado de la nota es el `to_status` de su último evento. Devuelve el estado. */
export async function expectInvariant(noteId: string): Promise<string> {
  const note = await noteRow(noteId)
  const [last] = await testDb.select({ toStatus: schema.mantPartsNoteEvents.toStatus }).from(schema.mantPartsNoteEvents)
    .where(eq(schema.mantPartsNoteEvents.noteId, noteId)).orderBy(desc(schema.mantPartsNoteEvents.seq)).limit(1)
  expect(last?.toStatus, `la nota ${note.code} debe estar en su último evento`).toBe(note.status)
  return note.status
}

/** Lo que hace una acción fallida: no escribe ni estado ni evento. Devuelve el mensaje. */
export async function refused(run: () => Promise<{ ok: boolean; message?: string; field?: string }>, noteId: string): Promise<{ message: string; field?: string }> {
  const before = (await eventsOf(noteId)).length
  const statusBefore = (await noteRow(noteId)).status
  const result = await run()
  expect(result.ok).toBe(false)
  expect((await eventsOf(noteId)).length).toBe(before)
  expect((await noteRow(noteId)).status).toBe(statusBefore)
  return { message: result.message ?? "", ...(result.field ? { field: result.field } : {}) }
}

let requestSeq = 0
/** Una solicitud de repuestos que compra la línea (sin OT si la línea no tiene OT). */
export async function requestFor(noteItemId: string, status = "approved") {
  requestSeq += 1
  const requestId = `req-tr-${requestSeq}`
  const itemId = `rqi-tr-${requestSeq}`
  await testDb.insert(schema.purchaseRequests).values({
    id: requestId, code: `SOL-TR-${requestSeq}`, worksiteId: IDS.wsBio, requesterId: IDS.jefe, requestType: "repuestos", urgency: "high", status: "submitted",
  })
  await testDb.insert(schema.purchaseRequestItems).values({
    id: itemId, requestId, productNameFree: "Filtro de aceite", quantity: 2, unitOfMeasure: "unidad", status, partsNoteItemId: noteItemId,
  })
  return { requestId, itemId }
}

/** La OC que compra esa solicitud, enviada al proveedor, lista para recibirse en faena. */
export async function orderFor(requestItemId: string, productId: string | null, quantity: number) {
  requestSeq += 1
  const orderId = `oc-tr-${requestSeq}`
  const ocItemId = `ocitem-tr-${requestSeq}`
  await testDb.insert(schema.purchaseOrders).values({
    id: orderId, code: `OC-TR-${requestSeq}`, worksiteId: IDS.wsBio, supplierId: "sup-tr", createdBy: IDS.jefe,
    status: "sent", deliveryMode: "directo_faena", createdAt: NOW, updatedAt: NOW,
  })
  await testDb.insert(schema.purchaseOrderItems).values({
    id: ocItemId, purchaseOrderId: orderId, requestItemId, productId, quantity, unitOfMeasure: "unidad", sortOrder: 0,
  })
  return { orderId, ocItemId }
}

export const link = (noteItemId: string, requestItemId: string) => testDb.transaction((raw) => linkNoteItemsToRequestTx(raw as unknown as Tx, {
  links: [{ noteItemId, requestItemId }], actorUserId: IDS.jefe,
}))

export async function resetState() {
  await clearNoteHistory(testDb)
  for (const table of [
    schema.notifications, schema.auditLog, schema.rateLimits, schema.receipts, schema.receiptItems,
    schema.purchaseOrderItems, schema.purchaseOrders, schema.purchaseRequestItems, schema.purchaseRequests,
    schema.mantPartsAllocationSources, schema.mantPartsAllocations, schema.mantPartsNotes,
  ]) await testDb.delete(table)
  await testDb.delete(schema.mantWorkOrderEvents).where(sql`true`)
}


export async function stockIn(productId: string): Promise<number> {
  const [row] = await testDb.select({ quantity: schema.worksiteStock.quantity }).from(schema.worksiteStock)
    .where(and(eq(schema.worksiteStock.worksiteId, IDS.wsBio), eq(schema.worksiteStock.productId, productId)))
  return Number(row?.quantity ?? 0)
}
