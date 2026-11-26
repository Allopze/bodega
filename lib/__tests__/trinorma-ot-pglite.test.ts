import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, asc, eq } from "drizzle-orm"
import path from "node:path"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { syncRecordSchema, type WorkOrderEntryPayload } from "@/lib/mantencion/contracts"
import { createWorkOrderSchema, editWorkOrderSchema, finishWorkOrderSchema, reclassifyWorkOrderSchema } from "@/lib/mantencion/work-order-schemas"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { configureZodLocale } from "@/lib/validation/zod-locale"
import { IDS, insertOrphanPhoto, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * Trinorma R4 / C5 en la OT: tipo de acción (obligatorio sólo con el interruptor
 * `ops.mantencion.ot_action_type_required`), especialidades, faena de ejecución,
 * «Trabajo realizado» y «Horas hombre» al terminar, la OT que nace de un hallazgo
 * (correctiva), el detalle y el Excel. Postgres real (PGlite con todas las migraciones).
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

const { createWorkOrder, createWorkOrderWithClient } = await import("@/lib/services/mantencion/work-orders/create")
const transitions = await import("@/lib/services/mantencion/work-orders/transitions")
const { listWorkOrders, loadWorkOrderDetail } = await import("@/lib/services/mantencion/work-orders/query")
const { exportWorkOrders } = await import("@/lib/services/mantencion/work-orders/export")
const { createRecord } = await import("@/lib/services/mantencion/records-create")
const { getUserRbacById } = await import("@/lib/auth/rbac")
const { updateOperationalSettings } = await import("@/lib/services/system-settings")

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
    clientRequestId: crypto.randomUUID(), vehicleId: IDS.truckBio, repair: true, maintenance: false, requestDate: today,
    requesterName: "Ana Contrato", repairDescription: "Fuga de aceite en el motor", observations: null,
    annexItems: [], maintenanceItems: [], assignedToUserId: null, ...overrides,
  })
}
function ok<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!result.ok) throw new Error(`Se esperaba éxito: ${result.message}`)
  return result.value
}
function refused(result: { ok: boolean; message?: string; code?: string; field?: string }) {
  if (result.ok) throw new Error("Se esperaba un rechazo")
  return result as { ok: false; message: string; code?: string; field?: string }
}

const entry = (): WorkOrderEntryPayload => ({
  workshopKind: "interno", workshopId: null, workshopManagerName: "Don Pedro", operatorDriverId: IDS.driver1, operatorName: null,
  entryAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), odometer: 12_000, hourmeter: null,
  estimatedDeliveryDate: addDaysToPlainDate(today, 3),
})

let readingCounter = 0
async function linkedCorrective(userId: string, workOrderId: string, vehicleId: string = IDS.truckBio) {
  const photoId = crypto.randomUUID()
  await insertOrphanPhoto(testDb, { id: photoId, userId, kind: "correctiva" })
  readingCounter += 10
  const input = syncRecordSchema.parse({
    id: crypto.randomUUID(), vehicleId, reading: 12_000 + readingCounter, workDate: today, signedAt: new Date().toISOString(), offlineSince: null,
    deviceId: crypto.randomUUID(), appVersion: "test", readingJumpConfirmed: false, duplicateConfirmed: false, correctsRecordId: null,
    kind: "C", oilIds: [IDS.oilMotor], noOilChange: false, executor: { kind: "yo" },
    jobs: [{ workTypeId: IDS.wtMec, hours: 2, noParts: false, parts: [{ quantity: 1, description: "Manguera" }] }],
    description: "Cambio de manguera de aire", inWorkshop: false, workshopEntryDate: null, workshopReason: null, workOrder: null,
    driverIds: [IDS.driver1], photos: [{ id: photoId, kind: "correctiva" }], workOrderId,
  })
  const outcome = await createRecord(input, (await contextOf(userId)).sync)
  if (!outcome.body.ok) throw new Error(`Registro rechazado: ${outcome.body.message}`)
}

async function row(id: string) {
  const [ot] = await testDb.select().from(schema.mantWorkOrders).where(eq(schema.mantWorkOrders.id, id))
  if (!ot) throw new Error("OT inexistente")
  return ot
}
async function eventsOf(id: string) {
  return testDb.select().from(schema.mantWorkOrderEvents).where(eq(schema.mantWorkOrderEvents.workOrderId, id)).orderBy(asc(schema.mantWorkOrderEvents.createdAt))
}
/** La bitácora guarda el estado como texto JSON. */
const stateOf = (value: unknown): Record<string, unknown> => (typeof value === "string" ? JSON.parse(value) : (value ?? {})) as Record<string, unknown>

async function setSwitch(value: 0 | 1) {
  await updateOperationalSettings({ mantencionActionTypeRequired: value }, { userId: IDS.jefe }, testDb)
}

