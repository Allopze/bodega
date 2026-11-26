import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, asc, eq } from "drizzle-orm"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"
import { MANT_WEB_DEVICE_ID, syncRecordSchema, type SyncRecord, type WorkOrderEntryPayload } from "@/lib/mantencion/contracts"
import { createWorkOrderSchema } from "@/lib/mantencion/work-order-schemas"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { configureZodLocale } from "@/lib/validation/zod-locale"
import { IDS, insertOrphanPhoto, seedMantFixtures } from "./mantencion-sync-fixtures"
import { correctiveBody, makeJpeg, metaFor } from "./mantencion-sync-http-helpers"

/**
 * Consumo de repuestos desde el registro y ciclo de vida (ADR mantención 0001, línea L4),
 * por los servicios REALES: `createRecord` descuenta con `egreso_mantencion`, `voidRecord`
 * repone, cerrar o anular la OT libera la reserva, reabrirla no vuelve a reservar y
 * `conciliatePart` resuelve las líneas que quedaron «pendiente de conciliar».
 *
 * PGlite es de una sola conexión: la concurrencia real (dos registros sobre el último
 * repuesto) no se puede probar aquí y queda como brecha declarada en el informe de la línea.
 */

const storageRoot = mkdtempSync(path.join(tmpdir(), "np-consumption-"))
process.env.STORAGE_PATH = storageRoot

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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const parts = await import("@/lib/services/mantencion/parts")
const { applyMovementTx } = await import("@/lib/services/stock-movement")
const { createRecord } = await import("@/lib/services/mantencion/records-create")
const { voidRecord } = await import("@/lib/services/mantencion/record-lifecycle")
const { createWorkOrder } = await import("@/lib/services/mantencion/work-orders/create")
const transitions = await import("@/lib/services/mantencion/work-orders/transitions")
const { conciliatePart, listPendingConciliation } = await import("@/lib/services/mantencion/parts/conciliation")
const { registerWorkOrderRecordFromWeb } = await import("@/lib/services/mantencion/web-record")
const { getUserRbacById } = await import("@/lib/auth/rbac")

const today = todayInChile()
const P = { filter: "p-l4-filter", hose: "p-l4-hose", oil: "p-l4-oil", bolt: "p-l4-bolt", gen: "p-l4-gen" } as const

async function contextOf(userId: string) {
  const rbac = await getUserRbacById(userId, true)
  if (!rbac) throw new Error(`Sin RBAC para ${userId}`)
  return {
    rbac,
    sync: {
      userName: rbac.name, deviceId: "dev-test", credentialId: "cred-test",
      viewer: { userId: rbac.id, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal },
    },
  }
}
async function actorOf(userId: string) {
  const { rbac } = await contextOf(userId)
  return { userId: rbac.id, name: rbac.name, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal }
}
async function viewerOf(userId: string) {
  return (await contextOf(userId)).sync.viewer
}

function ok<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!result.ok) throw new Error(`Se esperaba éxito: ${result.message}`)
  return result.value
}
function refused(result: { ok: boolean; message?: string; field?: string }) {
  if (result.ok) throw new Error("Se esperaba un rechazo")
  return result as { ok: false; message: string; field?: string }
}

const entry = (): WorkOrderEntryPayload => ({
  workshopKind: "interno", workshopId: null, workshopManagerName: "Don Pedro", operatorDriverId: IDS.driver1, operatorName: null,
  entryAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), odometer: 12_000, hourmeter: null,
  estimatedDeliveryDate: addDaysToPlainDate(today, 3),
})

/** OT por el servicio real: la crea la jefatura, la asigna y el mecánico la deja «En taller». */
async function newOt(options: { vehicleId?: string; mechanic?: string } = {}): Promise<string> {
  const mechanic = options.mechanic ?? IDS.mecBio
  const input = createWorkOrderSchema.parse({
    clientRequestId: crypto.randomUUID(), vehicleId: options.vehicleId ?? IDS.truckBio, repair: true, maintenance: false, requestDate: today,
    requesterName: "Alexis Morales", repairDescription: "Fuga de aceite en el motor", observations: null,
    annexItems: ["Cambiar manguera de aire"], maintenanceItems: [], assignedToUserId: null,
  })
  const id = ok(await createWorkOrder(await actorOf(IDS.jefe), input)).id
  ok(await transitions.assignWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, assignedToUserId: mechanic }))
  ok(await transitions.startWorkOrder(await actorOf(mechanic), { workOrderId: id, entry: entry() }))
  return id
}

async function ingress(productId: string, quantity: number, worksiteId: string = IDS.wsBio) {
  await testDb.transaction((tx) => applyMovementTx(tx as unknown as Tx, {
    worksiteId, productId, type: "ingreso_oc", quantity, performedBy: IDS.jefe, referenceType: "test", referenceId: "seed",
  }))
}

/** Lo que hace la recepción de una compra para la OT: reserva en la bodega de la faena. */
async function reserve(workOrderId: string, productId: string, quantity: number, worksiteId: string = IDS.wsBio) {
  const result = await testDb.transaction(async (raw) => {
    const tx = raw as unknown as Tx
    await parts.lockForStockTx(tx, { workOrderIds: [workOrderId], worksiteId, productIds: [productId] })
    return parts.addToAllocationTx(tx, { workOrderId, worksiteId, productId, quantity, source: "recepcion", actorUserId: IDS.jefe })
  })
  if (!result) throw new Error("La OT no admite reserva")
  return result.allocationId
}

