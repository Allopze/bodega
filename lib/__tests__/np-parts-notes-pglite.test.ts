import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq, inArray } from "drizzle-orm"
import path from "node:path"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"
import type { MantEquipmentSnapshot } from "@/db/schema"
import type { MantCatalog, SyncPartsNote } from "@/lib/mantencion/contracts"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { codeYear } from "@/lib/utils"
import { configureZodLocale } from "@/lib/validation/zod-locale"
import { IDS, seedMantFixtures } from "./mantencion-sync-fixtures"
import { getRequest, jsonRequest, readJson } from "./mantencion-sync-http-helpers"
import { clearNoteHistory } from "./np-history-reset"

/**
 * Notas de pedido (NP) de repuestos del mecánico (ADR mantención 0001) contra Postgres de
 * verdad: alta idempotente desde el teléfono, resolución por jefatura (desde stock, rechazo,
 * anulación, enlace con la solicitud), estado derivado de las líneas, lecturas con alcance,
 * catálogo del teléfono y lo que le pasa a las líneas sin resolver cuando su OT se cierra o se
 * anula (NP4-7). PGlite es de una sola conexión: la concurrencia real la cubre la revisión de
 * bloqueos del servicio, no esta suite.
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
// Los avisos escriben en `notifications` y además mandan correo: aquí sólo importa lo primero.
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn(async () => undefined),
  sendBatchEmails: vi.fn(async () => undefined),
  getAppBaseUrl: () => "http://localhost",
}))

const { createPartsNoteFromDevice } = await import("@/lib/services/mantencion/parts-notes/create")
const resolver = await import("@/lib/services/mantencion/parts-notes/resolve")
const query = await import("@/lib/services/mantencion/parts-notes/query")
const transitions = await import("@/lib/services/mantencion/work-orders/transitions")
const { rejectOpenLinesOfWorkOrderTx } = await import("@/lib/services/mantencion/parts-notes/line-rejection")
const { deriveNoteStatus, allocateUsed, lineAwaitsArrival, recalcNoteStatusTx } = await import("@/lib/services/mantencion/parts-notes/status")
const parts = await import("@/lib/services/mantencion/parts")
const { applyMovementTx } = await import("@/lib/services/stock-movement")
const { getUserRbacById } = await import("@/lib/auth/rbac")
const { issueDeviceCredential } = await import("@/lib/services/mantencion/device-credentials")
const { catalogVersion, CATALOG_FORMAT } = await import("@/lib/services/mantencion/sync-catalog-version")
const notasPedido = await import("@/app/api/mantencion/sync/notas-pedido/route")
const catalogo = await import("@/app/api/mantencion/sync/catalogo/route")

const SNAPSHOT_BIO: MantEquipmentSnapshot = { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" }
const SNAPSHOT_CHO: MantEquipmentSnapshot = { ...SNAPSHOT_BIO, code: "KA-200", plate: "BCDF-12", worksite: "Cholguán" }
const SNAPSHOT_MQ: MantEquipmentSnapshot = { ...SNAPSHOT_BIO, code: "MQ-01", plate: "MQ-01", noPlate: true, type: "Excavadora", unit: "h" }

type OtSpec = { vehicleId: string; worksiteId: string; snapshot: MantEquipmentSnapshot; status: "asignada" | "en_ejecucion" | "cerrada"; assignedTo: string }
const OTS = {
  /** La OT de Javier en Biodiversa: la del camino feliz. */
  a: { vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, snapshot: SNAPSHOT_BIO, status: "en_ejecucion", assignedTo: IDS.mecBio },
  /** Recién asignada: aún sin ingreso a taller. */
  asig: { vehicleId: IDS.machineBio, worksiteId: IDS.wsBio, snapshot: SNAPSHOT_MQ, status: "asignada", assignedTo: IDS.mecBio },
  /** Es de otro mecánico: para quien no es el asignado. */
  other: { vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, snapshot: SNAPSHOT_BIO, status: "en_ejecucion", assignedTo: IDS.mecBio2 },
  closed: { vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, snapshot: SNAPSHOT_BIO, status: "cerrada", assignedTo: IDS.mecBio },
  /** Equipo de Cholguán con su propio mecánico. */
  cho: { vehicleId: IDS.truckCho, worksiteId: IDS.wsCho, snapshot: SNAPSHOT_CHO, status: "en_ejecucion", assignedTo: IDS.mecCho },
  /** Equipo de Cholguán asignado a Javier (mecánico de Biodiversa): la jefatura asigna en cualquier faena. */
  choToBio: { vehicleId: IDS.truckCho, worksiteId: IDS.wsCho, snapshot: SNAPSHOT_CHO, status: "en_ejecucion", assignedTo: IDS.mecBio },
  // Las que terminan en las pruebas de «al cerrar o anular la OT» (NP4-7): una por caso, porque cerrar y anular no se deshacen.
  endVoid1: { vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, snapshot: SNAPSHOT_BIO, status: "en_ejecucion", assignedTo: IDS.mecBio },
  endVoid2: { vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, snapshot: SNAPSHOT_BIO, status: "en_ejecucion", assignedTo: IDS.mecBio },
  endVoid3: { vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, snapshot: SNAPSHOT_BIO, status: "en_ejecucion", assignedTo: IDS.mecBio },
  endVoid4: { vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, snapshot: SNAPSHOT_BIO, status: "en_ejecucion", assignedTo: IDS.mecBio },
  /** La que recibe la conformidad: se pide en taller y después pasa a «recepcionada» (una NP no se crea con la OT ya recibida). */
  endConform1: { vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, snapshot: SNAPSHOT_BIO, status: "en_ejecucion", assignedTo: IDS.mecBio },
} satisfies Record<string, OtSpec>
type OtKey = keyof typeof OTS
const OT_KEYS = Object.keys(OTS) as OtKey[]
const OT = Object.fromEntries(OT_KEYS.map((key) => [key, `ot-l3-${key}`])) as Record<OtKey, string>

async function insertOt(key: OtKey) {
  const spec: OtSpec = OTS[key]
  await testDb.insert(schema.mantWorkOrders).values({
    id: OT[key], folio: `OT-L3-${key}`, vehicleId: spec.vehicleId, worksiteId: spec.worksiteId, equipmentSnapshot: spec.snapshot,
    repair: true, maintenance: false, requestDate: "2026-11-01", requestedByUserId: IDS.jefe, requesterName: "Alexis Morales",
    repairDescription: "Fuga hidráulica en la pluma", status: spec.status,
    assignedToUserId: spec.assignedTo, assignedByUserId: IDS.jefe, assignedAt: "2026-11-01T12:00:00Z",
    ...(spec.status === "asignada" ? {} : {
      workshopKind: "interno", workshopEntryAt: "2026-11-02T08:00:00Z", estimatedDeliveryDate: "2026-12-31", startedAt: "2026-11-02T08:00:00Z", startedByUserId: spec.assignedTo,
    }),
    ...(spec.status === "cerrada" ? {
      workshopExitAt: "2026-11-04T08:00:00Z", finishedAt: "2026-11-04T08:00:00Z", finishedByUserId: IDS.mecBio,
      receivedAt: "2026-11-04T09:00:00Z", receiverName: "Pedro Soto", receivedByUserId: IDS.jefe, receivedRecordedAt: "2026-11-04T09:00:00Z",
      faenaReceivedAt: "2026-11-05T09:00:00Z", faenaReceiverName: "Admin Contrato", faenaReceivedByUserId: IDS.jefe, closedAt: "2026-11-05T09:00:00Z",
    } : {}),
  })
}

async function contextOf(userId: string, mutate?: (permissions: string[]) => string[]) {
  const rbac = (await getUserRbacById(userId, true))!
  return {
    userName: rbac.name, deviceId: "dev-test-np", credentialId: "cred-test-np",
    viewer: {
      userId: rbac.id, email: rbac.email, permissions: mutate ? mutate([...rbac.permissions]) : rbac.permissions,
      worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal,
    },
  }
}
const viewerOf = async (userId: string) => (await contextOf(userId)).viewer

let productSeq = 0
async function makeProduct(name: string, unit = "unidad", extra: { isSparePart?: boolean; isActive?: boolean } = {}): Promise<string> {
  productSeq += 1
  const id = `p-l3-${productSeq}`
  const now = new Date().toISOString()
  await testDb.insert(schema.products).values({
    id, sku: `REP-L3-${productSeq}`, name, categoryId: "cat-l3", unitOfMeasure: unit, isSparePart: extra.isSparePart ?? true,
    partNumber: extra.isSparePart === false ? null : `PN-L3-${productSeq}`, isActive: extra.isActive ?? true, createdAt: now, updatedAt: now,
  })
  return id
}

function noteBody(workOrderId: string, overrides: Partial<SyncPartsNote> = {}): SyncPartsNote {
  return {
    id: crypto.randomUUID(), workOrderId, deviceId: crypto.randomUUID(), appVersion: "test", createdAt: new Date().toISOString(),
    equipmentStopped: true, notes: "Se cortó en faena",
    lines: [
      { description: "Filtro de aceite", quantity: 2, unitOfMeasure: "unidad", partNumber: "FA-1", productId: null },
      { description: "Aceite hidráulico", quantity: 20, unitOfMeasure: "litro", partNumber: null, productId: null },
    ],
    ...overrides,
  }
}

type Created = { noteId: string; code: string; itemIds: string[] }
/** Crea una NP por el servicio (como la manda el teléfono) y devuelve sus ids. */
async function createNote(userId: string, workOrderId: string, overrides: Partial<SyncPartsNote> = {}): Promise<Created> {
  const result = await createPartsNoteFromDevice(noteBody(workOrderId, overrides), await contextOf(userId))
  expect(result.status).toBe(200)
  if (!result.body.ok) throw new Error(result.body.message)
  const items = await testDb.select().from(schema.mantPartsNoteItems).where(eq(schema.mantPartsNoteItems.noteId, result.body.noteId)).orderBy(schema.mantPartsNoteItems.sortOrder)
  return { noteId: result.body.noteId, code: result.body.code, itemIds: items.map((item) => item.id) }
}

async function ingress(productId: string, quantity: number, worksiteId: string = IDS.wsBio) {
  await testDb.transaction((tx) => applyMovementTx(tx as unknown as Tx, {
    worksiteId, productId, type: "ingreso_oc", quantity, performedBy: IDS.jefe, referenceType: "test", referenceId: "seed",
  }))
}

async function reserve(workOrderId: string, productId: string, quantity: number, noteItemId?: string, worksiteId: string = IDS.wsBio) {
  return testDb.transaction(async (raw) => {
    const tx = raw as unknown as Tx
    await parts.lockForStockTx(tx, { workOrderIds: [workOrderId], worksiteId, productIds: [productId] })
    return parts.addToAllocationTx(tx, { workOrderId, worksiteId, productId, quantity, source: "recepcion", noteItemId, actorUserId: IDS.jefe })
  })
}

async function freeOf(productId: string, worksiteId: string = IDS.wsBio): Promise<number> {
  return testDb.transaction(async (raw) => {
    const tx = raw as unknown as Tx
    await parts.lockForStockTx(tx, { worksiteId, productIds: [productId] })
    return parts.freeStockTx(tx, worksiteId, productId)
  })
}

