import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, asc, eq } from "drizzle-orm"
import path from "node:path"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { syncRecordSchema, type WorkOrderEntryPayload } from "@/lib/mantencion/contracts"
import { OT_STATUSES, type OtStatus, type OtTransition } from "@/lib/mantencion/work-order-states"
import { createWorkOrderSchema } from "@/lib/mantencion/work-order-schemas"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { configureZodLocale } from "@/lib/validation/zod-locale"
import { IDS, insertOrphanPhoto, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * Órdenes de trabajo (OT): alta con alcance e idempotencia, folio por faena,
 * matriz rol × transición, concurrencia (versión esperada y «tomar»), guardias
 * de ingreso/terminar, ciclo de rechazo, conformidad por faena, anular, reabrir
 * con la CAPA y avisos después del commit. Postgres real (PGlite con todas las
 * migraciones).
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))
// Los avisos escriben en `notifications` y además mandan correo: aquí sólo importa lo primero.
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn(async () => undefined),
  sendBatchEmails: vi.fn(async () => undefined),
  getAppBaseUrl: () => "http://localhost",
}))

const { createWorkOrder, createWorkOrderWithClient, notifyWorkOrderCreated } = await import("@/lib/services/mantencion/work-orders/create")
const transitions = await import("@/lib/services/mantencion/work-orders/transitions")
const { allowedTransitions, canActOnWorkOrder } = await import("@/lib/services/mantencion/work-orders/access")
const { listWorkOrders, loadWorkOrderDetail, listAssignableMechanics } = await import("@/lib/services/mantencion/work-orders/query")
const { exportWorkOrders } = await import("@/lib/services/mantencion/work-orders/export")
const { createRecord } = await import("@/lib/services/mantencion/records-create")
const { getUserRbacById } = await import("@/lib/auth/rbac")
const { sendWorkOrderNotification } = await import("@/lib/services/mantencion/work-orders/notifications")

const today = todayInChile()

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

function createInput(overrides: Record<string, unknown> = {}) {
  return createWorkOrderSchema.parse({
    clientRequestId: crypto.randomUUID(), vehicleId: IDS.truckBio, repair: true, maintenance: true, requestDate: today,
    requesterName: "Ana Contrato", repairDescription: "Fuga de aceite en el motor", observations: null,
    annexItems: ["Cambiar manguera de aire", "Revisar sistema de frenos"], maintenanceItems: ["Mantención de 10.000 km"],
    assignedToUserId: null, ...overrides,
  })
}

/** El administrador de Biodiversa elige entre sus dos mecánicos. */
const adminInput = (overrides: Record<string, unknown> = {}) => createInput({ assignedToUserId: IDS.mecBio, ...overrides })

function ok<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!result.ok) throw new Error(`Se esperaba éxito: ${result.message}`)
  return result.value
}
function refused(result: { ok: boolean; message?: string; code?: string; field?: string }) {
  if (result.ok) throw new Error("Se esperaba un rechazo")
  return result as { ok: false; message: string; code?: string; field?: string }
}

const entry = (overrides: Partial<WorkOrderEntryPayload> = {}): WorkOrderEntryPayload => ({
  workshopKind: "interno", workshopId: null, workshopManagerName: "Don Pedro", operatorDriverId: IDS.driver1, operatorName: null,
  entryAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), odometer: 12_000, hourmeter: null,
  estimatedDeliveryDate: addDaysToPlainDate(today, 3), ...overrides,
})

let readingCounter = 0
/** Una correctiva firmada y enlazada a la OT (la que habilita «terminar»). */
async function linkedCorrective(userId: string, workOrderId: string, vehicleId: string = IDS.truckBio, overrides: Record<string, unknown> = {}) {
  const photoId = crypto.randomUUID()
  await insertOrphanPhoto(testDb, { id: photoId, userId, kind: "correctiva" })
  readingCounter += 10
  const input = syncRecordSchema.parse({
    id: crypto.randomUUID(), vehicleId, reading: 12_000 + readingCounter, workDate: today, signedAt: new Date().toISOString(), offlineSince: null,
    deviceId: crypto.randomUUID(), appVersion: "test", readingJumpConfirmed: false, duplicateConfirmed: false, correctsRecordId: null,
    kind: "C", oilIds: [IDS.oilMotor], noOilChange: false, executor: { kind: "yo" },
    jobs: [{ workTypeId: IDS.wtMec, hours: 2, noParts: false, parts: [{ quantity: 1, description: "Manguera" }] }],
    description: "Cambio de manguera de aire", inWorkshop: false, workshopEntryDate: null, workshopReason: null, workOrder: null,
    driverIds: [IDS.driver1], photos: [{ id: photoId, kind: "correctiva" }], workOrderId, ...overrides,
  })
  const outcome = await createRecord(input, (await contextOf(userId)).sync)
  if (!outcome.body.ok) throw new Error(`Registro rechazado: ${outcome.body.message}`)
  return input.id
}

async function row(id: string) {
  const [ot] = await testDb.select().from(schema.mantWorkOrders).where(eq(schema.mantWorkOrders.id, id))
  if (!ot) throw new Error("OT inexistente")
  return ot
}
async function eventsOf(id: string) {
  return testDb.select().from(schema.mantWorkOrderEvents).where(eq(schema.mantWorkOrderEvents.workOrderId, id)).orderBy(asc(schema.mantWorkOrderEvents.createdAt))
}
async function vehicleStatus(id: string) {
  const [vehicle] = await testDb.select({ status: schema.fuelVehicles.operationalStatus }).from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, id))
  return vehicle?.status
}
async function openIntervalReason(id: string) {
  const intervals = await testDb.select().from(schema.fuelVehicleOperationalIntervals).where(eq(schema.fuelVehicleOperationalIntervals.vehicleId, id))
  return intervals.find((interval) => interval.endedAt === null)?.reason ?? null
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 120))
async function notificationsOf(type?: string) {
  const rows = await testDb.select().from(schema.notifications)
  return type ? rows.filter((notification) => notification.type === type) : rows
}

// La jefatura crea «por asignar»; el administrador de contrato deja la OT asignada al mecánico de su faena (ver «alta de la OT»).
async function newOt(overrides: Record<string, unknown> = {}, creator: string = IDS.jefe) {
  return ok(await createWorkOrder(await actorOf(creator), createInput(overrides))).id
}
async function assigned(mechanic: string = IDS.mecBio, overrides: Record<string, unknown> = {}) {
  const id = await newOt(overrides)
  ok(await transitions.assignWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, assignedToUserId: mechanic }))
  return id
}
async function inWorkshop(mechanic: string = IDS.mecBio, overrides: Record<string, unknown> = {}) {
  const id = await assigned(mechanic, overrides)
  ok(await transitions.startWorkOrder(await actorOf(mechanic), { workOrderId: id, entry: entry() }))
  return id
}
async function markAll(id: string, mechanic: string) {
  const items = await testDb.select().from(schema.mantWorkOrderItems).where(eq(schema.mantWorkOrderItems.workOrderId, id))
  if (items.length === 0) return
  ok(await transitions.markWorkOrderItems(await actorOf(mechanic), {
    workOrderId: id, marks: items.map((item) => ({ itemId: item.id, done: "si" as const, note: null })), added: [],
  }))
}
async function finished(mechanic: string = IDS.mecBio, overrides: Record<string, unknown> = {}) {
  const id = await inWorkshop(mechanic, overrides)
  await markAll(id, mechanic)
  await linkedCorrective(mechanic, id, (await row(id)).vehicleId)
  ok(await transitions.finishWorkOrder(await actorOf(mechanic), { workOrderId: id, exitAt: new Date(Date.now() - 60_000).toISOString(), note: null }))
  return id
}
async function received(overrides: Record<string, unknown> = {}) {
  const id = await finished(IDS.mecBio, overrides)
  ok(await transitions.receiveWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, receivedAt: new Date().toISOString(), receiverName: "Pedro Retira" }))
  return id
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
    schema.fuelVehicleOperationalIntervals,
  ]) await testDb.delete(table)
  await testDb.update(schema.fuelVehicles).set({ operationalStatus: "operativo" })
  readingCounter = 0
})