/** La jefatura crea y asigna; el mecánico ingresa, marca y deja el registro: queda lista para «terminar». */
async function readyToFinish(overrides: Record<string, unknown> = {}) {
  const id = ok(await createWorkOrder(await actorOf(IDS.jefe), createInput({ assignedToUserId: IDS.mecBio, ...overrides }))).id
  ok(await transitions.startWorkOrder(await actorOf(IDS.mecBio), { workOrderId: id, entry: entry() }))
  await linkedCorrective(IDS.mecBio, id)
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
    schema.fuelVehicleOperationalIntervals, schema.systemSettings,
  ]) await testDb.delete(table)
  await testDb.update(schema.fuelVehicles).set({ operationalStatus: "operativo" })
  readingCounter = 0
})

describe("tipo de acción y el interruptor", () => {
  it("apagado (por defecto): el tipo es opcional y la OT sin él nace sin clasificar", async () => {
    const created = ok(await createWorkOrder(await actorOf(IDS.jefe), createInput()))
    const ot = await row(created.id)
    expect(ot.actionType).toBeNull()
    expect(ot.specialties).toBeNull()
    expect(ot.executionWorksiteId).toBeNull()
  })

  it("encendido: sin tipo se rechaza en el servidor (campo actionType) y con tipo se guarda", async () => {
    await setSwitch(1)
    const actor = await actorOf(IDS.jefe)
    expect(refused(await createWorkOrder(actor, createInput()))).toMatchObject({ code: "invalid", field: "actionType" })
    expect(await testDb.select().from(schema.mantWorkOrders)).toHaveLength(0)
    expect(await testDb.select().from(schema.mantFolioCounters)).toHaveLength(0)

    const created = ok(await createWorkOrder(actor, createInput({ actionType: "predictiva", repair: false, maintenance: true, repairDescription: null })))
    expect((await row(created.id)).actionType).toBe("predictiva")
    // Apagarlo de nuevo deja de exigirlo.
    await setSwitch(0)
    ok(await createWorkOrder(actor, createInput()))
  })

  it("un tipo fuera de los tres no pasa el esquema ni el servicio", async () => {
    expect(createWorkOrderSchema.safeParse({ ...createInput(), actionType: "urgente" }).success).toBe(false)
    const actor = await actorOf(IDS.jefe)
    refused(await createWorkOrder(actor, { ...createInput(), actionType: "urgente" } as never))
  })

  it("especialidades en orden canónico, sin repetir; la faena de ejecución se valida y, si es la del equipo, no se guarda", async () => {
    const actor = await actorOf(IDS.jefe)
    const created = ok(await createWorkOrder(actor, createInput({
      actionType: "correctiva", specialties: ["soldadura", "mecanica", "mecanica"], executionWorksiteId: IDS.wsCho,
    })))
    const ot = await row(created.id)
    expect(ot).toMatchObject({ actionType: "correctiva", specialties: ["mecanica", "soldadura"], executionWorksiteId: IDS.wsCho, worksiteId: IDS.wsBio })

    const same = ok(await createWorkOrder(actor, createInput({ executionWorksiteId: IDS.wsBio })))
    expect((await row(same.id)).executionWorksiteId).toBeNull()
    expect(refused(await createWorkOrder(actor, createInput({ executionWorksiteId: "no-existe" }))).field).toBe("executionWorksiteId")
  })

  it("las casillas repair/maintenance siguen valiendo: sin ninguna, se rechaza aunque haya tipo", async () => {
    const actor = await actorOf(IDS.jefe)
    expect(refused(await createWorkOrder(actor, { ...createInput({ actionType: "preventiva" }), repair: false, maintenance: false })).field).toBe("repair")
  })

  it("el evento «created» y la bitácora registran los campos nuevos", async () => {
    const created = ok(await createWorkOrder(await actorOf(IDS.jefe), createInput({ actionType: "correctiva", specialties: ["electrica"], executionWorksiteId: IDS.wsAra })))
    const [event] = await eventsOf(created.id)
    expect(event!.changeSet).toMatchObject({ actionType: "correctiva", specialties: ["electrica"], executionWorksiteId: IDS.wsAra })
    const [audit] = await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, "mant_work_order"), eq(schema.auditLog.entityId, created.id)))
    expect(stateOf(audit!.newState)).toMatchObject({ actionType: "correctiva", specialties: ["electrica"], executionWorksiteId: IDS.wsAra })
  })

  it("editar la solicitud: lo no enviado se conserva, null lo borra, y una OT sin tipo no se bloquea con el interruptor encendido", async () => {
    const jefe = await actorOf(IDS.jefe)
    const created = ok(await createWorkOrder(jefe, createInput({ actionType: "correctiva", specialties: ["mecanica"] })))
    const base = { workOrderId: created.id, expectedVersion: 1, repair: true, maintenance: false, requestDate: today, requesterName: "Ana", repairDescription: "Fuga de aceite", observations: null, annexItems: [], maintenanceItems: [] }
    // Sin campos nuevos: se conserva todo.
    const kept = ok(await transitions.editWorkOrderRequest(jefe, editWorkOrderSchema.parse(base)))
    expect(await row(created.id)).toMatchObject({ actionType: "correctiva", specialties: ["mecanica"] })
    // Cambio explícito, con el evento «edited» llevando antes y después.
    ok(await transitions.editWorkOrderRequest(jefe, editWorkOrderSchema.parse({ ...base, expectedVersion: kept.version, actionType: "preventiva", specialties: [] })))
    expect(await row(created.id)).toMatchObject({ actionType: "preventiva", specialties: null })
    const edited = (await eventsOf(created.id)).filter((event) => event.type === "edited").at(-1)!
    expect(edited.changeSet).toMatchObject({ before: { actionType: "correctiva" }, after: { actionType: "preventiva" } })

    // OT anterior a la clasificación: editarla con el interruptor encendido no la bloquea; sí lo hace borrar un tipo que ya tenía.
    const legacy = ok(await createWorkOrder(jefe, createInput()))
    await setSwitch(1)
    const legacyBase = { ...base, workOrderId: legacy.id }
    ok(await transitions.editWorkOrderRequest(jefe, editWorkOrderSchema.parse(legacyBase)))
    expect(refused(await transitions.editWorkOrderRequest(jefe, editWorkOrderSchema.parse({ ...base, expectedVersion: 3, actionType: null }))).field).toBe("actionType")
  })
})