let recordSeq = 0
async function insertRecord(workOrderId: string, vehicleId: string, snapshot: MantEquipmentSnapshot = SNAPSHOT_BIO): Promise<string> {
  recordSeq += 1
  const id = `rec-l3-${recordSeq}`
  await testDb.insert(schema.mantRecords).values({
    id, folio: `C-L3-${recordSeq}`, kind: "C", vehicleId, equipmentSnapshot: snapshot, worksiteId: IDS.wsBio,
    reading: 120_000 + recordSeq, unit: "km", workDate: "2026-11-03", registeredBy: IDS.mecBio, executorKind: "yo", executorUserId: IDS.mecBio,
    executorName: "Javier Roa", signedAt: "2026-11-03T16:00:00Z", receivedAt: `2026-11-03T16:00:${String(recordSeq).padStart(2, "0")}Z`, workOrderId,
  })
  await testDb.insert(schema.mantRecordCorrectives).values({
    recordId: id, workTypes: ["Mecánico"], oils: [], description: "Cambio de filtro", noParts: false, hours: 2, inWorkshop: false,
  })
  return id
}

/** Lo que hace el registro del mecánico: consume del stock y guarda la línea con el resultado, en una transacción. */
async function consume(workOrderId: string, recordId: string, productId: string, quantity: number, allocationId: string) {
  return testDb.transaction(async (raw) => {
    const tx = raw as unknown as Tx
    const result = await parts.consumePartTx(tx, {
      recordId, workOrderId, recordWorksiteId: IDS.wsBio, productId, allocationId, quantity, actorUserId: IDS.mecBio,
    })
    expect(result.status).toBe("descontado")
    await tx.insert(schema.mantRecordParts).values({
      id: `${recordId}-${productId}`, recordId, quantity, description: "repuesto", source: "stock", productId, allocationId,
      stockStatus: "descontado", inventoryMovementId: result.status === "descontado" ? result.movementId : null,
    })
  })
}

let requestSeq = 0
/** Una compra que apunta a la línea de NP: solicitud + ítem (+ OC vigente si se pide). */
async function insertPurchase(input: { noteItemId: string; workOrderId: string; itemStatus: string; requestStatus?: string; withOrder?: boolean }) {
  requestSeq += 1
  const requestId = `req-l3-${requestSeq}`
  await testDb.insert(schema.purchaseRequests).values({
    id: requestId, code: `SOL-L3-${requestSeq}`, worksiteId: IDS.wsBio, requesterId: IDS.jefe, requestType: "repuestos", urgency: "high", status: input.requestStatus ?? "submitted",
  })
  const itemId = `rqi-l3-${requestSeq}`
  await testDb.insert(schema.purchaseRequestItems).values({
    id: itemId, requestId, productNameFree: "Filtro de aceite", quantity: 2, status: input.itemStatus,
    vehicleId: IDS.truckBio, workOrderId: input.workOrderId, partsNoteItemId: input.noteItemId,
  })
  let orderCode: string | null = null
  if (input.withOrder) {
    orderCode = `OC-L3-${requestSeq}`
    const orderId = `po-l3-${requestSeq}`
    await testDb.insert(schema.purchaseOrders).values({ id: orderId, code: orderCode, worksiteId: IDS.wsBio, supplierId: "sup-l3", createdBy: IDS.jefe, status: "sent" })
    await testDb.insert(schema.purchaseOrderItems).values({ id: `poi-l3-${requestSeq}`, purchaseOrderId: orderId, requestItemId: itemId, quantity: 2, status: "issued" })
  }
  return { requestId, itemId, requestCode: `SOL-L3-${requestSeq}`, orderCode }
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
const eventsOf = (workOrderId: string, type: string) => testDb.select().from(schema.mantWorkOrderEvents)
  .where(and(eq(schema.mantWorkOrderEvents.workOrderId, workOrderId), eq(schema.mantWorkOrderEvents.type, type)))
const notificationsOf = (type: string) => testDb.select().from(schema.notifications).where(eq(schema.notifications.type, type))

async function resetNoteState() {
  await clearNoteHistory(testDb)
  for (const table of [
    schema.notifications, schema.auditLog, schema.rateLimits, schema.mantRecordParts, schema.mantRecords,
    schema.purchaseOrderItems, schema.purchaseOrders, schema.purchaseRequestItems, schema.purchaseRequests,
    schema.mantPartsAllocationSources, schema.mantPartsAllocations, schema.mantPartsNotes,
  ]) await testDb.delete(table)
  await testDb.delete(schema.mantWorkOrderEvents).where(inArray(schema.mantWorkOrderEvents.type, [
    "parts_note_created", "parts_note_resolved", "parts_allocated", "parts_consumed", "parts_released",
  ]))
}

const tokens = new Map<string, string>()
async function tokenOf(userId: string): Promise<string> {
  const cached = tokens.get(userId)
  if (cached) return cached
  const { token } = await issueDeviceCredential({ userId, deviceId: crypto.randomUUID() })
  tokens.set(userId, token)
  return token
}

beforeAll(async () => {
  configureZodLocale()
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedMantFixtures(testDb)
  const now = new Date().toISOString()
  await testDb.insert(schema.suppliers).values({ id: "sup-l3", name: "Repuestos del Sur", rut: "76.000.333-3", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.productCategories).values({ id: "cat-l3", name: "Repuestos L3", slug: "repuestos-l3", isEpp: false, requiresPrevencion: false, sortOrder: 1 })
  for (const key of OT_KEYS) await insertOt(key)
})

beforeEach(resetNoteState)

// ── Reglas puras ─────────────────────────────────────────────────────────────

describe("estado de la NP y reparto de lo usado", () => {
  it("el estado sale de las líneas: enviada → en gestión → en compra → cerrada", () => {
    expect(deriveNoteStatus(["pendiente", "pendiente"])).toBe("enviada")
    expect(deriveNoteStatus(["desde_stock", "pendiente"])).toBe("en_gestion")
    expect(deriveNoteStatus(["rechazada", "pendiente", "en_compra"])).toBe("en_gestion")
    expect(deriveNoteStatus(["desde_stock", "en_compra", "rechazada"])).toBe("cerrada")
    // Ninguna pendiente y una compra aún sin llegar: en compra; si algo ya llegó a la faena, recibida parcial (ADR 0001, 2026-11-27).
    expect(deriveNoteStatus(["en_compra", "rechazada"], 1)).toBe("en_compra")
    expect(deriveNoteStatus(["desde_stock", "en_compra", "rechazada"], 1, { arrivedAny: true })).toBe("recibida_parcial")
    expect(deriveNoteStatus(["en_compra", "en_compra"], 2)).toBe("en_compra")
    expect(deriveNoteStatus(["rechazada", "rechazada"])).toBe("rechazada")
    // Lo pendiente manda sobre todo lo demás; sólo con todo pendiente, aceptada conserva su nombre.
    expect(deriveNoteStatus(["pendiente", "pendiente"], 0)).toBe("enviada")
    expect(deriveNoteStatus(["pendiente", "pendiente"], 0, { accepted: true })).toBe("aceptada")
    expect(deriveNoteStatus(["pendiente", "en_compra"], 1)).toBe("en_gestion")
  })

  it("una línea en compra espera su repuesto sólo con la OT abierta, una compra viva, sin lo llegado completo ni lo recibido por Compras", () => {
    const base = { resolution: "en_compra", quantity: 2, arrived: 0, workOrderOpen: true, purchases: [{ itemStatus: "approved", requestStatus: "approved" }] }
    expect(lineAwaitsArrival(base)).toBe(true)
    expect(lineAwaitsArrival({ ...base, purchases: [{ itemStatus: "in_purchase_order", requestStatus: "in_purchasing" }, { itemStatus: "delivered", requestStatus: "in_purchasing" }] })).toBe(true)
    // Llegó parte: sigue esperando; llegó todo (o más): ya no.
    expect(lineAwaitsArrival({ ...base, arrived: 1 })).toBe(true)
    expect(lineAwaitsArrival({ ...base, arrived: 2 })).toBe(false)
    // Compras ya la recibió (aunque lo reservado no cubra lo pedido): no hay nada en camino.
    expect(lineAwaitsArrival({ ...base, purchases: [{ itemStatus: "received", requestStatus: "closed" }] })).toBe(false)
    expect(lineAwaitsArrival({ ...base, purchases: [{ itemStatus: "delivered", requestStatus: "closed" }] })).toBe(false)
    // Sin compra viva (muerta o ninguna) o con la OT terminada, nadie espera.
    expect(lineAwaitsArrival({ ...base, purchases: [{ itemStatus: "rejected", requestStatus: "rejected" }] })).toBe(false)
    expect(lineAwaitsArrival({ ...base, purchases: [{ itemStatus: "approved", requestStatus: "cancelled" }] })).toBe(false)
    expect(lineAwaitsArrival({ ...base, purchases: [] })).toBe(false)
    expect(lineAwaitsArrival({ ...base, workOrderOpen: false })).toBe(false)
    // Sólo una línea en compra espera.
    expect(lineAwaitsArrival({ ...base, resolution: "pendiente" })).toBe(false)
    expect(lineAwaitsArrival({ ...base, resolution: "desde_stock" })).toBe(false)
  })

  it("lo usado se reparte en orden entre las líneas del mismo repuesto y con tope en lo que llegó a cada una", () => {
    const lines = [{ id: "l1", key: "ot:p", arrived: 2 }, { id: "l2", key: "ot:p", arrived: 2 }, { id: "l3", key: null, arrived: 5 }]
    expect([...allocateUsed(lines, new Map([["ot:p", 3]]))]).toEqual([["l1", 2], ["l2", 1], ["l3", 0]])
    expect([...allocateUsed(lines, new Map([["ot:p", 9]]))]).toEqual([["l1", 2], ["l2", 2], ["l3", 0]])
  })
})

// ── Alta desde el teléfono ───────────────────────────────────────────────────

describe("crear una nota de pedido desde el teléfono", () => {
  it("guarda la NP con su folio, el equipo y la faena de la OT, sus líneas, el evento, la auditoría y avisa a quienes la resuelven", async () => {
    const result = await createPartsNoteFromDevice(noteBody(OT.a), await contextOf(IDS.mecBio))
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, duplicate: false })
    const body = result.body as Extract<typeof result.body, { ok: true }>
    expect(body.code).toMatch(new RegExp(`^NP-${codeYear()}-\\d{4}$`))

    const note = await noteRow(body.noteId)
    expect(note).toMatchObject({
      workOrderId: OT.a, vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, requestedByUserId: IDS.mecBio,
      deviceId: "dev-test-np", equipmentStopped: true, notes: "Se cortó en faena", status: "enviada", clientOpId: expect.any(String),
    })
    const items = await testDb.select().from(schema.mantPartsNoteItems).where(eq(schema.mantPartsNoteItems.noteId, note.id)).orderBy(schema.mantPartsNoteItems.sortOrder)
    expect(items.map((item) => [item.sortOrder, item.description, Number(item.quantity), item.unitOfMeasure, item.partNumber, item.resolution]))
      .toEqual([[0, "Filtro de aceite", 2, "unidad", "FA-1", "pendiente"], [1, "Aceite hidráulico", 20, "litro", null, "pendiente"]])

    const [event] = await eventsOf(OT.a, "parts_note_created")
    expect(event).toMatchObject({ actorUserId: IDS.mecBio, clientOpId: null })
    expect(event?.changeSet).toMatchObject({ noteId: note.id, code: note.code, lines: 2 })
    const audits = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, note.id))
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ action: "create", entityType: "mant_parts_note", entityCode: note.code, userId: IDS.mecBio })

    // Quienes resuelven NP en Biodiversa (jefatura global, administración de contrato y supervisión de la faena), sin el autor.
    await vi.waitFor(async () => expect((await notificationsOf("mant_np_created")).map((row) => row.userId).sort()).toEqual([IDS.adminBio, IDS.jefe, IDS.supBio].sort()))
    const [notice] = await notificationsOf("mant_np_created")
    expect(notice?.body).toBe(`${note.code} · OT OT-L3-a · 2 repuestos · equipo detenido`)
    expect(notice?.entityHref).toBe(`/mantencion/notas-pedido/${note.id}`)
  })

  it("la misma NP enviada tres veces deja una sola; un id ajeno o de otra orden se rechaza con 409", async () => {
    const body = noteBody(OT.a)
    const context = await contextOf(IDS.mecBio)
    const first = await createPartsNoteFromDevice(body, context)
    const second = await createPartsNoteFromDevice(body, context)
    const third = await createPartsNoteFromDevice(body, context)
    expect([first.status, second.status, third.status]).toEqual([200, 200, 200])
    expect(first.body).toMatchObject({ ok: true, duplicate: false })
    expect(second.body).toMatchObject({ ok: true, duplicate: true })
    expect(third.body).toMatchObject({ ok: true, duplicate: true })
    const noteIds = new Set([first, second, third].map((result) => (result.body as { noteId: string }).noteId))
    expect(noteIds.size).toBe(1)
    expect((second.body as { code: string }).code).toBe((first.body as { code: string }).code)
    expect(await testDb.select().from(schema.mantPartsNotes)).toHaveLength(1)
    expect(await testDb.select().from(schema.mantPartsNoteItems)).toHaveLength(2)
    expect(await eventsOf(OT.a, "parts_note_created")).toHaveLength(1)

    const foreign = await createPartsNoteFromDevice({ ...body, workOrderId: OT.other }, await contextOf(IDS.mecBio2))
    expect(foreign.status).toBe(409)
    expect(foreign.body).toMatchObject({ ok: false, code: "rejected", message: "Ese identificador de operación ya pertenece a otra persona." })
    const elsewhere = await createPartsNoteFromDevice({ ...body, workOrderId: OT.asig }, context)
    expect(elsewhere.status).toBe(409)
    expect(elsewhere.body).toMatchObject({ ok: false, message: "Ese identificador ya se usó en otra orden." })
    expect(await testDb.select().from(schema.mantPartsNotes)).toHaveLength(1)
  })

  it("una OT cerrada o reasignada a otro mecánico rechaza con 409 y un mensaje legible; no deja nada guardado", async () => {
    const closed = await createPartsNoteFromDevice(noteBody(OT.closed), await contextOf(IDS.mecBio))
    expect(closed.status).toBe(409)
    expect(closed.body).toMatchObject({ ok: false, code: "rejected", message: "La orden OT-L3-closed está «Cerrada»: ya no admite pedir repuestos." })

    const reassigned = await createPartsNoteFromDevice(noteBody(OT.other), await contextOf(IDS.mecBio))
    expect(reassigned.status).toBe(409)
    expect(reassigned.body).toMatchObject({ ok: false, message: "La orden OT-L3-other ya no está asignada a ti." })

    expect(await testDb.select().from(schema.mantPartsNotes)).toHaveLength(0)
    expect(await eventsOf(OT.closed, "parts_note_created")).toHaveLength(0)
  })

  it("una OT recién asignada ya admite pedir repuestos; una que no existe se rechaza con 422", async () => {
    expect((await createPartsNoteFromDevice(noteBody(OT.asig), await contextOf(IDS.mecBio))).status).toBe(200)
    const missing = await createPartsNoteFromDevice(noteBody("ot-no-existe"), await contextOf(IDS.mecBio))
    expect(missing.status).toBe(422)
    expect(missing.body).toMatchObject({ ok: false, code: "invalid", field: "workOrderId" })
  })

  it("quien administra OT sin ser el asignado necesita la faena de la OT en su alcance; el asignado puede pedir aunque la OT sea de otra faena", async () => {
    // Supervisión de Biodiversa con permiso de administrar OT: no es el asignado de ninguna.
    await testDb.insert(schema.userPermissions).values({ userId: IDS.supBio, permissionId: "p-mant-ot-manage" })
    const supervisor = await contextOf(IDS.supBio)
    expect(supervisor.viewer.permissions).toContain("mant:ot:manage")

    const outside = await createPartsNoteFromDevice(noteBody(OT.cho), supervisor)
    expect(outside.status).toBe(409)
    expect(outside.body).toMatchObject({ ok: false, message: "La orden OT-L3-cho es de una faena que no es de tu alcance." })
    expect(await testDb.select().from(schema.mantPartsNotes)).toHaveLength(0)

    const inside = await createPartsNoteFromDevice(noteBody(OT.other), supervisor)
    expect(inside.status).toBe(200)

    // Javier es de Biodiversa, pero jefatura le asignó un equipo de Cholguán: es SU orden.
    const assigned = await createPartsNoteFromDevice(noteBody(OT.choToBio), await contextOf(IDS.mecBio))
    expect(assigned.status).toBe(200)
    const note = await noteRow((assigned.body as { noteId: string }).noteId)
    expect(note.worksiteId).toBe(IDS.wsCho)
    await testDb.delete(schema.userPermissions).where(eq(schema.userPermissions.userId, IDS.supBio))
  })

  it("sin mant:np:create responde 403 y no guarda nada", async () => {
    const context = await contextOf(IDS.mecBio, (permissions) => permissions.filter((permission) => permission !== "mant:np:create"))
    const result = await createPartsNoteFromDevice(noteBody(OT.a), context)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ ok: false, code: "rejected" })
    expect(await testDb.select().from(schema.mantPartsNotes)).toHaveLength(0)
  })

  it("un repuesto elegido del catálogo debe ser un repuesto activo", async () => {
    const guante = await makeProduct("Guante", "unidad", { isSparePart: false })
    const retired = await makeProduct("Manguera retirada", "unidad", { isActive: false })
    const good = await makeProduct("Filtro de aire")
    const line = (productId: string | null) => ({ description: "Repuesto de prueba", quantity: 1, unitOfMeasure: "unidad", partNumber: null, productId })
    for (const bad of [guante, retired, "p-no-existe"]) {
      const result = await createPartsNoteFromDevice(noteBody(OT.a, { lines: [line(good), line(bad)] }), await contextOf(IDS.mecBio))
      expect(result.status).toBe(422)
      expect(result.body).toMatchObject({ ok: false, code: "invalid", field: "lines.1.productId" })
    }
    expect(await testDb.select().from(schema.mantPartsNotes)).toHaveLength(0)
    const created = await createPartsNoteFromDevice(noteBody(OT.a, { lines: [line(good)] }), await contextOf(IDS.mecBio))
    expect(created.status).toBe(200)
  })

  it("POST /api/mantencion/sync/notas-pedido: autentica con Bearer, valida el cuerpo y contesta el estado del servicio", async () => {
    const path = "/api/mantencion/sync/notas-pedido"
    expect((await notasPedido.POST(jsonRequest(path, null, noteBody(OT.a)))).status).toBe(401)
    const token = await tokenOf(IDS.mecBio)
    const invalid = await notasPedido.POST(jsonRequest(path, token, noteBody(OT.a, { lines: [] })))
    expect(invalid.status).toBe(422)
    const body = noteBody(OT.a)
    const created = await notasPedido.POST(jsonRequest(path, token, body))
    expect(created.status).toBe(200)
    expect(await readJson(created)).toMatchObject({ ok: true, id: body.id, duplicate: false, code: expect.stringMatching(/^NP-/) })
    const again = await notasPedido.POST(jsonRequest(path, token, body))
    expect(await readJson(again)).toMatchObject({ ok: true, duplicate: true })
    const closed = await notasPedido.POST(jsonRequest(path, token, noteBody(OT.closed)))
    expect(closed.status).toBe(409)
    expect(await testDb.select().from(schema.mantPartsNotes)).toHaveLength(1)
  })
})