async function stockOf(productId: string, worksiteId: string = IDS.wsBio): Promise<number> {
  const [row] = await testDb.select({ quantity: schema.worksiteStock.quantity }).from(schema.worksiteStock)
    .where(and(eq(schema.worksiteStock.worksiteId, worksiteId), eq(schema.worksiteStock.productId, productId)))
  return Math.round(Number(row?.quantity ?? 0) * 100) / 100
}
async function remainingOf(allocationId: string): Promise<number> {
  return parts.allocationRemainingTx(testDb as unknown as Tx, allocationId)
}
async function allocationRow(id: string) {
  const [row] = await testDb.select().from(schema.mantPartsAllocations).where(eq(schema.mantPartsAllocations.id, id))
  return row
}

type PartInput = { quantity: number; description: string; source?: "stock" | "externo"; productId?: string | null; allocationId?: string | null }
const stockPart = (productId: string, quantity: number, allocationId?: string | null): PartInput => ({
  quantity, description: `Repuesto ${productId}`, source: "stock", productId, ...(allocationId !== undefined ? { allocationId } : {}),
})

let readingCounter = 0
/** El registro firmado en el teléfono: el mismo contrato que valida el servidor. */
async function buildRecord(workOrderId: string | null, partList: PartInput[], overrides: Record<string, unknown> = {}, userId: string = IDS.mecBio): Promise<SyncRecord> {
  const photoId = crypto.randomUUID()
  await insertOrphanPhoto(testDb, { id: photoId, userId, kind: "correctiva" })
  readingCounter += 10
  // Cholguán parte de una lectura inicial más alta que Biodiversa.
  const base = overrides.vehicleId === IDS.truckCho ? 30_000 : 12_000
  return syncRecordSchema.parse({
    id: crypto.randomUUID(), vehicleId: IDS.truckBio, reading: base + readingCounter, workDate: today, signedAt: new Date().toISOString(), offlineSince: null,
    deviceId: crypto.randomUUID(), appVersion: "test", readingJumpConfirmed: false, duplicateConfirmed: false, correctsRecordId: null,
    kind: "C", oilIds: [IDS.oilMotor], noOilChange: false, executor: { kind: "yo" },
    jobs: [{ workTypeId: IDS.wtMec, hours: 2, noParts: partList.length === 0, parts: partList }],
    description: "Cambio de manguera de aire", inWorkshop: false, workshopEntryDate: null, workshopReason: null, workOrder: null,
    driverIds: [IDS.driver1], photos: [{ id: photoId, kind: "correctiva" }], workOrderId, ...overrides,
  })
}

async function sign(workOrderId: string | null, partList: PartInput[], overrides: Record<string, unknown> = {}, userId: string = IDS.mecBio) {
  const input = await buildRecord(workOrderId, partList, overrides, userId)
  const outcome = await createRecord(input, (await contextOf(userId)).sync)
  return { input, outcome }
}
async function signOk(workOrderId: string | null, partList: PartInput[], overrides: Record<string, unknown> = {}) {
  const { input, outcome } = await sign(workOrderId, partList, overrides)
  if (!outcome.body.ok) throw new Error(`Registro rechazado: ${outcome.body.message}`)
  return { id: input.id, folio: outcome.body.folio }
}

async function linesOf(recordId: string) {
  return testDb.select().from(schema.mantRecordParts).where(eq(schema.mantRecordParts.recordId, recordId)).orderBy(asc(schema.mantRecordParts.sortOrder))
}
async function movementsOf(recordId: string) {
  return testDb.select().from(schema.inventoryMovements)
    .where(eq(schema.inventoryMovements.referenceId, recordId))
    .orderBy(asc(schema.inventoryMovements.performedAt))
}
async function eventsOf(workOrderId: string, type: string) {
  return testDb.select().from(schema.mantWorkOrderEvents)
    .where(and(eq(schema.mantWorkOrderEvents.workOrderId, workOrderId), eq(schema.mantWorkOrderEvents.type, type)))
}
async function recordRow(id: string) {
  const [row] = await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, id))
  return row
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 150))
async function alerts() {
  return (await testDb.select().from(schema.notifications)).filter((row) => row.type === "mant_np_stock_pending")
}

/** Lleva la OT hasta «cerrada» por los servicios reales (el registro ya está firmado). */
async function conform(workOrderId: string) {
  const items = await testDb.select().from(schema.mantWorkOrderItems).where(eq(schema.mantWorkOrderItems.workOrderId, workOrderId))
  ok(await transitions.markWorkOrderItems(await actorOf(IDS.mecBio), {
    workOrderId, marks: items.map((item) => ({ itemId: item.id, done: "si" as const, note: null })), added: [],
  }))
  ok(await transitions.finishWorkOrder(await actorOf(IDS.mecBio), { workOrderId, exitAt: new Date(Date.now() - 60_000).toISOString(), note: null }))
  ok(await transitions.receiveWorkOrder(await actorOf(IDS.jefe), { workOrderId, receivedAt: new Date().toISOString(), receiverName: "Pedro Retira" }))
  return ok(await transitions.conformWorkOrder(await actorOf(IDS.adminBio), { workOrderId, faenaReceivedAt: new Date().toISOString(), faenaReceiverName: "Ana Faena" }))
}

