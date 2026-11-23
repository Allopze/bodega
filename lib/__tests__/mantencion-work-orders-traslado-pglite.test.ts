import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, asc, eq, inArray } from "drizzle-orm"
import path from "node:path"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { syncRecordSchema, type WorkOrderEntryPayload } from "@/lib/mantencion/contracts"
import { createWorkOrderSchema } from "@/lib/mantencion/work-order-schemas"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { configureZodLocale } from "@/lib/validation/zod-locale"
import { IDS, insertOrphanPhoto, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * La OT de un equipo trasladado sigue al equipo (decisión del usuario, 2026-11-22: «tras un traslado, la
 * conformidad de la OT la da el administrador de la faena de destino; la OT y la hoja de vida siguen al
 * equipo»). `mant_work_orders.worksite_id` queda como faena de IMPUTACIÓN; la faena ACTUAL es la del equipo
 * (`fuel_vehicles.worksite_id`, que sólo cambia por `transferVehiclesTx`). Postgres real (PGlite).
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
vi.mock("@/lib/combustibles/copec-sync", () => ({ requestCopecRecheckFrom: async () => ({ requested: true }) }))

const { createWorkOrder } = await import("@/lib/services/mantencion/work-orders/create")
const transitions = await import("@/lib/services/mantencion/work-orders/transitions")
const { listWorkOrders, loadWorkOrderDetail, workOrdersWhere } = await import("@/lib/services/mantencion/work-orders/query")
const { createRecord } = await import("@/lib/services/mantencion/records-create")
const { getUserRbacById } = await import("@/lib/auth/rbac")
const { sendWorkOrderNotification } = await import("@/lib/services/mantencion/work-orders/notifications")
const { transferVehiclesTx } = await import("@/lib/services/fleet-transfers")
const { loadOpenWorkOrdersByStatus } = await import("@/lib/services/mantencion/indicators")

const today = todayInChile()
/** Tercera faena con su propio administrador de contrato: no tiene nada que ver con el traslado. */
const ADMIN_ARA = "u-admin-ara"

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
function refused(result: { ok: boolean; message?: string; code?: string }) {
  if (result.ok) throw new Error("Se esperaba un rechazo")
  return result as { ok: false; message: string; code?: string }
}

const entry = (): WorkOrderEntryPayload => ({
  workshopKind: "interno", workshopId: null, workshopManagerName: "Don Pedro", operatorDriverId: IDS.driver1, operatorName: null,
  entryAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), odometer: 12_000, hourmeter: null,
  estimatedDeliveryDate: addDaysToPlainDate(today, 3),
})

async function row(id: string) {
  const [ot] = await testDb.select().from(schema.mantWorkOrders).where(eq(schema.mantWorkOrders.id, id))
  if (!ot) throw new Error("OT inexistente")
  return ot
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 150))
async function noticesOf(type: string) {
  return (await testDb.select().from(schema.notifications)).filter((notice) => notice.type === type).map((notice) => notice.userId).sort()
}

/** Una OT del equipo KA-135 (faena de imputación: Biodiversa) que sale de taller y queda «por recibir». */
async function finishedInBio(): Promise<string> {
  const created = ok(await createWorkOrder(await actorOf(IDS.jefe), createWorkOrderSchema.parse({
    clientRequestId: crypto.randomUUID(), vehicleId: IDS.truckBio, repair: true, maintenance: false, requestDate: today,
    requesterName: "Ana Contrato", repairDescription: "Fuga de aceite en el motor", observations: null,
    annexItems: ["Cambiar manguera de aire"], maintenanceItems: [], assignedToUserId: null,
  })))
  const mechanic = await actorOf(IDS.mecBio)
  ok(await transitions.assignWorkOrder(await actorOf(IDS.jefe), { workOrderId: created.id, assignedToUserId: IDS.mecBio }))
  ok(await transitions.startWorkOrder(mechanic, { workOrderId: created.id, entry: entry() }))
  const items = await testDb.select().from(schema.mantWorkOrderItems).where(eq(schema.mantWorkOrderItems.workOrderId, created.id))
  ok(await transitions.markWorkOrderItems(mechanic, { workOrderId: created.id, marks: items.map((item) => ({ itemId: item.id, done: "si" as const, note: null })), added: [] }))
  const photoId = crypto.randomUUID()
  await insertOrphanPhoto(testDb, { id: photoId, userId: IDS.mecBio, kind: "correctiva" })
  const input = syncRecordSchema.parse({
    id: crypto.randomUUID(), vehicleId: IDS.truckBio, reading: 12_010, workDate: today, signedAt: new Date().toISOString(), offlineSince: null,
    deviceId: crypto.randomUUID(), appVersion: "test", readingJumpConfirmed: false, duplicateConfirmed: false, correctsRecordId: null,
    kind: "C", oilIds: [IDS.oilMotor], noOilChange: false, executor: { kind: "yo" },
    jobs: [{ workTypeId: IDS.wtMec, hours: 2, noParts: false, parts: [{ quantity: 1, description: "Manguera" }] }],
    description: "Cambio de manguera de aire", inWorkshop: false, workshopEntryDate: null, workshopReason: null, workOrder: null,
    driverIds: [IDS.driver1], photos: [{ id: photoId, kind: "correctiva" }], workOrderId: created.id,
  })
  const outcome = await createRecord(input, (await contextOf(IDS.mecBio)).sync)
  if (!outcome.body.ok) throw new Error(`Registro rechazado: ${outcome.body.message}`)
  ok(await transitions.finishWorkOrder(mechanic, { workOrderId: created.id, exitAt: new Date(Date.now() - 60_000).toISOString(), note: null }))
  return created.id
}