// ── Resolver ─────────────────────────────────────────────────────────────────

describe("resolver una línea desde el stock de la faena", () => {
  it("no pasa de lo libre; al alcanzar crea la reserva con la línea de origen y deja el estado de la NP", async () => {
    const filter = await makeProduct("Filtro de aceite")
    await ingress(filter, 3)
    // Otra OT ya apartó 1: libres = 2.
    const rival = await createNote(IDS.mecBio, OT.a)
    await reserve(OT.a, filter, 1, rival.itemIds[0])
    expect(await freeOf(filter)).toBe(2)

    const note = await createNote(IDS.mecBio, OT.asig, {
      lines: [
        { description: "Filtro de aceite", quantity: 5, unitOfMeasure: "unidad", partNumber: "FA-1", productId: null },
        { description: "Aceite hidráulico", quantity: 20, unitOfMeasure: "litro", partNumber: null, productId: null },
      ],
    })
    const jefe = await viewerOf(IDS.jefe)
    const tooMuch = await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[0]!, productId: filter, quantity: 3 })
    expect(tooMuch).toMatchObject({ ok: false, message: "En Biodiversa hay 2 libres.", field: "quantity" })
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("pendiente")
    expect(await testDb.select().from(schema.mantPartsAllocations).where(eq(schema.mantPartsAllocations.workOrderId, OT.asig))).toHaveLength(0)

    // Pidieron 5 y sólo hay 2 libres: se reservan 2 y el saldo (3) queda como una línea pendiente nueva (NP4-3).
    const done = await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[0]!, productId: filter, quantity: 2 })
    expect(done).toEqual({ ok: true, message: "Se reservaron 2 de «Filtro de aceite» del stock de Biodiversa para la orden OT-L3-asig. El saldo (3) quedó como una línea pendiente de la nota." })
    const [allocation] = await testDb.select().from(schema.mantPartsAllocations).where(and(eq(schema.mantPartsAllocations.workOrderId, OT.asig), eq(schema.mantPartsAllocations.productId, filter)))
    expect(allocation).toMatchObject({ worksiteId: IDS.wsBio, status: "activa" })
    expect(Number(allocation?.quantity)).toBe(2)
    const [source] = await testDb.select().from(schema.mantPartsAllocationSources).where(eq(schema.mantPartsAllocationSources.allocationId, allocation!.id))
    expect(source).toMatchObject({ source: "stock_existente", noteItemId: note.itemIds[0], actorUserId: IDS.jefe })
    expect(Number(source?.quantity)).toBe(2)
    expect(await freeOf(filter)).toBe(0)

    const line = await itemRow(note.itemIds[0]!)
    expect(line).toMatchObject({ resolution: "desde_stock", productId: filter, resolvedByUserId: IDS.jefe, quantity: 2 })
    expect(line.resolvedAt).toBeTruthy()
    expect((await noteRow(note.noteId)).status).toBe("en_gestion")
    const [event] = await eventsOf(OT.asig, "parts_note_resolved")
    expect(event?.changeSet).toMatchObject({ itemId: note.itemIds[0], resolution: "desde_stock", productId: filter, originalQuantity: 5, remainderQuantity: 3 })
    const audits = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, note.noteId))
    expect(audits.some((row) => row.action === "update")).toBe(true)

    // La segunda línea (en litros, fraccionable) se resuelve completa; la NP sigue abierta por el saldo del filtro.
    const aceite = await makeProduct("Aceite hidráulico", "litro")
    await ingress(aceite, 25)
    const second = await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[1]!, productId: aceite, quantity: 20 })
    expect(second.ok).toBe(true)
    expect((await noteRow(note.noteId)).status).toBe("en_gestion")
    const [, , remainder] = await testDb.select().from(schema.mantPartsNoteItems).where(eq(schema.mantPartsNoteItems.noteId, note.noteId)).orderBy(schema.mantPartsNoteItems.sortOrder)
    expect(remainder).toMatchObject({ description: "Filtro de aceite", quantity: 3, unitOfMeasure: "unidad", partNumber: "FA-1", resolution: "pendiente", sortOrder: 2 })
    expect((await resolver.rejectNoteItem(jefe, { itemId: remainder!.id, reason: "El saldo se compra aparte" })).ok).toBe(true)
    expect((await noteRow(note.noteId)).status).toBe("cerrada")
  })

  it("el aviso concuerda con la cantidad: «Se reservó 1 de…» en singular y «Se reservaron N de…» en plural, también con decimales (NAV-13)", async () => {
    const filter = await makeProduct("Filtro de aire")
    const aceite = await makeProduct("Aceite hidráulico", "litro")
    await ingress(filter, 6)
    await ingress(aceite, 40)
    // Se reserva todo lo pedido en cada línea: sin saldo, el aviso es sólo el de la reserva.
    const note = await createNote(IDS.mecBio, OT.asig, {
      lines: [
        { description: "Filtro de aire", quantity: 1, unitOfMeasure: "unidad", partNumber: null, productId: null },
        { description: "Filtro de aire grande", quantity: 3, unitOfMeasure: "unidad", partNumber: null, productId: null },
        { description: "Aceite hidráulico", quantity: 1.5, unitOfMeasure: "litro", partNumber: null, productId: null },
        { description: "Aceite hidráulico (resto)", quantity: 1, unitOfMeasure: "litro", partNumber: null, productId: null },
      ],
    })
    const jefe = await viewerOf(IDS.jefe)
    const ot = "para la orden OT-L3-asig."
    expect(await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[0]!, productId: filter, quantity: 1 }))
      .toEqual({ ok: true, message: `Se reservó 1 de «Filtro de aire» del stock de Biodiversa ${ot}` })
    expect(await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[1]!, productId: filter, quantity: 3 }))
      .toEqual({ ok: true, message: `Se reservaron 3 de «Filtro de aire» del stock de Biodiversa ${ot}` })
    // Una cantidad decimal no es «1»: va en plural (1,5 litros; 0,5 litros).
    expect(await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[2]!, productId: aceite, quantity: 1.5 }))
      .toEqual({ ok: true, message: `Se reservaron 1,5 de «Aceite hidráulico» del stock de Biodiversa ${ot}` })
    // Un litro exacto sí es uno solo.
    expect(await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[3]!, productId: aceite, quantity: 1 }))
      .toEqual({ ok: true, message: `Se reservó 1 de «Aceite hidráulico» del stock de Biodiversa ${ot}` })
  })

  it("el stock que se aparta es el de la faena ACTUAL del equipo, no el de otra", async () => {
    const filter = await makeProduct("Filtro de aceite")
    await ingress(filter, 5, IDS.wsBio)
    const note = await createNote(IDS.mecCho, OT.cho)
    const jefe = await viewerOf(IDS.jefe)
    const blocked = await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[0]!, productId: filter, quantity: 2 })
    expect(blocked).toMatchObject({ ok: false, message: "En Cholguán hay 0 libres." })
    await ingress(filter, 2, IDS.wsCho)
    expect((await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[0]!, productId: filter, quantity: 2 })).ok).toBe(true)
    const [allocation] = await testDb.select().from(schema.mantPartsAllocations).where(eq(schema.mantPartsAllocations.workOrderId, OT.cho))
    expect(allocation?.worksiteId).toBe(IDS.wsCho)
  })

  it("rechaza lo que no corresponde: producto que no es repuesto, cantidades inválidas, sin permiso, otra faena y una OT ya cerrada", async () => {
    const filter = await makeProduct("Filtro de aceite")
    const guante = await makeProduct("Guante", "unidad", { isSparePart: false })
    await ingress(filter, 10)
    const note = await createNote(IDS.mecBio, OT.a)
    const itemId = note.itemIds[0]!
    const jefe = await viewerOf(IDS.jefe)

    expect(await resolver.resolveNoteItemFromStock(jefe, { itemId, productId: guante, quantity: 1 })).toMatchObject({ ok: false, field: "productId" })
    expect(await resolver.resolveNoteItemFromStock(jefe, { itemId, productId: filter, quantity: 0 })).toMatchObject({ ok: false, field: "quantity" })
    expect(await resolver.resolveNoteItemFromStock(jefe, { itemId, productId: filter, quantity: 3 })).toMatchObject({ ok: false, field: "quantity", message: expect.stringContaining("pide 2") })
    expect(await resolver.resolveNoteItemFromStock(jefe, { itemId, productId: filter, quantity: 1.5 })).toMatchObject({ ok: false, field: "quantity" })
    expect(await resolver.resolveNoteItemFromStock(await viewerOf(IDS.mecBio), { itemId, productId: filter, quantity: 1 })).toMatchObject({ ok: false, message: "No tienes permiso para resolver notas de pedido." })
    const choNote = await createNote(IDS.mecCho, OT.cho)
    expect(await resolver.resolveNoteItemFromStock(await viewerOf(IDS.supBio), { itemId: choNote.itemIds[0]!, productId: filter, quantity: 1 }))
      .toMatchObject({ ok: false, message: "Esta nota de pedido es de una faena que no es de tu alcance." })
    expect(await resolver.resolveNoteItemFromStock(jefe, { itemId: "no-existe", productId: filter, quantity: 1 })).toMatchObject({ ok: false })
    expect((await itemRow(itemId)).resolution).toBe("pendiente")

    // La OT se cierra después de pedir: ya no se reserva para ella.
    await testDb.update(schema.mantWorkOrders).set({
      status: "cerrada", workshopExitAt: "2026-11-04T08:00:00Z", finishedAt: "2026-11-04T08:00:00Z", finishedByUserId: IDS.mecBio,
      receivedAt: "2026-11-04T09:00:00Z", receiverName: "Pedro Soto", receivedByUserId: IDS.jefe, receivedRecordedAt: "2026-11-04T09:00:00Z",
      faenaReceivedAt: "2026-11-05T09:00:00Z", faenaReceiverName: "Admin Contrato", faenaReceivedByUserId: IDS.jefe, closedAt: "2026-11-05T09:00:00Z",
    }).where(eq(schema.mantWorkOrders.id, OT.a))
    const afterClose = await resolver.resolveNoteItemFromStock(jefe, { itemId, productId: filter, quantity: 1 })
    expect(afterClose).toMatchObject({ ok: false, message: expect.stringContaining("OT-L3-a") })
    expect((await itemRow(itemId)).resolution).toBe("pendiente")
    expect(await testDb.select().from(schema.mantPartsAllocations).where(eq(schema.mantPartsAllocations.workOrderId, OT.a))).toHaveLength(0)
    // Se deja la OT como estaba para las demás pruebas.
    await testDb.update(schema.mantWorkOrders).set({
      status: "en_ejecucion", workshopExitAt: null, finishedAt: null, finishedByUserId: null, receivedAt: null, receiverName: null, receivedByUserId: null,
      receivedRecordedAt: null, faenaReceivedAt: null, faenaReceiverName: null, faenaReceivedByUserId: null, closedAt: null,
    }).where(eq(schema.mantWorkOrders.id, OT.a))
  })
})