beforeAll(async () => {
  configureZodLocale()
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedMantFixtures(testDb)
  const now = new Date().toISOString()
  await testDb.insert(schema.productCategories).values({ id: "cat-l4", name: "Repuestos L4", slug: "repuestos-l4", isEpp: false, requiresPrevencion: false, sortOrder: 1 })
  await testDb.insert(schema.products).values([
    { id: P.filter, sku: "REP-L4-1", name: "Filtro de aceite", categoryId: "cat-l4", unitOfMeasure: "unidad", isSparePart: true, partNumber: "FA-1", isActive: true, createdAt: now, updatedAt: now },
    { id: P.hose, sku: "REP-L4-2", name: "Manguera de aire", categoryId: "cat-l4", unitOfMeasure: "unidad", isSparePart: true, partNumber: "MG-2", isActive: true, createdAt: now, updatedAt: now },
    { id: P.oil, sku: "REP-L4-3", name: "Aceite hidráulico", categoryId: "cat-l4", unitOfMeasure: "litro", isSparePart: true, partNumber: "AH-3", isActive: true, createdAt: now, updatedAt: now },
    { id: P.bolt, sku: "REP-L4-4", name: "Perno", categoryId: "cat-l4", unitOfMeasure: "unidad", isSparePart: true, partNumber: "PE-4", isActive: true, createdAt: now, updatedAt: now },
    { id: P.gen, sku: "GEN-L4-5", name: "Guante", categoryId: "cat-l4", unitOfMeasure: "unidad", isActive: true, createdAt: now, updatedAt: now },
  ])
})

afterAll(() => rmSync(storageRoot, { recursive: true, force: true }))

beforeEach(async () => {
  for (const table of [
    schema.mantRecordObservations, schema.mantRecordVoids, schema.mantWorkshopUpdates, schema.mantRecordPhotos,
    schema.mantRecordParts, schema.mantRecords, schema.mantPartsAllocationSources, schema.mantPartsAllocations,
    schema.mantWorkOrderEvents, schema.mantWorkOrderItems, schema.mantWorkOrders, schema.mantFolioCounters,
    schema.inventoryMovements, schema.worksiteStock, schema.notifications, schema.auditLog, schema.fuelVehicleOperationalIntervals,
  ]) await testDb.delete(table)
  await testDb.update(schema.fuelVehicles).set({ operationalStatus: "operativo" })
  await testDb.update(schema.worksites).set({ isActive: true })
})