describe("alta de la OT", () => {
  it("el administrador de contrato crea en su faena: folio por faena, ítems, historial, bitácora y aviso a la jefatura (no a quien la creó)", async () => {
    const created = ok(await createWorkOrder(await actorOf(IDS.adminBio), adminInput()))
    expect(created).toMatchObject({ folio: "OT-BIO-0001", status: "asignada", version: 1 })

    const ot = await row(created.id)
    expect(ot).toMatchObject({
      worksiteId: IDS.wsBio, vehicleId: IDS.truckBio, requestedByUserId: IDS.adminBio, repair: true, maintenance: true,
      assignedToUserId: IDS.mecBio, assignedByUserId: IDS.adminBio, rejectionCount: 0,
    })
    expect(ot.equipmentSnapshot).toMatchObject({ code: "KA-135", plate: "RBYD-98", worksite: "Biodiversa", unit: "km" })
    const items = await testDb.select().from(schema.mantWorkOrderItems).where(eq(schema.mantWorkOrderItems.workOrderId, created.id))
    expect(items.map((item) => [item.kind, item.origin, item.description]).sort()).toEqual([
      ["anexo", "solicitud", "Cambiar manguera de aire"], ["anexo", "solicitud", "Revisar sistema de frenos"], ["mantencion", "solicitud", "Mantención de 10.000 km"],
    ])
    expect((await eventsOf(created.id)).map((event) => event.type)).toEqual(["created", "assigned"])
    const [audit] = await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, "mant_work_order"), eq(schema.auditLog.entityId, created.id)))
    expect(audit).toMatchObject({ action: "create", entityCode: "OT-BIO-0001", userId: IDS.adminBio, worksiteId: IDS.wsBio })

    await vi.waitFor(async () => expect(await notificationsOf("mant_ot_created")).toHaveLength(1))
    const [notice] = await notificationsOf("mant_ot_created")
    expect(notice).toMatchObject({ userId: IDS.jefe, entityHref: `/mantencion/ot/${created.id}`, dedupeKey: `mant-ot:${created.id}:created:1` })
  })

  it("un administrador de contrato no crea para el equipo de otra faena; el de esa faena sí, y el folio es independiente por faena", async () => {
    const denied = refused(await createWorkOrder(await actorOf(IDS.adminBio), adminInput({ vehicleId: IDS.truckCho })))
    expect(denied).toMatchObject({ code: "forbidden", field: "vehicleId" })
    expect(denied.message).toContain("Cholguán")
    expect(await testDb.select().from(schema.mantWorkOrders)).toHaveLength(0)

    const own = ok(await createWorkOrder(await actorOf(IDS.adminCho), createInput({ vehicleId: IDS.truckCho })))
    expect(own.folio).toBe("OT-CHO-0001")
    // El jefe (rol global) crea en cualquier faena.
    expect(ok(await createWorkOrder(await actorOf(IDS.jefe), createInput({ vehicleId: IDS.truckAra }))).folio).toBe("OT-ARA-0001")
  })

  it("rechaza quien no tiene `mant:ot:create` y equipos dados de baja o fuera del módulo", async () => {
    expect(refused(await createWorkOrder(await actorOf(IDS.mecBio), createInput())).code).toBe("forbidden")
    expect(refused(await createWorkOrder(await actorOf(IDS.jefe), createInput({ vehicleId: IDS.retired }))).message).toContain("dado de baja")
    expect(refused(await createWorkOrder(await actorOf(IDS.jefe), createInput({ vehicleId: "no-existe" }))).field).toBe("vehicleId")
    // La jefatura asigna al crear a cualquier mecánico, de cualquier faena: nace «asignada» y avisa al mecánico.
    const withMechanic = ok(await createWorkOrder(await actorOf(IDS.jefe), createInput({ assignedToUserId: IDS.mecCho })))
    expect(withMechanic.status).toBe("asignada")
    expect((await eventsOf(withMechanic.id)).map((event) => event.type)).toEqual(["created", "assigned"])
    await vi.waitFor(async () => expect((await notificationsOf("mant_ot_assigned")).map((notice) => notice.userId)).toEqual([IDS.mecCho]))
  })

  it("la OT del administrador de contrato queda asignada al mecánico de su faena; con varios, elige; sin ninguno, queda por asignar", async () => {
    // Cholguán tiene un solo mecánico: se asigna sin preguntar.
    const cho = ok(await createWorkOrder(await actorOf(IDS.adminCho), createInput({ vehicleId: IDS.truckCho })))
    expect(cho.status).toBe("asignada")
    expect(await row(cho.id)).toMatchObject({ assignedToUserId: IDS.mecCho, assignedByUserId: IDS.adminCho })
    await vi.waitFor(async () => expect((await notificationsOf("mant_ot_assigned")).map((notice) => notice.userId)).toEqual([IDS.mecCho]))
    // La jefatura recibe el aviso de OT nueva, que ya no dice «por asignar».
    await vi.waitFor(async () => expect((await notificationsOf("mant_ot_created"))[0]?.body).toContain("Ya tiene mecánico asignado"))

    // Biodiversa tiene dos: hay que elegir, y sólo entre los de esa faena.
    const admin = await actorOf(IDS.adminBio)
    const unchosen = refused(await createWorkOrder(admin, createInput()))
    expect(unchosen).toMatchObject({ code: "invalid", field: "assignedToUserId" })
    expect(unchosen.message).toContain("Biodiversa")
    expect(refused(await createWorkOrder(admin, createInput({ assignedToUserId: IDS.mecCho })))).toMatchObject({ code: "invalid", field: "assignedToUserId" })
    expect(refused(await createWorkOrder(admin, createInput({ assignedToUserId: IDS.supBio })))).toMatchObject({ code: "invalid", field: "assignedToUserId" })
    expect((await row(ok(await createWorkOrder(admin, createInput({ assignedToUserId: IDS.mecBio2 }))).id)).assignedToUserId).toBe(IDS.mecBio2)

    // La jefatura reasigna a quien quiera.
    ok(await transitions.assignWorkOrder(await actorOf(IDS.jefe), { workOrderId: cho.id, assignedToUserId: IDS.mecBio }))
    expect((await row(cho.id)).assignedToUserId).toBe(IDS.mecBio)

    // Sin mecánico activo en la faena, queda por asignar para la jefatura.
    await testDb.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, IDS.mecCho))
    try {
      const orphan = ok(await createWorkOrder(await actorOf(IDS.adminCho), createInput({ vehicleId: IDS.truckCho })))
      expect(orphan.status).toBe("solicitada")
      expect((await row(orphan.id)).assignedToUserId).toBeNull()
    } finally {
      await testDb.update(schema.users).set({ isActive: true }).where(eq(schema.users.id, IDS.mecCho))
    }
  })

  it("folios correlativos, también con altas simultáneas, sin huecos ni repetidos", async () => {
    const actor = await actorOf(IDS.adminBio)
    const sequential = [ok(await createWorkOrder(actor, adminInput())), ok(await createWorkOrder(actor, adminInput()))]
    expect(sequential.map((created) => created.folio)).toEqual(["OT-BIO-0001", "OT-BIO-0002"])
    const burst = await Promise.all(Array.from({ length: 5 }, () => createWorkOrder(actor, adminInput())))
    const folios = burst.map((result) => ok(result).folio).sort()
    expect(folios).toEqual(["OT-BIO-0003", "OT-BIO-0004", "OT-BIO-0005", "OT-BIO-0006", "OT-BIO-0007"])
    const [counter] = await testDb.select().from(schema.mantFolioCounters).where(and(eq(schema.mantFolioCounters.worksiteId, IDS.wsBio), eq(schema.mantFolioCounters.kind, "OT")))
    expect(counter?.last).toBe(7)
  })

  it("idempotente por `client_request_id`: reenviar devuelve la misma OT; otra persona con el mismo id recibe un conflicto", async () => {
    const actor = await actorOf(IDS.adminBio)
    const input = adminInput()
    const first = ok(await createWorkOrder(actor, input))
    const second = ok(await createWorkOrder(actor, input))
    expect(second.id).toBe(first.id)
    expect(await testDb.select().from(schema.mantWorkOrders)).toHaveLength(1)
    // Envíos idénticos a la vez: una sola OT.
    const again = adminInput()
    const twins = await Promise.all([createWorkOrder(actor, again), createWorkOrder(actor, again), createWorkOrder(actor, again)])
    expect(new Set(twins.map((result) => ok(result).id)).size).toBe(1)
    expect(await testDb.select().from(schema.mantWorkOrders)).toHaveLength(2)
    expect(refused(await createWorkOrder(await actorOf(IDS.jefe), input)).code).toBe("conflict")
  })

  it("las reglas de la solicitud: tipo, descripción de la reparación y máximo de ítems", async () => {
    const actor = await actorOf(IDS.adminBio)
    const tooMany = refused(await createWorkOrder(actor, { ...adminInput(), annexItems: Array.from({ length: 13 }, (_, index) => `Ítem número ${index}`) }))
    expect(tooMany.field).toBe("items")
    expect(refused(await createWorkOrder(actor, { ...adminInput(), repair: false, maintenance: false })).field).toBe("repair")
    expect(refused(await createWorkOrder(actor, { ...adminInput(), repairDescription: "mal" })).field).toBe("repairDescription")
    // Nada quedó a medias: ni OT ni folio gastado.
    expect(await testDb.select().from(schema.mantWorkOrders)).toHaveLength(0)
    expect(await testDb.select().from(schema.mantFolioCounters)).toHaveLength(0)
  })
})