describe("rechazar y anular", () => {
  it("rechazar exige un motivo; deja la línea rechazada con su evento, el estado y un aviso al autor", async () => {
    const note = await createNote(IDS.mecBio, OT.a)
    const jefe = await viewerOf(IDS.jefe)
    const short = await resolver.rejectNoteItem(jefe, { itemId: note.itemIds[0]!, reason: "no" })
    expect(short).toMatchObject({ ok: false, field: "reason" })
    expect((await itemRow(note.itemIds[0]!)).resolution).toBe("pendiente")

    expect((await resolver.rejectNoteItem(jefe, { itemId: note.itemIds[0]!, reason: "Ya hay uno en bodega de oficina" })).ok).toBe(true)
    expect(await itemRow(note.itemIds[0]!)).toMatchObject({ resolution: "rechazada", resolutionReason: "Ya hay uno en bodega de oficina", resolvedByUserId: IDS.jefe })
    expect((await noteRow(note.noteId)).status).toBe("en_gestion")
    const [event] = await eventsOf(OT.a, "parts_note_resolved")
    expect(event).toMatchObject({ actorUserId: IDS.jefe, reason: "Ya hay uno en bodega de oficina" })
    await vi.waitFor(async () => expect((await notificationsOf("mant_np_rejected")).map((row) => row.userId)).toEqual([IDS.mecBio]))
    const [notice] = await notificationsOf("mant_np_rejected")
    expect(notice?.body).toBe("Filtro de aceite · Rechazado: Ya hay uno en bodega de oficina")

    // Una línea ya resuelta no se rechaza otra vez.
    expect(await resolver.rejectNoteItem(jefe, { itemId: note.itemIds[0]!, reason: "Otra vez, por favor" })).toMatchObject({ ok: false })
    expect((await resolver.rejectNoteItem(jefe, { itemId: note.itemIds[1]!, reason: "Tampoco se necesita" })).ok).toBe(true)
    expect((await noteRow(note.noteId)).status).toBe("rechazada")
    expect(await resolver.rejectNoteItem(await viewerOf(IDS.mecBio), { itemId: note.itemIds[0]!, reason: "Intento de un mecánico" })).toMatchObject({ ok: false })
  })

  it("una línea con una compra en curso no se resuelve ni se rechaza; si todas sus compras murieron, vuelve a poder gestionarse", async () => {
    const filter = await makeProduct("Filtro de aceite")
    await ingress(filter, 5)
    const note = await createNote(IDS.mecBio, OT.a)
    const jefe = await viewerOf(IDS.jefe)
    const [live, dead] = note.itemIds
    await markInPurchase(live!)
    await markInPurchase(dead!)
    await insertPurchase({ noteItemId: live!, workOrderId: OT.a, itemStatus: "in_purchase_order" })
    await insertPurchase({ noteItemId: dead!, workOrderId: OT.a, itemStatus: "rejected" })

    expect(await resolver.rejectNoteItem(jefe, { itemId: live!, reason: "Ya no se necesita" })).toMatchObject({ ok: false, message: expect.stringContaining("compra") })
    expect(await resolver.resolveNoteItemFromStock(jefe, { itemId: live!, productId: filter, quantity: 1 })).toMatchObject({ ok: false })
    expect((await itemRow(live!)).resolution).toBe("en_compra")

    expect((await resolver.resolveNoteItemFromStock(jefe, { itemId: dead!, productId: filter, quantity: 2 })).ok).toBe(true)
    expect((await itemRow(dead!)).resolution).toBe("desde_stock")
  })

  it("anular la NP: sólo sin líneas desde stock ni en compra viva, con motivo; después nada se resuelve", async () => {
    const filter = await makeProduct("Filtro de aceite")
    await ingress(filter, 5)
    const jefe = await viewerOf(IDS.jefe)

    const withStock = await createNote(IDS.mecBio, OT.a)
    await resolver.resolveNoteItemFromStock(jefe, { itemId: withStock.itemIds[0]!, productId: filter, quantity: 1 })
    expect(await resolver.voidPartsNote(jefe, { noteId: withStock.noteId, reason: "Se pidió por error" })).toMatchObject({ ok: false, message: expect.stringContaining("stock") })

    const withPurchase = await createNote(IDS.mecBio, OT.a)
    await markInPurchase(withPurchase.itemIds[0]!)
    await insertPurchase({ noteItemId: withPurchase.itemIds[0]!, workOrderId: OT.a, itemStatus: "approved" })
    expect(await resolver.voidPartsNote(jefe, { noteId: withPurchase.noteId, reason: "Se pidió por error" })).toMatchObject({ ok: false, message: expect.stringContaining("compra") })
    expect((await noteRow(withPurchase.noteId)).status).not.toBe("anulada")

    const plain = await createNote(IDS.mecBio, OT.a)
    await resolver.rejectNoteItem(jefe, { itemId: plain.itemIds[1]!, reason: "No corresponde al equipo" })
    expect(await resolver.voidPartsNote(jefe, { noteId: plain.noteId, reason: "no" })).toMatchObject({ ok: false, field: "reason" })
    expect(await resolver.voidPartsNote(await viewerOf(IDS.mecBio), { noteId: plain.noteId, reason: "Intento de un mecánico" })).toMatchObject({ ok: false })
    expect((await resolver.voidPartsNote(jefe, { noteId: plain.noteId, reason: "Se pidió por error" })).ok).toBe(true)
    expect(await noteRow(plain.noteId)).toMatchObject({ status: "anulada", voidedByUserId: IDS.jefe, voidReason: "Se pidió por error" })
    expect((await noteRow(plain.noteId)).voidedAt).toBeTruthy()

    // Ya anulada: ni se resuelve, ni se rechaza, ni se anula de nuevo; y su estado no se recalcula.
    expect(await resolver.resolveNoteItemFromStock(jefe, { itemId: plain.itemIds[0]!, productId: filter, quantity: 1 })).toMatchObject({ ok: false })
    expect(await resolver.rejectNoteItem(jefe, { itemId: plain.itemIds[0]!, reason: "Después de anular" })).toMatchObject({ ok: false })
    expect(await resolver.voidPartsNote(jefe, { noteId: plain.noteId, reason: "Se pidió por error" })).toMatchObject({ ok: false })
    expect((await noteRow(plain.noteId)).status).toBe("anulada")
  })

  it("la solicitud de repuestos deja las líneas «en compra» dentro de su transacción; el estado de la NP sigue a las líneas", async () => {
    const note = await createNote(IDS.mecBio, OT.a)
    const [first, second] = note.itemIds
    const p1 = await insertPurchase({ noteItemId: first!, workOrderId: OT.a, itemStatus: "draft", requestStatus: "draft" })
    const p2 = await insertPurchase({ noteItemId: second!, workOrderId: OT.a, itemStatus: "draft", requestStatus: "draft" })

    await testDb.transaction((tx) => resolver.linkNoteItemsToRequestTx(tx as unknown as Tx, {
      links: [{ noteItemId: first!, requestItemId: p1.itemId }], actorUserId: IDS.jefe,
    }))
    expect(await itemRow(first!)).toMatchObject({ resolution: "en_compra", resolvedByUserId: IDS.jefe })
    expect((await itemRow(first!)).resolvedAt).toBeTruthy()
    expect((await noteRow(note.noteId)).status).toBe("en_gestion")
    const [event] = await eventsOf(OT.a, "parts_note_resolved")
    expect(event?.changeSet).toMatchObject({ itemId: first, resolution: "en_compra", requestItemId: p1.itemId })

    // Guardar otra vez el mismo borrador no cambia nada ni falla.
    await testDb.transaction((tx) => resolver.linkNoteItemsToRequestTx(tx as unknown as Tx, {
      links: [{ noteItemId: first!, requestItemId: p1.itemId }, { noteItemId: second!, requestItemId: p2.itemId }], actorUserId: IDS.jefe,
    }))
    expect((await itemRow(second!)).resolution).toBe("en_compra")
    // Todas en compra y nada llegó: la NP sigue en gestión hasta que lo comprado llegue a la faena (NP4-2).
    expect((await noteRow(note.noteId)).status).toBe("en_compra")
    expect(await eventsOf(OT.a, "parts_note_resolved")).toHaveLength(2)

    // Una línea ya rechazada no se puede comprar: la solicitud entera se revierte.
    const other = await createNote(IDS.mecBio, OT.a)
    await resolver.rejectNoteItem(await viewerOf(IDS.jefe), { itemId: other.itemIds[0]!, reason: "No corresponde al equipo" })
    const p3 = await insertPurchase({ noteItemId: other.itemIds[0]!, workOrderId: OT.a, itemStatus: "draft", requestStatus: "draft" })
    await expect(testDb.transaction((tx) => resolver.linkNoteItemsToRequestTx(tx as unknown as Tx, {
      links: [{ noteItemId: other.itemIds[0]!, requestItemId: p3.itemId }], actorUserId: IDS.jefe,
    }))).rejects.toThrow(/rechaz/i)
    expect((await itemRow(other.itemIds[0]!)).resolution).toBe("rechazada")
  })
})

