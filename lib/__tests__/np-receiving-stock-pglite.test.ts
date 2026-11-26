import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/**
 * Repuestos en la recepción, las guías y sus anulaciones (ADR mantención 0001,
 * línea L1): el repuesto de catálogo recibido ENTRA AL STOCK de la faena (D1) y,
 * si su ítem de solicitud trae OT, queda RESERVADO para ella (D5). Por la vía
 * oficina el stock es de la oficina y viaja en guía: la reserva nace al despachar
 * (D11). El ítem de solicitud igual termina `delivered` al llegar a faena (D10).
 *
 * PGlite es de una sola conexión: el orden de bloqueo (equipo → OT → faena → stock)
 * se respeta en el código pero un deadlock real sólo se vería contra Postgres.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema })
const testGlobal = globalThis as unknown as { __db?: typeof testDb }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/email/smtp", () => ({ sendEmail: vi.fn(async () => ({ ok: true })), sendBatchEmails: vi.fn(async () => []), getAppBaseUrl: () => "http://localhost" }))

/** Avisos que habrían llegado a alguien (el resto de `notification-create` queda real). */
const sent = vi.hoisted(() => [] as Array<{ userIds: string[]; input: Record<string, unknown> }>)
vi.mock("@/lib/services/notification-create", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/notification-create")>()),
  notifyManyUser: vi.fn(async (userIds: string[], input: Record<string, unknown>) => {
    sent.push({ userIds: [...userIds].sort(), input })
  }),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { IDS, seedMantFixtures } = await import("./mantencion-sync-fixtures")
const parts = await import("@/lib/services/mantencion/parts")
const { registerReceipt } = await import("@/lib/services/receiving")
const { voidReceipt } = await import("@/lib/services/receiving-void")
const { cancelDispatchGuide, confirmDispatchGuideReceipt, dispatchDispatchGuide, prepareAdditionalDispatchGuideForOfficeReceipt } = await import("@/lib/services/dispatch-guides")
const { registerWorkerStockDelivery } = await import("@/lib/services/deliveries")
const { SPARE_PART_FORBIDDEN_MESSAGE } = await import("@/lib/services/stock-reservations")

const now = new Date().toISOString()
const OFFICE = "ws-np-oficina"
const ACTOR = { userId: IDS.jefe, userEmail: "jefe@chome.test" }
const SNAPSHOT = { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" as const }
const P = { filter: "p-l1-filter", hose: "p-l1-hose", bolt: "p-l1-bolt", seal: "p-l1-seal", glove: "p-l1-glove", service: "p-l1-service", plain: "p-l1-plain" } as const
const OT = { a: "ot-l1-a", b: "ot-l1-b", c: "ot-l1-c", d: "ot-l1-d", e: "ot-l1-e", f: "ot-l1-f", closed: "ot-l1-closed" } as const

let counter = 0
let recordSeq = 0

async function insertOt(id: string, status: "en_ejecucion" | "cerrada") {
  await testDb.insert(schema.mantWorkOrders).values({
    id, folio: `OT-${id}`, vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, equipmentSnapshot: SNAPSHOT,
    repair: true, maintenance: false, requestDate: "2026-11-01", requestedByUserId: IDS.jefe, requesterName: "Alexis Morales",
    repairDescription: "Fuga hidráulica en la pluma", status,
    assignedToUserId: IDS.mecBio, assignedByUserId: IDS.jefe, assignedAt: "2026-11-01T12:00:00Z",
    workshopKind: "interno", workshopEntryAt: "2026-11-02T08:00:00Z", estimatedDeliveryDate: "2026-12-31", startedAt: "2026-11-02T08:00:00Z", startedByUserId: IDS.mecBio,
    ...(status === "cerrada" ? {
      workshopExitAt: "2026-11-04T08:00:00Z", finishedAt: "2026-11-04T08:00:00Z", finishedByUserId: IDS.mecBio,
      receivedAt: "2026-11-04T09:00:00Z", receiverName: "Pedro Soto", receivedByUserId: IDS.jefe, receivedRecordedAt: "2026-11-04T09:00:00Z",
      faenaReceivedAt: "2026-11-05T09:00:00Z", faenaReceiverName: "Admin Contrato", faenaReceivedByUserId: IDS.jefe, closedAt: "2026-11-05T09:00:00Z",
    } : {}),
  })
}

/** Una NP con una línea, para probar que la reserva guarda su `note_item_id`. */
async function insertNote(workOrderId: string, code: string, description: string): Promise<{ noteId: string; noteItemId: string }> {
  const noteId = `note-${code}`
  const noteItemId = `noteitem-${code}`
  await testDb.insert(schema.mantPartsNotes).values({
    id: noteId, code, workOrderId, vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, requestedByUserId: IDS.mecBio, status: "en_gestion",
  })
  await testDb.insert(schema.mantPartsNoteItems).values({
    id: noteItemId, noteId, description, quantity: 2, unitOfMeasure: "unidad", sortOrder: 0,
    resolution: "en_compra", resolvedByUserId: IDS.jefe, resolvedAt: now,
  })
  return { noteId, noteItemId }
}

type SeedLine = { quantity: number; productId: string; workOrderId?: string | null; partsNoteItemId?: string | null }

/** Una solicitud con una línea por entrada y una OC que las compra. */
async function seedOrder(lines: SeedLine[], deliveryMode: "directo_faena" | "via_oficina" = "directo_faena", worksiteId: string = IDS.wsBio) {
  const n = ++counter
  const requestId = `req-l1-${n}`
  await testDb.insert(schema.purchaseRequests).values({
    id: requestId, code: `REP-L1-${n}`, worksiteId, requesterId: IDS.jefe, requestType: "repuestos",
    status: "in_purchasing", urgency: "high", deliveryMode, createdAt: now, updatedAt: now,
  })
  const orderId = `oc-l1-${n}`
  await testDb.insert(schema.purchaseOrders).values({
    id: orderId, code: `OC-L1-${n}`, worksiteId, supplierId: "sup-l1", createdBy: IDS.jefe,
    status: "sent", deliveryMode, createdAt: now, updatedAt: now,
  })
  const ocItemIds: string[] = []
  const requestItemIds: string[] = []
  for (const [index, line] of lines.entries()) {
    const itemId = `item-l1-${n}-${index}`
    requestItemIds.push(itemId)
    await testDb.insert(schema.purchaseRequestItems).values({
      id: itemId, requestId, productId: line.productId, quantity: line.quantity, unitOfMeasure: "unidad",
      status: "purchased", urgency: "high", sortOrder: index, createdAt: now, updatedAt: now,
      ...(line.workOrderId ? { vehicleId: IDS.truckBio, workOrderId: line.workOrderId } : {}),
      ...(line.partsNoteItemId ? { partsNoteItemId: line.partsNoteItemId } : {}),
    })
    const ocItemId = `ocitem-l1-${n}-${index}`
    ocItemIds.push(ocItemId)
    await testDb.insert(schema.purchaseOrderItems).values({
      id: ocItemId, purchaseOrderId: orderId, requestItemId: itemId, productId: line.productId,
      quantity: line.quantity, unitOfMeasure: "unidad", sortOrder: index,
    })
  }
  return { orderId, ocItemIds, requestItemIds }
}

const receive = (orderId: string, ocItemId: string, quantity: number, stage: "office" | "faena" = "faena") => registerReceipt({
  purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage, ...(stage === "faena" ? { worksiteId: IDS.wsBio } : {}),
  items: [{ purchaseOrderItemId: ocItemId, quantityReceived: quantity }],
})

const stockOf = async (productId: string, worksiteId: string = IDS.wsBio) => {
  const [row] = await testDb.select({ quantity: schema.worksiteStock.quantity }).from(schema.worksiteStock)
    .where(and(eq(schema.worksiteStock.worksiteId, worksiteId), eq(schema.worksiteStock.productId, productId)))
  return Math.round(Number(row?.quantity ?? 0) * 100) / 100
}
const movementsOf = (productId: string) => testDb.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.productId, productId))
const allocationsOf = (workOrderId: string, productId: string) => testDb.select().from(schema.mantPartsAllocations)
  .where(and(eq(schema.mantPartsAllocations.workOrderId, workOrderId), eq(schema.mantPartsAllocations.productId, productId)))