describe("el registro descuenta de la bodega", () => {
  it("descuenta de la reserva de la OT, enlaza el movimiento (egreso_mantencion → registro) y deja el evento parts_consumed", async () => {
    const ot = await newOt()
    await ingress(P.filter, 5)
    const allocationId = await reserve(ot, P.filter, 3)

    const { id, folio } = await signOk(ot, [stockPart(P.filter, 2, allocationId)])

    const [line] = await linesOf(id)
    expect(line).toMatchObject({ source: "stock", productId: P.filter, allocationId, stockStatus: "descontado", stockNote: null, reversalMovementId: null })
    expect(line!.inventoryMovementId).toBeTruthy()
    const [movement] = await movementsOf(id)
    expect(movement).toMatchObject({
      id: line!.inventoryMovementId, type: "egreso_mantencion", referenceType: "mant_record", referenceId: id,
      worksiteId: IDS.wsBio, productId: P.filter, performedBy: IDS.mecBio,
    })
    expect(Number(movement!.quantity)).toBe(-2)
    expect(await stockOf(P.filter)).toBe(3)
    expect(await remainingOf(allocationId)).toBe(1)

    const [event] = await eventsOf(ot, "parts_consumed")
    expect(event).toBeTruthy()
    const changeSet = event!.changeSet as { recordId: string; folio: string; items: Array<Record<string, unknown>> }
    expect(changeSet).toMatchObject({ recordId: id, folio })
    expect(changeSet.items).toEqual([expect.objectContaining({ recordPartId: line!.id, productId: P.filter, quantity: 2, status: "descontado" })])
    await settle()
    expect(await alerts()).toHaveLength(0)
  })

  it("sin stock suficiente el registro se guarda igual: la línea queda pendiente de conciliar con su nota y avisa a quienes concilian", async () => {
    const ot = await newOt()
    await ingress(P.hose, 1)

    const { id, folio } = await signOk(ot, [stockPart(P.hose, 3)])

    expect((await recordRow(id))?.status).toBe("vigente")
    const [line] = await linesOf(id)
    expect(line).toMatchObject({ source: "stock", productId: P.hose, stockStatus: "pendiente_conciliar", inventoryMovementId: null })
    expect(line!.stockNote).toContain("Faltaban 2")
    expect(await stockOf(P.hose)).toBe(1)
    expect(await movementsOf(id)).toHaveLength(0)

    const [event] = await eventsOf(ot, "parts_consumed")
    expect((event!.changeSet as { items: Array<Record<string, unknown>> }).items).toEqual([expect.objectContaining({ status: "pendiente_conciliar" })])

    await settle()
    const sent = await alerts()
    const [otRow] = await testDb.select().from(schema.mantWorkOrders).where(eq(schema.mantWorkOrders.id, ot))
    const recipients = sent.map((row) => row.userId)
    expect(recipients).toContain(IDS.jefe)
    expect(recipients).toContain(IDS.supBio)
    expect(recipients).not.toContain(IDS.mecBio)
    const forJefe = sent.find((row) => row.userId === IDS.jefe)!
    expect(forJefe.body).toBe(`Faltó stock: Manguera de aire · OT ${otRow!.folio} · registro ${folio}. Concilia desde Notas de pedido.`)
  })

  it("el mismo registro enviado dos veces no descuenta dos veces", async () => {
    const ot = await newOt()
    await ingress(P.filter, 5)
    const allocationId = await reserve(ot, P.filter, 5)
    const input = await buildRecord(ot, [stockPart(P.filter, 2, allocationId)])
    const context = (await contextOf(IDS.mecBio)).sync

    const first = await createRecord(input, context)
    const again = await createRecord(input, context)

    expect(first.body).toMatchObject({ ok: true, duplicate: false })
    expect(again.body).toMatchObject({ ok: true, duplicate: true })
    expect(await stockOf(P.filter)).toBe(3)
    expect(await movementsOf(input.id)).toHaveLength(1)
    expect(await linesOf(input.id)).toHaveLength(1)
    expect(await eventsOf(ot, "parts_consumed")).toHaveLength(1)
  })

  it("rechaza (422) la reserva de otra OT, un producto que no es repuesto y una cantidad fraccionaria en unidades enteras", async () => {
    const otA = await newOt()
    const otB = await newOt({ vehicleId: IDS.truckCho, mechanic: IDS.mecCho })
    await ingress(P.filter, 5)
    const allocationA = await reserve(otA, P.filter, 5)

    const other = await sign(otB, [stockPart(P.filter, 1, allocationA)], { vehicleId: IDS.truckCho }, IDS.mecCho)
    expect(other.outcome).toMatchObject({ status: 422, body: { ok: false, field: "jobs.0.parts.0.allocationId" } })
    expect(other.outcome.body.ok === false && other.outcome.body.message).toBe("Esa reserva es de otra orden de trabajo o de otro repuesto.")

    const notPart = await sign(otA, [stockPart(P.gen, 1)])
    expect(notPart.outcome).toMatchObject({ status: 422, body: { ok: false, field: "jobs.0.parts.0.productId" } })

    const fractional = await sign(otA, [stockPart(P.filter, 1.5)])
    expect(fractional.outcome).toMatchObject({ status: 422, body: { ok: false, field: "jobs.0.parts.0.quantity" } })

    expect(await stockOf(P.filter)).toBe(5)
    expect(await testDb.select().from(schema.mantRecords)).toHaveLength(0)
    expect(await testDb.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.type, "egreso_mantencion"))).toHaveLength(0)
  })

  it("una línea inválida revierte el descuento de las anteriores: el registro no queda a medias", async () => {
    const ot = await newOt()
    await ingress(P.filter, 5)
    await ingress(P.hose, 5)
    const allocationFilter = await reserve(ot, P.filter, 5)

    // La línea 1 (filtro) descuenta bien; la 2 apunta a una reserva que no es de su repuesto.
    const { outcome } = await sign(ot, [stockPart(P.filter, 2, allocationFilter), stockPart(P.hose, 1, allocationFilter)])

    expect(outcome).toMatchObject({ status: 422, body: { ok: false, field: "jobs.0.parts.1.allocationId" } })
    expect(await stockOf(P.filter)).toBe(5)
    expect(await remainingOf(allocationFilter)).toBe(5)
    expect(await testDb.select().from(schema.mantRecords)).toHaveLength(0)
    expect(await testDb.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.type, "egreso_mantencion"))).toHaveLength(0)
  })

  it("dos líneas del mismo repuesto en un registro descuentan en orden: la segunda sale del libre y puede quedar pendiente", async () => {
    const ot = await newOt()
    await ingress(P.filter, 5)
    const allocationId = await reserve(ot, P.filter, 3)

    // 2 + 2 con 5 en bodega (3 reservados para esta OT): las dos caben (la segunda pasa de la reserva y sale del libre).
    const both = await signOk(ot, [stockPart(P.filter, 2, allocationId), stockPart(P.filter, 2, allocationId)])
    expect((await linesOf(both.id)).map((line) => line.stockStatus)).toEqual(["descontado", "descontado"])
    expect(await stockOf(P.filter)).toBe(1)
    expect((await movementsOf(both.id)).map((movement) => Number(movement.quantity))).toEqual([-2, -2])

    // Con 1 en bodega la tercera línea ya no cabe: queda pendiente y el registro se guarda.
    const third = await signOk(ot, [stockPart(P.filter, 2, allocationId)])
    const [line] = await linesOf(third.id)
    expect(line).toMatchObject({ stockStatus: "pendiente_conciliar", inventoryMovementId: null })
    expect(line!.stockNote).toContain("Faltaban 1")
    expect(await stockOf(P.filter)).toBe(1)
  })

  it("source stock sin OT enlazada: 422 con el mensaje de D12 apuntando a la línea", async () => {
    await ingress(P.filter, 5)

    const { outcome } = await sign(null, [stockPart(P.filter, 1)])

    expect(outcome).toMatchObject({ status: 422, body: { ok: false, field: "jobs.0.parts.0.source" } })
    expect(outcome.body.ok === false && outcome.body.message).toBe("Para descontar de la bodega, el registro debe estar enlazado a una orden de trabajo.")
    expect(await stockOf(P.filter)).toBe(5)
    expect(await testDb.select().from(schema.mantRecords)).toHaveLength(0)
  })

  it("un teléfono viejo (partes sin source) sigue funcionando: texto libre, sin tocar el stock", async () => {
    const ot = await newOt()
    await ingress(P.filter, 5)
    const allocationId = await reserve(ot, P.filter, 5)

    // El cuerpo exacto del teléfono sin actualizar: sólo cantidad y descripción.
    const input = syncRecordSchema.parse(correctiveBody([], {
      vehicleId: IDS.truckBio, workOrderId: ot, workDate: today, reading: 12_500,
      jobs: [{ workTypeId: IDS.wtMec, hours: 2, noParts: false, parts: [{ quantity: 1, description: "Filtro de aceite" }] }],
      photos: await (async () => {
        const photoId = crypto.randomUUID()
        await insertOrphanPhoto(testDb, { id: photoId, userId: IDS.mecBio, kind: "correctiva" })
        return [{ id: photoId, kind: "correctiva" }]
      })(),
      oilIds: [IDS.oilMotor], executor: { kind: "yo" }, driverIds: [IDS.driver1],
    }))
    const outcome = await createRecord(input, (await contextOf(IDS.mecBio)).sync)
    expect(outcome.body.ok).toBe(true)

    const [line] = await linesOf(input.id)
    expect(line).toMatchObject({ source: "texto", productId: null, allocationId: null, stockStatus: "no_aplica", inventoryMovementId: null })
    expect(await stockOf(P.filter)).toBe(5)
    expect(await remainingOf(allocationId)).toBe(5)
    expect(await eventsOf(ot, "parts_consumed")).toHaveLength(0)
  })

  it("un repuesto externo no mueve stock: no_aplica, con su producto si lo eligió", async () => {
    const ot = await newOt()
    await ingress(P.filter, 5)

    const { id } = await signOk(ot, [{ quantity: 1, description: "Filtro que trajo el taller", source: "externo", productId: P.filter }])

    const [line] = await linesOf(id)
    expect(line).toMatchObject({ source: "externo", productId: P.filter, stockStatus: "no_aplica", inventoryMovementId: null })
    expect(await stockOf(P.filter)).toBe(5)
    expect(await eventsOf(ot, "parts_consumed")).toHaveLength(0)
  })

  it("el registro web pasa por el mismo camino: descuenta, enlaza y deja el evento", async () => {
    const ot = await newOt()
    await ingress(P.filter, 4)
    const allocationId = await reserve(ot, P.filter, 4)

    const input = await buildRecord(ot, [stockPart(P.filter, 3, allocationId)], {}, IDS.mecBio)
    // El formulario web manda el registro en JSON y las fotos como archivos; aquí la foto es real.
    await testDb.delete(schema.mantRecordPhotos)
    const jpeg = await makeJpeg(32, 24)
    const photoId = crypto.randomUUID()
    const form = new FormData()
    form.set("record", JSON.stringify({ ...input, photos: [{ id: photoId, kind: "correctiva" }] }))
    form.set(`photo:${photoId}`, new File([jpeg as BlobPart], `${photoId}.jpg`, { type: "image/jpeg" }))
    form.set(`meta:${photoId}`, JSON.stringify(await metaFor(jpeg, { kind: "correctiva" })))
    const context = { ...(await contextOf(IDS.mecBio)).sync, deviceId: MANT_WEB_DEVICE_ID, credentialId: "web" }

    const outcome = await registerWorkOrderRecordFromWeb(context, form)

    expect(outcome).toMatchObject({ ok: true, duplicate: false })
    const [line] = await linesOf(input.id)
    expect(line).toMatchObject({ source: "stock", productId: P.filter, allocationId, stockStatus: "descontado" })
    const [movement] = await movementsOf(input.id)
    expect(movement).toMatchObject({ type: "egreso_mantencion", referenceType: "mant_record" })
    expect(await stockOf(P.filter)).toBe(1)
    expect(await eventsOf(ot, "parts_consumed")).toHaveLength(1)
  })
})