describe("enlazar y desenlazar con la solicitud de repuestos", () => {
  it("enlazar es idempotente: una línea que ya está en compra no falla ni repite el evento", async () => {
    const note = await createNote(IDS.mecBio, OT.a)
    const [first] = note.itemIds as [string, string]
    const p1 = await insertPurchase({ noteItemId: first, workOrderId: OT.a, itemStatus: "draft", requestStatus: "draft" })
    const link = (requestItemId: string) => testDb.transaction((tx) => resolver.linkNoteItemsToRequestTx(tx as unknown as Tx, {
      links: [{ noteItemId: first, requestItemId }], actorUserId: IDS.jefe,
    }))
    await link(p1.itemId)
    const resolvedAt = (await itemRow(first)).resolvedAt
    // Autoguardado del borrador y una segunda solicitud que compra el saldo: la línea sigue igual.
    await link(p1.itemId)
    const p2 = await insertPurchase({ noteItemId: first, workOrderId: OT.a, itemStatus: "draft", requestStatus: "draft" })
    await link(p2.itemId)
    expect(await eventsOf(OT.a, "parts_note_resolved")).toHaveLength(1)
    expect(await itemRow(first)).toMatchObject({ resolution: "en_compra", resolvedByUserId: IDS.jefe, resolvedAt })
  })

  it("desenlazar devuelve la línea a pendiente sólo cuando no queda ningún comprador vivo, y recalcula la NP", async () => {
    const note = await createNote(IDS.mecBio, OT.a)
    const [first, second] = note.itemIds as [string, string]
    const jefe = await viewerOf(IDS.jefe)
    const p1 = await insertPurchase({ noteItemId: first, workOrderId: OT.a, itemStatus: "draft", requestStatus: "draft" })
    const p2 = await insertPurchase({ noteItemId: first, workOrderId: OT.a, itemStatus: "draft", requestStatus: "draft" })
    const p3 = await insertPurchase({ noteItemId: second, workOrderId: OT.a, itemStatus: "draft", requestStatus: "draft" })
    const link = (links: Array<{ noteItemId: string; requestItemId: string }>) => testDb.transaction((tx) => resolver.linkNoteItemsToRequestTx(tx as unknown as Tx, { links, actorUserId: IDS.jefe }))
    const unlink = (noteItemIds: string[]) => testDb.transaction((tx) => resolver.unlinkNoteItemsFromRequestTx(tx as unknown as Tx, { noteItemIds, actorUserId: IDS.mecBio }))
    await link([{ noteItemId: first, requestItemId: p1.itemId }, { noteItemId: second, requestItemId: p3.itemId }])
    await link([{ noteItemId: first, requestItemId: p2.itemId }])
    expect((await noteRow(note.noteId)).status).toBe("en_compra")
    expect(await eventsOf(OT.a, "parts_note_resolved")).toHaveLength(2)

    // Quitan el ítem del primer comprador: el segundo aún compra la línea.
    await testDb.delete(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.id, p1.itemId))
    await unlink([first])
    expect((await itemRow(first)).resolution).toBe("en_compra")
    expect(await eventsOf(OT.a, "parts_note_resolved")).toHaveLength(2)
    expect((await noteRow(note.noteId)).status).toBe("en_compra")

    // Quitan también el segundo: la primera línea vuelve a pendiente; la segunda conserva su comprador.
    await testDb.delete(schema.purchaseRequestItems).where(eq(schema.purchaseRequestItems.id, p2.itemId))
    await unlink([first, second])
    expect(await itemRow(first)).toMatchObject({ resolution: "pendiente", resolutionReason: null, resolvedByUserId: null, resolvedAt: null })
    expect((await itemRow(second)).resolution).toBe("en_compra")
    expect((await noteRow(note.noteId)).status).toBe("en_gestion")
    const events = await eventsOf(OT.a, "parts_note_resolved")
    expect(events).toHaveLength(3)
    const returned = events.find((event) => (event.changeSet as { resolution?: string } | null)?.resolution === "pendiente")
    expect(returned).toMatchObject({ actorUserId: IDS.mecBio, reason: expect.stringContaining("Vuelve a pendiente") })
    expect(returned?.changeSet).toMatchObject({ itemId: first, previousResolution: "en_compra", returned: "vuelve a pendiente" })

    // Repetirlo no cambia nada.
    await unlink([first, second])
    expect(await eventsOf(OT.a, "parts_note_resolved")).toHaveLength(3)

    // Cancelar la solicitud entera (el ítem queda vivo en su fila) también la suelta.
    await testDb.update(schema.purchaseRequests).set({ status: "cancelled" }).where(eq(schema.purchaseRequests.id, p3.requestId))
    await unlink([second])
    expect((await itemRow(second)).resolution).toBe("pendiente")
    expect((await noteRow(note.noteId)).status).toBe("enviada")

    // Lo que jefatura rechazó (o apartó del stock) no vuelve a pendiente.
    await resolver.rejectNoteItem(jefe, { itemId: second, reason: "No corresponde al equipo" })
    await unlink([second])
    expect((await itemRow(second)).resolution).toBe("rechazada")
    await unlink([])
  })
})

// ── Lecturas ─────────────────────────────────────────────────────────────────

