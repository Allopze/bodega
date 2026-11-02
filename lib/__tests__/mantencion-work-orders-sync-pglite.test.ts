import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { asc, eq } from "drizzle-orm"
import path from "node:path"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { syncRecordSchema, workOrderOpSchema, type MantCatalog, type WorkOrderEntryPayload } from "@/lib/mantencion/contracts"
import { createWorkOrderSchema } from "@/lib/mantencion/work-order-schemas"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { configureZodLocale } from "@/lib/validation/zod-locale"
import { getRequest, jsonRequest, readJson } from "./mantencion-sync-http-helpers"
import { IDS, insertOrphanPhoto, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * Órdenes de trabajo desde el teléfono: `POST /sync/ot` idempotente por `id`,
 * enlace registro ↔ OT (422/409), y la OT en el catálogo de la app (con ETag y
 * el interruptor del submódulo). Postgres real (PGlite con todas las migraciones).
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn(async () => undefined),
  sendBatchEmails: vi.fn(async () => undefined),
  getAppBaseUrl: () => "http://localhost",
}))

const { applyWorkOrderOp } = await import("@/lib/services/mantencion/work-orders/sync-ops")
const { createWorkOrder } = await import("@/lib/services/mantencion/work-orders/create")
const transitions = await import("@/lib/services/mantencion/work-orders/transitions")
const { createRecord } = await import("@/lib/services/mantencion/records-create")
const { issueDeviceCredential } = await import("@/lib/services/mantencion/device-credentials")
const { setSubmoduleToggle } = await import("@/lib/services/module-toggles")
const { getUserRbacById } = await import("@/lib/auth/rbac")
const otRoute = await import("@/app/api/mantencion/sync/ot/route")
const catalogRoute = await import("@/app/api/mantencion/sync/catalogo/route")

const today = todayInChile()

async function contextOf(userId: string) {
  const rbac = (await getUserRbacById(userId, true))!
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

const tokens = new Map<string, string>()
async function tokenOf(userId: string) {
  const cached = tokens.get(userId)
  if (cached) return cached
  const { token } = await issueDeviceCredential({ userId, deviceId: crypto.randomUUID() })
  tokens.set(userId, token)
  return token
}

const entry = (overrides: Partial<WorkOrderEntryPayload> = {}): WorkOrderEntryPayload => ({
  workshopKind: "interno", workshopId: null, workshopManagerName: null, operatorDriverId: null, operatorName: null,
  entryAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), odometer: 12_000, hourmeter: null,
  estimatedDeliveryDate: addDaysToPlainDate(today, 3), ...overrides,
})

const base = (workOrderId: string, id: string = crypto.randomUUID()) => ({ id, workOrderId, createdAt: new Date().toISOString(), deviceId: crypto.randomUUID() })
const op = (payload: Record<string, unknown>) => workOrderOpSchema.parse(payload)

async function send(userId: string, payload: Record<string, unknown>) {
  const outcome = await applyWorkOrderOp(op(payload), (await contextOf(userId)).sync)
  return outcome
}

// La jefatura crea «por asignar» (la del administrador de contrato nace asignada al mecánico de su faena).
async function newOt(overrides: Record<string, unknown> = {}, creator: string = IDS.jefe) {
  const result = await createWorkOrder(await actorOf(creator), createWorkOrderSchema.parse({
    clientRequestId: crypto.randomUUID(), vehicleId: IDS.truckBio, repair: true, maintenance: false, requestDate: today, requesterName: "Ana Contrato",
    repairDescription: "Fuga de aceite en el motor", observations: null, annexItems: ["Cambiar manguera de aire"], maintenanceItems: [],
    assignedToUserId: null, ...overrides,
  }))
  if (!result.ok) throw new Error(result.message)
  return result.value.id
}
async function inWorkshop(mechanic: string = IDS.mecBio, overrides: Record<string, unknown> = {}) {
  const id = await newOt(overrides, IDS.jefe)
  const assign = await transitions.assignWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, assignedToUserId: mechanic })
  if (!assign.ok) throw new Error(assign.message)
  const start = await transitions.startWorkOrder(await actorOf(mechanic), { workOrderId: id, entry: entry() })
  if (!start.ok) throw new Error(start.message)
  return id
}