describe("término del trabajo: trabajo realizado y horas hombre", () => {
  it("guarda ambos al terminar, con el evento y la bitácora, y el detalle los muestra con los días en taller", async () => {
    const id = await readyToFinish({ actionType: "correctiva", specialties: ["mecanica"] })
    const mec = await actorOf(IDS.mecBio)
    const result = ok(await transitions.finishWorkOrder(mec, {
      workOrderId: id, exitAt: new Date(Date.now() - 60_000).toISOString(), note: null, workPerformed: "  Se cambió la manguera  ", laborHours: 5.5,
    }))
    expect(result.status).toBe("trabajo_terminado")
    expect(await row(id)).toMatchObject({ workPerformed: "Se cambió la manguera", laborHours: 5.5 })
    const finished = (await eventsOf(id)).find((event) => event.type === "finished")!
    expect(finished.changeSet).toMatchObject({ workPerformed: "Se cambió la manguera", laborHours: 5.5 })
    const audits = await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, "mant_work_order"), eq(schema.auditLog.entityId, id)))
    expect(audits.some((audit) => stateOf(audit.newState).laborHours === 5.5)).toBe(true)

    const detail = await loadWorkOrderDetail(await viewerOf(IDS.jefe), id)
    // Días en taller = días civiles de Chile entre ingreso (hace 2 h) y salida (hace 1 min): 0, salvo
    // que la corrida caiga entre las 00:00 y las 02:00 de Chile, cuando el ingreso fue el día anterior.
    const stored = await row(id)
    const chileDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date(iso))
    const expectedDays = chileDay(stored.workshopEntryAt!) === chileDay(stored.workshopExitAt!) ? 0 : 1
    expect(detail).toMatchObject({
      actionType: "correctiva", effectiveActionType: "correctiva", specialties: ["mecanica"], laborHours: 5.5,
      workPerformed: "Se cambió la manguera", daysStopped: expectedDays, executionWorksiteName: null,
    })
  })

  it("son opcionales: terminar sin ellos funciona y no pisa lo que ya había", async () => {
    const id = await readyToFinish()
    ok(await transitions.finishWorkOrder(await actorOf(IDS.mecBio), { workOrderId: id, exitAt: new Date(Date.now() - 60_000).toISOString(), note: null }))
    expect(await row(id)).toMatchObject({ workPerformed: null, laborHours: null, status: "trabajo_terminado" })
  })

  it("sin fecha de salida no hay término: se rechaza y la OT sigue «En taller»", async () => {
    const id = await readyToFinish()
    const mec = await actorOf(IDS.mecBio)
    expect(finishWorkOrderSchema.safeParse({ workOrderId: id, expectedVersion: 1, note: null, workPerformed: "x", laborHours: 1 }).success).toBe(false)
    expect(refused(await transitions.finishWorkOrder(mec, { workOrderId: id, exitAt: "", note: null, laborHours: 2 }))).toMatchObject({ code: "invalid", field: "exitAt" })
    expect(refused(await transitions.finishWorkOrder(mec, { workOrderId: id, exitAt: "no-es-fecha", note: null }))).toMatchObject({ field: "exitAt" })
    expect(await row(id)).toMatchObject({ status: "en_ejecucion", workshopExitAt: null, laborHours: null })
  })

  it("horas negativas o sobre 10.000 se rechazan, en el esquema y en el servicio, sin terminar la OT", async () => {
    const id = await readyToFinish()
    const mec = await actorOf(IDS.mecBio)
    const exitAt = new Date(Date.now() - 60_000).toISOString()
    for (const laborHours of [-1, 10_001]) {
      expect(finishWorkOrderSchema.safeParse({ workOrderId: id, expectedVersion: 1, exitAt, note: null, laborHours }).success).toBe(false)
      expect(refused(await transitions.finishWorkOrder(mec, { workOrderId: id, exitAt, note: null, laborHours }))).toMatchObject({ code: "invalid", field: "laborHours" })
    }
    expect((await row(id)).status).toBe("en_ejecucion")
    // El tope inclusive sí vale.
    ok(await transitions.finishWorkOrder(mec, { workOrderId: id, exitAt, note: null, laborHours: 10_000 }))
    expect((await row(id)).laborHours).toBe(10_000)
  })
})