describe("permisos por estado (rol × transición)", () => {
  const FACTS = (status: OtStatus) => ({ status, worksiteId: IDS.wsBio, requestedByUserId: IDS.adminBio, assignedToUserId: status === "solicitada" ? null : IDS.mecBio })
  const MATRIX: Record<string, Partial<Record<OtStatus, OtTransition[]>>> = {
    // La jefatura asigna y gestiona; ejecuta también (tiene `execute`); no da la conformidad.
    [IDS.jefe]: {
      solicitada: ["assign", "void"], asignada: ["assign", "unassign", "start", "void"], en_ejecucion: ["assign", "finish", "void"],
      trabajo_terminado: ["receive", "reject_receipt"], recepcionada: [], cerrada: ["reopen"], anulada: [],
    },
    // El administrador de contrato de la faena: anula lo suyo mientras no entra a taller (por asignar o asignada, que es como nace la suya); recibe y da la conformidad.
    [IDS.adminBio]: {
      solicitada: ["void"], asignada: ["void"], en_ejecucion: [], trabajo_terminado: ["receive", "reject_receipt"],
      recepcionada: ["conform", "reject_conformity"], cerrada: [], anulada: [],
    },
    // El de otra faena no recibe ni da la conformidad de equipos ajenos.
    [IDS.adminCho]: { solicitada: [], asignada: [], en_ejecucion: [], trabajo_terminado: [], recepcionada: [], cerrada: [], anulada: [] },
    // El mecánico asignado ejecuta. Nadie toma una OT por asignar: la asigna la jefatura.
    [IDS.mecBio]: { solicitada: [], asignada: ["start"], en_ejecucion: ["finish"], trabajo_terminado: [], recepcionada: [], cerrada: [], anulada: [] },
    [IDS.mecCho]: { solicitada: [], asignada: [], en_ejecucion: [], trabajo_terminado: [], recepcionada: [], cerrada: [], anulada: [] },
  }

  for (const [userId, byStatus] of Object.entries(MATRIX)) {
    it(`matriz de ${userId}`, async () => {
      const viewer = await viewerOf(userId)
      for (const status of OT_STATUSES) {
        expect(allowedTransitions(viewer, FACTS(status)).sort(), `${userId} en «${status}»`).toEqual([...(byStatus[status] ?? [])].sort())
      }
    })
  }

  it("un rol sin permisos de OT no puede nada", async () => {
    const viewer = await viewerOf(IDS.plain)
    for (const status of OT_STATUSES) expect(allowedTransitions(viewer, FACTS(status))).toEqual([])
  })

  it("el servicio aplica la misma regla: el mecánico no asignado no inicia, el administrador no asigna, la jefatura no da conformidad", async () => {
    const id = await assigned(IDS.mecBio)
    expect(refused(await transitions.startWorkOrder(await actorOf(IDS.mecBio2), { workOrderId: id, entry: entry() })).code).toBe("forbidden")
    expect(refused(await transitions.assignWorkOrder(await actorOf(IDS.adminBio), { workOrderId: id, assignedToUserId: IDS.mecBio2 })).code).toBe("forbidden")
    expect(canActOnWorkOrder(await viewerOf(IDS.jefe), { ...FACTS("recepcionada") }, "conform")).toMatchObject({ ok: false, code: "forbidden" })
    expect(canActOnWorkOrder(await viewerOf(IDS.mecBio), { ...FACTS("asignada") }, "finish")).toMatchObject({ ok: false, code: "conflict" })
  })
})

describe("asignación y concurrencia", () => {
  it("una versión esperada obsoleta no pisa lo que otra sesión cambió", async () => {
    const id = await newOt()
    const jefe = await actorOf(IDS.jefe)
    const stale = refused(await transitions.assignWorkOrder(jefe, { workOrderId: id, expectedVersion: 99, assignedToUserId: IDS.mecBio }))
    expect(stale).toMatchObject({ code: "conflict", message: "La OT cambió en otra sesión. Recarga antes de continuar." })
    expect((await row(id)).status).toBe("solicitada")
    const fine = ok(await transitions.assignWorkOrder(jefe, { workOrderId: id, expectedVersion: 1, assignedToUserId: IDS.mecBio }))
    expect(fine).toMatchObject({ status: "asignada", version: 2 })
    // La misma versión ya no sirve.
    expect(refused(await transitions.unassignWorkOrder(jefe, { workOrderId: id, expectedVersion: 1 })).code).toBe("conflict")
  })

  it("asignar, reasignar y desasignar: valida al mecánico, no deja evento si no cambia y avisa al nuevo y, al reasignar, también al que la perdía", async () => {
    const id = await newOt()
    const jefe = await actorOf(IDS.jefe)
    expect(refused(await transitions.assignWorkOrder(jefe, { workOrderId: id, assignedToUserId: IDS.plain })).field).toBe("assignedToUserId")
    expect(refused(await transitions.assignWorkOrder(jefe, { workOrderId: id, assignedToUserId: IDS.inactive })).field).toBe("assignedToUserId")
    ok(await transitions.assignWorkOrder(jefe, { workOrderId: id, assignedToUserId: IDS.mecBio }))
    const same = ok(await transitions.assignWorkOrder(jefe, { workOrderId: id, assignedToUserId: IDS.mecBio }))
    expect(same.version).toBe(2)
    ok(await transitions.assignWorkOrder(jefe, { workOrderId: id, assignedToUserId: IDS.mecCho }))
    expect((await row(id)).assignedToUserId).toBe(IDS.mecCho)
    ok(await transitions.unassignWorkOrder(jefe, { workOrderId: id }))
    expect(await row(id)).toMatchObject({ status: "solicitada", assignedToUserId: null, assignedAt: null })
    expect((await eventsOf(id)).map((event) => event.type)).toEqual(["created", "assigned", "assigned", "unassigned"])
    await vi.waitFor(async () => expect((await notificationsOf("mant_ot_assigned")).map((notice) => notice.userId).sort()).toEqual([IDS.mecBio, IDS.mecCho]))
    // D4: pasar la OT de Bio a Cho avisó también a Bio (antes seguía creyendo que era suya); el
    // aviso de «volvió a por asignar» le llega después a Cho, que era quien la tenía.
    await vi.waitFor(async () => {
      const lost = await notificationsOf("mant_ot_unassigned")
      expect(lost.map((notice) => notice.userId).sort()).toEqual([IDS.mecBio, IDS.mecCho])
      expect(lost.find((notice) => notice.userId === IDS.mecBio)?.body).toContain("Se reasignó a otro mecánico")
      expect(lost.find((notice) => notice.userId === IDS.mecCho)?.body).toContain("Volvió a «Por asignar»")
    })
  })

  it("asignar a quien ya la tiene, o por primera vez, no manda aviso de «quitada»", async () => {
    const id = await newOt()
    const jefe = await actorOf(IDS.jefe)
    ok(await transitions.assignWorkOrder(jefe, { workOrderId: id, assignedToUserId: IDS.mecBio }))
    ok(await transitions.assignWorkOrder(jefe, { workOrderId: id, assignedToUserId: IDS.mecBio }))
    await settle()
    expect(await notificationsOf("mant_ot_unassigned")).toEqual([])
  })

  it("la jefatura puede asignar a un mecánico de OTRA faena y él la trabaja", async () => {
    const id = await assigned(IDS.mecCho)
    ok(await transitions.startWorkOrder(await actorOf(IDS.mecCho), { workOrderId: id, entry: entry() }))
    expect((await row(id)).status).toBe("en_ejecucion")
  })
})

describe("ingreso a taller", () => {
  it("registra el ingreso con los nombres resueltos y pone el equipo en `mantencion` con el folio como motivo", async () => {
    const id = await assigned()
    const mecanico = await actorOf(IDS.mecBio)
    ok(await transitions.startWorkOrder(mecanico, { workOrderId: id, entry: entry({ workshopKind: "externo", workshopId: IDS.workshop }) }))
    const ot = await row(id)
    expect(ot).toMatchObject({
      status: "en_ejecucion", workshopKind: "externo", workshopId: IDS.workshop, workshopName: "Maestranza Melo", operatorDriverId: IDS.driver1,
      operatorName: "AEDO POLANCO JOSE A.", entryOdometer: 12_000, entryHourmeter: null, startedByUserId: IDS.mecBio,
    })
    expect(await vehicleStatus(IDS.truckBio)).toBe("mantencion")
    expect(await openIntervalReason(IDS.truckBio)).toBe("OT-BIO-0001: Ingreso a taller")
  })

  it("guardias del ingreso: lectura de la unidad, hora no futura, fecha estimada, taller externo del catálogo", async () => {
    const id = await assigned()
    const mecanico = await actorOf(IDS.mecBio)
    const start = (overrides: Partial<WorkOrderEntryPayload>) => transitions.startWorkOrder(mecanico, { workOrderId: id, entry: entry(overrides) })
    expect(refused(await start({ odometer: null })).field).toBe("odometer")
    // Un horómetro no sirve para un equipo medido en km.
    expect(refused(await start({ odometer: null, hourmeter: 500 })).field).toBe("odometer")
    expect(refused(await start({ entryAt: new Date(Date.now() + 3_600_000).toISOString() })).field).toBe("entryAt")
    expect(refused(await start({ estimatedDeliveryDate: addDaysToPlainDate(today, -2) })).field).toBe("estimatedDeliveryDate")
    expect(refused(await start({ workshopKind: "externo", workshopId: null })).field).toBe("workshopId")
    expect(refused(await start({ workshopKind: "externo", workshopId: "wk-inexistente" })).field).toBe("workshopId")
    expect((await row(id)).status).toBe("asignada")
    expect(await vehicleStatus(IDS.truckBio)).toBe("operativo")
  })

  it("el horómetro es la lectura de un equipo medido en horas", async () => {
    const id = await assigned(IDS.mecBio, { vehicleId: IDS.machineBio })
    const mecanico = await actorOf(IDS.mecBio)
    expect(refused(await transitions.startWorkOrder(mecanico, { workOrderId: id, entry: entry({ odometer: 400, hourmeter: null }) })).field).toBe("hourmeter")
    ok(await transitions.startWorkOrder(mecanico, { workOrderId: id, entry: entry({ odometer: null, hourmeter: 1_250 }) }))
    expect(await row(id)).toMatchObject({ entryOdometer: null, entryHourmeter: 1_250 })
  })

  it("no pisa un `fuera_servicio` impuesto por otro módulo ni lo devuelve a operativo al terminar", async () => {
    await testDb.update(schema.fuelVehicles).set({ operationalStatus: "fuera_servicio" }).where(eq(schema.fuelVehicles.id, IDS.truckBio))
    const id = await finished()
    expect(await vehicleStatus(IDS.truckBio)).toBe("fuera_servicio")
    expect((await row(id)).status).toBe("trabajo_terminado")
  })

  it("la fecha estimada cambia con motivo y deja `{from, to}` en el historial; corregir el ingreso no la toca", async () => {
    const id = await inWorkshop()
    const mecanico = await actorOf(IDS.mecBio)
    const current = (await row(id)).estimatedDeliveryDate!
    const newDate = addDaysToPlainDate(today, 6)
    expect(refused(await transitions.changeWorkOrderEstimate(mecanico, { workOrderId: id, estimatedDeliveryDate: newDate, reason: null })).field).toBe("reason")
    // D4: mismo umbral que las demás transiciones (REASON_MIN_LENGTH), no un 5 propio.
    expect(refused(await transitions.changeWorkOrderEstimate(mecanico, { workOrderId: id, estimatedDeliveryDate: newDate, reason: "Repuesto" })).message).toContain("al menos 10 caracteres")
    ok(await transitions.changeWorkOrderEstimate(mecanico, { workOrderId: id, estimatedDeliveryDate: newDate, reason: "Falta un repuesto importado" }))
    const event = (await eventsOf(id)).find((item) => item.type === "estimate_changed")
    expect(event).toMatchObject({ reason: "Falta un repuesto importado", changeSet: { from: current, to: newDate } })
    expect(refused(await transitions.updateWorkOrderEntry(mecanico, { workOrderId: id, entry: entry({ estimatedDeliveryDate: current }) })).field).toBe("estimatedDeliveryDate")
    ok(await transitions.updateWorkOrderEntry(mecanico, { workOrderId: id, entry: entry({ estimatedDeliveryDate: newDate, odometer: 12_050, workshopManagerName: "Don Luis" }) }))
    expect(await row(id)).toMatchObject({ entryOdometer: 12_050, workshopManagerName: "Don Luis", estimatedDeliveryDate: newDate })
    expect((await eventsOf(id)).find((item) => item.type === "entry_updated")?.changeSet).toMatchObject({ after: { entryOdometer: 12_050 } })
  })
})