let readingCounter = 0
function recordBody(photoId: string, vehicleId: string, overrides: Record<string, unknown> = {}) {
  readingCounter += 10
  return {
    id: crypto.randomUUID(), vehicleId, reading: 12_000 + readingCounter, workDate: today, signedAt: new Date().toISOString(), offlineSince: null,
    deviceId: crypto.randomUUID(), appVersion: "test", readingJumpConfirmed: false, duplicateConfirmed: false, correctsRecordId: null,
    kind: "C", oilIds: [IDS.oilMotor], noOilChange: false, executor: { kind: "yo" },
    jobs: [{ workTypeId: IDS.wtMec, hours: 2, noParts: false, parts: [{ quantity: 1, description: "Manguera" }] }],
    description: "Cambio de manguera de aire", inWorkshop: false, workshopEntryDate: null, workshopReason: null, workOrder: null,
    driverIds: [IDS.driver1], photos: [{ id: photoId, kind: "correctiva" }], ...overrides,
  }
}
async function record(userId: string, vehicleId: string, overrides: Record<string, unknown> = {}) {
  const photoId = crypto.randomUUID()
  await insertOrphanPhoto(testDb, { id: photoId, userId, kind: "correctiva" })
  const input = syncRecordSchema.parse(recordBody(photoId, vehicleId, overrides))
  return { input, outcome: await createRecord(input, (await contextOf(userId)).sync) }
}

async function row(id: string) {
  return (await testDb.select().from(schema.mantWorkOrders).where(eq(schema.mantWorkOrders.id, id)))[0]!
}
async function eventsOf(id: string) {
  return testDb.select().from(schema.mantWorkOrderEvents).where(eq(schema.mantWorkOrderEvents.workOrderId, id)).orderBy(asc(schema.mantWorkOrderEvents.createdAt))
}

beforeAll(async () => {
  configureZodLocale()
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedMantFixtures(testDb)
})

beforeEach(async () => {
  for (const table of [
    schema.mantWorkOrderEvents, schema.mantWorkOrderItems, schema.mantRecordObservations, schema.mantRecordVoids, schema.mantWorkshopUpdates,
    schema.mantRecordPhotos, schema.mantRecords, schema.mantWorkOrders, schema.mantFolioCounters, schema.notifications, schema.auditLog,
    schema.fuelVehicleOperationalIntervals, schema.rateLimits,
  ]) await testDb.delete(table)
  await testDb.update(schema.fuelVehicles).set({ operationalStatus: "operativo" })
  await setSubmoduleToggle("mantencion_equipos", "/mantencion/ot", true, { userId: IDS.jefe })
  readingCounter = 0
})

describe("POST /sync/ot: idempotencia", () => {
  it("la misma operación enviada tres veces deja UN evento y devuelve siempre la misma OT", async () => {
    const id = await newOt()
    const payload = { ...base(id), action: "take" }
    const first = await send(IDS.mecBio, payload)
    const second = await send(IDS.mecBio, payload)
    const third = await send(IDS.mecBio, payload)
    expect([first.status, second.status, third.status]).toEqual([200, 200, 200])
    if (!first.body.ok || !second.body.ok || !third.body.ok) throw new Error("se esperaba éxito")
    expect([first.body.duplicate, second.body.duplicate, third.body.duplicate]).toEqual([false, true, true])
    expect(first.body).toMatchObject({ workOrderId: id, status: "asignada", id: payload.id })
    expect(second.body.receivedAt).toBe(first.body.receivedAt)
    expect((await eventsOf(id)).filter((event) => event.clientOpId === payload.id)).toHaveLength(1)
    expect(await row(id)).toMatchObject({ status: "asignada", assignedToUserId: IDS.mecBio, version: 2 })
  })

  it("envíos simultáneos de la misma operación: un solo evento", async () => {
    const id = await newOt()
    const payload = { ...base(id), action: "take" }
    const results = await Promise.all([send(IDS.mecBio, payload), send(IDS.mecBio, payload), send(IDS.mecBio, payload)])
    expect(results.every((result) => result.status === 200)).toBe(true)
    expect(results.filter((result) => result.body.ok && !result.body.duplicate)).toHaveLength(1)
    expect((await eventsOf(id)).filter((event) => event.clientOpId === payload.id)).toHaveLength(1)
  })

  it("un identificador de operación de otra persona es un 409, también si la OT es otra", async () => {
    const id = await newOt()
    const other = await newOt()
    const payload = { ...base(id), action: "take" }
    expect((await send(IDS.mecBio, payload)).status).toBe(200)
    const stolen = await send(IDS.mecBio2, { ...payload, workOrderId: other })
    expect(stolen.status).toBe(409)
    expect(stolen.body).toMatchObject({ ok: false, code: "rejected" })
    expect((await row(other)).status).toBe("solicitada")
  })

  it("«tomar» una OT que otro tomó primero es un rechazo definitivo (409), no un reintento", async () => {
    const id = await newOt()
    expect((await send(IDS.mecBio, { ...base(id), action: "take" })).status).toBe(200)
    const late = await send(IDS.mecBio2, { ...base(id), action: "take" })
    expect(late.status).toBe(409)
    if (late.body.ok) throw new Error("se esperaba rechazo")
    expect(late.body.message).toContain("ya no está por asignar")
    expect((await row(id)).assignedToUserId).toBe(IDS.mecBio)
  })

  it("una OT inexistente o sin permiso de ejecutar es un 422", async () => {
    expect((await send(IDS.mecBio, { ...base("no-existe"), action: "take" })).status).toBe(422)
    const id = await newOt()
    const noExecute = await applyWorkOrderOp(op({ ...base(id), action: "take" }), (await contextOf(IDS.adminBio)).sync)
    expect(noExecute.status).toBe(422)
    expect((await row(id)).status).toBe("solicitada")
  })
})