describe("OT desde un hallazgo (C5)", () => {
  it("nace correctiva, con el tipo en el evento y la bitácora, y se puede cambiar después", async () => {
    const created = await testDb.transaction((tx) => createWorkOrderWithClient(tx as never, {
      vehicleId: IDS.truckBio, inspectionFindingId: null, repair: true, maintenance: false, repairDescription: "Neumático dañado en la inspección",
      observations: null, requesterName: "Inspector",
    }, { userId: IDS.jefe, name: "Alexis Morales" }))
    const ot = await row(created.id)
    expect(ot.actionType).toBe("correctiva")
    expect((await eventsOf(created.id))[0]!.changeSet).toMatchObject({ actionType: "correctiva" })
    // Aun con el interruptor encendido no se exige nada más: ya trae tipo.
    await setSwitch(1)
    const jefe = await actorOf(IDS.jefe)
    ok(await transitions.editWorkOrderRequest(jefe, editWorkOrderSchema.parse({
      workOrderId: created.id, expectedVersion: 1, repair: true, maintenance: true, requestDate: today, requesterName: "Inspector",
      repairDescription: "Neumático dañado", observations: null, annexItems: [], maintenanceItems: [], actionType: "preventiva",
    })))
    expect((await row(created.id)).actionType).toBe("preventiva")
  })
})

describe("alcance por faena y Excel", () => {
  it("la lista y el detalle respetan la faena aunque la OT se ejecute en otra; el Excel sale sólo con lo que se ve", async () => {
    const jefe = await actorOf(IDS.jefe)
    const bio = ok(await createWorkOrder(jefe, createInput({ vehicleId: IDS.truckBio, actionType: "correctiva", executionWorksiteId: IDS.wsCho })))
    const cho = ok(await createWorkOrder(jefe, createInput({ vehicleId: IDS.truckCho, actionType: "preventiva", repair: false, maintenance: true, repairDescription: null })))

    // El administrador de Cholguán no ve la OT de Biodiversa aunque se ejecute en Cholguán: manda la faena de imputación (la del equipo).
    const adminCho = await viewerOf(IDS.adminCho)
    expect(await loadWorkOrderDetail(adminCho, bio.id)).toBeNull()
    expect(await loadWorkOrderDetail(adminCho, cho.id)).not.toBeNull()
    const listed = await listWorkOrders(adminCho, { tab: "abiertas", page: 1, pageSize: 50 })
    expect(listed.rows.map((item) => item.id)).toEqual([cho.id])

    const detail = await loadWorkOrderDetail(await viewerOf(IDS.jefe), bio.id)
    expect(detail).toMatchObject({ worksiteId: IDS.wsBio, executionWorksiteId: IDS.wsCho, executionWorksiteName: "Cholguán" })

    const { rbac } = await contextOf(IDS.jefe)
    const session = { user: { id: rbac.id, email: rbac.email, name: rbac.name, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal }, expires: "2099-01-01" }
    const outcome = await exportWorkOrders({ session: session as never, filters: { tab: "abiertas" } })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const ExcelJS = (await import("exceljs")).default
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(outcome.data.base64, "base64") as never)
    const sheet = workbook.worksheets[0]!
    const headers = (sheet.getRow(1).values as unknown[]).slice(1).map(String)
    for (const header of ["Tipo de acción", "Especialidades", "Horas hombre", "Días en taller", "Faena de ejecución", "Trabajo realizado"]) expect(headers).toContain(header)
    const folioCol = headers.indexOf("Folio") + 1
    const rowFor = (folio: string) => {
      for (let r = 2; r <= sheet.rowCount; r++) if (sheet.getRow(r).getCell(folioCol).value === folio) return sheet.getRow(r)
      throw new Error(`Sin fila ${folio}`)
    }
    const bioRow = rowFor(detail!.folio)
    expect(bioRow.getCell(headers.indexOf("Tipo de acción") + 1).value).toBe("Correctiva")
    expect(bioRow.getCell(headers.indexOf("Faena de ejecución") + 1).value).toBe("Cholguán")
  })

  it("una OT sin tipo ni casillas claras (las dos marcadas) sale «No informado»", async () => {
    const jefe = await actorOf(IDS.jefe)
    const created = ok(await createWorkOrder(jefe, createInput({ repair: true, maintenance: true })))
    expect((await loadWorkOrderDetail(await viewerOf(IDS.jefe), created.id))).toMatchObject({ actionType: null, effectiveActionType: "sin_clasificar" })
    const solo = ok(await createWorkOrder(jefe, createInput({ repair: true, maintenance: false })))
    // Una OT anterior (sin tipo) con sólo «Reparación» se lee correctiva por las casillas.
    expect((await loadWorkOrderDetail(await viewerOf(IDS.jefe), solo.id))).toMatchObject({ actionType: null, effectiveActionType: "correctiva" })
  })
})