describe("ítems SÍ/NO y salida de taller", () => {
  it("marca ítems, agrega los del taller (máx. 12 por lista) y rechaza ítems ajenos", async () => {
    const id = await inWorkshop()
    const mecanico = await actorOf(IDS.mecBio)
    const [first] = await testDb.select().from(schema.mantWorkOrderItems).where(eq(schema.mantWorkOrderItems.workOrderId, id)).orderBy(asc(schema.mantWorkOrderItems.sortOrder))
    ok(await transitions.markWorkOrderItems(mecanico, {
      workOrderId: id, marks: [{ itemId: first!.id, done: "no", note: "No había repuesto" }],
      added: [{ kind: "anexo", description: "Cambiar abrazaderas" }],
    }))
    const items = await testDb.select().from(schema.mantWorkOrderItems).where(eq(schema.mantWorkOrderItems.workOrderId, id))
    expect(items.find((item) => item.id === first!.id)).toMatchObject({ done: "no", note: "No había repuesto", markedByUserId: IDS.mecBio })
    expect(items.find((item) => item.description === "Cambiar abrazaderas")).toMatchObject({ origin: "taller", kind: "anexo", sortOrder: 2 })
    expect(refused(await transitions.markWorkOrderItems(mecanico, { workOrderId: id, marks: [{ itemId: "otro", done: "si", note: null }], added: [] })).field).toBe("marks")
    const many = Array.from({ length: 10 }, (_, index) => ({ kind: "anexo" as const, description: `Trabajo adicional ${index}` }))
    expect(refused(await transitions.markWorkOrderItems(mecanico, { workOrderId: id, marks: [], added: many })).field).toBe("added")
    expect(refused(await transitions.markWorkOrderItems(mecanico, { workOrderId: id, marks: [], added: [] })).field).toBe("marks")
  })

  it("terminar exige todos los ítems marcados y un registro vigente enlazado; la salida no precede al ingreso ni es futura", async () => {
    const id = await inWorkshop()
    const mecanico = await actorOf(IDS.mecBio)
    const exitAt = new Date(Date.now() - 60_000).toISOString()
    const finish = (at = exitAt) => transitions.finishWorkOrder(mecanico, { workOrderId: id, exitAt: at, note: null })

    const unmarked = refused(await finish())
    expect(unmarked).toMatchObject({ field: "items" })
    expect(unmarked.message).toContain("faltan 3")
    await markAll(id, IDS.mecBio)
    expect(refused(await finish()).field).toBe("records")

    const recordId = await linkedCorrective(IDS.mecBio, id)
    // Un registro anulado no cuenta.
    await testDb.update(schema.mantRecords).set({ status: "anulado" }).where(eq(schema.mantRecords.id, recordId))
    expect(refused(await finish()).field).toBe("records")
    await testDb.update(schema.mantRecords).set({ status: "vigente" }).where(eq(schema.mantRecords.id, recordId))

    expect(refused(await finish(new Date(Date.now() - 5 * 3_600_000).toISOString())).field).toBe("exitAt")
    expect(refused(await finish(new Date(Date.now() + 3_600_000).toISOString())).field).toBe("exitAt")
    expect((await row(id)).status).toBe("en_ejecucion")

    const done = ok(await finish())
    expect(done.status).toBe("trabajo_terminado")
    expect(await row(id)).toMatchObject({ finishedByUserId: IDS.mecBio })
    // Sale de taller: el equipo vuelve a operativo porque el intervalo era de esta OT.
    expect(await vehicleStatus(IDS.truckBio)).toBe("operativo")
    expect(await openIntervalReason(IDS.truckBio)).toBe("OT-BIO-0001: Salida de taller")
    await vi.waitFor(async () => expect((await notificationsOf("mant_ot_finished")).map((notice) => notice.userId).sort()).toEqual([IDS.adminBio, IDS.jefe].sort()))
  })

  it("con otra OT del mismo equipo todavía en taller, terminar una no lo devuelve a operativo", async () => {
    const first = await inWorkshop()
    // El mismo camión admite otra OT (su equipo ya está en `mantencion`: la segunda no lo toca).
    const second = await inWorkshop(IDS.mecBio2)
    await markAll(first, IDS.mecBio)
    await linkedCorrective(IDS.mecBio, first)
    ok(await transitions.finishWorkOrder(await actorOf(IDS.mecBio), { workOrderId: first, exitAt: new Date(Date.now() - 60_000).toISOString(), note: null }))
    expect(await vehicleStatus(IDS.truckBio)).toBe("mantencion")
    await markAll(second, IDS.mecBio2)
    await linkedCorrective(IDS.mecBio2, second)
    ok(await transitions.finishWorkOrder(await actorOf(IDS.mecBio2), { workOrderId: second, exitAt: new Date(Date.now() - 30_000).toISOString(), note: null }))
    expect(await vehicleStatus(IDS.truckBio)).toBe("operativo")
  })
})