describe("POST /sync/ot: el flujo del mecánico", () => {
  it("tomar → ingreso → fecha estimada → ítems (con uno agregado por el teléfono) → registro → terminar", async () => {
    const id = await newOt()
    const mecanico = IDS.mecCho
    // Una faena distinta a la suya sólo avisa: puede trabajarla igual.
    const take = await send(mecanico, { ...base(id), action: "take" })
    if (!take.body.ok) throw new Error(take.body.message)
    expect(take.body.warnings.map((warning) => warning.code)).toEqual(["out_of_worksite"])

    const early = await send(mecanico, { ...base(id), action: "finish", exitAt: new Date().toISOString(), note: null })
    expect(early.status).toBe(409)

    const start = await send(mecanico, { ...base(id), action: "start", entry: entry({ workshopKind: "externo", workshopId: IDS.workshop, workshopManagerName: "Don Pedro", operatorDriverId: IDS.driver2 }) })
    expect(start.status).toBe(200)
    expect(await row(id)).toMatchObject({ status: "en_ejecucion", workshopName: "Maestranza Melo", operatorName: "BELTRAN IRARRAZAVAL HECTOR A.", entryOdometer: 12_000, entryHourmeter: null })

    const newDate = addDaysToPlainDate(today, 5)
    const noReason = await send(mecanico, { ...base(id), action: "estimate", estimatedDeliveryDate: newDate, reason: null })
    expect(noReason.status).toBe(422)
    // El teléfono pide ≥ 5 caracteres (la web, 10).
    expect((await send(mecanico, { ...base(id), action: "estimate", estimatedDeliveryDate: newDate, reason: "Repuesto" })).status).toBe(200)
    expect((await eventsOf(id)).find((event) => event.type === "estimate_changed")?.changeSet).toMatchObject({ to: newDate })

    // El ítem agregado en el teléfono conserva su uuid y una operación posterior lo puede marcar.
    const [requested] = await testDb.select().from(schema.mantWorkOrderItems).where(eq(schema.mantWorkOrderItems.workOrderId, id))
    const addedId = crypto.randomUUID()
    const addPayload = { ...base(id), action: "items", marks: [{ itemId: requested!.id, done: "si", note: null }], added: [{ id: addedId, kind: "anexo", description: "Cambiar abrazaderas" }] }
    expect((await send(mecanico, addPayload)).status).toBe(200)
    expect((await send(mecanico, addPayload)).body).toMatchObject({ ok: true, duplicate: true })
    // Reenviar el ítem agregado en OTRA operación (misma uuid) no lo duplica (sin evento nuevo, sin error).
    expect((await send(mecanico, { ...base(id), action: "items", marks: [], added: [{ id: addedId, kind: "anexo", description: "Cambiar abrazaderas" }] })).status).toBe(200)
    expect(await testDb.select().from(schema.mantWorkOrderItems).where(eq(schema.mantWorkOrderItems.workOrderId, id))).toHaveLength(2)
    expect((await send(mecanico, { ...base(id), action: "items", marks: [{ itemId: addedId, done: "no", note: "No era necesario" }], added: [] })).status).toBe(200)
    const items = await testDb.select().from(schema.mantWorkOrderItems).where(eq(schema.mantWorkOrderItems.workOrderId, id))
    expect(items.find((item) => item.id === addedId)).toMatchObject({ origin: "taller", done: "no", note: "No era necesario" })

    // Sin un registro enlazado no se puede terminar.
    const noRecord = await send(mecanico, { ...base(id), action: "finish", exitAt: new Date(Date.now() - 60_000).toISOString(), note: null })
    expect(noRecord.status).toBe(422)
    if (noRecord.body.ok) throw new Error("se esperaba rechazo")
    expect(noRecord.body.field).toBe("records")
    const { outcome } = await record(mecanico, IDS.truckBio, { workOrderId: id })
    expect(outcome.status).toBe(200)

    const finish = { ...base(id), action: "finish", exitAt: new Date(Date.now() - 60_000).toISOString(), note: "Entrega al administrador" }
    const done = await send(mecanico, finish)
    expect(done.body).toMatchObject({ ok: true, status: "trabajo_terminado", duplicate: false })
    expect((await send(mecanico, finish)).body).toMatchObject({ ok: true, status: "trabajo_terminado", duplicate: true })
    expect(await row(id)).toMatchObject({ status: "trabajo_terminado", finishedByUserId: IDS.mecCho })
    // Una vez terminada, el mecánico ya no edita ítems.
    expect((await send(mecanico, { ...base(id), action: "items", marks: [{ itemId: addedId, done: "si", note: null }], added: [] })).status).toBe(409)
  })

  it("por HTTP: credencial obligatoria, cuerpo validado y respuesta con el mismo contrato", async () => {
    const id = await newOt()
    const payload = { ...base(id), action: "take" }
    expect((await otRoute.POST(jsonRequest("/api/mantencion/sync/ot", null, payload))).status).toBe(401)
    expect((await otRoute.POST(jsonRequest("/api/mantencion/sync/ot", await tokenOf(IDS.mecBio), { ...payload, action: "volar" }))).status).toBe(422)
    const response = await otRoute.POST(jsonRequest("/api/mantencion/sync/ot", await tokenOf(IDS.mecBio), payload))
    expect(response.status).toBe(200)
    expect(await readJson(response)).toMatchObject({ ok: true, workOrderId: id, status: "asignada", duplicate: false })
    const again = await otRoute.POST(jsonRequest("/api/mantencion/sync/ot", await tokenOf(IDS.mecBio), payload))
    expect(await readJson(again)).toMatchObject({ ok: true, duplicate: true })
    // Con el submódulo apagado la ruta responde que el módulo está inactivo.
    await setSubmoduleToggle("mantencion_equipos", "/mantencion/ot", false, { userId: IDS.jefe })
    expect((await otRoute.POST(jsonRequest("/api/mantencion/sync/ot", await tokenOf(IDS.mecBio), { ...base(id), action: "take" }))).status).toBe(503)
  })
})