describe("corregir la clasificación (reclassifyWorkOrder)", () => {
  const REASON = "El taller de Cholguán hizo el trabajo"
  const reclassify = async (userId: string, workOrderId: string, expectedVersion: number, fields: Record<string, unknown>) =>
    transitions.reclassifyWorkOrder(await actorOf(userId), reclassifyWorkOrderSchema.parse({ workOrderId, expectedVersion, reason: REASON, ...fields }))

  it("corrige tipo, especialidades y faena de una OT en taller: evento «edited» con scope, antes y después; versión + 1; bitácora", async () => {
    const id = await readyToFinish({ actionType: "correctiva", specialties: ["mecanica"] })
    const before = await row(id)
    const result = ok(await reclassify(IDS.jefe, id, before.version, { actionType: "preventiva", specialties: ["soldadura", "mecanica"], executionWorksiteId: IDS.wsCho }))
    expect(result).toMatchObject({ status: "en_ejecucion", version: before.version + 1 })
    expect(await row(id)).toMatchObject({ actionType: "preventiva", specialties: ["mecanica", "soldadura"], executionWorksiteId: IDS.wsCho, status: "en_ejecucion" })

    const event = (await eventsOf(id)).filter((item) => item.type === "edited").at(-1)!
    expect(event.reason).toBe(REASON)
    expect(event.changeSet).toMatchObject({
      scope: "clasificacion", reason: REASON,
      before: { actionType: "correctiva", specialties: ["mecanica"], executionWorksiteId: null, executionWorksiteName: null },
      after: { actionType: "preventiva", specialties: ["mecanica", "soldadura"], executionWorksiteId: IDS.wsCho, executionWorksiteName: "Cholguán" },
    })
    const audits = await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, "mant_work_order"), eq(schema.auditLog.entityId, id)))
    const audit = audits.find((item) => (stateOf(item.newState).events as string[] | undefined)?.includes("edited") && stateOf(item.newState).actionType === "preventiva")
    expect(audit).toBeTruthy()
    expect(stateOf(audit!.oldState)).toMatchObject({ actionType: "correctiva" })
    // El detalle lo refleja y ya no ofrece «Editar orden» pero sí «Corregir tipo de acción».
    expect(await loadWorkOrderDetail(await viewerOf(IDS.jefe), id)).toMatchObject({ actionType: "preventiva", executionWorksiteName: "Cholguán", canEditRequest: false, canReclassify: true })

    // El Excel rotula los eventos con la misma tabla que la ficha (OT4-9): la corrección se lee «Tipo de acción corregido».
    const { rbac } = await contextOf(IDS.jefe)
    const session = { user: { id: rbac.id, email: rbac.email, name: rbac.name, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal }, expires: "2099-01-01" }
    const outcome = await exportWorkOrders({ session: session as never, filters: { tab: "abiertas" } })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const ExcelJS = (await import("exceljs")).default
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(outcome.data.base64, "base64") as never)
    const history = workbook.getWorksheet("Historial")!
    const headers = (history.getRow(1).values as unknown[]).slice(1).map(String)
    const folioCol = headers.indexOf("Folio") + 1
    const eventCol = headers.indexOf("Evento") + 1
    const folio = (await row(id)).folio
    const labels: string[] = []
    for (let r = 2; r <= history.rowCount; r++) if (history.getRow(r).getCell(folioCol).value === folio) labels.push(String(history.getRow(r).getCell(eventCol).value))
    expect(labels).toContain("Orden solicitada")
    expect(labels).toContain("Tipo de acción corregido")
    expect(labels).not.toContain("Solicitud editada")
    expect(labels).not.toContain("Creada")
  })

  it("sólo con mant:ot:manage: el mecánico y el administrador de contrato no pueden", async () => {
    const id = await readyToFinish({ actionType: "correctiva" })
    const version = (await row(id)).version
    for (const userId of [IDS.mecBio, IDS.adminBio, IDS.supBio]) {
      expect(refused(await reclassify(userId, id, version, { actionType: "preventiva" })).code).toBe("forbidden")
    }
    expect((await row(id)).actionType).toBe("correctiva")
    expect(await loadWorkOrderDetail(await viewerOf(IDS.mecBio), id)).toMatchObject({ canReclassify: false })
  })

  it("una OT anulada no se corrige; «Por asignar» y «Asignada» van por «Editar orden» (canReclassify queda en false)", async () => {
    const jefe = await actorOf(IDS.jefe)
    const created = ok(await createWorkOrder(jefe, createInput({ actionType: "correctiva" })))
    expect(await loadWorkOrderDetail(await viewerOf(IDS.jefe), created.id)).toMatchObject({ canEditRequest: true, canReclassify: false })
    const voided = ok(await transitions.voidWorkOrder(jefe, { workOrderId: created.id, expectedVersion: created.version, reason: "Equipo equivocado en la orden" }))
    const result = refused(await reclassify(IDS.jefe, created.id, voided.version, { actionType: "preventiva" }))
    expect(result.code).toBe("conflict")
    expect(result.message).toContain("Anulada")
    expect((await row(created.id)).actionType).toBe("correctiva")
    expect(await loadWorkOrderDetail(await viewerOf(IDS.jefe), created.id)).toMatchObject({ canReclassify: false })
  })

  it("el motivo es obligatorio (esquema y servicio) y un conflicto de versión no pisa nada", async () => {
    const id = await readyToFinish({ actionType: "correctiva" })
    const version = (await row(id)).version
    expect(reclassifyWorkOrderSchema.safeParse({ workOrderId: id, expectedVersion: version, actionType: "preventiva", reason: "corto" }).success).toBe(false)
    const direct = await transitions.reclassifyWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, expectedVersion: version, actionType: "preventiva", reason: "  " })
    expect(refused(direct)).toMatchObject({ code: "invalid", field: "reason" })
    expect(refused(await reclassify(IDS.jefe, id, version + 7, { actionType: "preventiva" }))).toMatchObject({ code: "conflict" })
    expect(refused(await reclassify(IDS.jefe, id, version, { actionType: "correctiva" })).message).toContain("No cambiaste nada")
    expect((await row(id)).actionType).toBe("correctiva")
    expect((await eventsOf(id)).filter((item) => item.type === "edited")).toHaveLength(0)
  })

  it("valida como el alta: tipo, especialidad y faena de ejecución inexistentes se rechazan; con el interruptor encendido no se puede borrar el tipo", async () => {
    const id = await readyToFinish({ actionType: "correctiva" })
    const version = (await row(id)).version
    expect(refused(await reclassify(IDS.jefe, id, version, { executionWorksiteId: "no-existe" })).field).toBe("executionWorksiteId")
    expect(refused(await transitions.reclassifyWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, expectedVersion: version, actionType: "urgente" as never, reason: REASON })).field).toBe("actionType")
    expect(reclassifyWorkOrderSchema.safeParse({ workOrderId: id, expectedVersion: version, specialties: ["carpinteria"], reason: REASON }).success).toBe(false)
    await setSwitch(1)
    expect(refused(await reclassify(IDS.jefe, id, version, { actionType: null })).field).toBe("actionType")
    // Lo no enviado se conserva.
    ok(await reclassify(IDS.jefe, id, version, { specialties: ["electrica"] }))
    expect(await row(id)).toMatchObject({ actionType: "correctiva", specialties: ["electrica"] })
  })

  it("las horas hombre sólo se corrigen si la OT ya pasó por la salida de taller, con los mismos topes de «Registrar salida»", async () => {
    const id = await readyToFinish({ actionType: "correctiva" })
    const jefe = await actorOf(IDS.jefe)
    const first = (await row(id)).version
    // Aún en taller: no hay horas que corregir.
    expect(refused(await reclassify(IDS.jefe, id, first, { laborHours: 3 })).field).toBe("laborHours")
    const finished = ok(await transitions.finishWorkOrder(await actorOf(IDS.mecBio), { workOrderId: id, exitAt: new Date(Date.now() - 60_000).toISOString(), note: null, laborHours: 8, workPerformed: "Cambio de manguera" }))
    expect(refused(await transitions.reclassifyWorkOrder(jefe, { workOrderId: id, expectedVersion: finished.version, laborHours: -1, reason: REASON })).field).toBe("laborHours")
    expect(reclassifyWorkOrderSchema.safeParse({ workOrderId: id, expectedVersion: finished.version, laborHours: -1, reason: REASON }).success).toBe(false)
    expect(reclassifyWorkOrderSchema.safeParse({ workOrderId: id, expectedVersion: finished.version, laborHours: 10_001, reason: REASON }).success).toBe(false)
    expect(refused(await transitions.reclassifyWorkOrder(jefe, { workOrderId: id, expectedVersion: finished.version, laborHours: 10_001, reason: REASON })).field).toBe("laborHours")

    const fixed = ok(await reclassify(IDS.jefe, id, finished.version, { laborHours: 2.5 }))
    expect(fixed.status).toBe("trabajo_terminado")
    expect(await row(id)).toMatchObject({ laborHours: 2.5, workPerformed: "Cambio de manguera" })
    const event = (await eventsOf(id)).filter((item) => item.type === "edited").at(-1)!
    expect(event.changeSet).toMatchObject({ scope: "clasificacion", before: { laborHours: 8 }, after: { laborHours: 2.5 } })
    expect((event.changeSet as { after: Record<string, unknown> }).after).not.toHaveProperty("actionType")
  })

  it("no cambia lo demás de la OT: estado, mecánico y ítems siguen igual", async () => {
    const id = await readyToFinish({ actionType: "correctiva", annexItems: ["Cambiar pastillas"] })
    const before = await row(id)
    ok(await reclassify(IDS.jefe, id, before.version, { specialties: ["hidraulica"] }))
    const after = await row(id)
    expect(after).toMatchObject({ status: before.status, assignedToUserId: before.assignedToUserId, repairDescription: before.repairDescription, estimatedDeliveryDate: before.estimatedDeliveryDate })
    const items = await testDb.select().from(schema.mantWorkOrderItems).where(eq(schema.mantWorkOrderItems.workOrderId, id))
    expect(items.map((item) => item.description)).toEqual(["Cambiar pastillas"])
  })
})