const sourcesOf = (allocationId: string) => testDb.select().from(schema.mantPartsAllocationSources)
  .where(eq(schema.mantPartsAllocationSources.allocationId, allocationId))
const itemStatus = async (requestItemId: string) => {
  const [row] = await testDb.select({ status: schema.purchaseRequestItems.status }).from(schema.purchaseRequestItems)
    .where(eq(schema.purchaseRequestItems.id, requestItemId))
  return row?.status
}
const remainingOf = (allocationId: string) => parts.allocationRemainingTx(testDb as unknown as Tx, allocationId)
const guideOfReceipt = async (receiptId: string) => {
  const [guide] = await testDb.select().from(schema.dispatchGuides).where(eq(schema.dispatchGuides.receiptId, receiptId))
  return guide
}
const guideLines = (guideId: string) => testDb.select().from(schema.dispatchGuideItems).where(eq(schema.dispatchGuideItems.guideId, guideId))

/** Lo que hará el registro: consume de la reserva y guarda la línea. Sirve para simular «ya se usó». */
async function consume(workOrderId: string, productId: string, quantity: number, allocationId: string): Promise<string> {
  recordSeq += 1
  const recordId = `rec-l1-${recordSeq}`
  const folio = `C-L1-${recordSeq}`
  await testDb.insert(schema.mantRecords).values({
    id: recordId, folio, kind: "C", vehicleId: IDS.truckBio, equipmentSnapshot: SNAPSHOT, worksiteId: IDS.wsBio,
    reading: 120_000 + recordSeq, unit: "km", workDate: "2026-11-03", registeredBy: IDS.mecBio, executorKind: "yo", executorUserId: IDS.mecBio,
    executorName: "Javier Roa", signedAt: "2026-11-03T16:00:00Z", receivedAt: `2026-11-03T16:00:${String(recordSeq).padStart(2, "0")}Z`, workOrderId,
  })
  await testDb.insert(schema.mantRecordCorrectives).values({
    recordId, workTypes: ["Mecánico"], oils: [], description: "Cambio de repuesto", noParts: false, hours: 2, inWorkshop: false,
  })
  await testDb.transaction(async (raw) => {
    const tx = raw as unknown as Tx
    const result = await parts.consumePartTx(tx, {
      recordId, workOrderId, recordWorksiteId: IDS.wsBio, productId, allocationId, quantity, actorUserId: IDS.mecBio,
    })
    await tx.insert(schema.mantRecordParts).values({
      id: `${recordId}-part`, recordId, quantity, description: "repuesto", source: "stock", productId,
      allocationId: result.allocationId, stockStatus: result.status,
      inventoryMovementId: result.status === "descontado" ? result.movementId : null,
      stockNote: result.status === "pendiente_conciliar" ? result.note : null,
    })
  })
  return folio
}