describe("enlace de un registro con su OT", () => {
  it("el mecánico asignado enlaza su correctiva: queda `work_order_id`, el evento `record_linked` y la OT se actualiza sin cambiar de versión", async () => {
    const id = await inWorkshop()
    const before = await row(id)
    const { input, outcome } = await record(IDS.mecBio, IDS.truckBio, { workOrderId: id })
    expect(outcome.status).toBe(200)
    const [saved] = await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, input.id))
    expect(saved).toMatchObject({ workOrderId: id, kind: "C" })
    const linked = (await eventsOf(id)).find((event) => event.type === "record_linked")
    expect(linked).toMatchObject({ actorUserId: IDS.mecBio, changeSet: { recordId: input.id, kind: "C" } })
    const after = await row(id)
    expect(after.version).toBe(before.version)
    expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt).getTime())
  })

  it("un registro sin `workOrderId` (teléfono con cola antigua) sigue funcionando y no se enlaza", async () => {
    const { input, outcome } = await record(IDS.mecBio, IDS.truckBio)
    expect(outcome.status).toBe(200)
    expect((await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, input.id)))[0]?.workOrderId).toBeNull()
  })

  it("rechaza OT inexistente, de otro equipo o que no está en taller (422, con el campo)", async () => {
    const id = await inWorkshop()
    const missing = await record(IDS.mecBio, IDS.truckBio, { workOrderId: "no-existe" })
    expect(missing.outcome).toMatchObject({ status: 422, body: { ok: false, field: "workOrderId" } })

    const otherVehicle = await inWorkshop(IDS.mecCho, { vehicleId: IDS.truckCho })
    const wrongEquipment = await record(IDS.mecBio, IDS.truckBio, { workOrderId: otherVehicle })
    expect(wrongEquipment.outcome).toMatchObject({ status: 422, body: { ok: false, field: "workOrderId" } })
    if (wrongEquipment.outcome.body.ok) throw new Error("se esperaba rechazo")
    expect(wrongEquipment.outcome.body.message).toContain("otro equipo")

    const idle = await newOt()
    await transitions.assignWorkOrder(await actorOf(IDS.jefe), { workOrderId: idle, assignedToUserId: IDS.mecBio })
    const notStarted = await record(IDS.mecBio, IDS.truckBio, { workOrderId: idle })
    expect(notStarted.outcome).toMatchObject({ status: 422, body: { ok: false, field: "workOrderId" } })
    expect(await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.workOrderId, id))).toHaveLength(0)
  })

  it("un registro enlazado no puede declarar «queda en taller»: la OT manda (422 en `inWorkshop`)", async () => {
    const id = await inWorkshop()
    const { outcome } = await record(IDS.mecBio, IDS.truckBio, {
      workOrderId: id, inWorkshop: true, workshopEntryDate: today, workshopReason: "Sigue en el taller por repuestos",
    })
    expect(outcome).toMatchObject({ status: 422, body: { ok: false, field: "inWorkshop" } })
    expect(await testDb.select().from(schema.mantRecords)).toHaveLength(0)
  })

  it("el registro lo firma el asignado (o quien él nombró como ejecutor); otro mecánico recibe 409; la jefatura puede", async () => {
    const id = await inWorkshop(IDS.mecBio)
    const stranger = await record(IDS.mecBio2, IDS.truckBio, { workOrderId: id })
    expect(stranger.outcome).toMatchObject({ status: 409, body: { ok: false, field: "workOrderId" } })
    const named = await record(IDS.mecBio2, IDS.truckBio, { workOrderId: id, executor: { kind: "otro_mecanico", userId: IDS.mecBio } })
    expect(named.outcome.status).toBe(200)
    const manager = await record(IDS.jefe, IDS.truckBio, { workOrderId: id })
    expect(manager.outcome.status).toBe(200)
    expect(await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.workOrderId, id))).toHaveLength(2)
  })
})