describe("bandeja de notas de pedido", () => {
  async function seedTray() {
    const jefe = await viewerOf(IDS.jefe)
    const bio = await createNote(IDS.mecBio, OT.a)
    const cho = await createNote(IDS.mecCho, OT.cho, {
      equipmentStopped: false,
      lines: [{ description: "Bomba hidráulica especial", quantity: 1, unitOfMeasure: "unidad", partNumber: null, productId: null }],
    })
    const machine = await createNote(IDS.mecBio, OT.asig)
    await resolver.rejectNoteItem(jefe, { itemId: bio.itemIds[0]!, reason: "No corresponde al equipo" })
    await resolver.rejectNoteItem(jefe, { itemId: bio.itemIds[1]!, reason: "Tampoco corresponde" })
    await resolver.rejectNoteItem(jefe, { itemId: machine.itemIds[0]!, reason: "Ya hay uno en la bodega" })
    return { bio, cho, machine }
  }

  it("separa las pestañas por lo que falta resolver, cuenta cada una y filtra por faena y búsqueda", async () => {
    const { bio, cho, machine } = await seedTray()
    const jefe = await viewerOf(IDS.jefe)
    const base = { page: 1, pageSize: 25 }
    // «Pendientes» = nota abierta con al menos una línea pendiente, aunque tenga otras resueltas (NP4-2): la de Cholguán (1 de 1)
    // y la de la máquina (1 de 2 pendiente, la otra rechazada), con el equipo detenido primero.
    const pendientes = await query.listPartsNotes(jefe, { tab: "pendientes", ...base })
    expect(pendientes.counts).toEqual({ pendientes: 2, en_gestion: 0, cerradas: 1 })
    expect(pendientes.rows.map((row) => row.id)).toEqual([machine.noteId, cho.noteId])
    expect(pendientes.rows[1]).toMatchObject({
      code: cho.code, status: "enviada", workOrderId: OT.cho, workOrderFolio: "OT-L3-cho", equipmentCode: "KA-200", equipmentPlate: "BCDF-12",
      worksiteId: IDS.wsCho, worksiteName: "Cholguán", requestedByName: "Pedro Cholguán", equipmentStopped: false, pendingLines: 1, totalLines: 1,
    })
    expect(pendientes.rows[0]).toMatchObject({ code: machine.code, status: "en_gestion", equipmentStopped: true, pendingLines: 1, totalLines: 2 })
    // «En gestión» es lo que no tiene nada pendiente y espera una compra: hoy no hay ninguna.
    expect((await query.listPartsNotes(jefe, { tab: "en_gestion", ...base })).rows).toEqual([])
    const cerradas = await query.listPartsNotes(jefe, { tab: "cerradas", ...base })
    expect(cerradas.rows.map((row) => row.id)).toEqual([bio.noteId])
    expect(cerradas.total).toBe(1)

    expect((await query.listPartsNotes(jefe, { tab: "pendientes", worksiteId: IDS.wsBio, ...base })).rows.map((row) => row.id)).toEqual([machine.noteId])
    for (const [q, tab, noteId] of [
      [cho.code, "pendientes", cho.noteId], ["OT-L3-cho", "pendientes", cho.noteId], ["KA-200", "pendientes", cho.noteId], ["bcdf", "pendientes", cho.noteId],
      ["bomba hidr", "pendientes", cho.noteId], ["OT-L3-asig", "pendientes", machine.noteId], ["mq-01", "pendientes", machine.noteId],
    ] as const) {
      expect((await query.listPartsNotes(jefe, { tab, q, ...base })).rows.map((row) => row.id), q).toEqual([noteId])
    }
    expect((await query.listPartsNotes(jefe, { tab: "pendientes", q: "100%_no", ...base })).rows).toHaveLength(0)
    await createNote(IDS.mecCho, OT.cho)
    await createNote(IDS.mecCho, OT.cho)
    const paged = await query.listPartsNotes(jefe, { tab: "pendientes", q: "NP-", page: 2, pageSize: 2 })
    expect(paged).toMatchObject({ total: 4, counts: { pendientes: 4 } })
    expect(paged.rows).toHaveLength(2)
  })

  it("el alcance lo pone el servidor: supervisión ve sólo su faena, sin permiso no ve nada", async () => {
    const { bio, cho, machine } = await seedTray()
    const supervisor = await viewerOf(IDS.supBio)
    const mine = await query.listPartsNotes(supervisor, { tab: "pendientes", page: 1, pageSize: 25 })
    expect(mine.counts).toEqual({ pendientes: 1, en_gestion: 0, cerradas: 1 })
    expect(mine.rows.map((row) => row.id)).toEqual([machine.noteId])
    // Un filtro de otra faena no amplía lo que ve.
    expect((await query.listPartsNotes(supervisor, { tab: "pendientes", worksiteId: IDS.wsCho, page: 1, pageSize: 25 })).rows).toHaveLength(0)
    expect(await query.getPartsNote(supervisor, cho.noteId)).toBeNull()
    expect((await query.getPartsNote(supervisor, machine.noteId))?.id).toBe(machine.noteId)
    expect((await query.getPartsNote(supervisor, bio.noteId))?.canManage).toBe(true)

    // El mecánico ve lo que pidió él mismo (`mant:np:view_own`, por defecto) y nada de lo de otro.
    const mechanic = await viewerOf(IDS.mecBio)
    expect((await query.listPartsNotes(mechanic, { tab: "pendientes", page: 1, pageSize: 25 })).counts).toEqual({ pendientes: 1, en_gestion: 0, cerradas: 1 })
    expect((await query.getPartsNote(mechanic, bio.noteId))?.id).toBe(bio.noteId)
    expect(await query.getPartsNote(mechanic, cho.noteId)).toBeNull()
    // Sin ningún permiso de notas, no ve nada, ni lo propio.
    const bare = await contextOf(IDS.mecBio, (permissions) => permissions.filter((permission) => !permission.startsWith("mant:np:")))
    expect((await query.listPartsNotes(bare.viewer, { tab: "pendientes", page: 1, pageSize: 25 })).counts).toEqual({ pendientes: 0, en_gestion: 0, cerradas: 0 })
    expect(await query.getPartsNote(bare.viewer, bio.noteId)).toBeNull()
    expect(await query.getPartsNote(await viewerOf(IDS.jefe), "no-existe")).toBeNull()
    // Quien sólo ve (jefatura general) no administra.
    const viewOnly = { ...(await viewerOf(IDS.jefe)), permissions: ["mant:np:view_worksite"] }
    expect((await query.getPartsNote(viewOnly, bio.noteId))?.canManage).toBe(false)
  })

  it("quien resuelve ve los repuestos con stock libre en la faena del equipo para elegir cuál sacar (lo encontró la E2E)", async () => {
    const { bio } = await seedTray()
    const gasket = await makeProduct("Empaquetadura culata QA")
    await ingress(gasket, 2)
    const jefe = await viewerOf(IDS.jefe)
    const detail = await query.getPartsNote(jefe, bio.noteId)
    expect(detail?.stockOptions).toEqual(expect.arrayContaining([expect.objectContaining({ productId: gasket, name: "Empaquetadura culata QA", free: 2 })]))
    expect(detail?.stockOptions?.every((option) => option.free > 0)).toBe(true)
    const viewOnly = { ...jefe, permissions: ["mant:np:view_worksite"] }
    expect((await query.getPartsNote(viewOnly, bio.noteId))?.stockOptions).toEqual([])
  })
})

describe("detalle de la NP: etapa, llegado, usado, compras y libre en la faena", () => {
  it("una línea desde stock con reserva y consumo reparte lo usado entre las líneas del mismo repuesto", async () => {
    const filter = await makeProduct("Filtro de aceite")
    await ingress(filter, 10)
    const jefe = await viewerOf(IDS.jefe)
    const note = await createNote(IDS.mecBio, OT.a, {
      lines: [
        { description: "Filtro de aceite (1)", quantity: 2, unitOfMeasure: "unidad", partNumber: null, productId: null },
        { description: "Filtro de aceite (2)", quantity: 2, unitOfMeasure: "unidad", partNumber: null, productId: null },
        { description: "Pintura", quantity: 1, unitOfMeasure: "unidad", partNumber: null, productId: null },
      ],
    })
    for (const itemId of note.itemIds.slice(0, 2)) expect((await resolver.resolveNoteItemFromStock(jefe, { itemId, productId: filter, quantity: 2 })).ok).toBe(true)
    const [allocation] = await testDb.select().from(schema.mantPartsAllocations).where(eq(schema.mantPartsAllocations.workOrderId, OT.a))
    expect(Number(allocation?.quantity)).toBe(4)
    await consume(OT.a, await insertRecord(OT.a, IDS.truckBio), filter, 3, allocation!.id)

    const detail = (await query.getPartsNote(jefe, note.noteId))!
    expect(detail).toMatchObject({ code: note.code, status: "en_gestion", canManage: true, notes: "Se cortó en faena", voidReason: null, equipmentCode: "KA-135", requestedByName: "Javier Roa" })
    expect(detail.lines.map((line) => [line.description, line.resolution, line.stage, line.arrived, line.used])).toEqual([
      ["Filtro de aceite (1)", "desde_stock", "en_bodega", 2, 2],
      ["Filtro de aceite (2)", "desde_stock", "en_bodega", 2, 1],
      ["Pintura", "pendiente", "pedido", 0, 0],
    ])
    expect(detail.lines[0]).toMatchObject({ productId: filter, productName: "Filtro de aceite", resolvedByName: "Alexis Morales", purchases: [] })
    // Libre = stock (10 − 3 usados = 7) − lo que aún está reservado (4 − 3 = 1).
    expect(detail.lines[0]?.freeInWorksite).toBe(6)
    expect(detail.lines[2]?.freeInWorksite).toBeNull()
  })

  it("una línea en compra muestra su solicitud y su OC; llegó a bodega si hay reserva; vuelve a «pedido» si todas sus compras murieron", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const note = await createNote(IDS.mecBio, OT.a, {
      lines: ["uno", "dos", "tres", "cuatro"].map((name) => ({ description: `Repuesto ${name}`, quantity: 2, unitOfMeasure: "unidad", partNumber: null, productId: null })),
    })
    const [inBuy, rejected, cancelled, arrivedLine] = note.itemIds as [string, string, string, string]
    // Como en la solicitud real: el ítem que compra la línea existe antes de que la línea pase a «en compra».
    const live = await insertPurchase({ noteItemId: inBuy, workOrderId: OT.a, itemStatus: "in_purchase_order", withOrder: true })
    await insertPurchase({ noteItemId: rejected, workOrderId: OT.a, itemStatus: "rejected" })
    await insertPurchase({ noteItemId: cancelled, workOrderId: OT.a, itemStatus: "approved", requestStatus: "cancelled" })
    await insertPurchase({ noteItemId: arrivedLine, workOrderId: OT.a, itemStatus: "delivered" })
    for (const itemId of note.itemIds) await markInPurchase(itemId)
    const bolt = await makeProduct("Perno")
    await ingress(bolt, 5)
    await reserve(OT.a, bolt, 2, arrivedLine)

    const detail = (await query.getPartsNote(jefe, note.noteId))!
    expect(detail.lines.map((line) => [line.stage, line.arrived, line.used])).toEqual([["en_compra", 0, 0], ["pedido", 0, 0], ["pedido", 0, 0], ["en_bodega", 2, 0]])
    expect(detail.lines[0]?.purchases).toEqual([{
      requestItemId: live.itemId, requestId: live.requestId, requestCode: live.requestCode, status: "in_purchase_order", orderId: expect.any(String), orderCode: live.orderCode,
    }])
    expect(detail.lines[3]).toMatchObject({ productId: bolt, productName: "Perno", freeInWorksite: 3 })
    // Ninguna línea está pendiente y una ya llegó a la faena mientras la primera espera su compra: la NP está recibida parcial
    // (pestaña «En gestión», no «Cerradas») y ninguna cuenta como pendiente.
    const row = (await query.listPartsNotes(jefe, { tab: "en_gestion", page: 1, pageSize: 25 })).rows.find((item) => item.id === note.noteId)
    expect(row).toMatchObject({ status: "recibida_parcial", pendingLines: 0, totalLines: 4 })
    expect((await query.listPartsNotes(jefe, { tab: "pendientes", page: 1, pageSize: 25 })).rows.map((item) => item.id)).not.toContain(note.noteId)
    expect((await query.listPartsNotes(jefe, { tab: "cerradas", page: 1, pageSize: 25 })).rows.map((item) => item.id)).not.toContain(note.noteId)
  })
})