describe("recepciones, rechazo y conformidad", () => {
  it("recepción y recepción en faena: validan fechas y nombres, cierran la OT y avisan", async () => {
    const id = await finished()
    const jefe = await actorOf(IDS.jefe)
    const exit = new Date((await row(id)).workshopExitAt!).getTime()
    expect(refused(await transitions.receiveWorkOrder(jefe, { workOrderId: id, receivedAt: new Date(exit - 3_600_000).toISOString(), receiverName: "Pedro Retira" })).field).toBe("receivedAt")
    expect(refused(await transitions.receiveWorkOrder(jefe, { workOrderId: id, receivedAt: new Date().toISOString(), receiverName: "P" })).field).toBe("receiverName")
    const received = ok(await transitions.receiveWorkOrder(jefe, { workOrderId: id, receivedAt: new Date().toISOString(), receiverName: "Pedro Retira" }))
    expect(received.status).toBe("recepcionada")
    expect(await row(id)).toMatchObject({ receiverName: "Pedro Retira", receivedByUserId: IDS.jefe })
    await vi.waitFor(async () => expect((await notificationsOf("mant_ot_received")).map((notice) => notice.userId)).toEqual([IDS.adminBio]))

    const admin = await actorOf(IDS.adminBio)
    expect(refused(await transitions.conformWorkOrder(admin, { workOrderId: id, faenaReceivedAt: new Date(Date.now() - 3_600_000 * 10).toISOString(), faenaReceiverName: "Ana Faena" })).field).toBe("faenaReceivedAt")
    const closed = ok(await transitions.conformWorkOrder(admin, { workOrderId: id, faenaReceivedAt: new Date().toISOString(), faenaReceiverName: "Ana Faena" }))
    expect(closed.status).toBe("cerrada")
    expect(await row(id)).toMatchObject({ faenaReceiverName: "Ana Faena", faenaReceivedByUserId: IDS.adminBio })
    expect((await row(id)).closedAt).toBeTruthy()
    expect((await eventsOf(id)).map((event) => event.type)).toEqual(expect.arrayContaining(["received", "conformed"]))
    await vi.waitFor(async () => expect((await notificationsOf("mant_ot_closed")).map((notice) => notice.userId).sort()).toEqual([IDS.jefe]))
  })

  it("la conformidad de otra faena se rechaza; la jefatura tampoco puede darla", async () => {
    const id = await received()
    const input = { workOrderId: id, faenaReceivedAt: new Date().toISOString(), faenaReceiverName: "Quien Sea" }
    const other = refused(await transitions.conformWorkOrder(await actorOf(IDS.adminCho), input))
    expect(other.code).toBe("forbidden")
    expect(other.message).toContain("otra faena")
    expect(refused(await transitions.conformWorkOrder(await actorOf(IDS.jefe), input)).code).toBe("forbidden")
    expect((await row(id)).status).toBe("recepcionada")
  })

  it("el rechazo en la recepción vuelve a taller con el mismo mecánico: motivo, contador, campos limpios, historial y avisos", async () => {
    const id = await finished()
    const before = await row(id)
    const admin = await actorOf(IDS.adminBio)
    expect(refused(await transitions.rejectWorkOrder(admin, { workOrderId: id, reason: "corto" })).field).toBe("reason")

    const back = ok(await transitions.rejectWorkOrder(admin, { workOrderId: id, reason: "El equipo sigue con fuga de aceite" }))
    expect(back.status).toBe("en_ejecucion")
    const after = await row(id)
    expect(after).toMatchObject({
      status: "en_ejecucion", rejectionCount: 1, assignedToUserId: IDS.mecBio, workshopExitAt: null, finishedAt: null, finishedByUserId: null,
      receivedAt: null, receiverName: null, receivedByUserId: null,
    })
    const rejection = (await eventsOf(id)).find((event) => event.type === "rejected")
    expect(rejection).toMatchObject({ reason: "El equipo sigue con fuga de aceite", fromStatus: "trabajo_terminado", toStatus: "en_ejecucion" })
    expect(rejection?.changeSet).toMatchObject({ stage: "recepcion", rejectionCount: 1 })
    expect(new Date((rejection?.changeSet as { previous: { workshopExitAt: string } }).previous.workshopExitAt).getTime()).toBe(new Date(before.workshopExitAt!).getTime())
    // El equipo vuelve a «en taller» bajo el mismo folio.
    expect(await vehicleStatus(IDS.truckBio)).toBe("mantencion")
    expect(await openIntervalReason(IDS.truckBio)).toBe("OT-BIO-0001: Devuelta a taller")
    await vi.waitFor(async () => expect((await notificationsOf("mant_ot_rejected")).map((notice) => notice.userId).sort()).toEqual([IDS.jefe, IDS.mecBio].sort()))

    // Terminar otra vez exige una correctiva NUEVA, firmada después del rechazo.
    await markAll(id, IDS.mecBio)
    const mecanico = await actorOf(IDS.mecBio)
    const finish = () => transitions.finishWorkOrder(mecanico, { workOrderId: id, exitAt: new Date(Date.now() - 1_000).toISOString(), note: null })
    const stale = refused(await finish())
    expect(stale).toMatchObject({ field: "records" })
    expect(stale.message).toContain("Tras la devolución")
    await linkedCorrective(IDS.mecBio, id)
    expect(ok(await finish()).status).toBe("trabajo_terminado")
  })

  it("tras el rechazo cuenta la hora en que el servidor recibió la correctiva, no la firma del teléfono (reloj atrasado)", async () => {
    const id = await finished()
    ok(await transitions.rejectWorkOrder(await actorOf(IDS.adminBio), { workOrderId: id, reason: "El equipo sigue con fuga de aceite" }))
    await markAll(id, IDS.mecBio)
    const mecanico = await actorOf(IDS.mecBio)
    // Un teléfono atrasado 3 horas firma ahora una correctiva «de antes del rechazo» según su propio reloj.
    const skewed = new Date(Date.now() - 3 * 3_600_000).toISOString()
    await linkedCorrective(IDS.mecBio, id, IDS.truckBio, { signedAt: skewed })
    // La app del mecánico recibe la misma regla: la correctiva figura como posterior a la devolución.
    const { loadCatalogWorkOrders } = await import("@/lib/services/mantencion/work-orders/catalog-items")
    const catalog = await loadCatalogWorkOrders(await viewerOf(IDS.mecBio))
    expect(catalog.workOrders.find((workOrder) => workOrder.id === id)?.linkedRecords).toHaveLength(1)
    const outcome = await transitions.finishWorkOrder(mecanico, { workOrderId: id, exitAt: new Date(Date.now() - 1_000).toISOString(), note: null })
    expect(ok(outcome).status).toBe("trabajo_terminado")
  })

  it("el rechazo en la conformidad también devuelve a taller, con el aviso y la etapa en el historial", async () => {
    const id = await received()
    const back = ok(await transitions.rejectWorkOrder(await actorOf(IDS.adminBio), { workOrderId: id, reason: "La pintura quedó sin terminar" }))
    expect(back.status).toBe("en_ejecucion")
    expect(await row(id)).toMatchObject({ rejectionCount: 1, receivedAt: null, faenaReceivedAt: null })
    expect((await eventsOf(id)).find((event) => event.type === "rejected")).toMatchObject({ fromStatus: "recepcionada", changeSet: { stage: "conformidad" } })
    // La jefatura no puede rechazar la conformidad (no tiene `conform`).
    const again = await received()
    expect(refused(await transitions.rejectWorkOrder(await actorOf(IDS.jefe), { workOrderId: again, reason: "Quiero devolverla ahora" })).code).toBe("forbidden")
  })
})

describe("anular y reabrir", () => {
  it("quien la creó puede anularla mientras está por asignar; después sólo la jefatura, siempre con motivo", async () => {
    // La del administrador nace asignada: la jefatura la devuelve a «por asignar».
    const id = await newOt({ assignedToUserId: IDS.mecBio }, IDS.adminBio)
    ok(await transitions.unassignWorkOrder(await actorOf(IDS.jefe), { workOrderId: id }))
    const admin = await actorOf(IDS.adminBio)
    expect(refused(await transitions.voidWorkOrder(admin, { workOrderId: id, reason: "corto" })).field).toBe("reason")
    ok(await transitions.voidWorkOrder(admin, { workOrderId: id, reason: "Se pidió el equipo equivocado" }))
    expect(await row(id)).toMatchObject({ status: "anulada", voidedByUserId: IDS.adminBio, voidReason: "Se pidió el equipo equivocado" })

    const assignedId = await assigned()
    expect(refused(await transitions.voidWorkOrder(admin, { workOrderId: assignedId, reason: "Ya no hace falta la OT" })).code).toBe("forbidden")
    ok(await transitions.voidWorkOrder(await actorOf(IDS.jefe), { workOrderId: assignedId, reason: "Ya no hace falta la OT" }))
    // Una anulada no admite nada más.
    expect(refused(await transitions.assignWorkOrder(await actorOf(IDS.jefe), { workOrderId: assignedId, assignedToUserId: IDS.mecBio })).code).toBe("conflict")
  })

  it("la OT que el administrador de contrato creó nace asignada y él puede anularla ahí; en taller ya no, y el mecánico recibe el aviso", async () => {
    const admin = await actorOf(IDS.adminBio)
    const id = await newOt({ assignedToUserId: IDS.mecBio }, IDS.adminBio)
    expect(await row(id)).toMatchObject({ status: "asignada", assignedToUserId: IDS.mecBio })
    ok(await transitions.voidWorkOrder(admin, { workOrderId: id, reason: "Se pidió el equipo equivocado" }))
    expect(await row(id)).toMatchObject({ status: "anulada", voidedByUserId: IDS.adminBio })
    await settle()
    const voided = await notificationsOf("mant_ot_voided")
    expect(voided.map((notification) => notification.userId)).toEqual([IDS.mecBio])
    expect(voided[0]!.body).toContain("Se pidió el equipo equivocado")

    // Una vez en taller (ejecución iniciada) sólo la jefatura anula.
    const inShop = await newOt({ assignedToUserId: IDS.mecBio }, IDS.adminBio)
    ok(await transitions.startWorkOrder(await actorOf(IDS.mecBio), { workOrderId: inShop, entry: entry() }))
    const denied = refused(await transitions.voidWorkOrder(admin, { workOrderId: inShop, reason: "Ya no hace falta la OT" }))
    expect(denied.code).toBe("forbidden")
    expect(denied.message).toMatch(/mientras no haya entrado a taller/)
  })

  it("devolver la OT a «por asignar» avisa al mecánico que la tenía", async () => {
    const id = await assigned()
    await settle()
    ok(await transitions.unassignWorkOrder(await actorOf(IDS.jefe), { workOrderId: id }))
    await settle()
    const unassigned = await notificationsOf("mant_ot_unassigned")
    expect(unassigned.map((notification) => notification.userId)).toEqual([IDS.mecBio])
    expect(unassigned[0]).toMatchObject({ entityId: id })
  })

  it("anular una OT en taller devuelve el equipo a operativo", async () => {
    const id = await inWorkshop()
    expect(await vehicleStatus(IDS.truckBio)).toBe("mantencion")
    ok(await transitions.voidWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, reason: "El equipo se dio de baja" }))
    expect(await vehicleStatus(IDS.truckBio)).toBe("operativo")
  })

  it("reabrir (jefatura) deja la OT en taller con todo limpio, el equipo en mantención y un motivo", async () => {
    const id = await received()
    ok(await transitions.conformWorkOrder(await actorOf(IDS.adminBio), { workOrderId: id, faenaReceivedAt: new Date().toISOString(), faenaReceiverName: "Ana Faena" }))
    expect(refused(await transitions.reopenWorkOrder(await actorOf(IDS.adminBio), { workOrderId: id, reason: "Quiero reabrirla ya" })).code).toBe("forbidden")
    expect(refused(await transitions.reopenWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, reason: "corto" })).field).toBe("reason")
    ok(await transitions.reopenWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, reason: "La falla reapareció en terreno" }))
    expect(await row(id)).toMatchObject({
      status: "en_ejecucion", closedAt: null, faenaReceivedAt: null, receivedAt: null, workshopExitAt: null, assignedToUserId: IDS.mecBio, rejectionCount: 0,
    })
    expect(await vehicleStatus(IDS.truckBio)).toBe("mantencion")
    expect((await eventsOf(id)).find((event) => event.type === "reopened")).toMatchObject({ reason: "La falla reapareció en terreno", fromStatus: "cerrada" })
    // Como tras un rechazo, terminar pide una correctiva posterior a la reapertura.
    await markAll(id, IDS.mecBio)
    expect(refused(await transitions.finishWorkOrder(await actorOf(IDS.mecBio), { workOrderId: id, exitAt: new Date(Date.now() - 1_000).toISOString(), note: null })).field).toBe("records")
  })
})