describe("ítems de un tipo de trabajo desmarcado (OT-5)", () => {
  const itemsOf = async (id: string) => (await testDb.select().from(schema.mantWorkOrderItems).where(eq(schema.mantWorkOrderItems.workOrderId, id)))
    .map((item) => `${item.kind}:${item.description}`).sort()

  it("el esquema descarta los ítems del tipo desmarcado antes de validar: un ítem corto oculto no da error", () => {
    const parsed = createWorkOrderSchema.parse({
      clientRequestId: crypto.randomUUID(), vehicleId: IDS.truckBio, repair: true, maintenance: false, requestDate: today, requesterName: "Ana Contrato",
      repairDescription: "Fuga de aceite", observations: null, annexItems: ["Cambiar pastillas"], maintenanceItems: ["ab"], assignedToUserId: null,
    })
    expect(parsed.maintenanceItems).toEqual([])
    expect(parsed.annexItems).toEqual(["Cambiar pastillas"])
    const edit = editWorkOrderSchema.parse({
      workOrderId: "ot-1", expectedVersion: 1, repair: false, maintenance: true, requestDate: today, requesterName: "Ana", repairDescription: null,
      observations: null, annexItems: ["Quitar esto"], maintenanceItems: ["Cambio de aceite"],
    })
    expect(edit.annexItems).toEqual([])
    expect(edit.maintenanceItems).toEqual(["Cambio de aceite"])
  })

  it("al crear, los ítems del tipo desmarcado no se guardan", async () => {
    const created = ok(await createWorkOrder(await actorOf(IDS.jefe), createInput({ repair: true, maintenance: false, annexItems: ["Cambiar pastillas"], maintenanceItems: ["Cambio de aceite"] })))
    expect(await itemsOf(created.id)).toEqual(["anexo:Cambiar pastillas"])
  })

  it("al editar la solicitud, los ítems del tipo desmarcado se borran y no se guardan, aunque lleguen por el servicio", async () => {
    const jefe = await actorOf(IDS.jefe)
    const created = ok(await createWorkOrder(jefe, createInput({ repair: true, maintenance: true, annexItems: ["Cambiar pastillas"], maintenanceItems: ["Cambio de aceite"] })))
    expect(await itemsOf(created.id)).toEqual(["anexo:Cambiar pastillas", "mantencion:Cambio de aceite"])
    const base = { workOrderId: created.id, expectedVersion: created.version, repair: true, maintenance: false, requestDate: today, requesterName: "Ana", repairDescription: "Fuga de aceite", observations: null }
    // Por el esquema (la vía de la acción web).
    const edited = ok(await transitions.editWorkOrderRequest(jefe, editWorkOrderSchema.parse({ ...base, annexItems: ["Cambiar pastillas"], maintenanceItems: ["Cambio de aceite"] })))
    expect(await itemsOf(created.id)).toEqual(["anexo:Cambiar pastillas"])
    // Directo al servicio, sin pasar por el esquema: el servicio también las descarta (y un ítem corto oculto no bloquea).
    ok(await transitions.editWorkOrderRequest(jefe, { ...base, expectedVersion: edited.version, repair: false, maintenance: true, repairDescription: null, annexItems: ["ab"], maintenanceItems: ["Cambio de aceite"] }))
    expect(await itemsOf(created.id)).toEqual(["mantencion:Cambio de aceite"])
  })
})