describe("prellenado de la solicitud de repuestos", () => {
  it("urgencia crítica con el equipo detenido; sólo las líneas por resolver; exige administrar y alcance", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const stopped = await createNote(IDS.mecBio, OT.a, {
      lines: [
        { description: "Filtro de aceite", quantity: 2, unitOfMeasure: "unidad", partNumber: "FA-1", productId: null },
        { description: "Aceite hidráulico", quantity: 20, unitOfMeasure: "litro", partNumber: null, productId: null },
        { description: "Manguera", quantity: 1, unitOfMeasure: "unidad", partNumber: null, productId: null },
        { description: "Perno", quantity: 8, unitOfMeasure: "unidad", partNumber: null, productId: null },
      ],
    })
    const [pending, rejected, liveBuy, deadBuy] = stopped.itemIds as [string, string, string, string]
    await resolver.rejectNoteItem(jefe, { itemId: rejected, reason: "No corresponde al equipo" })
    await markInPurchase(liveBuy)
    await markInPurchase(deadBuy)
    await insertPurchase({ noteItemId: liveBuy, workOrderId: OT.a, itemStatus: "approved" })
    await insertPurchase({ noteItemId: deadBuy, workOrderId: OT.a, itemStatus: "rejected" })

    const prefill = await query.loadPartsNotePrefill(jefe, stopped.noteId)
    expect(prefill).toMatchObject({
      noteId: stopped.noteId, noteCode: stopped.code, worksiteId: IDS.wsBio, vehicleId: IDS.truckBio, vehicleLabel: "KA-135 · RBYD-98",
      workOrderId: OT.a, workOrderFolio: "OT-L3-a", urgency: "critical",
    })
    expect(prefill?.items).toEqual([
      { partsNoteItemId: pending, productId: null, description: "Filtro de aceite", quantity: 2, unitOfMeasure: "unidad", partNumber: "FA-1", chargeVehicleId: null, chargeVehicleLabel: null },
      { partsNoteItemId: deadBuy, productId: null, description: "Perno", quantity: 8, unitOfMeasure: "unidad", partNumber: null, chargeVehicleId: null, chargeVehicleLabel: null },
    ])

    const calm = await createNote(IDS.mecBio, OT.asig, { equipmentStopped: false })
    expect((await query.loadPartsNotePrefill(jefe, calm.noteId))?.urgency).toBe("high")
    expect((await query.loadPartsNotePrefill(jefe, calm.noteId))?.vehicleLabel).toBe("MQ-01")
    expect(await query.loadPartsNotePrefill(await viewerOf(IDS.mecBio), calm.noteId)).toBeNull()
    expect(await query.loadPartsNotePrefill(await viewerOf(IDS.supBio), (await createNote(IDS.mecCho, OT.cho)).noteId)).toBeNull()
    expect(await query.loadPartsNotePrefill(jefe, "no-existe")).toBeNull()

    for (const itemId of calm.itemIds) await resolver.rejectNoteItem(jefe, { itemId, reason: "No corresponde al equipo" })
    expect(await query.loadPartsNotePrefill(jefe, calm.noteId)).toBeNull()
  })
})

describe("sección «Repuestos» de la OT", () => {
  it("trae las NP, lo disponible para la OT y lo consumido; una OT fuera del alcance viene vacía", async () => {
    const filter = await makeProduct("Filtro de aceite")
    await ingress(filter, 6)
    const jefe = await viewerOf(IDS.jefe)
    const note = await createNote(IDS.mecBio, OT.a)
    await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[0]!, productId: filter, quantity: 2 })
    const [allocation] = await testDb.select().from(schema.mantPartsAllocations).where(eq(schema.mantPartsAllocations.workOrderId, OT.a))
    const recordId = await insertRecord(OT.a, IDS.truckBio)
    await consume(OT.a, recordId, filter, 1, allocation!.id)

    const overview = await query.loadWorkOrderPartsOverview(jefe, OT.a)
    expect(overview.notes).toHaveLength(1)
    expect(overview.notes[0]).toMatchObject({ id: note.noteId, code: note.code, status: "en_gestion", equipmentStopped: true })
    expect(overview.notes[0]?.lines.map((line) => [line.description, line.stage, line.arrived, line.used, line.rejectionReason])).toEqual([
      ["Filtro de aceite", "en_bodega", 2, 1, null], ["Aceite hidráulico", "pedido", 0, 0, null],
    ])
    expect(overview.available).toHaveLength(1)
    expect(overview.available[0]).toMatchObject({ workOrderId: OT.a, productId: filter, name: "Filtro de aceite", remaining: 1, allocationId: allocation!.id })
    expect(overview.consumptions).toEqual([expect.objectContaining({
      recordId, recordFolio: expect.stringMatching(/^C-L3-/), productId: filter, quantity: 1, source: "stock", stockStatus: "descontado", stockNote: null,
    })])

    const outside = await query.loadWorkOrderPartsOverview(await viewerOf(IDS.mecBio2), OT.cho)
    expect(outside).toEqual({ notes: [], available: [], consumptions: [] })
    const scoped = await query.loadWorkOrderPartsOverview(await viewerOf(IDS.supBio), OT.a)
    expect(scoped.notes).toHaveLength(1)
  })
})

// ── Catálogo del teléfono ────────────────────────────────────────────────────

describe("catálogo del teléfono con NP y reservas por OT", () => {
  async function fetchCatalog(userId: string): Promise<MantCatalog> {
    const response = await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", await tokenOf(userId)))
    expect(response.status).toBe(200)
    return (await response.json()) as MantCatalog
  }

  it("el formato del catálogo es al menos 7 (mis notas, centros de costo y permiso de pedir sin OT; el 8 suma los repuestos)", () => {
    expect(CATALOG_FORMAT).toBeGreaterThanOrEqual(7)
  })

  it("cada OT trae sus NP no anuladas y lo disponible; sólo las del mecánico", async () => {
    const filter = await makeProduct("Filtro de aceite")
    await ingress(filter, 4)
    const jefe = await viewerOf(IDS.jefe)
    const mine = await createNote(IDS.mecBio, OT.a)
    const voided = await createNote(IDS.mecBio, OT.a)
    await resolver.voidPartsNote(jefe, { noteId: voided.noteId, reason: "Se pidió por error" })
    await createNote(IDS.mecBio2, OT.other)
    await resolver.rejectNoteItem(jefe, { itemId: mine.itemIds[1]!, reason: "No corresponde al equipo" })
    await resolver.resolveNoteItemFromStock(jefe, { itemId: mine.itemIds[0]!, productId: filter, quantity: 2 })

    const catalog = await fetchCatalog(IDS.mecBio)
    const ot = catalog.workOrders?.find((order) => order.id === OT.a)
    expect(ot).toBeDefined()
    expect(ot?.partsNotes).toHaveLength(1)
    expect(ot?.partsNotes?.[0]).toMatchObject({ id: mine.noteId, code: mine.code, status: "cerrada", equipmentStopped: true })
    expect(ot?.partsNotes?.[0]?.lines).toEqual([
      expect.objectContaining({ id: mine.itemIds[0], stage: "en_bodega", arrived: 2, used: 0, rejectionReason: null }),
      expect.objectContaining({ id: mine.itemIds[1], stage: "rechazado", arrived: 0, rejectionReason: "No corresponde al equipo" }),
    ])
    expect(ot?.partsAvailable).toEqual([expect.objectContaining({ productId: filter, name: "Filtro de aceite", remaining: 2, wholeOnly: true, worksiteId: IDS.wsBio, worksiteName: "Biodiversa" })])
    expect(ot?.partsAvailable?.[0]).not.toHaveProperty("workOrderId")
    expect(catalog.workOrders?.map((order) => order.id)).not.toContain(OT.other)

    const other = await fetchCatalog(IDS.mecBio2)
    expect(other.workOrders?.map((order) => order.id)).toContain(OT.other)
    expect(other.workOrders?.find((order) => order.id === OT.other)?.partsNotes).toHaveLength(1)
    expect(other.workOrders?.find((order) => order.id === OT.other)?.partsAvailable).toEqual([])
    expect(other.workOrders?.some((order) => order.id === OT.a)).toBe(false)
  })

  it("el ETag cambia al crear una nota y al crear una reserva", async () => {
    const viewer = await viewerOf(IDS.mecBio)
    const before = await catalogVersion(viewer, "mias")
    expect(await catalogVersion(viewer, "mias")).toBe(before)
    const note = await createNote(IDS.mecBio, OT.a)
    const afterNote = await catalogVersion(viewer, "mias")
    expect(afterNote).not.toBe(before)
    const filter = await makeProduct("Filtro de aceite")
    await ingress(filter, 3)
    const beforeReserve = await catalogVersion(viewer, "mias")
    await reserve(OT.a, filter, 1, note.itemIds[0])
    expect(await catalogVersion(viewer, "mias")).not.toBe(beforeReserve)
    // Resolver una línea (rechazo) también se nota en el teléfono.
    const beforeReject = await catalogVersion(viewer, "mias")
    await resolver.rejectNoteItem(await viewerOf(IDS.jefe), { itemId: note.itemIds[1]!, reason: "No corresponde al equipo" })
    expect(await catalogVersion(viewer, "mias")).not.toBe(beforeReject)
  })
})

// ── Al terminar la OT (NP4-7) ────────────────────────────────────────────────