describe("OT de un hallazgo de inspección: la conformidad acredita la CAPA", () => {
  const AUTOR = IDS.jefe
  async function seedFindingWithCapa(status = "pending") {
    const templateId = crypto.randomUUID()
    await testDb.insert(schema.preventionInspectionTemplates).values({
      id: templateId, code: `PLT-${templateId.slice(0, 5)}`, versionLabel: "v1", name: "Camiones", kind: "inspection", definitionSnapshot: {},
      contentHash: "a".repeat(64), status: "draft", authorUserId: AUTOR,
    })
    const runId = crypto.randomUUID()
    await testDb.insert(schema.preventionInspectionRuns).values({
      id: runId, code: `INS-${runId.slice(0, 5)}`, templateId, worksiteId: IDS.wsBio, status: "completed", createdByUserId: AUTOR,
    })
    const capaId = crypto.randomUUID()
    await testDb.insert(schema.preventionCapaActions).values({
      id: capaId, code: `CAPA-${capaId.slice(0, 5)}`, sourceType: "inspection", sourceId: runId, worksiteId: IDS.wsBio,
      finding: "Falla en el sistema de frenos", actionDescription: "Reparar y probar los frenos", targetDate: addDaysToPlainDate(today, 10), status, createdByUserId: AUTOR,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    const findingId = crypto.randomUUID()
    await testDb.insert(schema.preventionInspectionFindings).values({
      id: findingId, runId, description: "Falla en el sistema de frenos", criticality: "high", status: "capa_linked", capaActionId: capaId,
    })
    return { findingId, capaId }
  }
  async function otFromFinding(findingId: string) {
    const created = await testDb.transaction((tx) => createWorkOrderWithClient(tx, {
      vehicleId: IDS.truckBio, inspectionFindingId: findingId, repair: true, maintenance: false,
      repairDescription: "Falla en el sistema de frenos", observations: "Lectura: 12.000 km", requesterName: "Inspección SST",
    }, { userId: AUTOR, name: "Alexis Morales" }))
    await notifyWorkOrderCreated(created.id)
    return created.id
  }
  async function toConformed(id: string) {
    await markAll(id, IDS.mecBio)
    await linkedCorrective(IDS.mecBio, id)
    ok(await transitions.finishWorkOrder(await actorOf(IDS.mecBio), { workOrderId: id, exitAt: new Date(Date.now() - 60_000).toISOString(), note: null }))
    ok(await transitions.receiveWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, receivedAt: new Date().toISOString(), receiverName: "Pedro Retira" }))
  }
  const conform = async (id: string) => transitions.conformWorkOrder(await actorOf(IDS.adminBio), { workOrderId: id, faenaReceivedAt: new Date().toISOString(), faenaReceiverName: "Ana Faena" })
  const wipe = async () => {
    for (const table of [
      schema.preventionCapaEvidence, schema.preventionCapaTransitions, schema.mantWorkOrderEvents, schema.mantWorkOrderItems,
      schema.mantRecordPhotos, schema.mantRecords, schema.mantWorkOrders, schema.preventionInspectionFindings, schema.preventionCapaActions,
      schema.preventionInspectionRuns, schema.preventionInspectionTemplates,
    ]) await testDb.delete(table)
  }
  beforeEach(wipe)

  it("conformidad → evidencia `mantencion:ot:<id>`, hallazgo cerrado y CAPA en verificación; reabrir la supersede; una CAPA verificada impide reabrir", async () => {
    const { findingId, capaId } = await seedFindingWithCapa()
    const id = await otFromFinding(findingId)
    expect(await row(id)).toMatchObject({ inspectionFindingId: findingId, folio: "OT-BIO-0001" })
    // Un hallazgo deriva a lo más una OT viva.
    await expect(otFromFinding(findingId)).rejects.toThrow()

    ok(await transitions.assignWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, assignedToUserId: IDS.mecBio }))
    ok(await transitions.startWorkOrder(await actorOf(IDS.mecBio), { workOrderId: id, entry: entry() }))
    await toConformed(id)
    ok(await conform(id))

    const evidence = async () => testDb.select().from(schema.preventionCapaEvidence).where(eq(schema.preventionCapaEvidence.actionId, capaId))
    expect(await evidence()).toEqual([expect.objectContaining({ reference: `mantencion:ot:${id}`, status: "active", kind: "document" })])
    const [finding] = await testDb.select().from(schema.preventionInspectionFindings).where(eq(schema.preventionInspectionFindings.id, findingId))
    expect(finding).toMatchObject({ status: "closed", closedByUserId: IDS.adminBio })
    const [capa] = await testDb.select().from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.id, capaId))
    expect(capa).toMatchObject({ status: "pending_verification", completedByUserId: IDS.adminBio })

    ok(await transitions.reopenWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, reason: "La falla reapareció durante la prueba" }))
    expect(await evidence()).toEqual([expect.objectContaining({ status: "superseded", supersededByUserId: IDS.jefe })])
    expect((await testDb.select().from(schema.preventionInspectionFindings).where(eq(schema.preventionInspectionFindings.id, findingId)))[0]).toMatchObject({ status: "capa_linked", closedAt: null })
    expect((await testDb.select().from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.id, capaId)))[0]).toMatchObject({ status: "reopened" })

    // Cerrarla de nuevo reactiva la misma evidencia; si Prevención ya verificó la CAPA, Mantención no puede reabrir.
    await markAll(id, IDS.mecBio)
    await linkedCorrective(IDS.mecBio, id)
    ok(await transitions.finishWorkOrder(await actorOf(IDS.mecBio), { workOrderId: id, exitAt: new Date(Date.now() - 1_000).toISOString(), note: null }))
    ok(await transitions.receiveWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, receivedAt: new Date().toISOString(), receiverName: "Pedro Retira" }))
    ok(await conform(id))
    expect(await evidence()).toEqual([expect.objectContaining({ status: "active" })])
    await testDb.update(schema.preventionCapaActions).set({ status: "verified", verifiedByUserId: AUTOR, verifiedAt: new Date().toISOString(), effectivenessStatus: "effective" })
      .where(eq(schema.preventionCapaActions.id, capaId))
    const blocked = refused(await transitions.reopenWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, reason: "La falla volvió a presentarse" }))
    expect(blocked.message).toMatch(/debe reabrirla un usuario autorizado de Prevención/)
    expect((await row(id)).status).toBe("cerrada")
  })

  it("si la CAPA está cancelada la conformidad se revierte entera: la OT sigue por conformidad y no sale ningún aviso de cierre", async () => {
    const { findingId, capaId } = await seedFindingWithCapa()
    const id = await otFromFinding(findingId)
    ok(await transitions.assignWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, assignedToUserId: IDS.mecBio }))
    ok(await transitions.startWorkOrder(await actorOf(IDS.mecBio), { workOrderId: id, entry: entry() }))
    await toConformed(id)
    await testDb.update(schema.preventionCapaActions).set({ status: "cancelled" }).where(eq(schema.preventionCapaActions.id, capaId))
    const failed = refused(await conform(id))
    expect(failed.message).toContain("cancelada")
    expect(await row(id)).toMatchObject({ status: "recepcionada", closedAt: null, faenaReceivedAt: null })
    expect((await eventsOf(id)).map((event) => event.type)).not.toContain("conformed")
    await settle()
    expect(await notificationsOf("mant_ot_closed")).toHaveLength(0)
  })

  it("si Prevención cancela la CAPA por su servicio real (el hallazgo vuelve a `open` sin vínculo) la conformidad se rechaza y el hallazgo no se cierra", async () => {
    const { transitionCapaActionWithClient } = await import("@/lib/services/prevention-capa")
    const { findingId, capaId } = await seedFindingWithCapa()
    const id = await otFromFinding(findingId)
    ok(await transitions.assignWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, assignedToUserId: IDS.mecBio }))
    ok(await transitions.startWorkOrder(await actorOf(IDS.mecBio), { workOrderId: id, entry: entry() }))
    await toConformed(id)

    await transitionCapaActionWithClient(testDb, {
      actionId: capaId, expectedVersion: 1, toStatus: "cancelled", reason: "Se descarta la acción propuesta",
    }, { ctx: { userId: AUTOR }, scope: { mode: "all", ids: [] }, permissions: ["prevention:capa:manage"] })
    const [released] = await testDb.select().from(schema.preventionInspectionFindings).where(eq(schema.preventionInspectionFindings.id, findingId))
    expect(released).toMatchObject({ status: "open", capaActionId: null })

    const failed = refused(await conform(id))
    expect(failed.message).toMatch(/fue cancelada en Prevención/)
    expect(await row(id)).toMatchObject({ status: "recepcionada", closedAt: null, faenaReceivedAt: null })
    expect((await testDb.select().from(schema.preventionInspectionFindings).where(eq(schema.preventionInspectionFindings.id, findingId)))[0]).toMatchObject({ status: "open" })
    expect(await testDb.select().from(schema.preventionCapaEvidence).where(eq(schema.preventionCapaEvidence.actionId, capaId))).toHaveLength(0)
    expect((await eventsOf(id)).map((event) => event.type)).not.toContain("conformed")
  })

  it("una OT cerrada no se reabre si el hallazgo ya tiene otra OT abierta (re-derivado)", async () => {
    const { findingId } = await seedFindingWithCapa()
    const first = await otFromFinding(findingId)
    ok(await transitions.assignWorkOrder(await actorOf(IDS.jefe), { workOrderId: first, assignedToUserId: IDS.mecBio }))
    ok(await transitions.startWorkOrder(await actorOf(IDS.mecBio), { workOrderId: first, entry: entry() }))
    await toConformed(first)
    ok(await conform(first))
    expect((await row(first)).status).toBe("cerrada")
    // Cerrada la primera, el índice admite otra OT viva para el mismo hallazgo.
    const second = await otFromFinding(findingId)
    expect(second).not.toBe(first)
    const blocked = refused(await transitions.reopenWorkOrder(await actorOf(IDS.jefe), { workOrderId: first, reason: "La falla reapareció en terreno" }))
    expect(blocked.message).toMatch(/ya tiene otra OT abierta/)
    expect((await row(first)).status).toBe("cerrada")
  })

  it("un hallazgo ya cerrado por Prevención sin CAPA no bloquea la conformidad", async () => {
    const { findingId } = await seedFindingWithCapa()
    const id = await otFromFinding(findingId)
    ok(await transitions.assignWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, assignedToUserId: IDS.mecBio }))
    ok(await transitions.startWorkOrder(await actorOf(IDS.mecBio), { workOrderId: id, entry: entry() }))
    await toConformed(id)
    await testDb.update(schema.preventionInspectionFindings).set({ status: "closed", capaActionId: null })
      .where(eq(schema.preventionInspectionFindings.id, findingId))
    ok(await conform(id))
    expect((await row(id)).status).toBe("cerrada")
  })
})