describe("catálogo de la app con OT", () => {
  async function catalogOf(userId: string, ifNoneMatch?: string) {
    const response = await catalogRoute.GET(getRequest("/api/mantencion/sync/catalogo", await tokenOf(userId), ifNoneMatch ? { "if-none-match": ifNoneMatch } : {}))
    return { response, status: response.status, etag: response.headers.get("etag"), body: response.status === 200 ? ((await response.json()) as MantCatalog) : null }
  }

  it("trae mis OT (con el equipo resumido y las listas) y las «por asignar» de todas las faenas, las de mi faena primero", async () => {
    const mine = await inWorkshop(IDS.mecBio)
    const free = await newOt()
    const freeCho = await newOt({ vehicleId: IDS.truckCho })
    const { body } = await catalogOf(IDS.mecBio)
    expect(body?.workOrders?.map((order) => order.id)).toEqual([mine])
    const own = body!.workOrders![0]!
    expect(own).toMatchObject({
      folio: "OT-BIO-0001", status: "en_ejecucion", equipmentCode: "KA-135", unit: "km", worksiteName: "Biodiversa", outOfWorksite: false,
      assignedToName: "Javier Roa", lastRejection: null,
    })
    expect(own.entry).toMatchObject({ workshopKind: "interno", odometer: 12_000, hourmeter: null })
    expect(own.items).toEqual([expect.objectContaining({ kind: "anexo", origin: "solicitud", done: null })])
    // Las «por asignar»: la de mi faena antes que la de Cholguán, esta última marcada como fuera de faena.
    expect(body?.availableWorkOrders?.map((order) => order.id)).toEqual([free, freeCho])
    expect(body?.availableWorkOrders?.map((order) => order.outOfWorksite)).toEqual([false, true])
    // El equipo de la OT figura «en taller» en el catálogo, con el folio de la OT.
    expect(body?.equipment.find((item) => item.id === IDS.truckBio)?.workshop).toMatchObject({ folio: "OT-BIO-0001", recordId: mine })
    // Un mecánico de Cholguán ve las mismas «por asignar», con la suya primero.
    expect((await catalogOf(IDS.mecCho)).body?.availableWorkOrders?.map((order) => order.id)).toEqual([freeCho, free])
    expect((await catalogOf(IDS.mecCho)).body?.workOrders).toEqual([])
  })

  it("«Devuelta»: el último rechazo y los registros enlazados desde entonces", async () => {
    const id = await inWorkshop(IDS.mecBio)
    const items = await testDb.select().from(schema.mantWorkOrderItems).where(eq(schema.mantWorkOrderItems.workOrderId, id))
    await transitions.markWorkOrderItems(await actorOf(IDS.mecBio), { workOrderId: id, marks: items.map((item) => ({ itemId: item.id, done: "si" as const, note: null })), added: [] })
    await record(IDS.mecBio, IDS.truckBio, { workOrderId: id })
    expect((await catalogOf(IDS.mecBio)).body?.workOrders?.[0]?.linkedRecords).toHaveLength(1)
    await transitions.finishWorkOrder(await actorOf(IDS.mecBio), { workOrderId: id, exitAt: new Date(Date.now() - 60_000).toISOString(), note: null })
    await transitions.receiveWorkOrder(await actorOf(IDS.adminBio), { workOrderId: id, receivedAt: new Date().toISOString(), receiverName: "Ana Faena" })
    await transitions.rejectWorkOrder(await actorOf(IDS.adminBio), { workOrderId: id, reason: "Todavía gotea el aceite" })
    const order = (await catalogOf(IDS.mecBio)).body?.workOrders?.[0]
    expect(order?.status).toBe("en_ejecucion")
    expect(order?.lastRejection).toMatchObject({ count: 1, reason: "Todavía gotea el aceite" })
    expect(order?.linkedRecords).toEqual([])
    expect(order?.exitAt).toBeNull()
  })

  it("el ETag cambia cuando cambia una OT (aunque no cambie ningún registro) y 304 si no cambió nada", async () => {
    const id = await newOt()
    const first = await catalogOf(IDS.mecBio)
    expect((await catalogOf(IDS.mecBio, first.etag!)).status).toBe(304)
    await transitions.assignWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, assignedToUserId: IDS.mecBio })
    const second = await catalogOf(IDS.mecBio, first.etag!)
    expect(second.status).toBe(200)
    expect(second.etag).not.toBe(first.etag)
    expect(second.body?.workOrders?.map((order) => order.id)).toEqual([id])
    expect(second.body?.availableWorkOrders).toEqual([])
  })

  it("con el submódulo de OT apagado el catálogo no trae OT y su ETag es otro", async () => {
    await newOt()
    const on = await catalogOf(IDS.mecBio)
    expect(on.body?.availableWorkOrders).toHaveLength(1)
    await setSubmoduleToggle("mantencion_equipos", "/mantencion/ot", false, { userId: IDS.jefe })
    const off = await catalogOf(IDS.mecBio, on.etag!)
    expect(off.status).toBe(200)
    expect(off.etag).not.toBe(on.etag)
    expect(off.body?.workOrders).toBeUndefined()
    expect(off.body?.availableWorkOrders).toBeUndefined()
    await setSubmoduleToggle("mantencion_equipos", "/mantencion/ot", true, { userId: IDS.jefe })
    expect((await catalogOf(IDS.mecBio)).body?.availableWorkOrders).toHaveLength(1)
  })
})