describe("cerrar o anular la OT rechaza las líneas de nota que nadie resolvió", () => {
  const CLOSED_REASON = "La orden de trabajo se cerró antes de resolver esta línea."

  async function actorOf(userId: string) {
    const rbac = (await getUserRbacById(userId, true))!
    return { userId: rbac.id, name: rbac.name, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal }
  }
  const void_ = async (workOrderId: string, reason: string) => transitions.voidWorkOrder(await actorOf(IDS.jefe), { workOrderId, reason })
  /** La OT sale de taller y se recibe el equipo: queda esperando la conformidad de la faena (los `check` de la tabla piden todo esto). */
  const receive = (workOrderId: string) => testDb.update(schema.mantWorkOrders).set({
    status: "recepcionada",
    workshopExitAt: "2026-11-04T08:00:00Z", finishedAt: "2026-11-04T08:00:00Z", finishedByUserId: IDS.mecBio,
    receivedAt: "2026-11-04T09:00:00Z", receiverName: "Pedro Soto", receivedByUserId: IDS.jefe, receivedRecordedAt: "2026-11-04T09:00:00Z",
  }).where(eq(schema.mantWorkOrders.id, workOrderId))
  const conform = async (workOrderId: string) => transitions.conformWorkOrder(await actorOf(IDS.adminBio), {
    workOrderId, faenaReceivedAt: new Date().toISOString(), faenaReceiverName: "Ana Faena",
  })
  /** Todo lo que la prueba compara de una nota: ella y sus líneas, tal como están en la base. */
  const snapshotOf = async (note: Created) => ({ note: await noteRow(note.noteId), lines: await Promise.all(note.itemIds.map(itemRow)) })
  const auditsOf = async (noteId: string) => (await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, noteId))).filter((row) => row.action === "update")
  async function fetchCatalog(userId: string): Promise<MantCatalog> {
    const response = await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", await tokenOf(userId)))
    expect(response.status).toBe(200)
    return (await response.json()) as MantCatalog
  }

  it("anular una OT con una nota «enviada»: la nota queda rechazada (todas sus líneas) con el motivo, con rastro y sin aviso al mecánico", async () => {
    const note = await createNote(IDS.mecBio, OT.endVoid1)
    expect((await noteRow(note.noteId)).status).toBe("enviada")
    const motive = "Se pidió el equipo equivocado"

    expect(await void_(OT.endVoid1, motive)).toMatchObject({ ok: true, value: { status: "anulada" } })

    const reason = `La orden de trabajo se anuló: ${motive}`
    expect((await noteRow(note.noteId)).status).toBe("rechazada")
    for (const itemId of note.itemIds) {
      const line = await itemRow(itemId)
      expect(line).toMatchObject({ resolution: "rechazada", resolutionReason: reason, resolvedByUserId: IDS.jefe })
      expect(line.resolvedAt).toBeTruthy()
    }
    // El rastro es el de un rechazo de jefatura (evento en la OT + auditoría de la NP), una vez por línea, marcado como automático.
    const events = await eventsOf(OT.endVoid1, "parts_note_resolved")
    expect(events).toHaveLength(2)
    for (const event of events) {
      expect(event).toMatchObject({ actorUserId: IDS.jefe, reason })
      expect(event.changeSet).toMatchObject({ noteId: note.noteId, code: note.code, resolution: "rechazada", reason, automatic: true, cause: "ot_anulada" })
    }
    expect(events.map((event) => (event.changeSet as { itemId: string }).itemId).sort()).toEqual([...note.itemIds].sort())
    const audits = await auditsOf(note.noteId)
    expect(audits).toHaveLength(2)
    for (const audit of audits) {
      expect(audit).toMatchObject({ entityType: "mant_parts_note", entityCode: note.code, userId: IDS.jefe, reason, worksiteId: IDS.wsBio })
      expect(JSON.parse(audit.oldState as string)).toMatchObject({ resolution: "pendiente" })
      expect(JSON.parse(audit.newState as string)).toMatchObject({ resolution: "rechazada", automatic: true, cause: "ot_anulada" })
    }

    // Sale de «Pendientes» y de «En gestión»; el aviso de la anulación le llega al mecánico y los rechazos automáticos no suman otro.
    const jefe = await viewerOf(IDS.jefe)
    const tray = await query.listPartsNotes(jefe, { tab: "pendientes", page: 1, pageSize: 25 })
    expect(tray.rows).toHaveLength(0)
    expect(tray.counts).toEqual({ pendientes: 0, en_gestion: 0, cerradas: 1 })
    await vi.waitFor(async () => expect((await notificationsOf("mant_ot_voided")).map((row) => row.userId)).toEqual([IDS.mecBio]))
    expect(await notificationsOf("mant_np_rejected")).toHaveLength(0)

    // Lo que la línea ya no puede hacer: resolverse otra vez, a mano.
    expect(await resolver.rejectNoteItem(jefe, { itemId: note.itemIds[0]!, reason: "Otra vez, por favor" })).toMatchObject({ ok: false, message: expect.stringContaining("ya está rechazada") })
    expect(await resolver.resolveNoteItemFromStock(jefe, { itemId: note.itemIds[0]!, productId: await makeProduct("Filtro de aceite"), quantity: 1 }))
      .toMatchObject({ ok: false, message: expect.stringContaining("ya está rechazada") })
  })

  it("repetir no duplica: anular otra vez la OT se rechaza y el paso que rechaza las líneas no escribe nada si no queda ninguna pendiente", async () => {
    const note = await createNote(IDS.mecBio, OT.endVoid2)
    expect(await void_(OT.endVoid2, "Ya no hace falta la OT")).toMatchObject({ ok: true })
    const after = { events: await eventsOf(OT.endVoid2, "parts_note_resolved"), audits: await auditsOf(note.noteId), snapshot: await snapshotOf(note) }
    expect(after.events).toHaveLength(2)

    expect(await void_(OT.endVoid2, "Ya no hace falta la OT")).toMatchObject({ ok: false, code: "conflict" })
    const again = await testDb.transaction((tx) => rejectOpenLinesOfWorkOrderTx(tx as unknown as Tx, {
      workOrderId: OT.endVoid2, actor: { userId: IDS.jefe }, end: { kind: "anulada", reason: "Ya no hace falta la OT" },
    }))
    expect(again).toEqual({ notes: 0, lines: 0 })

    expect(await eventsOf(OT.endVoid2, "parts_note_resolved")).toHaveLength(after.events.length)
    expect(await auditsOf(note.noteId)).toHaveLength(after.audits.length)
    expect(await snapshotOf(note)).toEqual(after.snapshot)
  })

  it("dar conformidad a una OT con una nota «en gestión»: sólo la línea pendiente se rechaza; lo ya resuelto no se toca y el teléfono ve el motivo", async () => {
    const filter = await makeProduct("Filtro de aceite")
    await ingress(filter, 5)
    const note = await createNote(IDS.mecBio, OT.endConform1, {
      lines: ["desde stock", "en compra", "rechazada a mano", "pendiente"].map((name) => ({
        description: `Repuesto ${name}`, quantity: 1, unitOfMeasure: "unidad", partNumber: null, productId: null,
      })),
    })
    const [fromStock, inPurchase, manual, pending] = note.itemIds as [string, string, string, string]
    const jefe = await viewerOf(IDS.jefe)
    expect((await resolver.resolveNoteItemFromStock(jefe, { itemId: fromStock, productId: filter, quantity: 1 })).ok).toBe(true)
    await markInPurchase(inPurchase)
    await insertPurchase({ noteItemId: inPurchase, workOrderId: OT.endConform1, itemStatus: "approved" })
    expect((await resolver.rejectNoteItem(jefe, { itemId: manual, reason: "No corresponde al equipo" })).ok).toBe(true)
    expect((await noteRow(note.noteId)).status).toBe("en_gestion")
    const resolved = await Promise.all([fromStock, inPurchase, manual].map(itemRow))
    const eventsBefore = (await eventsOf(OT.endConform1, "parts_note_resolved")).length
    // El único rechazo que avisó fue el de jefatura a mano.
    await vi.waitFor(async () => expect(await notificationsOf("mant_np_rejected")).toHaveLength(1))

    await receive(OT.endConform1)
    expect(await conform(OT.endConform1)).toMatchObject({ ok: true, value: { status: "cerrada" } })

    expect(await itemRow(pending)).toMatchObject({ resolution: "rechazada", resolutionReason: CLOSED_REASON, resolvedByUserId: IDS.adminBio })
    expect(await Promise.all([fromStock, inPurchase, manual].map(itemRow))).toEqual(resolved)
    expect((await noteRow(note.noteId)).status).toBe("cerrada")
    const events = await eventsOf(OT.endConform1, "parts_note_resolved")
    expect(events).toHaveLength(eventsBefore + 1)
    expect(events.find((event) => (event.changeSet as { itemId?: string } | null)?.itemId === pending)).toMatchObject({
      actorUserId: IDS.adminBio, reason: CLOSED_REASON, changeSet: expect.objectContaining({ automatic: true, cause: "ot_cerrada" }),
    })
    // La reserva de lo sacado de bodega se libera como siempre; la línea sigue «desde stock».
    const [allocation] = await testDb.select().from(schema.mantPartsAllocations).where(eq(schema.mantPartsAllocations.workOrderId, OT.endConform1))
    expect(allocation).toMatchObject({ status: "liberada" })
    await vi.waitFor(async () => expect(await notificationsOf("mant_ot_closed")).toHaveLength(1))
    expect(await notificationsOf("mant_np_rejected")).toHaveLength(1)

    // El catálogo del teléfono (OT cerrada hace menos de 7 días) muestra el motivo de la línea rechazada, sin cambios.
    const order = (await fetchCatalog(IDS.mecBio)).workOrders?.find((candidate) => candidate.id === OT.endConform1)
    expect(order).toMatchObject({ status: "cerrada" })
    const lines = order?.partsNotes?.[0]?.lines ?? []
    expect(lines.find((line) => line.id === pending)).toMatchObject({ stage: "rechazado", rejectionReason: CLOSED_REASON })
    expect(lines.find((line) => line.id === manual)).toMatchObject({ stage: "rechazado", rejectionReason: "No corresponde al equipo" })
  })

  it("una nota ya cerrada o anulada no se toca: ni sus líneas, ni su estado, ni su rastro; la abierta de la misma OT sí se cierra", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const closedNote = await createNote(IDS.mecBio, OT.endVoid3)
    for (const itemId of closedNote.itemIds) expect((await resolver.rejectNoteItem(jefe, { itemId, reason: "No corresponde al equipo" })).ok).toBe(true)
    const voidedNote = await createNote(IDS.mecBio, OT.endVoid3)
    expect((await resolver.voidPartsNote(jefe, { noteId: voidedNote.noteId, reason: "Se pidió por error" })).ok).toBe(true)
    const openNote = await createNote(IDS.mecBio, OT.endVoid3, { lines: [{ description: "Bomba de agua", quantity: 1, unitOfMeasure: "unidad", partNumber: null, productId: null }] })
    expect([(await noteRow(closedNote.noteId)).status, (await noteRow(voidedNote.noteId)).status, (await noteRow(openNote.noteId)).status]).toEqual(["rechazada", "anulada", "enviada"])
    const frozen = { closed: await snapshotOf(closedNote), voided: await snapshotOf(voidedNote) }
    const eventsBefore = (await eventsOf(OT.endVoid3, "parts_note_resolved")).length

    expect(await void_(OT.endVoid3, "El equipo se dio de baja")).toMatchObject({ ok: true })

    expect(await snapshotOf(closedNote)).toEqual(frozen.closed)
    expect(await snapshotOf(voidedNote)).toEqual(frozen.voided)
    // La anulada conserva sus líneas pendientes y su estado: no era una nota abierta.
    expect(frozen.voided.note.status).toBe("anulada")
    expect(frozen.voided.lines.map((line) => line.resolution)).toEqual(["pendiente", "pendiente"])
    expect(await itemRow(openNote.itemIds[0]!)).toMatchObject({ resolution: "rechazada", resolutionReason: "La orden de trabajo se anuló: El equipo se dio de baja" })
    expect((await noteRow(openNote.noteId)).status).toBe("rechazada")
    expect(await eventsOf(OT.endVoid3, "parts_note_resolved")).toHaveLength(eventsBefore + 1)
  })

  it("una línea «en compra» cuya compra muere después de anular la OT no vuelve a «pendiente»: se rechaza sola y la nota sigue cerrada", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const note = await createNote(IDS.mecBio, OT.endVoid4)
    const [bought, other] = note.itemIds as [string, string]
    await markInPurchase(bought)
    const purchase = await insertPurchase({ noteItemId: bought, workOrderId: OT.endVoid4, itemStatus: "approved" })

    expect(await void_(OT.endVoid4, "El equipo se dio de baja")).toMatchObject({ ok: true })
    // Con la compra viva, la línea en compra queda como está; sólo la pendiente se rechaza.
    expect((await itemRow(bought)).resolution).toBe("en_compra")
    expect((await itemRow(other)).resolution).toBe("rechazada")
    expect((await noteRow(note.noteId)).status).toBe("cerrada")

    // Cancelan la solicitud que la compraba: en una OT abierta volvería a pendiente; aquí la OT ya no existe para nadie.
    await testDb.update(schema.purchaseRequests).set({ status: "cancelled" }).where(eq(schema.purchaseRequests.id, purchase.requestId))
    const unlink = () => testDb.transaction((tx) => resolver.unlinkNoteItemsFromRequestTx(tx as unknown as Tx, { noteItemIds: [bought], actorUserId: IDS.supBio }))
    await unlink()
    expect(await itemRow(bought)).toMatchObject({
      resolution: "rechazada", resolutionReason: "La orden de trabajo se anuló: El equipo se dio de baja", resolvedByUserId: IDS.supBio,
    })
    expect((await noteRow(note.noteId)).status).toBe("rechazada")
    expect((await query.listPartsNotes(jefe, { tab: "pendientes", page: 1, pageSize: 25 })).rows).toHaveLength(0)
    const events = await eventsOf(OT.endVoid4, "parts_note_resolved")
    expect(events.find((event) => (event.changeSet as { itemId?: string } | null)?.itemId === bought && (event.changeSet as { cause?: string }).cause)).toMatchObject({
      changeSet: expect.objectContaining({ automatic: true, cause: "ot_anulada", previousResolution: "en_compra" }),
    })

    // Repetirlo no cambia nada.
    const snapshot = await snapshotOf(note)
    await unlink()
    expect(await snapshotOf(note)).toEqual(snapshot)
    expect(await eventsOf(OT.endVoid4, "parts_note_resolved")).toHaveLength(events.length)
  })
})