describe("filtro por día de cierre (cerradaDesde / cerradaHasta)", () => {
  /** Lleva una OT hasta «cerrada» por el camino real y fija su `closed_at`. */
  async function closedAt(isoInstant: string) {
    const id = await readyToFinish({ actionType: "correctiva" })
    ok(await transitions.finishWorkOrder(await actorOf(IDS.mecBio), { workOrderId: id, exitAt: new Date(Date.now() - 60_000).toISOString(), note: null }))
    ok(await transitions.receiveWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, receivedAt: new Date().toISOString(), receiverName: "Pedro Retira" }))
    ok(await transitions.conformWorkOrder(await actorOf(IDS.adminBio), { workOrderId: id, faenaReceivedAt: new Date().toISOString(), faenaReceiverName: "Ana Faena" }))
    await testDb.update(schema.mantWorkOrders).set({ closedAt: isoInstant }).where(eq(schema.mantWorkOrders.id, id))
    return id
  }
  const listClosed = async (filters: { closedFrom?: string; closedTo?: string }) => {
    const result = await listWorkOrders(await viewerOf(IDS.jefe), { tab: "cerrada", ...filters, page: 1, pageSize: 50 })
    return { ids: result.rows.map((item) => item.id), counts: result.counts }
  }

  it("compara el día de Chile, inclusivo: un cierre a las 23:30 de Chile (otro día en UTC) cae en el día de Chile", async () => {
    // 2026-11-13 23:30 en Chile (UTC-3 en noviembre) = 2026-11-14 02:30 UTC.
    const late = await closedAt("2026-11-14T02:30:00.000Z")
    // 2026-11-14 00:30 en Chile = 2026-11-14 03:30 UTC.
    const next = await closedAt("2026-11-14T03:30:00.000Z")
    const old = await closedAt("2026-10-02T15:00:00.000Z")

    expect((await listClosed({ closedFrom: "2026-11-13", closedTo: "2026-11-13" })).ids).toEqual([late])
    expect((await listClosed({ closedFrom: "2026-11-14", closedTo: "2026-11-14" })).ids).toEqual([next])
    expect((await listClosed({ closedFrom: "2026-11-13", closedTo: "2026-11-14" })).ids.sort()).toEqual([late, next].sort())
    expect((await listClosed({ closedFrom: "2026-11-14" })).ids).toEqual([next])
    expect((await listClosed({ closedTo: "2026-11-13" })).ids.sort()).toEqual([late, old].sort())
    expect((await listClosed({})).ids).toHaveLength(3)

    // Los conteos de las pestañas usan el mismo filtro.
    expect((await listClosed({ closedFrom: "2026-11-13", closedTo: "2026-11-13" })).counts.cerrada).toBe(1)
    expect((await listClosed({ closedFrom: "2026-12-01" })).counts.cerrada).toBe(0)
  })

  it("el Excel respeta el mismo filtro", async () => {
    const late = await closedAt("2026-11-14T02:30:00.000Z")
    await closedAt("2026-10-02T15:00:00.000Z")
    const { rbac } = await contextOf(IDS.jefe)
    const session = { user: { id: rbac.id, email: rbac.email, name: rbac.name, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal }, expires: "2099-01-01" }
    const outcome = await exportWorkOrders({ session: session as never, filters: { tab: "cerrada", closedFrom: "2026-11-13", closedTo: "2026-11-13" } })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const ExcelJS = (await import("exceljs")).default
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(outcome.data.base64, "base64") as never)
    const sheet = workbook.worksheets[0]!
    const headers = (sheet.getRow(1).values as unknown[]).slice(1).map(String)
    const folioCol = headers.indexOf("Folio") + 1
    const folios: string[] = []
    for (let r = 2; r <= sheet.rowCount; r++) { const value = sheet.getRow(r).getCell(folioCol).value; if (value) folios.push(String(value)) }
    const lateFolio = (await row(late)).folio
    expect(folios).toEqual([lateFolio])
  })
})