/** Deja correr el microtask de `notifyAfterCommit` y lo que éste encadena. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30))

beforeAll(async () => {
  await seedMantFixtures(testDb as unknown as DB)
  await testDb.insert(schema.worksites).values({ id: OFFICE, name: "Oficina CHOME", code: "OF-NP", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.suppliers).values({ id: "sup-l1", name: "Repuestos del Sur", rut: "76.000.222-2", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.productCategories).values({ id: "cat-l1", name: "Repuestos L1", slug: "repuestos-l1", isEpp: false, requiresPrevencion: false, sortOrder: 1 })
  const spare = (id: string, sku: string, name: string, partNumber: string) => ({
    id, sku, name, categoryId: "cat-l1", unitOfMeasure: "unidad", isSparePart: true, partNumber, isActive: true, createdAt: now, updatedAt: now,
  })
  await testDb.insert(schema.products).values([
    spare(P.filter, "REP-L1-1", "Filtro hidráulico", "HF-35"),
    spare(P.hose, "REP-L1-2", "Manguera", "MG-3"),
    spare(P.bolt, "REP-L1-3", "Perno", "PE-4"),
    spare(P.seal, "REP-L1-4", "Sello", "SE-5"),
    { id: P.glove, sku: "GEN-L1-1", name: "Guante", categoryId: "cat-l1", unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now },
    { id: P.service, sku: "SRV-L1-1", name: "Calibración", categoryId: "cat-l1", unitOfMeasure: "servicio", isService: true, isActive: true, createdAt: now, updatedAt: now },
    { id: P.plain, sku: "GEN-L1-2", name: "Aceite", categoryId: "cat-l1", unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now },
  ])
  for (const id of [OT.a, OT.b, OT.c, OT.d, OT.e, OT.f]) await insertOt(id, "en_ejecucion")
  await insertOt(OT.closed, "cerrada")
})

beforeEach(() => { sent.length = 0 })
afterAll(async () => { await pg.close() })

describe("recepción en faena: el repuesto entra al stock y se reserva para su OT", () => {
  it("recepción completa con OT abierta: ingreso_oc, reserva «recepción» con su trazabilidad e ítem entregado", async () => {
    const { noteItemId } = await insertNote(OT.a, "NP-2026-9001", "Filtro de retorno")
    const { orderId, ocItemIds, requestItemIds } = await seedOrder([{ quantity: 2, productId: P.filter, workOrderId: OT.a, partsNoteItemId: noteItemId }])

    const receiptId = await receive(orderId, ocItemIds[0]!, 2)

    // El stock de la faena subió y el kárdex lo explica.
    expect(await stockOf(P.filter)).toBe(2)
    expect(await movementsOf(P.filter)).toMatchObject([{ type: "ingreso_oc", quantity: 2, referenceType: "receipt", referenceId: receiptId, worksiteId: IDS.wsBio }])
    // Reservado para la OT, con el origen y los vínculos que L3 lee para «llegó n».
    const [allocation] = await allocationsOf(OT.a, P.filter)
    expect(allocation).toMatchObject({ status: "activa", worksiteId: IDS.wsBio })
    expect(Number(allocation!.quantity)).toBe(2)
    const sources = await sourcesOf(allocation!.id)
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ source: "recepcion", receiptId, noteItemId, requestItemId: requestItemIds[0], actorUserId: IDS.mecBio })
    expect(Number(sources[0]!.quantity)).toBe(2)
    expect(await remainingOf(allocation!.id)).toBe(2)
    // D10: para Compras el ciclo termina al llegar a faena.
    expect(await itemStatus(requestItemIds[0]!)).toBe("delivered")
    const events = await testDb.select().from(schema.mantWorkOrderEvents)
      .where(and(eq(schema.mantWorkOrderEvents.workOrderId, OT.a), eq(schema.mantWorkOrderEvents.type, "parts_allocated")))
    expect(events.length).toBeGreaterThanOrEqual(1)
  })

  it("recepción parcial: reserva por lo recibido, el ítem sigue «recibido parcial» y el saldo suma a la misma reserva", async () => {
    const { orderId, ocItemIds, requestItemIds } = await seedOrder([{ quantity: 4, productId: P.hose, workOrderId: OT.b }])

    await receive(orderId, ocItemIds[0]!, 1)
    expect(await itemStatus(requestItemIds[0]!)).toBe("partially_received")
    expect(await stockOf(P.hose)).toBe(1)
    let allocations = await allocationsOf(OT.b, P.hose)
    expect(allocations).toHaveLength(1)
    expect(Number(allocations[0]!.quantity)).toBe(1)

    await receive(orderId, ocItemIds[0]!, 3)
    expect(await itemStatus(requestItemIds[0]!)).toBe("delivered")
    expect(await stockOf(P.hose)).toBe(4)
    allocations = await allocationsOf(OT.b, P.hose)
    expect(allocations).toHaveLength(1)
    expect(Number(allocations[0]!.quantity)).toBe(4)
    expect((await sourcesOf(allocations[0]!.id)).map((row) => Number(row.quantity)).sort()).toEqual([1, 3])
  })

  it("con la OT cerrada el repuesto entra al stock sin reserva", async () => {
    const { orderId, ocItemIds, requestItemIds } = await seedOrder([{ quantity: 2, productId: P.bolt, workOrderId: OT.closed }])

    await receive(orderId, ocItemIds[0]!, 2)

    expect(await stockOf(P.bolt)).toBe(2)
    expect(await allocationsOf(OT.closed, P.bolt)).toEqual([])
    expect(await itemStatus(requestItemIds[0]!)).toBe("delivered")
  })

  it("un repuesto sin OT entra al stock libre, sin reserva", async () => {
    const { orderId, ocItemIds } = await seedOrder([{ quantity: 3, productId: P.seal }])

    await receive(orderId, ocItemIds[0]!, 3)

    expect(await stockOf(P.seal)).toBe(3)
    expect(await testDb.select().from(schema.mantPartsAllocations).where(eq(schema.mantPartsAllocations.productId, P.seal))).toEqual([])
  })

  it("un servicio sigue sin stock ni kárdex; un producto común sí ingresa y no se reserva", async () => {
    const { orderId, ocItemIds } = await seedOrder([
      { quantity: 1, productId: P.service, workOrderId: OT.c },
      { quantity: 5, productId: P.plain, workOrderId: OT.c },
    ])

    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio,
      items: [
        { purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 1 },
        { purchaseOrderItemId: ocItemIds[1]!, quantityReceived: 5 },
      ],
    })

    expect(await movementsOf(P.service)).toEqual([])
    expect(await testDb.select().from(schema.worksiteStock).where(eq(schema.worksiteStock.productId, P.service))).toEqual([])
    expect(await stockOf(P.plain)).toBe(5)
    expect(await testDb.select().from(schema.mantPartsAllocations).where(eq(schema.mantPartsAllocations.workOrderId, OT.c))).toEqual([])
  })

  it("REC-001: si la faena de destino es la propia oficina, no se vuelve a ingresar pero la reserva se crea sobre la oficina", async () => {
    const { orderId, ocItemIds, requestItemIds } = await seedOrder([{ quantity: 2, productId: P.filter, workOrderId: OT.d }], "via_oficina", OFFICE)
    const before = await stockOf(P.filter, OFFICE)

    const officeReceipt = await receive(orderId, ocItemIds[0]!, 2, "office")
    expect(await stockOf(P.filter, OFFICE)).toBe(before + 2)
    expect(await guideOfReceipt(officeReceipt)).toBeUndefined()
    // La etapa de oficina no reserva: la reserva espera a la etapa de faena.
    expect(await allocationsOf(OT.d, P.filter)).toEqual([])

    const faenaReceipt = await registerReceipt({
      purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: OFFICE,
      items: [{ purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 2 }],
    })

    expect(await stockOf(P.filter, OFFICE)).toBe(before + 2)
    const faenaMovements = (await movementsOf(P.filter)).filter((movement) => movement.referenceId === faenaReceipt)
    expect(faenaMovements).toEqual([])
    const [allocation] = await allocationsOf(OT.d, P.filter)
    expect(allocation).toMatchObject({ status: "activa", worksiteId: OFFICE })
    expect(Number(allocation!.quantity)).toBe(2)
    expect((await sourcesOf(allocation!.id))[0]).toMatchObject({ source: "recepcion", receiptId: faenaReceipt })
    expect(await itemStatus(requestItemIds[0]!)).toBe("delivered")
  })
})

describe("vía oficina: stock de la oficina, guía y reserva al despachar", () => {
  async function officeReceived(quantity: number, workOrderId: string | null, productId: string = P.hose) {
    const { noteItemId } = workOrderId
      ? await insertNote(workOrderId, `NP-2026-${9100 + counter}`, "Manguera de retorno")
      : { noteItemId: null }
    const order = await seedOrder([{ quantity, productId, workOrderId, partsNoteItemId: noteItemId }], "via_oficina")
    const officeBefore = await stockOf(productId, OFFICE)
    const receiptId = await receive(order.orderId, order.ocItemIds[0]!, quantity, "office")
    const guide = (await guideOfReceipt(receiptId))!
    return { ...order, receiptId, guide, noteItemId, officeBefore }
  }

  it("la llegada a oficina ingresa al stock de la oficina sin reservar y prepara una guía con el repuesto", async () => {
    const { requestItemIds, guide, officeBefore } = await officeReceived(2, OT.e, P.filter)

    expect(await stockOf(P.filter, OFFICE)).toBe(officeBefore + 2)
    expect(await testDb.select().from(schema.mantPartsAllocations).where(eq(schema.mantPartsAllocations.workOrderId, OT.e))).toEqual([])
    expect(guide).toMatchObject({ status: "draft", originWorksiteId: OFFICE, destinationWorksiteId: IDS.wsBio })
    expect(await guideLines(guide.id)).toMatchObject([{ productId: P.filter, quantity: 2 }])
    expect(await itemStatus(requestItemIds[0]!)).toBe("office_received")
  })

  it("despachar la guía mueve el stock a la faena y deja la reserva «traslado» con su guía y su NP", async () => {
    const { guide, requestItemIds, noteItemId, officeBefore } = await officeReceived(2, OT.f, P.hose)
    const hoseBefore = await stockOf(P.hose)

    await dispatchDispatchGuide(guide.id, ACTOR)

    expect(await stockOf(P.hose, OFFICE)).toBe(officeBefore)
    expect(await stockOf(P.hose)).toBe(hoseBefore + 2)
    const [allocation] = await allocationsOf(OT.f, P.hose)
    expect(allocation).toMatchObject({ status: "activa", worksiteId: IDS.wsBio })
    expect(Number(allocation!.quantity)).toBe(2)
    expect((await sourcesOf(allocation!.id))[0]).toMatchObject({
      source: "traslado", dispatchGuideId: guide.id, requestItemId: requestItemIds[0], noteItemId, actorUserId: IDS.jefe,
    })
    // El ítem sigue en oficina hasta el cotejo en faena.
    expect(await itemStatus(requestItemIds[0]!)).toBe("office_received")
  })

  it("el cotejo con diferencia no mueve stock ni toca la reserva; el ítem llega a faena (D10)", async () => {
    const { guide, requestItemIds, orderId, ocItemIds } = await officeReceived(3, OT.a, P.seal)
    await dispatchDispatchGuide(guide.id, ACTOR)
    const stockAfterDispatch = await stockOf(P.seal)
    const [line] = await guideLines(guide.id)

    await confirmDispatchGuideReceipt(guide.id, {
      items: [{ guideItemId: line!.id, quantityReceived: 2, differenceReason: "Una unidad llegó rota en el traslado" }],
    }, ACTOR)

    // Documenta el comportamiento vigente (GDI-001): el cotejo no mueve stock, así que la reserva sigue igual.
    expect(await stockOf(P.seal)).toBe(stockAfterDispatch)
    const [allocation] = await allocationsOf(OT.a, P.seal)
    expect(Number(allocation!.quantity)).toBe(3)
    expect(await remainingOf(allocation!.id)).toBe(3)
    expect(await itemStatus(requestItemIds[0]!)).toBe("partially_received")
    void orderId; void ocItemIds
  })

  it("anular la guía despachada rebaja la reserva y devuelve el repuesto a la oficina", async () => {
    const { guide, officeBefore } = await officeReceived(2, OT.b, P.filter)
    const faenaBefore = await stockOf(P.filter)
    await dispatchDispatchGuide(guide.id, ACTOR)
    const [allocation] = await allocationsOf(OT.b, P.filter)
    expect(await remainingOf(allocation!.id)).toBeGreaterThanOrEqual(2)
    const remainingBefore = await remainingOf(allocation!.id)

    await cancelDispatchGuide(guide.id, { reason: "Se despachó por error de bodega" }, ACTOR)

    expect(await stockOf(P.filter)).toBe(faenaBefore)
    expect(await stockOf(P.filter, OFFICE)).toBe(officeBefore + 2)
    expect(await remainingOf(allocation!.id)).toBe(remainingBefore - 2)
    const sources = await sourcesOf(allocation!.id)
    expect(sources.filter((row) => row.source === "anulacion_guia").map((row) => Number(row.quantity))).toEqual([-2])
  })

  it("no se puede anular la guía si el repuesto ya se usó: el mensaje nombra el registro y la OT, y nada se mueve", async () => {
    const { guide } = await officeReceived(2, OT.e, P.bolt)
    await dispatchDispatchGuide(guide.id, ACTOR)
    const [allocation] = await allocationsOf(OT.e, P.bolt)
    const folio = await consume(OT.e, P.bolt, 2, allocation!.id)
    const faenaStock = await stockOf(P.bolt)
    const officeStock = await stockOf(P.bolt, OFFICE)

    await expect(cancelDispatchGuide(guide.id, { reason: "Se despachó por error de bodega" }, ACTOR))
      .rejects.toThrow(`Ya se usó en el registro ${folio} de la OT OT-${OT.e}`)

    expect(await stockOf(P.bolt)).toBe(faenaStock)
    expect(await stockOf(P.bolt, OFFICE)).toBe(officeStock)
    const [after] = await testDb.select().from(schema.dispatchGuides).where(eq(schema.dispatchGuides.id, guide.id))
    expect(after!.status).toBe("dispatched")
  })
})

describe("anular una recepción", () => {
  it("la recepción parcial revierte el stock con egreso_anulacion y rebaja la reserva", async () => {
    const { orderId, ocItemIds, requestItemIds } = await seedOrder([{ quantity: 4, productId: P.filter, workOrderId: OT.c }])
    const stockBefore = await stockOf(P.filter)
    const receiptId = await receive(orderId, ocItemIds[0]!, 2)
    const [allocation] = await allocationsOf(OT.c, P.filter)
    const remainingBefore = await remainingOf(allocation!.id)

    const result = await voidReceipt({ receiptId, reason: "Se registró contra la orden equivocada", voidedBy: IDS.jefe })

    expect(result.reversedMovements).toBe(1)
    expect(await stockOf(P.filter)).toBe(stockBefore)
    expect((await movementsOf(P.filter)).filter((movement) => movement.referenceId === receiptId).map((movement) => movement.type).sort())
      .toEqual(["egreso_anulacion", "ingreso_oc"])
    expect(await remainingOf(allocation!.id)).toBe(remainingBefore - 2)
    expect((await sourcesOf(allocation!.id)).filter((row) => row.source === "anulacion_recepcion").map((row) => Number(row.quantity))).toEqual([-2])
    expect(await itemStatus(requestItemIds[0]!)).toBe("purchased")
  })

  it("si lo recibido ya se usó, la anulación se bloquea nombrando el registro y la OT, sin mover nada", async () => {
    const { orderId, ocItemIds } = await seedOrder([{ quantity: 4, productId: P.hose, workOrderId: OT.d }])
    const receiptId = await receive(orderId, ocItemIds[0]!, 2)
    const [allocation] = await allocationsOf(OT.d, P.hose)
    const folio = await consume(OT.d, P.hose, 2, allocation!.id)
    const stockBefore = await stockOf(P.hose)

    await expect(voidReceipt({ receiptId, reason: "Se registró contra la orden equivocada", voidedBy: IDS.jefe }))
      .rejects.toThrow(`Ya se usó en el registro ${folio} de la OT OT-${OT.d}`)

    expect(await stockOf(P.hose)).toBe(stockBefore)
    const [receipt] = await testDb.select().from(schema.receipts).where(eq(schema.receipts.id, receiptId))
    expect(receipt!.status).not.toBe("voided")
  })

  it("la recepción completa de un repuesto sigue bloqueada (el ítem ya está entregado) y manda al ajuste de inventario", async () => {
    const { orderId, ocItemIds } = await seedOrder([{ quantity: 2, productId: P.bolt, workOrderId: OT.f }])
    const receiptId = await receive(orderId, ocItemIds[0]!, 2)
    const stockBefore = await stockOf(P.bolt)

    await expect(voidReceipt({ receiptId, reason: "Se registró contra la orden equivocada", voidedBy: IDS.jefe }))
      .rejects.toThrow(/el repuesto ya llegó a la faena.*ajuste de inventario/)

    expect(await stockOf(P.bolt)).toBe(stockBefore)
  })

  it("REC-001: anular la etapa de faena de una OC con destino en la oficina rebaja la reserva sin mover stock (esa etapa no ingresó nada)", async () => {
    const { orderId, ocItemIds, requestItemIds } = await seedOrder([{ quantity: 3, productId: P.hose, workOrderId: OT.e }], "via_oficina", OFFICE)
    await receive(orderId, ocItemIds[0]!, 3, "office")
    const officeStock = await stockOf(P.hose, OFFICE)
    const faenaReceipt = await registerReceipt({
      purchaseOrderId: orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: OFFICE,
      items: [{ purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 2 }],
    })
    const [allocation] = (await allocationsOf(OT.e, P.hose)).filter((row) => row.worksiteId === OFFICE)
    expect(await remainingOf(allocation!.id)).toBe(2)
    expect(await itemStatus(requestItemIds[0]!)).toBe("partially_received")

    const result = await voidReceipt({ receiptId: faenaReceipt, reason: "Se registró contra la orden equivocada", voidedBy: IDS.jefe })

    expect(result.reversedMovements).toBe(0)
    expect(await stockOf(P.hose, OFFICE)).toBe(officeStock)
    expect(await remainingOf(allocation!.id)).toBe(0)
    expect((await sourcesOf(allocation!.id)).filter((row) => row.source === "anulacion_recepcion").map((row) => Number(row.quantity))).toEqual([-2])
  })

  it("una recepción anterior al corte (sin ingreso_oc) no mueve stock al anularse, para no llevarse stock ajeno", async () => {
    const { orderId, ocItemIds, requestItemIds } = await seedOrder([{ quantity: 4, productId: P.seal }])
    // Stock propio de la faena que NO viene de esta recepción.
    await testDb.transaction(async (tx) => {
      const { applyMovementTx } = await import("@/lib/services/stock-movement")
      await applyMovementTx(tx as unknown as Tx, { worksiteId: IDS.wsBio, productId: P.seal, type: "ingreso_oc", quantity: 5, performedBy: IDS.jefe, referenceType: "test", referenceId: "seed-l1" })
    })
    const stockBefore = await stockOf(P.seal)
    // La recepción histórica: recibió 2 de 4 y nunca generó kárdex.
    const receiptId = `rec-l1-precut-${counter}`
    await testDb.insert(schema.receipts).values({ id: receiptId, code: `REC-L1-PRE-${counter}`, purchaseOrderId: orderId, receivedBy: IDS.jefe, receivedAt: now, locationType: "faena", worksiteId: IDS.wsBio, status: "closed", createdAt: now })
    await testDb.insert(schema.receiptItems).values({ id: `ri-l1-${counter}`, receiptId, purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 2, quantityRejected: 0, quantityDamaged: 0, status: "partially_received" })
    await testDb.update(schema.purchaseOrderItems).set({ quantityReceived: 2 }).where(eq(schema.purchaseOrderItems.id, ocItemIds[0]!))
    await testDb.update(schema.purchaseRequestItems).set({ status: "partially_received" }).where(eq(schema.purchaseRequestItems.id, requestItemIds[0]!))

    const result = await voidReceipt({ receiptId, reason: "Se registró contra la orden equivocada", voidedBy: IDS.jefe })

    expect(result.reversedMovements).toBe(0)
    expect(await stockOf(P.seal)).toBe(stockBefore)
    const [line] = await testDb.select().from(schema.purchaseOrderItems).where(eq(schema.purchaseOrderItems.id, ocItemIds[0]!))
    expect(line!.quantityReceived).toBe(0)
  })

  it("una recepción en oficina anterior al corte no arma una guía con el repuesto: nunca entró al stock de la oficina", async () => {
    const { orderId, ocItemIds } = await seedOrder([{ quantity: 3, productId: P.seal }], "via_oficina")
    const receiptId = `rec-l1-precut-office-${counter}`
    await testDb.insert(schema.receipts).values({ id: receiptId, code: `REC-L1-PREOF-${counter}`, purchaseOrderId: orderId, receivedBy: IDS.jefe, receivedAt: now, locationType: "office", worksiteId: OFFICE, status: "closed", createdAt: now })
    await testDb.insert(schema.receiptItems).values({ id: `ri-l1-of-${counter}`, receiptId, purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 3, quantityRejected: 0, quantityDamaged: 0, status: "received" })
    await expect(prepareAdditionalDispatchGuideForOfficeReceipt(receiptId, { userId: IDS.jefe })).rejects.toThrow("no tiene bienes trasladables")
  })
})

describe("entrega a un trabajador", () => {
  it("un repuesto no se entrega: se rechaza con el mensaje del motor antes de tocar nada", async () => {
    await testDb.insert(schema.workers).values({ id: "w-l1", firstName: "Andrea", lastName: "Operadora", worksiteId: IDS.wsBio, isActive: true, createdAt: now })
    const stockBefore = await stockOf(P.filter)

    await expect(registerWorkerStockDelivery({
      sourceWorksiteId: IDS.wsBio, workerId: "w-l1", deliveredBy: IDS.jefe, items: [{ productId: P.filter, quantity: 1 }],
    })).rejects.toThrow(SPARE_PART_FORBIDDEN_MESSAGE)

    expect(await stockOf(P.filter)).toBe(stockBefore)
    expect(await testDb.select().from(schema.deliveries)).toEqual([])
  })
})

describe("aviso al autor de la nota de pedido", () => {
  it("al llegar completo, el autor de la NP recibe «Llegó a faena: repuesto · NP · OT», una vez, y no se duplica con el aviso general", async () => {
    const { noteItemId } = await insertNote(OT.b, "NP-2026-9300", "Filtro de retorno")
    const { orderId, ocItemIds } = await seedOrder([{ quantity: 1, productId: P.filter, workOrderId: OT.b, partsNoteItemId: noteItemId }])

    const receiptId = await registerReceipt({
      purchaseOrderId: orderId, receivedBy: IDS.supBio, stage: "faena", worksiteId: IDS.wsBio,
      items: [{ purchaseOrderItemId: ocItemIds[0]!, quantityReceived: 1 }],
    })
    await settle()

    const partsNotices = sent.filter((entry) => entry.input.type === "mant_ot_parts_received")
    const forAuthor = partsNotices.filter((entry) => entry.userIds.includes(IDS.mecBio))
    // El mecánico es a la vez autor de la NP y mecánico asignado de la OT: un solo aviso, el de la NP.
    expect(forAuthor).toHaveLength(1)
    expect(forAuthor[0]!.input).toMatchObject({
      title: `Llegó a faena: Filtro de retorno · NP-2026-9300 · OT OT-${OT.b}`,
      entityType: "mant_work_order", entityId: OT.b, entityHref: `/mantencion/ot/${OT.b}`,
    })
    expect(String(forAuthor[0]!.input.dedupeKey)).toContain(receiptId)
    // El autor de la recepción nunca se avisa a sí mismo.
    expect(partsNotices.every((entry) => !entry.userIds.includes(IDS.supBio))).toBe(true)
  })

  it("con varias líneas de la misma NP, el aviso es un resumen legible con una sola NP", async () => {
    const { noteId, noteItemId } = await insertNote(OT.c, "NP-2026-9301", "Filtro de retorno")
    await testDb.insert(schema.mantPartsNoteItems).values({
      id: "noteitem-NP-2026-9301-b", noteId, description: "Sello de pistón", quantity: 1, unitOfMeasure: "unidad", sortOrder: 1,
      resolution: "en_compra", resolvedByUserId: IDS.jefe, resolvedAt: now,
    })
    const { orderId, ocItemIds } = await seedOrder([
      { quantity: 1, productId: P.filter, workOrderId: OT.c, partsNoteItemId: noteItemId },
      { quantity: 1, productId: P.seal, workOrderId: OT.c, partsNoteItemId: "noteitem-NP-2026-9301-b" },
    ])

    await registerReceipt({
      purchaseOrderId: orderId, receivedBy: IDS.supBio, stage: "faena", worksiteId: IDS.wsBio,
      items: ocItemIds.map((purchaseOrderItemId) => ({ purchaseOrderItemId, quantityReceived: 1 })),
    })
    await settle()

    const forAuthor = sent.filter((entry) => entry.input.type === "mant_ot_parts_received" && entry.userIds.includes(IDS.mecBio))
    expect(forAuthor).toHaveLength(1)
    expect(forAuthor[0]!.input.title).toBe(`Llegaron a faena: Filtro de retorno y 1 más · NP-2026-9301 · OT OT-${OT.c}`)
    expect(String(forAuthor[0]!.input.body)).toContain("Filtro de retorno; Sello de pistón")
  })

  it("una llegada parcial no avisa, y quien recibe la NP que él mismo escribió no se avisa a sí mismo", async () => {
    const { noteItemId } = await insertNote(OT.d, "NP-2026-9302", "Manguera de retorno")
    const partial = await seedOrder([{ quantity: 3, productId: P.hose, workOrderId: OT.d, partsNoteItemId: noteItemId }])
    await registerReceipt({
      purchaseOrderId: partial.orderId, receivedBy: IDS.supBio, stage: "faena", worksiteId: IDS.wsBio,
      items: [{ purchaseOrderItemId: partial.ocItemIds[0]!, quantityReceived: 1 }],
    })
    await settle()
    expect(sent.filter((entry) => entry.input.type === "mant_ot_parts_received")).toEqual([])

    // El mismo mecánico autor de la NP registra la recepción completa del saldo: no se avisa a sí mismo.
    await registerReceipt({
      purchaseOrderId: partial.orderId, receivedBy: IDS.mecBio, stage: "faena", worksiteId: IDS.wsBio,
      items: [{ purchaseOrderItemId: partial.ocItemIds[0]!, quantityReceived: 2 }],
    })
    await settle()
    expect(sent.filter((entry) => entry.input.type === "mant_ot_parts_received" && entry.userIds.includes(IDS.mecBio))).toEqual([])
  })
})