describe("anular el registro", () => {
  it("repone el stock (revertido, con su movimiento de reverso) y cierra las pendientes como sin_movimiento", async () => {
    const ot = await newOt()
    await ingress(P.filter, 5)
    await ingress(P.hose, 1)
    const allocationId = await reserve(ot, P.filter, 5)
    const { id } = await signOk(ot, [stockPart(P.filter, 2, allocationId), stockPart(P.hose, 4)])
    expect(await stockOf(P.filter)).toBe(3)

    const result = await voidRecord({ recordId: id, reason: "Se firmó con la cantidad equivocada", viewer: await viewerOf(IDS.jefe) })

    expect(result.ok).toBe(true)
    const lines = await linesOf(id)
    const discounted = lines.find((line) => line.productId === P.filter)!
    const pending = lines.find((line) => line.productId === P.hose)!
    expect(discounted.stockStatus).toBe("revertido")
    expect(discounted.reversalMovementId).toBeTruthy()
    expect(pending).toMatchObject({ stockStatus: "sin_movimiento", inventoryMovementId: null })
    expect(pending.stockNote).toBe("Registro anulado antes de conciliar.")
    expect(await stockOf(P.filter)).toBe(5)
    expect(await remainingOf(allocationId)).toBe(5)
    const reversal = (await movementsOf(id)).find((movement) => movement.id === discounted.reversalMovementId)
    expect(reversal).toMatchObject({ type: "ingreso_anulacion", referenceType: "mant_record_void", referenceId: id })
    expect((await recordRow(id))?.status).toBe("anulado")
  })

  it("si la OT ya salió de taller no se anula (como antes) y el stock no se toca", async () => {
    const ot = await newOt()
    await ingress(P.filter, 5)
    const allocationId = await reserve(ot, P.filter, 5)
    const { id } = await signOk(ot, [stockPart(P.filter, 2, allocationId)])
    await conform(ot)

    const result = refused(await voidRecord({ recordId: id, reason: "Se firmó con la cantidad equivocada", viewer: await viewerOf(IDS.jefe) }))

    expect(result.message).toContain("ya salió de taller")
    expect((await recordRow(id))?.status).toBe("vigente")
    expect((await linesOf(id))[0]).toMatchObject({ stockStatus: "descontado", reversalMovementId: null })
    expect(await stockOf(P.filter)).toBe(3)
  })

  it("si la faena está cerrada no se puede reponer: el registro NO se anula y el stock queda como estaba", async () => {
    const ot = await newOt()
    await ingress(P.filter, 5)
    const allocationId = await reserve(ot, P.filter, 5)
    const { id } = await signOk(ot, [stockPart(P.filter, 2, allocationId)])
    await testDb.update(schema.worksites).set({ isActive: false }).where(eq(schema.worksites.id, IDS.wsBio))

    const result = refused(await voidRecord({ recordId: id, reason: "Se firmó con la cantidad equivocada", viewer: await viewerOf(IDS.jefe) }))

    expect(result.message).toContain("Biodiversa está cerrada")
    expect((await recordRow(id))?.status).toBe("vigente")
    expect(await testDb.select().from(schema.mantRecordVoids).where(eq(schema.mantRecordVoids.recordId, id))).toHaveLength(0)
    const [line] = await linesOf(id)
    expect(line).toMatchObject({ stockStatus: "descontado", reversalMovementId: null })
    expect(await stockOf(P.filter)).toBe(3)
  })
})