const listIds = async (userId: string, filters: { tab?: "abiertas" | "cerrada"; worksiteId?: string } = {}) =>
  (await listWorkOrders(await viewerOf(userId), { tab: filters.tab ?? "abiertas", worksiteId: filters.worksiteId, page: 1, pageSize: 50 })).rows.map((r) => r.id)

beforeAll(async () => {
  configureZodLocale()
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedMantFixtures(testDb)
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values({ id: ADMIN_ARA, name: "Rosa Contrato Arauco", email: "rosa@chome.test", hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.userRoles).values({ userId: ADMIN_ARA, roleId: "rol-admin-contrato" })
  await testDb.insert(schema.worksiteUsers).values({ userId: ADMIN_ARA, worksiteId: IDS.wsAra, isPrimary: true })
})

beforeEach(async () => {
  for (const table of [
    schema.mantWorkOrderEvents, schema.mantWorkOrderItems, schema.mantRecordObservations, schema.mantRecordVoids, schema.mantWorkshopUpdates,
    schema.mantRecordPhotos, schema.mantRecords, schema.mantWorkOrders, schema.mantFolioCounters, schema.notifications, schema.auditLog,
    schema.fuelVehicleOperationalIntervals,
  ]) await testDb.delete(table)
  await testDb.update(schema.fuelVehicles).set({ operationalStatus: "operativo" })
})

describe("la OT sigue al equipo trasladado", () => {
  it("antes del traslado todo es como siempre; después, el destino ve, recibe y da la conformidad y el origen sólo la ve", async () => {
    const id = await finishedInBio()
    const adminBio = await actorOf(IDS.adminBio)
    const adminCho = await actorOf(IDS.adminCho)

    // ── Sin traslado: actual = imputación ──
    expect(await loadWorkOrderDetail(await viewerOf(IDS.adminBio), id)).toMatchObject({ worksiteId: IDS.wsBio, equipmentWorksiteId: IDS.wsBio, allowedTransitions: expect.arrayContaining(["receive"]) })
    expect(await loadWorkOrderDetail(await viewerOf(IDS.adminCho), id)).toBeNull()
    expect(await loadWorkOrderDetail(await viewerOf(ADMIN_ARA), id)).toBeNull()
    expect(await listIds(IDS.adminBio)).toContain(id)
    expect(await listIds(IDS.adminCho)).not.toContain(id)
    expect(await listIds(IDS.jefe, { worksiteId: IDS.wsCho })).not.toContain(id)
    expect(refused(await transitions.receiveWorkOrder(adminCho, { workOrderId: id, receivedAt: new Date().toISOString(), receiverName: "Carlos" })).code).toBe("forbidden")

    // ── Traslado de Biodiversa a Cholguán ──
    const moved = await testDb.transaction((tx) => transferVehiclesTx(
      tx,
      { userId: IDS.jefe, email: "jefe@chome.test", scope: "all" },
      { toWorksiteId: IDS.wsCho, effectiveDate: today, reason: "Refuerzo de la faena Cholguán", authorizedBy: "Gerencia", vehicleIds: [IDS.truckBio] },
      today,
    ))
    expect(moved.ok).toBe(true)
    const [vehicle] = await testDb.select({ worksiteId: schema.fuelVehicles.worksiteId }).from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, IDS.truckBio))
    expect(vehicle?.worksiteId).toBe(IDS.wsCho)
    // La faena de imputación NO cambia.
    expect((await row(id)).worksiteId).toBe(IDS.wsBio)

    // Visibilidad: el destino la ve (ficha y lista), el origen la sigue viendo por imputación, una tercera faena no.
    const forCho = await loadWorkOrderDetail(await viewerOf(IDS.adminCho), id)
    expect(forCho).toMatchObject({ worksiteId: IDS.wsBio, worksiteName: "Biodiversa", equipmentWorksiteId: IDS.wsCho, equipmentWorksiteName: "Cholguán" })
    expect(forCho?.allowedTransitions).toEqual(expect.arrayContaining(["receive", "reject_receipt"]))
    const forBio = await loadWorkOrderDetail(await viewerOf(IDS.adminBio), id)
    expect(forBio?.id).toBe(id)
    expect(forBio?.allowedTransitions).not.toContain("receive")
    expect(forBio?.allowedTransitions).not.toContain("reject_receipt")
    expect(await loadWorkOrderDetail(await viewerOf(ADMIN_ARA), id)).toBeNull()
    expect(await listIds(IDS.adminCho)).toContain(id)
    expect(await listIds(IDS.adminBio)).toContain(id)
    expect(await listIds(ADMIN_ARA)).not.toContain(id)

    // El filtro `faena` incluye la imputación Y la faena actual del equipo; otra faena no.
    expect(await listIds(IDS.jefe, { worksiteId: IDS.wsCho })).toContain(id)
    expect(await listIds(IDS.jefe, { worksiteId: IDS.wsBio })).toContain(id)
    expect(await listIds(IDS.jefe, { worksiteId: IDS.wsAra })).not.toContain(id)
    // El Excel comparte el filtro con la lista.
    const excelIds = async (worksiteId: string) =>
      (await testDb.select({ id: schema.mantWorkOrders.id }).from(schema.mantWorkOrders).where(workOrdersWhere(await viewerOf(IDS.jefe), { tab: "abiertas", worksiteId }))).map((r) => r.id)
    expect(await excelIds(IDS.wsCho)).toContain(id)
    expect(await excelIds(IDS.wsAra)).not.toContain(id)

    // Aviso «salió de taller» (finished → receive): a quien recibe en la faena actual, no en la de imputación.
    await settle()
    await testDb.delete(schema.notifications) // los de antes del traslado (el «salió de taller» original) no cuentan
    const ot = await row(id)
    const plan = { event: "finished" as const, workOrderId: id, folio: ot.folio, worksiteId: ot.worksiteId, version: ot.version, actorUserId: IDS.mecBio, requestedByUserId: ot.requestedByUserId, assigneeUserId: ot.assignedToUserId, equipment: "KA-135 · Camión" }
    await sendWorkOrderNotification(plan)
    const finishedTo = await noticesOf("mant_ot_finished")
    expect(finishedTo).toContain(IDS.adminCho)
    expect(finishedTo).not.toContain(IDS.adminBio)

    // Recepción: el origen la pierde, el destino la da.
    const refusal = refused(await transitions.receiveWorkOrder(adminBio, { workOrderId: id, receivedAt: new Date().toISOString(), receiverName: "Ana" }))
    expect(refusal.code).toBe("forbidden")
    expect(refusal.message).toContain("otra faena")
    expect((await row(id)).status).toBe("trabajo_terminado")
    expect(ok(await transitions.receiveWorkOrder(adminCho, { workOrderId: id, receivedAt: new Date().toISOString(), receiverName: "Carlos Retira" })).status).toBe("recepcionada")

    // «Espera tu conformidad» (received → conform): sólo al administrador de la faena actual.
    await settle()
    expect(await noticesOf("mant_ot_received")).toEqual([])
    // (el actor de la recepción es el propio Carlos y nunca se avisa a sí mismo: se prueba con otro actor)
    await sendWorkOrderNotification({ ...plan, event: "received", actorUserId: IDS.jefe })
    expect(await noticesOf("mant_ot_received")).toEqual([IDS.adminCho])

    // Cifras del Panel: la OT abierta cuenta donde está imputada (Biodiversa), no en la faena actual del equipo.
    const openCount = async (userId: string) => (await loadOpenWorkOrdersByStatus(await viewerOf(userId), undefined)).reduce((sum, row) => sum + row.count, 0)
    const openIn = async (worksiteId: string) => (await testDb.select({ id: schema.mantWorkOrders.id }).from(schema.mantWorkOrders)
      .where(and(eq(schema.mantWorkOrders.worksiteId, worksiteId), inArray(schema.mantWorkOrders.status, ["solicitada", "asignada", "en_ejecucion", "trabajo_terminado", "recepcionada"])))).length
    expect(await openCount(IDS.adminCho)).toBe(await openIn(IDS.wsCho))
    expect(await openCount(IDS.adminBio)).toBe(await openIn(IDS.wsBio))
    // Conformidad: el origen la pierde, el destino la da y la imputación sigue en Biodiversa.
    const conformInput = { workOrderId: id, faenaReceivedAt: new Date().toISOString(), faenaReceiverName: "Carlos Faena" }
    expect(refused(await transitions.conformWorkOrder(adminBio, conformInput)).code).toBe("forbidden")
    expect(ok(await transitions.conformWorkOrder(adminCho, conformInput)).status).toBe("cerrada")
    expect(await row(id)).toMatchObject({ status: "cerrada", worksiteId: IDS.wsBio, faenaReceivedByUserId: IDS.adminCho })
    expect((await testDb.select().from(schema.mantWorkOrderEvents).where(eq(schema.mantWorkOrderEvents.workOrderId, id)).orderBy(asc(schema.mantWorkOrderEvents.createdAt))).map((e) => e.type)).toContain("conformed")
  })
})