describe("avisos: sólo después del commit", () => {
  it("una transacción revertida no deja OT, ni folio gastado, ni aviso", async () => {
    await expect(testDb.transaction(async (tx) => {
      await createWorkOrderWithClient(tx, {
        vehicleId: IDS.truckBio, inspectionFindingId: null, repair: true, maintenance: false,
        repairDescription: "Falla en el sistema de frenos", observations: null, requesterName: "Inspección SST",
      }, { userId: IDS.adminBio, name: "Ana" })
      throw new Error("rollback del llamador")
    })).rejects.toThrow("rollback del llamador")
    await settle()
    expect(await testDb.select().from(schema.mantWorkOrders)).toHaveLength(0)
    expect(await testDb.select().from(schema.mantFolioCounters)).toHaveLength(0)
    expect(await notificationsOf()).toHaveLength(0)
  })

  it("`createWorkOrderWithClient` no avisa solo: el aviso sale cuando el llamador lo pide, y es idempotente", async () => {
    const created = await testDb.transaction((tx) => createWorkOrderWithClient(tx, {
      vehicleId: IDS.truckBio, inspectionFindingId: null, repair: true, maintenance: false, annexItems: ["Revisar frenos"],
      repairDescription: "Falla en el sistema de frenos", observations: null, requesterName: "Inspección SST",
    }, { userId: IDS.adminBio, name: "Ana" }))
    expect(created).toMatchObject({ folio: "OT-BIO-0001", worksiteId: IDS.wsBio })
    await settle()
    expect(await notificationsOf()).toHaveLength(0)
    await notifyWorkOrderCreated(created.id)
    await notifyWorkOrderCreated(created.id)
    expect((await notificationsOf("mant_ot_created")).map((notice) => notice.userId)).toEqual([IDS.jefe])
    // Un equipo fuera del módulo no puede tener OT: el llamador recibe un error legible.
    await expect(testDb.transaction((tx) => createWorkOrderWithClient(tx, {
      vehicleId: "v-no-modulo", inspectionFindingId: null, repair: true, maintenance: false, repairDescription: "Falla en el sistema de frenos",
      observations: null, requesterName: "Inspección SST",
    }, { userId: IDS.adminBio, name: "Ana" }))).rejects.toThrow("no está en el módulo de mantención")
  })
})