describe("cerrar, anular y reabrir la OT", () => {
  it("conformar la OT libera el saldo de la reserva a stock libre, con su evento", async () => {
    const ot = await newOt()
    await ingress(P.filter, 5)
    const allocationId = await reserve(ot, P.filter, 5)
    await signOk(ot, [stockPart(P.filter, 2, allocationId)])
    await conform(ot)

    const allocation = await allocationRow(allocationId)
    expect(allocation).toMatchObject({ status: "liberada", releasedByUserId: IDS.adminBio, releaseReason: "OT cerrada" })
    expect(await remainingOf(allocationId)).toBe(0)
    expect(await stockOf(P.filter)).toBe(3)
    expect(await eventsOf(ot, "parts_released")).toHaveLength(1)
    const free = await testDb.transaction(async (raw) => {
      const tx = raw as unknown as Tx
      await parts.lockForStockTx(tx, { worksiteId: IDS.wsBio, productIds: [P.filter] })
      return parts.freeStockTx(tx, IDS.wsBio, P.filter)
    })
    expect(free).toBe(3)
  })

  // Este caso falla mientras `release.ts` use `consumedSql` como campo directo de un select de una sola tabla:
  // drizzle le quita los prefijos de tabla a las columnas y la subconsulta compara `allocation_id = id` (el
  // id de la línea), así que «consumido» da siempre 0 y se informa como liberada la reserva ENTERA. Ver el informe de L4.
  it("lo liberado y su evento cuentan lo que NO se usó (3 de 5), no la reserva completa", async () => {
    const ot = await newOt()
    await ingress(P.filter, 5)
    const allocationId = await reserve(ot, P.filter, 5)
    await signOk(ot, [stockPart(P.filter, 2, allocationId)])

    await conform(ot)

    expect(Number((await allocationRow(allocationId))!.releasedQuantity)).toBe(3)
    const [event] = await eventsOf(ot, "parts_released")
    expect((event!.changeSet as { items: Array<Record<string, unknown>> }).items).toEqual([expect.objectContaining({ allocationId, productId: P.filter, quantity: 3 })])
  })

  it("anular la OT también libera la reserva, con el motivo en la liberación", async () => {
    const ot = await newOt()
    await ingress(P.bolt, 6)
    const allocationId = await reserve(ot, P.bolt, 4)

    ok(await transitions.voidWorkOrder(await actorOf(IDS.jefe), { workOrderId: ot, reason: "El equipo se dio de baja" }))

    const allocation = await allocationRow(allocationId)
    expect(allocation).toMatchObject({ status: "liberada", releaseReason: "OT anulada: El equipo se dio de baja" })
    expect(Number(allocation!.releasedQuantity)).toBe(4)
    expect(await eventsOf(ot, "parts_released")).toHaveLength(1)
    expect(await stockOf(P.bolt)).toBe(6)
  })

  it("reabrir la OT no vuelve a reservar: lo liberado sigue libre", async () => {
    const ot = await newOt()
    await ingress(P.filter, 5)
    const allocationId = await reserve(ot, P.filter, 5)
    await signOk(ot, [stockPart(P.filter, 2, allocationId)])
    await conform(ot)

    ok(await transitions.reopenWorkOrder(await actorOf(IDS.jefe), { workOrderId: ot, reason: "La falla reapareció en terreno" }))

    const all = await testDb.select().from(schema.mantPartsAllocations).where(eq(schema.mantPartsAllocations.workOrderId, ot))
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id: allocationId, status: "liberada" })
    expect(await remainingOf(allocationId)).toBe(0)
    expect(await eventsOf(ot, "parts_allocated")).toHaveLength(1)
  })
})

