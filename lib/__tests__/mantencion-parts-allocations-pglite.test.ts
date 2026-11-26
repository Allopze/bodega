import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * Núcleo de reservas de repuestos por OT (ADR mantención 0001) contra Postgres de
 * verdad: aportar, consumir, rebajar, liberar y revertir, con las reglas de
 * integridad del plan (una reserva activa por OT/faena/producto, el registro nunca
 * se rechaza por stock, salidas que no se comen lo reservado, ajuste que rebaja,
 * centésimas sobre float4).
 *
 * PGlite es de una sola conexión: la concurrencia real (dos registros sobre el
 * último repuesto) la cubre la suite de consumo contra el contenedor Postgres.
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

const parts = await import("@/lib/services/mantencion/parts")
const { applyMovementTx } = await import("@/lib/services/stock-movement")

const SNAPSHOT = { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" as const }
const OT = { a: "ot-np-a", b: "ot-np-b", closed: "ot-np-closed" } as const
const P = { filter: "p-np-filter", oil: "p-np-oil", hose: "p-np-hose", bolt: "p-np-bolt", gen: "p-np-gen" } as const

type OtStatus = "en_ejecucion" | "cerrada"

async function insertOt(id: string, status: OtStatus, vehicleId: string) {
  await testDb.insert(schema.mantWorkOrders).values({
    id, folio: `OT-${id}`, vehicleId, worksiteId: IDS.wsBio, equipmentSnapshot: SNAPSHOT,
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

let recordSeq = 0
async function insertRecord(workOrderId: string, vehicleId: string): Promise<string> {
  recordSeq += 1
  const id = `rec-np-${recordSeq}`
  await testDb.insert(schema.mantRecords).values({
    id, folio: `C-NP-${recordSeq}`, kind: "C", vehicleId, equipmentSnapshot: SNAPSHOT, worksiteId: IDS.wsBio,
    reading: 120_000 + recordSeq, unit: "km", workDate: "2026-11-03", registeredBy: IDS.mecBio, executorKind: "yo", executorUserId: IDS.mecBio,
    executorName: "Javier Roa", signedAt: "2026-11-03T16:00:00Z", receivedAt: `2026-11-03T16:00:${String(recordSeq).padStart(2, "0")}Z`, workOrderId,
  })
  await testDb.insert(schema.mantRecordCorrectives).values({
    recordId: id, workTypes: ["Mecánico"], oils: [], description: "Cambio de filtro", noParts: false, hours: 2, inWorkshop: false,
  })
  return id
}

/** Lo que hará el registro: consume y guarda la línea con el resultado, en la misma transacción. */
async function consumeLine(input: { recordId: string; workOrderId: string; productId: string; quantity: number; allocationId?: string | null }) {
  return testDb.transaction(async (raw) => {
    const tx = raw as unknown as Tx
    const result = await parts.consumePartTx(tx, {
      recordId: input.recordId, workOrderId: input.workOrderId, recordWorksiteId: IDS.wsBio,
      productId: input.productId, allocationId: input.allocationId, quantity: input.quantity, actorUserId: IDS.mecBio,
    })
    const partId = `${input.recordId}-${input.productId}-${Math.random().toString(36).slice(2, 7)}`
    await tx.insert(schema.mantRecordParts).values({
      id: partId, recordId: input.recordId, quantity: input.quantity, description: "repuesto", source: "stock", productId: input.productId,
      allocationId: result.allocationId,
      stockStatus: result.status,
      inventoryMovementId: result.status === "descontado" ? result.movementId : null,
      stockNote: result.status === "pendiente_conciliar" ? result.note : null,
    })
    return { ...result, partId }
  })
}

async function ingress(productId: string, quantity: number, worksiteId: string = IDS.wsBio) {
  await testDb.transaction((tx) => applyMovementTx(tx as unknown as Tx, {
    worksiteId, productId, type: "ingreso_oc", quantity, performedBy: IDS.jefe, referenceType: "test", referenceId: "seed",
  }))
}

async function reserve(workOrderId: string, productId: string, quantity: number, extra: { receiptId?: string } = {}) {
  return testDb.transaction(async (raw) => {
    const tx = raw as unknown as Tx
    await parts.lockForStockTx(tx, { workOrderIds: [workOrderId], worksiteId: IDS.wsBio, productIds: [productId] })
    return parts.addToAllocationTx(tx, {
      workOrderId, worksiteId: IDS.wsBio, productId, quantity, source: "recepcion", actorUserId: IDS.jefe, receiptId: extra.receiptId,
    })
  })
}

async function stockOf(productId: string, worksiteId: string = IDS.wsBio): Promise<number> {
  const [row] = await testDb.select({ quantity: schema.worksiteStock.quantity }).from(schema.worksiteStock)
    .where(and(eq(schema.worksiteStock.worksiteId, worksiteId), eq(schema.worksiteStock.productId, productId)))
  return Math.round(Number(row?.quantity ?? 0) * 100) / 100
}

async function freeOf(productId: string): Promise<number> {
  return testDb.transaction(async (raw) => {
    const tx = raw as unknown as Tx
    await parts.lockForStockTx(tx, { worksiteId: IDS.wsBio, productIds: [productId] })
    return parts.freeStockTx(tx, IDS.wsBio, productId)
  })
}

async function remainingOf(allocationId: string): Promise<number> {
  return parts.allocationRemainingTx(testDb as unknown as Tx, allocationId)
}

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  await seedMantFixtures(testDb)
  const now = new Date().toISOString()
  await testDb.insert(schema.suppliers).values({ id: "sup-np", name: "Repuestos del Sur", rut: "76.000.222-2", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.productCategories).values({ id: "cat-np", name: "Repuestos NP", slug: "repuestos-np", isEpp: false, requiresPrevencion: false, sortOrder: 1 })
  await testDb.insert(schema.products).values([
    { id: P.filter, sku: "REP-NP-1", name: "Filtro de aceite", categoryId: "cat-np", unitOfMeasure: "unidad", isSparePart: true, partNumber: "FA-1", isActive: true, createdAt: now, updatedAt: now },
    { id: P.oil, sku: "REP-NP-2", name: "Aceite hidráulico", categoryId: "cat-np", unitOfMeasure: "litro", isSparePart: true, partNumber: "AH-2", isActive: true, createdAt: now, updatedAt: now },
    { id: P.hose, sku: "REP-NP-3", name: "Manguera", categoryId: "cat-np", unitOfMeasure: "unidad", isSparePart: true, partNumber: "MG-3", isActive: true, createdAt: now, updatedAt: now },
    { id: P.bolt, sku: "REP-NP-4", name: "Perno", categoryId: "cat-np", unitOfMeasure: "unidad", isSparePart: true, partNumber: "PE-4", isActive: true, createdAt: now, updatedAt: now },
    { id: P.gen, sku: "GEN-NP-5", name: "Guante", categoryId: "cat-np", unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now },
  ])
  await insertOt(OT.a, "en_ejecucion", IDS.truckBio)
  await insertOt(OT.b, "en_ejecucion", IDS.truckCho)
  await insertOt(OT.closed, "cerrada", IDS.machineBio)
})

describe("reserva por OT", () => {
  it("acumula una sola reserva activa por OT, faena y producto, con sus orígenes y evento", async () => {
    await ingress(P.filter, 10)
    const first = await reserve(OT.a, P.filter, 2)
    const second = await reserve(OT.a, P.filter, 3)
    expect(first?.allocationId).toBeTruthy()
    expect(second?.allocationId).toBe(first?.allocationId)
    const rows = await testDb.select().from(schema.mantPartsAllocations).where(eq(schema.mantPartsAllocations.workOrderId, OT.a))
    expect(rows.filter((row) => row.productId === P.filter).map((row) => Number(row.quantity))).toEqual([5])
    const sources = await testDb.select().from(schema.mantPartsAllocationSources).where(eq(schema.mantPartsAllocationSources.allocationId, first!.allocationId))
    expect(sources.map((row) => Number(row.quantity)).sort()).toEqual([2, 3])
    const events = await testDb.select().from(schema.mantWorkOrderEvents).where(and(eq(schema.mantWorkOrderEvents.workOrderId, OT.a), eq(schema.mantWorkOrderEvents.type, "parts_allocated")))
    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(await freeOf(P.filter)).toBe(5)
  })

  it("una OT cerrada no reserva: el stock queda libre", async () => {
    await ingress(P.bolt, 4)
    expect(await reserve(OT.closed, P.bolt, 4)).toBeNull()
    expect(await freeOf(P.bolt)).toBe(4)
  })
})

describe("consumo desde el registro", () => {
  it("descuenta de la reserva propia, enlaza el movimiento y apunta al registro", async () => {
    await ingress(P.hose, 3)
    const allocation = await reserve(OT.a, P.hose, 3)
    const recordId = await insertRecord(OT.a, IDS.truckBio)
    const result = await consumeLine({ recordId, workOrderId: OT.a, productId: P.hose, quantity: 2, allocationId: allocation!.allocationId })
    expect(result.status).toBe("descontado")
    expect(await stockOf(P.hose)).toBe(1)
    expect(await remainingOf(allocation!.allocationId)).toBe(1)
    const [movement] = await testDb.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.id, (result as { movementId: string }).movementId))
    expect(movement).toMatchObject({ type: "egreso_mantencion", referenceType: "mant_record", referenceId: recordId })
  })

  it("si falta stock, la línea queda pendiente de conciliar y la transacción del registro sigue viva", async () => {
    // Filtro: 10 en bodega, 5 reservados para A. B no tiene reserva: sólo ve los 5 libres.
    const recordId = await insertRecord(OT.b, IDS.truckCho)
    const result = await consumeLine({ recordId, workOrderId: OT.b, productId: P.filter, quantity: 6 })
    expect(result.status).toBe("pendiente_conciliar")
    expect((result as { note: string }).note).toContain("Faltaban 1")
    expect(await stockOf(P.filter)).toBe(10)
    const [line] = await testDb.select().from(schema.mantRecordParts).where(eq(schema.mantRecordParts.id, result.partId))
    expect(line).toMatchObject({ stockStatus: "pendiente_conciliar", inventoryMovementId: null })
  })

  it("lo que pasa de la reserva propia sale del libre y la línea queda enlazada a la reserva", async () => {
    const [allocation] = await testDb.select().from(schema.mantPartsAllocations)
      .where(and(eq(schema.mantPartsAllocations.workOrderId, OT.a), eq(schema.mantPartsAllocations.productId, P.filter)))
    const recordId = await insertRecord(OT.a, IDS.truckBio)
    const result = await consumeLine({ recordId, workOrderId: OT.a, productId: P.filter, quantity: 7 })
    expect(result).toMatchObject({ status: "descontado", allocationId: allocation!.id })
    expect(await stockOf(P.filter)).toBe(3)
    expect(await remainingOf(allocation!.id)).toBe(0)
    expect(await freeOf(P.filter)).toBe(3)
  })

  it("rechaza con 422 una reserva de otra OT y una cantidad fraccionaria en un repuesto entero", async () => {
    const [allocation] = await testDb.select().from(schema.mantPartsAllocations)
      .where(and(eq(schema.mantPartsAllocations.workOrderId, OT.a), eq(schema.mantPartsAllocations.productId, P.hose)))
    const recordId = await insertRecord(OT.b, IDS.truckCho)
    await expect(consumeLine({ recordId, workOrderId: OT.b, productId: P.hose, quantity: 1, allocationId: allocation!.id }))
      .rejects.toBeInstanceOf(parts.PartsValidationError)
    await expect(consumeLine({ recordId, workOrderId: OT.b, productId: P.bolt, quantity: 1.5 }))
      .rejects.toThrow("va en unidades enteras")
    await expect(consumeLine({ recordId, workOrderId: OT.b, productId: P.gen, quantity: 1 }))
      .rejects.toThrow("no es un repuesto")
  })

  it("se lleva exacto todo lo que hay aunque el stock sea float4 (0,7 litros)", async () => {
    await ingress(P.oil, 0.7)
    const recordId = await insertRecord(OT.b, IDS.truckCho)
    const result = await consumeLine({ recordId, workOrderId: OT.b, productId: P.oil, quantity: 0.7 })
    expect(result.status).toBe("descontado")
    expect(await stockOf(P.oil)).toBe(0)
  })
})

describe("salidas que no son consumo", () => {
  it("una baja que se comería lo reservado se rechaza nombrando la OT", async () => {
    // Manguera: 1 en bodega, reservada para A (restante 1).
    await expect(testDb.transaction((tx) => applyMovementTx(tx as unknown as Tx, {
      worksiteId: IDS.wsBio, productId: P.hose, type: "egreso_desecho", quantity: 1, performedBy: IDS.jefe, reason: "Rota",
    }))).rejects.toThrow(`reservados para OT-${OT.a}`)
  })

  it("un ajuste negativo manda: rebaja la reserva más nueva y deja el origen «ajuste»", async () => {
    await ingress(P.bolt, 2) // perno: 6 libres
    const allocation = await reserve(OT.a, P.bolt, 5)
    await testDb.transaction((tx) => applyMovementTx(tx as unknown as Tx, {
      worksiteId: IDS.wsBio, productId: P.bolt, type: "ajuste", quantity: -4, performedBy: IDS.jefe, reason: "Conteo físico CON-1",
    }))
    expect(await stockOf(P.bolt)).toBe(2)
    expect(await remainingOf(allocation!.allocationId)).toBe(2)
    const sources = await testDb.select().from(schema.mantPartsAllocationSources)
      .where(and(eq(schema.mantPartsAllocationSources.allocationId, allocation!.allocationId), eq(schema.mantPartsAllocationSources.source, "ajuste")))
    expect(sources.map((row) => Number(row.quantity))).toEqual([-3])
  })

  it("un repuesto no se entrega a un trabajador", async () => {
    await expect(testDb.transaction((tx) => applyMovementTx(tx as unknown as Tx, {
      worksiteId: IDS.wsBio, productId: P.bolt, type: "egreso_entrega", quantity: -1, performedBy: IDS.jefe,
    }))).rejects.toThrow("sólo sale de bodega al usarse en una orden de trabajo")
  })
})

describe("rebaja por anulación de la fuente", () => {
  it("rebaja lo que aportó la recepción y bloquea si ya se usó, nombrando el registro", async () => {
    const now = new Date().toISOString()
    await testDb.insert(schema.purchaseOrders).values({ id: "po-np", code: "OC-NP-1", worksiteId: IDS.wsBio, supplierId: "sup-np", createdBy: IDS.jefe, status: "sent", deliveryMode: "directo_faena" })
    await testDb.insert(schema.receipts).values([
      { id: "rec-np-a", code: "REC-NP-1", purchaseOrderId: "po-np", receivedBy: IDS.jefe, receivedAt: now, locationType: "faena", worksiteId: IDS.wsBio, createdAt: now },
      { id: "rec-np-b", code: "REC-NP-2", purchaseOrderId: "po-np", receivedBy: IDS.jefe, receivedAt: now, locationType: "faena", worksiteId: IDS.wsBio, createdAt: now },
    ])
    // B recibe 2 mangueras por la recepción A (stock 1 → 3).
    await ingress(P.hose, 2)
    const allocation = await reserve(OT.b, P.hose, 2, { receiptId: "rec-np-a" })
    const shrink = (receiptId: string, quantity: number) => testDb.transaction(async (raw) => {
      const tx = raw as unknown as Tx
      await parts.lockForStockTx(tx, { workOrderIds: [OT.b], worksiteId: IDS.wsBio, productIds: [P.hose] })
      return parts.shrinkAllocationsForSourceTx(tx, { receiptId, productId: P.hose, quantity, source: "anulacion_recepcion", actorUserId: IDS.jefe, reason: "Recepción mal digitada" })
    })
    expect(await shrink("rec-np-a", 1)).toEqual({ shrunk: 1 })
    expect(await remainingOf(allocation!.allocationId)).toBe(1)
    // Se usa la que queda; anular el resto de esa recepción ya no se puede.
    const recordId = await insertRecord(OT.b, IDS.truckCho)
    await consumeLine({ recordId, workOrderId: OT.b, productId: P.hose, quantity: 1 })
    await expect(shrink("rec-np-a", 1)).rejects.toThrow(/Ya se usó en el registro C-NP-\d+ de la OT OT-ot-np-b/)
    // Una recepción que no aportó nada no rebaja nada.
    expect(await shrink("rec-np-b", 1)).toEqual({ shrunk: 0 })
  })
})

describe("liberar y revertir", () => {
  it("anular el registro repone el stock, devuelve la reserva y cierra lo pendiente", async () => {
    const [allocation] = await testDb.select().from(schema.mantPartsAllocations)
      .where(and(eq(schema.mantPartsAllocations.workOrderId, OT.a), eq(schema.mantPartsAllocations.productId, P.bolt)))
    const recordId = await insertRecord(OT.a, IDS.truckBio)
    const used = await consumeLine({ recordId, workOrderId: OT.a, productId: P.bolt, quantity: 2 })
    const short = await consumeLine({ recordId, workOrderId: OT.a, productId: P.bolt, quantity: 9 })
    expect(used.status).toBe("descontado")
    expect(short.status).toBe("pendiente_conciliar")
    expect(await stockOf(P.bolt)).toBe(0)

    const outcome = await testDb.transaction((tx) => parts.reverseRecordPartsTx(tx as unknown as Tx, { recordId, actorUserId: IDS.jefe, reason: "Registro anulado" }))
    expect(outcome).toEqual({ reversed: 1, closedPending: 1 })
    expect(await stockOf(P.bolt)).toBe(2)
    expect(await remainingOf(allocation!.id)).toBe(2)
    const lines = await testDb.select().from(schema.mantRecordParts).where(eq(schema.mantRecordParts.recordId, recordId))
    expect(lines.map((line) => line.stockStatus).sort()).toEqual(["revertido", "sin_movimiento"])
    const reversal = await testDb.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.referenceType, "mant_record_void"))
    expect(reversal.map((row) => row.type)).toEqual(["ingreso_anulacion"])
  })

  it("cerrar la OT libera lo no usado a stock libre; la reserva queda como auditoría", async () => {
    const before = await freeOf(P.bolt)
    const outcome = await testDb.transaction((tx) => parts.releaseWorkOrderAllocationsTx(tx as unknown as Tx, { workOrderId: OT.a, actorUserId: IDS.jefe, reason: "OT cerrada" }))
    expect(outcome.released.find((row) => row.productId === P.bolt)?.quantity).toBe(2)
    expect(await freeOf(P.bolt)).toBe(before + 2)
    const active = await testDb.select().from(schema.mantPartsAllocations)
      .where(and(eq(schema.mantPartsAllocations.workOrderId, OT.a), eq(schema.mantPartsAllocations.status, "activa")))
    expect(active).toHaveLength(0)
    const events = await testDb.select().from(schema.mantWorkOrderEvents).where(and(eq(schema.mantWorkOrderEvents.workOrderId, OT.a), eq(schema.mantWorkOrderEvents.type, "parts_released")))
    expect(events).toHaveLength(1)
  })

  it("los disponibles de una OT sólo listan reservas activas con saldo", async () => {
    const availableA = await parts.listAvailableForWorkOrders([OT.a])
    expect(availableA).toEqual([])
    const summary = await parts.stockReservationSummary({ worksiteIds: [IDS.wsBio] })
    expect(summary.every((row) => row.reserved > 0)).toBe(true)
  })
})