describe("lectura: lista, detalle, filtros y Excel", () => {
  it("D4: una página más allá de la última sirve la última página, no un listado vacío", async () => {
    const first = await newOt()
    const second = await newOt({ vehicleId: IDS.truckCho })
    const third = await newOt({ vehicleId: IDS.machineBio })
    const jefe = await viewerOf(IDS.jefe)
    const filters = { tab: "abiertas" as const, pageSize: 2 }
    const page2 = await listWorkOrders(jefe, { ...filters, page: 2 })
    expect(page2.rows).toHaveLength(1)
    // Página 9 de 2: antes volvía sin filas con total 3 (el estado vacío con la lista llena).
    const beyond = await listWorkOrders(jefe, { ...filters, page: 9 })
    expect(beyond.total).toBe(3)
    expect(beyond.rows.map((item) => item.id)).toEqual(page2.rows.map((item) => item.id))
    expect([first, second, third]).toContain(beyond.rows[0]?.id)
    // Sin ninguna fila en la pestaña la página 9 sigue vacía (no hay última página que servir).
    expect((await listWorkOrders(jefe, { tab: "cerrada", pageSize: 2, page: 9 })).rows).toEqual([])
  })

  it("la lista respeta el alcance: el administrador de contrato ve las de su faena, el mecánico las suyas y las por asignar", async () => {
    const bio = await newOt()
    const cho = await newOt({ vehicleId: IDS.truckCho })
    const filters = { tab: "abiertas" as const, page: 1, pageSize: 50 }
    const adminBio = await listWorkOrders(await viewerOf(IDS.adminBio), filters)
    expect(adminBio.rows.map((item) => item.id)).toEqual([bio])
    expect(adminBio.counts).toMatchObject({ abiertas: 1, solicitada: 1, cerrada: 0 })
    expect((await listWorkOrders(await viewerOf(IDS.jefe), filters)).rows.map((item) => item.id).sort()).toEqual([bio, cho].sort())
    // El mecánico no ve las «por asignar» (no las toma); sólo las que se le asignan, aunque sean de otra faena.
    expect((await listWorkOrders(await viewerOf(IDS.mecBio), filters)).total).toBe(0)
    expect(await loadWorkOrderDetail(await viewerOf(IDS.mecBio), bio)).toBeNull()
    ok(await transitions.assignWorkOrder(await actorOf(IDS.jefe), { workOrderId: cho, assignedToUserId: IDS.mecBio }))
    expect((await listWorkOrders(await viewerOf(IDS.mecBio), filters)).rows.map((item) => item.id)).toEqual([cho])
    expect((await loadWorkOrderDetail(await viewerOf(IDS.mecBio), cho))?.id).toBe(cho)
    expect((await listWorkOrders(await viewerOf(IDS.plain), filters)).total).toBe(0)
  })

  it("búsqueda del servidor, pestañas, período y paginación", async () => {
    const jefe = await viewerOf(IDS.jefe)
    const a = await newOt()
    await newOt({ vehicleId: IDS.machineBio, requesterName: "Pedro Pérez" })
    await newOt({ vehicleId: IDS.truckCho }, IDS.adminCho)
    const base = { tab: "abiertas" as const, page: 1, pageSize: 50 }
    expect((await listWorkOrders(jefe, { ...base, q: "ot-bio-0001" })).rows.map((item) => item.id)).toEqual([a])
    expect((await listWorkOrders(jefe, { ...base, q: "mq-01" })).total).toBe(1)
    expect((await listWorkOrders(jefe, { ...base, q: "pérez" })).total).toBe(1)
    expect((await listWorkOrders(jefe, { ...base, q: "%" })).total).toBe(0)
    expect((await listWorkOrders(jefe, { ...base, worksiteId: IDS.wsCho })).total).toBe(1)
    expect((await listWorkOrders(jefe, { ...base, from: addDaysToPlainDate(today, 1) })).total).toBe(0)
    const paged = await listWorkOrders(jefe, { ...base, pageSize: 2 })
    expect(paged).toMatchObject({ total: 3 })
    expect(paged.rows).toHaveLength(2)
    expect((await listWorkOrders(jefe, { ...base, pageSize: 2, page: 2 })).rows).toHaveLength(1)
    expect((await listWorkOrders(jefe, { ...base, tab: "anulada" })).total).toBe(0)
  })

  it("el detalle trae las transiciones permitidas de quien mira, los eventos con nombres y los registros enlazados; fuera de alcance, nada", async () => {
    const id = await finished()
    const jefe = await loadWorkOrderDetail(await viewerOf(IDS.jefe), id)
    expect(jefe).toMatchObject({
      folio: "OT-BIO-0001", status: "trabajo_terminado", unit: "km", requestedByName: "Alexis Morales", assignedToName: "Javier Roa",
      assignedByName: "Alexis Morales", worksiteName: "Biodiversa", equipmentCode: "KA-135",
    })
    expect(jefe?.allowedTransitions.sort()).toEqual(["receive", "reject_receipt"])
    expect(jefe?.entry).toMatchObject({ workshopKind: "interno", operatorName: "AEDO POLANCO JOSE A.", odometer: 12_000 })
    expect(jefe?.exit?.finishedByName).toBe("Javier Roa")
    expect(jefe?.items.map((item) => item.done)).toEqual(["si", "si", "si"])
    expect(jefe?.events.map((event) => event.type)).toEqual(expect.arrayContaining(["created", "assigned", "started", "items_marked", "record_linked", "finished"]))
    expect(jefe?.events.find((event) => event.type === "started")?.actorName).toBe("Javier Roa")
    expect(jefe?.linkedRecords).toEqual([expect.objectContaining({ kind: "C", status: "vigente", canOpen: true })])
    const mecanico = await loadWorkOrderDetail(await viewerOf(IDS.mecBio), id)
    expect(mecanico?.allowedTransitions).toEqual([])
    expect(mecanico?.linkedRecords[0]?.canOpen).toBe(true)
    // El administrador de contrato ve la OT de su faena pero no los registros del módulo.
    expect((await loadWorkOrderDetail(await viewerOf(IDS.adminBio), id))?.linkedRecords[0]?.canOpen).toBe(false)
    expect(await loadWorkOrderDetail(await viewerOf(IDS.adminCho), id)).toBeNull()
    expect(await loadWorkOrderDetail(await viewerOf(IDS.jefe), "no-existe")).toBeNull()
  })

  it("el detalle de una OT en taller marca qué puede editar quien la ejecuta; los mecánicos asignables son de todas las faenas", async () => {
    const id = await inWorkshop(IDS.mecCho)
    const detail = await loadWorkOrderDetail(await viewerOf(IDS.mecCho), id)
    expect(detail).toMatchObject({ canEditExecution: true, canEditRequest: false })
    expect(detail?.allowedTransitions).toEqual(["finish"])
    const mechanics = await listAssignableMechanics()
    expect(mechanics.map((mechanic) => mechanic.id)).toEqual(expect.arrayContaining([IDS.mecBio, IDS.mecBio2, IDS.mecCho, IDS.jefe, IDS.supBio]))
    expect(mechanics.map((mechanic) => mechanic.id)).not.toContain(IDS.inactive)
    expect(mechanics.find((mechanic) => mechanic.id === IDS.mecCho)?.worksiteNames).toEqual(["Cholguán"])
  })

  it("editar la solicitud: sólo mientras no está en taller; la jefatura o quien la creó; reemplaza los ítems pedidos", async () => {
    const id = await newOt({ assignedToUserId: IDS.mecBio }, IDS.adminBio)
    const admin = await actorOf(IDS.adminBio)
    const edit = (version: number, overrides: Record<string, unknown> = {}) => transitions.editWorkOrderRequest(admin, {
      workOrderId: id, expectedVersion: version, repair: true, maintenance: false, requestDate: today, requesterName: "Ana Contrato",
      repairDescription: "Fuga de aceite en la caja de cambios", observations: "Urgente", annexItems: ["Cambiar retén"], maintenanceItems: [], ...overrides,
    })
    ok(await edit(1))
    const items = await testDb.select().from(schema.mantWorkOrderItems).where(eq(schema.mantWorkOrderItems.workOrderId, id))
    expect(items.map((item) => item.description)).toEqual(["Cambiar retén"])
    expect(await row(id)).toMatchObject({ maintenance: false, observations: "Urgente", repairDescription: "Fuga de aceite en la caja de cambios", version: 2 })
    expect(refused(await edit(1)).code).toBe("conflict")
    expect(refused(await transitions.editWorkOrderRequest(await actorOf(IDS.adminCho), {
      workOrderId: id, expectedVersion: 2, repair: true, maintenance: false, requestDate: today, requesterName: "Otra Persona", repairDescription: "Algo que no corresponde",
      observations: null, annexItems: [], maintenanceItems: [],
    })).code).toBe("forbidden")
    ok(await transitions.assignWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, assignedToUserId: IDS.mecBio }))
    ok(await transitions.startWorkOrder(await actorOf(IDS.mecBio), { workOrderId: id, entry: entry() }))
    expect(refused(await edit(4)).code).toBe("conflict")
  })

  it("el Excel respeta el alcance, trae las tres hojas y deja una fila en la bitácora", async () => {
    await newOt()
    await newOt({ vehicleId: IDS.truckCho }, IDS.adminCho)
    const { rbac } = await contextOf(IDS.adminBio)
    const session = { user: { id: rbac.id, email: rbac.email, name: rbac.name, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal, roles: [] } }
    const outcome = await exportWorkOrders({ session: session as never, filters: { tab: "abiertas" } })
    if (!outcome.ok) throw new Error(outcome.message)
    expect(outcome.data.filename).toMatch(/^ordenes-de-trabajo-\d{4}-\d{2}-\d{2}\.xlsx$/)
    const ExcelJS = (await import("exceljs")).default
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(outcome.data.base64, "base64") as never)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(expect.arrayContaining(["Órdenes de trabajo", "Ítems", "Historial"]))
    expect(workbook.getWorksheet("Órdenes de trabajo")!.rowCount).toBe(2)
    const [audit] = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_work_orders_export"))
    expect(audit).toMatchObject({ action: "export", userId: IDS.adminBio })
    const empty = await exportWorkOrders({ session: session as never, filters: { tab: "cerrada" } })
    expect(empty.ok).toBe(false)
  })
})

describe("avisos y el rol administrador", () => {
  const ADMIN = "u-admin-plataforma"

  /** Un administrador de plataforma: rol global con los permisos de OT (el rol real los recibe todos). */
  async function withPlatformAdmin(run: () => Promise<void>) {
    const { SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS } = await import("@/lib/auth/system-rbac")
    const role = SYSTEM_ROLES.find((candidate) => candidate.name === "administrador")!
    await testDb.insert(schema.roles).values(role).onConflictDoNothing()
    const seeded = new Set((await testDb.select({ id: schema.permissions.id }).from(schema.permissions)).map((row) => row.id))
    const grants = SYSTEM_ROLE_PERMISSIONS.filter((grant) => grant.roleId === role.id && seeded.has(grant.permissionId))
    if (grants.length) await testDb.insert(schema.rolePermissions).values(grants).onConflictDoNothing()
    const now = new Date().toISOString()
    await testDb.insert(schema.users).values({ id: ADMIN, name: "Admin Plataforma", email: "admin.plataforma@test.cl", hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now })
    await testDb.insert(schema.userRoles).values({ userId: ADMIN, roleId: role.id })
    try {
      await run()
    } finally {
      await testDb.delete(schema.notifications).where(eq(schema.notifications.userId, ADMIN))
      await testDb.delete(schema.userRoles).where(eq(schema.userRoles.userId, ADMIN))
      await testDb.delete(schema.users).where(eq(schema.users.id, ADMIN))
    }
  }

  const plan = (overrides: Partial<Parameters<typeof sendWorkOrderNotification>[0]>) => ({
    event: "created" as const, workOrderId: "ot-x", folio: "OT-BIO-0099", worksiteId: IDS.wsBio, version: 1,
    actorUserId: IDS.adminBio, requestedByUserId: IDS.adminBio, assigneeUserId: null, equipment: "KA-135 · Camión", ...overrides,
  })

  it("no le llega el aviso al administrador cuando la faena tiene un responsable", async () => {
    await withPlatformAdmin(async () => {
      await sendWorkOrderNotification(plan({ event: "created" }))
      expect((await notificationsOf("mant_ot_created")).map((notice) => notice.userId)).toEqual([IDS.jefe])
      await sendWorkOrderNotification(plan({ event: "received", version: 6, actorUserId: IDS.jefe }))
      expect((await notificationsOf("mant_ot_received")).map((notice) => notice.userId)).toEqual([IDS.adminBio])
    })
  })

  it("si en la faena no queda otro responsable, el aviso llega al administrador para no perderse", async () => {
    await withPlatformAdmin(async () => {
      // Arauco no tiene administrador de contrato: nadie más da conformidad ahí.
      await sendWorkOrderNotification(plan({ event: "received", worksiteId: IDS.wsAra, version: 6, actorUserId: IDS.jefe }))
      expect((await notificationsOf("mant_ot_received")).map((notice) => notice.userId)).toEqual([ADMIN])
    })
  })
})