describe("conciliar", () => {
  /** Un registro con una línea que quedó pendiente porque faltaba stock. */
  async function pendingLine(options: { productId?: string; quantity?: number; stock?: number } = {}) {
    const ot = await newOt()
    const productId = options.productId ?? P.hose
    if (options.stock) await ingress(productId, options.stock)
    const { id, folio } = await signOk(ot, [stockPart(productId, options.quantity ?? 3)])
    const [line] = await linesOf(id)
    expect(line!.stockStatus).toBe("pendiente_conciliar")
    return { ot, recordId: id, folio, lineId: line!.id, productId }
  }

  it("aplicar con stock ya disponible descuenta, enlaza el movimiento, toca el registro y deja bitácora", async () => {
    const { recordId, lineId, ot } = await pendingLine({ stock: 1 })
    await ingress(P.hose, 4)
    const before = await recordRow(recordId)

    const result = await conciliatePart(await viewerOf(IDS.jefe), { recordPartId: lineId, mode: "aplicar" })

    expect(result.ok).toBe(true)
    const [line] = await linesOf(recordId)
    expect(line).toMatchObject({ stockStatus: "descontado", stockNote: null })
    expect(line!.inventoryMovementId).toBeTruthy()
    const [movement] = await movementsOf(recordId)
    expect(movement).toMatchObject({ id: line!.inventoryMovementId, type: "egreso_mantencion", referenceType: "mant_record", referenceId: recordId, performedBy: IDS.jefe })
    expect(Number(movement!.quantity)).toBe(-3)
    expect(await stockOf(P.hose)).toBe(2)
    expect(new Date((await recordRow(recordId))!.updatedAt).getTime()).toBeGreaterThan(new Date(before!.updatedAt).getTime())
    const audit = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, lineId))
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ userId: IDS.jefe, action: "update" })
    expect(await eventsOf(ot, "parts_consumed")).toHaveLength(2)
    expect((await listPendingConciliation(await viewerOf(IDS.jefe), {})).total).toBe(0)
  })

  it("aplicar cuando todavía falta stock no mueve nada y dice cuánto falta", async () => {
    const { recordId, lineId } = await pendingLine({ stock: 1 })

    const result = refused(await conciliatePart(await viewerOf(IDS.jefe), { recordPartId: lineId, mode: "aplicar" }))

    expect(result.message).toBe("Todavía faltan 2 en Biodiversa.")
    const [line] = await linesOf(recordId)
    expect(line).toMatchObject({ stockStatus: "pendiente_conciliar", inventoryMovementId: null })
    expect(await stockOf(P.hose)).toBe(1)
  })

  it("dos conciliaciones de la misma línea: sólo una mueve stock", async () => {
    const { recordId, lineId } = await pendingLine({ stock: 1 })
    await ingress(P.hose, 4)
    const viewer = await viewerOf(IDS.jefe)

    const results = await Promise.all([
      conciliatePart(viewer, { recordPartId: lineId, mode: "aplicar" }),
      conciliatePart(viewer, { recordPartId: lineId, mode: "aplicar" }),
    ])

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toHaveLength(1)
    expect(await movementsOf(recordId)).toHaveLength(1)
    expect(await stockOf(P.hose)).toBe(2)
    const again = refused(await conciliatePart(viewer, { recordPartId: lineId, mode: "aplicar" }))
    expect(again.message).toContain("ya")
    expect(await stockOf(P.hose)).toBe(2)
  })

  it("sin_movimiento exige un motivo y deja la línea cerrada sin tocar el stock", async () => {
    const { recordId, lineId } = await pendingLine({ stock: 1 })
    const viewer = await viewerOf(IDS.jefe)
    const before = await recordRow(recordId)

    expect(refused(await conciliatePart(viewer, { recordPartId: lineId, mode: "sin_movimiento", reason: "abc" })).field).toBe("reason")
    expect((await linesOf(recordId))[0]!.stockStatus).toBe("pendiente_conciliar")

    const result = await conciliatePart(viewer, { recordPartId: lineId, mode: "sin_movimiento", reason: "Se compró afuera y no pasó por bodega" })

    expect(result.ok).toBe(true)
    const [line] = await linesOf(recordId)
    expect(line).toMatchObject({ stockStatus: "sin_movimiento", stockNote: "Se compró afuera y no pasó por bodega", inventoryMovementId: null })
    expect(await stockOf(P.hose)).toBe(1)
    expect(new Date((await recordRow(recordId))!.updatedAt).getTime()).toBeGreaterThan(new Date(before!.updatedAt).getTime())
    expect(await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, lineId))).toHaveLength(1)
    const again = refused(await conciliatePart(viewer, { recordPartId: lineId, mode: "sin_movimiento", reason: "Se compró afuera y no pasó por bodega" }))
    expect(again.message).toContain("ya")
  })

  it("con la OT ya cerrada (reserva liberada) aplicar toma stock libre", async () => {
    const ot = await newOt()
    await ingress(P.hose, 1)
    const allocationId = await reserve(ot, P.hose, 1)
    const { id } = await signOk(ot, [stockPart(P.hose, 3, allocationId)])
    const [pending] = await linesOf(id)
    expect(pending!.stockStatus).toBe("pendiente_conciliar")
    await conform(ot)
    expect((await allocationRow(allocationId))!.status).toBe("liberada")
    await ingress(P.hose, 5)

    const result = await conciliatePart(await viewerOf(IDS.jefe), { recordPartId: pending!.id, mode: "aplicar" })

    expect(result.ok).toBe(true)
    const [line] = await linesOf(id)
    expect(line).toMatchObject({ stockStatus: "descontado", allocationId: null })
    expect(await stockOf(P.hose)).toBe(3)
  })

  it("exige mant:np:manage y la faena de la línea en el alcance; las demás parecen no existir", async () => {
    const { lineId } = await pendingLine({ stock: 1 })
    await ingress(P.hose, 4)

    expect(refused(await conciliatePart(await viewerOf(IDS.mecBio), { recordPartId: lineId, mode: "aplicar" })).message).toContain("permiso")
    // Una línea de Cholguán, fuera del alcance del supervisor de Biodiversa.
    const otCho = await newOt({ vehicleId: IDS.truckCho, mechanic: IDS.mecCho })
    const { outcome, input } = await sign(otCho, [stockPart(P.oil, 2)], { vehicleId: IDS.truckCho }, IDS.mecCho)
    expect(outcome.body.ok).toBe(true)
    const [lineCho] = await linesOf(input.id)
    expect(lineCho!.stockStatus).toBe("pendiente_conciliar")

    expect(refused(await conciliatePart(await viewerOf(IDS.supBio), { recordPartId: lineCho!.id, mode: "aplicar" })).message).toBe("No encontramos esa línea de repuesto.")
    expect(refused(await conciliatePart(await viewerOf(IDS.jefe), { recordPartId: "no-existe", mode: "aplicar" })).message).toBe("No encontramos esa línea de repuesto.")
    expect((await linesOf(input.id))[0]!.stockStatus).toBe("pendiente_conciliar")
    // El supervisor sí concilia la de su faena.
    expect((await conciliatePart(await viewerOf(IDS.supBio), { recordPartId: lineId, mode: "aplicar" })).ok).toBe(true)
  })
})

describe("pendientes de conciliar (lista)", () => {
  async function pendingIn(vehicleId: string, mechanic: string, productId: string, quantity: number) {
    const ot = await newOt({ vehicleId, mechanic })
    const { input, outcome } = await sign(ot, [stockPart(productId, quantity)], { vehicleId }, mechanic)
    if (!outcome.body.ok) throw new Error(outcome.body.message)
    return { ot, recordId: input.id, folio: outcome.body.folio }
  }

  it("lista lo pendiente de registros vigentes dentro del alcance, con OT, faena, producto, cantidad y libre hoy; pagina", async () => {
    const bio = await pendingIn(IDS.truckBio, IDS.mecBio, P.hose, 3)
    await pendingIn(IDS.truckCho, IDS.mecCho, P.oil, 2)
    await ingress(P.hose, 2)
    const [otBio] = await testDb.select().from(schema.mantWorkOrders).where(eq(schema.mantWorkOrders.id, bio.ot))

    const all = await listPendingConciliation(await viewerOf(IDS.jefe), {})
    expect(all.total).toBe(2)
    const rowBio = all.rows.find((row) => row.productId === P.hose)!
    expect(rowBio).toMatchObject({
      recordId: bio.recordId, recordFolio: bio.folio, workOrderId: bio.ot, workOrderFolio: otBio!.folio, worksiteId: IDS.wsBio, worksiteName: "Biodiversa",
      productName: "Manguera de aire", quantity: 3, freeNow: 2,
    })
    expect(rowBio.note).toContain("Faltaban 3")
    expect(new Date(rowBio.signedAt).getTime()).not.toBeNaN()

    const scoped = await listPendingConciliation(await viewerOf(IDS.supBio), {})
    expect(scoped.rows.map((row) => row.worksiteId)).toEqual([IDS.wsBio])
    expect(scoped.total).toBe(1)
    expect(await listPendingConciliation(await viewerOf(IDS.mecBio), {})).toEqual({ rows: [], total: 0 })

    const onlyCho = await listPendingConciliation(await viewerOf(IDS.jefe), { worksiteId: IDS.wsCho })
    expect(onlyCho.rows.map((row) => row.productId)).toEqual([P.oil])
    const page1 = await listPendingConciliation(await viewerOf(IDS.jefe), { page: 1, pageSize: 1 })
    const page2 = await listPendingConciliation(await viewerOf(IDS.jefe), { page: 2, pageSize: 1 })
    expect(page1.total).toBe(2)
    expect(page1.rows).toHaveLength(1)
    expect(page2.rows).toHaveLength(1)
    expect(page2.rows[0]!.recordPartId).not.toBe(page1.rows[0]!.recordPartId)
  })

  it("un registro anulado o una línea ya conciliada salen de la lista", async () => {
    const one = await pendingIn(IDS.truckBio, IDS.mecBio, P.hose, 3)
    const two = await pendingIn(IDS.truckCho, IDS.mecCho, P.oil, 2)
    const viewer = await viewerOf(IDS.jefe)
    expect((await listPendingConciliation(viewer, {})).total).toBe(2)

    ok(await voidRecordOk({ recordId: one.recordId, reason: "Se firmó por error en la OT equivocada", viewer }))
    const [lineTwo] = await linesOf(two.recordId)
    await conciliatePart(viewer, { recordPartId: lineTwo!.id, mode: "sin_movimiento", reason: "Se compró afuera y no pasó por bodega" })

    expect(await listPendingConciliation(viewer, {})).toEqual({ rows: [], total: 0 })
  })
})

async function voidRecordOk(input: Parameters<typeof voidRecord>[0]): Promise<{ ok: true; value: true } | { ok: false; message: string }> {
  const result = await voidRecord(input)
  return result.ok ? { ok: true, value: true } : { ok: false, message: result.message }
}
