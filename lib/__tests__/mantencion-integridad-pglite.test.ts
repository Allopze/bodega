import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { MANT_WEB_DEVICE_ID, syncRecordSchema, workOrderOpRequestSchema, type WorkOrderEntryPayload } from "@/lib/mantencion/contracts"
import { createWorkOrderSchema } from "@/lib/mantencion/work-order-schemas"
import { createMantencionFilePath } from "@/lib/storage/config"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { configureZodLocale } from "@/lib/validation/zod-locale"
import { IDS, insertOrphanPhoto, seedMantFixtures } from "./mantencion-sync-fixtures"
import { correctiveBody, makeJpeg, metaFor } from "./mantencion-sync-http-helpers"

/**
 * Integridad del módulo de mantención (auditoría 2026-11-04, carril B):
 *
 * - 3.2: una OT que ya salió de taller no deja anular el registro que la respalda.
 * - 3.3: `client_op_id` atado a la OT y a la acción, e ítems sin marcas nuevas que
 *   dejan el evento que reconoce el reenvío.
 * - 3.4: fotos huérfanas del registro web: la compensación no deja fila ni archivo.
 * - 3.7: el PDF de la revisión 1 se borra al anular el registro.
 *
 * Postgres real (PGlite con todas las migraciones) y almacenamiento en un
 * directorio temporal propio.
 */

const storageRoot = mkdtempSync(path.join(tmpdir(), "mant-integridad-"))
process.env.STORAGE_PATH = storageRoot

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

const { voidRecord } = await import("@/lib/services/mantencion/record-lifecycle")
const { applyWorkOrderOp } = await import("@/lib/services/mantencion/work-orders/sync-ops")
const transitions = await import("@/lib/services/mantencion/work-orders/transitions")
const { createWorkOrder } = await import("@/lib/services/mantencion/work-orders/create")
const { createRecord } = await import("@/lib/services/mantencion/records-create")
const { registerWorkOrderRecordFromWeb } = await import("@/lib/services/mantencion/web-record")
const { pdfRevision, pdfStorageName } = await import("@/lib/services/mantencion/record-pdf")
const { getUserRbacById } = await import("@/lib/auth/rbac")

const today = todayInChile()
const storageDir = path.join(storageRoot, "mantencion")

async function rbacOf(userId: string) {
  const rbac = await getUserRbacById(userId, true)
  if (!rbac) throw new Error(`Sin RBAC para ${userId}`)
  return rbac
}
async function viewerOf(userId: string) {
  const rbac = await rbacOf(userId)
  return { userId: rbac.id, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal }
}
async function actorOf(userId: string) {
  const rbac = await rbacOf(userId)
  return { userId: rbac.id, name: rbac.name, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal }
}
/** El mismo contexto que arma la sincronización del teléfono; la web sólo cambia el dispositivo. */
async function syncOf(userId: string, deviceId = "dev-test") {
  const rbac = await rbacOf(userId)
  return {
    userName: rbac.name,
    deviceId,
    credentialId: "cred-test",
    viewer: { userId: rbac.id, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal },
  }
}

function ok<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!result.ok) throw new Error(`Se esperaba éxito: ${result.message}`)
  return result.value
}

const entry = (overrides: Partial<WorkOrderEntryPayload> = {}): WorkOrderEntryPayload => ({
  workshopKind: "interno", workshopId: null, workshopManagerName: null, operatorDriverId: null, operatorName: null,
  entryAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), odometer: 12_000, hourmeter: null,
  estimatedDeliveryDate: addDaysToPlainDate(today, 3), ...overrides,
})

/** OT de la jefatura («por asignar»), asignada al mecánico indicado. */
async function assigned(mechanic: string = IDS.mecBio, overrides: Record<string, unknown> = {}): Promise<string> {
  const id = ok(await createWorkOrder(await actorOf(IDS.jefe), createWorkOrderSchema.parse({
    clientRequestId: crypto.randomUUID(), vehicleId: IDS.truckBio, repair: true, maintenance: false, requestDate: today,
    requesterName: "Ana Contrato", repairDescription: "Fuga de aceite en el motor", observations: null,
    annexItems: ["Cambiar manguera de aire"], maintenanceItems: [], assignedToUserId: null, ...overrides,
  }))).id
  ok(await transitions.assignWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, assignedToUserId: mechanic }))
  return id
}
async function inWorkshop(mechanic: string = IDS.mecBio, overrides: Record<string, unknown> = {}): Promise<string> {
  const id = await assigned(mechanic, overrides)
  ok(await transitions.startWorkOrder(await actorOf(mechanic), { workOrderId: id, entry: entry() }))
  return id
}
async function row(id: string) {
  const [ot] = await testDb.select().from(schema.mantWorkOrders).where(eq(schema.mantWorkOrders.id, id))
  if (!ot) throw new Error("OT inexistente")
  return ot
}
async function eventsOf(id: string) {
  return testDb.select().from(schema.mantWorkOrderEvents).where(eq(schema.mantWorkOrderEvents.workOrderId, id))
}
async function markAll(id: string, mechanic: string = IDS.mecBio) {
  const items = await testDb.select().from(schema.mantWorkOrderItems).where(eq(schema.mantWorkOrderItems.workOrderId, id))
  if (items.length === 0) return
  ok(await transitions.markWorkOrderItems(await actorOf(mechanic), {
    workOrderId: id, marks: items.map((item) => ({ itemId: item.id, done: "si" as const, note: null })), added: [],
  }))
}

let readingCounter = 0
/** Una correctiva firmada desde el teléfono, enlazada a la OT (o suelta) y con su foto ya subida. */
async function corrective(mechanic: string, workOrderId: string | null, vehicleId: string = IDS.truckBio) {
  const photoId = crypto.randomUUID()
  await insertOrphanPhoto(testDb, { id: photoId, userId: mechanic, kind: "correctiva" })
  readingCounter += 10
  const input = syncRecordSchema.parse({
    id: crypto.randomUUID(), vehicleId, reading: 12_000 + readingCounter, workDate: today, signedAt: new Date().toISOString(),
    offlineSince: null, deviceId: crypto.randomUUID(), appVersion: "test", readingJumpConfirmed: false, duplicateConfirmed: false,
    correctsRecordId: null, kind: "C", oilIds: [IDS.oilMotor], noOilChange: false, executor: { kind: "yo" },
    jobs: [{ workTypeId: IDS.wtMec, hours: 2, noParts: false, parts: [{ quantity: 1, description: "Manguera" }] }],
    description: "Cambio de manguera de aire", inWorkshop: false, workshopEntryDate: null, workshopReason: null, workOrder: null,
    driverIds: [IDS.driver1], photos: [{ id: photoId, kind: "correctiva" }], workOrderId,
  })
  const outcome = await createRecord(input, await syncOf(mechanic))
  if (!outcome.body.ok) throw new Error(`Registro rechazado: ${outcome.body.message}`)
  const [saved] = await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, input.id))
  if (!saved) throw new Error("Registro no guardado")
  return saved
}

const op = (payload: Record<string, unknown>) => workOrderOpRequestSchema.parse(payload)
const base = (workOrderId: string) => ({ workOrderId, createdAt: new Date().toISOString(), deviceId: crypto.randomUUID() })
async function send(userId: string, payload: Record<string, unknown>) {
  return applyWorkOrderOp(op(payload), await syncOf(userId))
}

const voidsOf = (recordId: string) =>
  testDb.select().from(schema.mantRecordVoids).where(eq(schema.mantRecordVoids.recordId, recordId))
const auditOf = (recordId: string) =>
  testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, "mant_record"), eq(schema.auditLog.entityId, recordId), eq(schema.auditLog.action, "cancel")))

beforeAll(async () => {
  configureZodLocale()
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedMantFixtures(testDb)
})

afterAll(() => rmSync(storageRoot, { recursive: true, force: true }))

beforeEach(async () => {
  for (const table of [
    schema.mantWorkOrderEvents, schema.mantWorkOrderItems, schema.mantRecordObservations, schema.mantRecordVoids, schema.mantWorkshopUpdates,
    schema.mantRecordPhotos, schema.mantRecords, schema.mantWorkOrders, schema.mantFolioCounters, schema.notifications, schema.auditLog,
    schema.fuelVehicleOperationalIntervals,
  ]) await testDb.delete(table)
  await testDb.update(schema.fuelVehicles).set({ operationalStatus: "operativo" })
  rmSync(storageDir, { recursive: true, force: true })
  readingCounter = 0
})

describe("3.2 · anular el registro que respalda una OT que ya salió de taller", () => {
  it("la OT terminada y la cerrada bloquean la anulación; tras reabrirla sí se anula", async () => {
    const workOrderId = await inWorkshop()
    await markAll(workOrderId)
    const record = await corrective(IDS.mecBio, workOrderId)
    const exitAt = new Date(Date.now() - 60_000).toISOString()
    ok(await transitions.finishWorkOrder(await actorOf(IDS.mecBio), { workOrderId, exitAt, note: null }))
    const otFolio = (await row(workOrderId)).folio
    const expected = `La OT ${otFolio} ya salió de taller: reábrela antes de anular ${record.folio}.`
    const viewer = await viewerOf(IDS.jefe)
    const reason = "Se registró en el equipo equivocado"

    // «Trabajo terminado»: el trabajo ya se firmó y salió de taller.
    expect(await voidRecord({ recordId: record.id, reason, viewer })).toEqual({ ok: false, message: expected })
    expect(await voidsOf(record.id)).toHaveLength(0)
    expect((await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, record.id)))[0]?.status).toBe("vigente")
    // Ni anulación, ni bitácora, ni evento en la OT.
    expect(await auditOf(record.id)).toHaveLength(0)
    expect((await eventsOf(workOrderId)).filter((event) => event.type === "voided")).toHaveLength(0)

    ok(await transitions.receiveWorkOrder(await actorOf(IDS.jefe), { workOrderId, receivedAt: new Date().toISOString(), receiverName: "Pedro Retira" }))
    ok(await transitions.conformWorkOrder(await actorOf(IDS.adminBio), { workOrderId, faenaReceivedAt: new Date().toISOString(), faenaReceiverName: "Ana Faena" }))
    expect((await row(workOrderId)).status).toBe("cerrada")
    // «Cerrada»: la conformidad y la CAPA quedarían acreditando algo que ya no existe.
    expect(await voidRecord({ recordId: record.id, reason, viewer })).toEqual({ ok: false, message: expected })
    expect(await voidsOf(record.id)).toHaveLength(0)

    // La salida es reabrir la OT (jefatura): vuelve a taller y la anulación ya procede.
    ok(await transitions.reopenWorkOrder(await actorOf(IDS.jefe), { workOrderId, reason: "La falla reapareció en terreno" }))
    expect((await voidRecord({ recordId: record.id, reason, viewer })).ok).toBe(true)
    expect(await voidsOf(record.id)).toHaveLength(1)
  })

  it("una OT en ejecución no bloquea la anulación (el comportamiento no cambió)", async () => {
    const workOrderId = await inWorkshop()
    const record = await corrective(IDS.mecBio, workOrderId)
    expect((await voidRecord({ recordId: record.id, reason: "Se registró en el equipo equivocado", viewer: await viewerOf(IDS.jefe) })).ok).toBe(true)
    expect(await voidsOf(record.id)).toHaveLength(1)
  })
})

describe("3.3 · client_op_id atado a la OT y a la acción", () => {
  it("la misma operación dos veces en la misma OT deja un evento; el mismo id en otra OT es 409 y no toca la segunda", async () => {
    const first = await assigned(IDS.mecBio)
    const second = await assigned(IDS.mecBio2)
    const payload = { ...base(first), id: crypto.randomUUID(), action: "start", entry: entry() }

    const once = await send(IDS.mecBio, payload)
    expect(once.status).toBe(200)
    expect(once.body).toMatchObject({ ok: true, duplicate: false, workOrderId: first, status: "en_ejecucion" })
    const twice = await send(IDS.mecBio, payload)
    expect(twice.status).toBe(200)
    expect(twice.body).toMatchObject({ ok: true, duplicate: true, workOrderId: first })
    expect((await eventsOf(first)).filter((event) => event.clientOpId === payload.id)).toHaveLength(1)

    // El mismo id aplicado en otra OT: 409, y la segunda sigue «asignada» sin evento ni versión nueva.
    const before = await row(second)
    const foreign = await send(IDS.mecBio, { ...payload, workOrderId: second })
    expect(foreign.status).toBe(409)
    expect(foreign.body).toEqual({ ok: false, code: "rejected", message: "Ese identificador ya se usó en otra orden." })
    expect(await row(second)).toMatchObject({ status: "asignada", version: before.version })
    expect((await eventsOf(second)).filter((event) => event.clientOpId === payload.id)).toHaveLength(0)

    // El mismo id con otra acción en la misma OT tampoco es un reenvío: 409 y sin evento nuevo.
    const wrongAction = await send(IDS.mecBio, {
      ...base(first), id: payload.id, action: "estimate", estimatedDeliveryDate: addDaysToPlainDate(today, 5), reason: "Repuesto",
    })
    expect(wrongAction.status).toBe(409)
    expect(wrongAction.body).toEqual({ ok: false, code: "rejected", message: "Ese identificador ya se usó en otra orden." })
    expect((await eventsOf(first)).filter((event) => event.type === "estimate_changed")).toHaveLength(0)
  })

  it("ítems sin marcas nuevas: deja el evento que reconoce la operación y el reenvío es duplicado", async () => {
    const workOrderId = await inWorkshop()
    const addedId = crypto.randomUUID()
    const added = [{ id: addedId, kind: "anexo" as const, description: "Cambiar abrazaderas" }]
    // Primera operación: agrega el ítem del taller (evento `item_added` con su client_op_id).
    expect((await send(IDS.mecBio, { ...base(workOrderId), id: crypto.randomUUID(), action: "items", marks: [], added })).status).toBe(200)

    // Segunda operación, id nuevo, que sólo reenvía un ítem que ya existía: no hay nada que
    // escribir, pero antes no dejaba evento y el teléfono la reenviaba para siempre.
    const noop = { ...base(workOrderId), id: crypto.randomUUID(), action: "items", marks: [], added }
    const empty = await send(IDS.mecBio, noop)
    expect(empty.status).toBe(200)
    expect(empty.body).toMatchObject({ ok: true, duplicate: false })
    const written = (await eventsOf(workOrderId)).filter((event) => event.clientOpId === noop.id)
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ type: "items_marked", changeSet: { marks: [], added: [] } })

    const again = await send(IDS.mecBio, noop)
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ ok: true, duplicate: true, workOrderId })
    expect((await eventsOf(workOrderId)).filter((event) => event.clientOpId === noop.id)).toHaveLength(1)
    // El ítem se agregó una sola vez.
    const items = await testDb.select().from(schema.mantWorkOrderItems).where(eq(schema.mantWorkOrderItems.workOrderId, workOrderId))
    expect(items.filter((item) => item.id === addedId)).toHaveLength(1)
  })
})

describe("3.4 · fotos huérfanas del registro web", () => {
  it("si la segunda foto falla, no queda ni la fila ni el archivo de la primera", async () => {
    const workOrderId = await inWorkshop()
    const first = crypto.randomUUID()
    const second = crypto.randomUUID()
    const firstBytes = await makeJpeg(32, 24, "#1e6e3e")
    const secondBytes = await makeJpeg(32, 24, "#6e1e1e")

    const form = new FormData()
    form.set("record", JSON.stringify(correctiveBody([], {
      workOrderId, reading: 12_000, workDate: today,
      photos: [{ id: first, kind: "correctiva" }, { id: second, kind: "correctiva" }],
    })))
    form.set(`photo:${first}`, new File([firstBytes as BlobPart], `${first}.jpg`, { type: "image/jpeg" }))
    form.set(`meta:${first}`, JSON.stringify(await metaFor(firstBytes, { kind: "correctiva" })))
    form.set(`photo:${second}`, new File([secondBytes as BlobPart], `${second}.jpg`, { type: "image/jpeg" }))
    // La segunda llega con otra huella: `savePhoto` la rechaza después de que la primera se guardó.
    form.set(`meta:${second}`, JSON.stringify(await metaFor(secondBytes, { kind: "correctiva", sha256: "f".repeat(64) })))

    const outcome = await registerWorkOrderRecordFromWeb(await syncOf(IDS.mecBio, MANT_WEB_DEVICE_ID), form)
    expect(outcome).toMatchObject({ ok: false, field: "photos", message: expect.stringMatching(/huella no coincide/) })

    // Ninguna foto quedó a nombre de quien la subió, y el disco tampoco guarda el archivo de la primera.
    expect(await testDb.select().from(schema.mantRecordPhotos)).toEqual([])
    expect(existsSync(storageDir) ? readdirSync(storageDir) : []).toEqual([])
    expect(await testDb.select().from(schema.mantRecords)).toEqual([])
  })

  it("si createRecord rechaza el registro después de guardar las fotos, tampoco quedan fila ni archivo", async () => {
    const workOrderId = await inWorkshop()
    const shot = crypto.randomUUID()
    const bytes = await makeJpeg(32, 24, "#1e3e6e")
    const form = new FormData()
    // Fecha futura: `savePhoto` la deja pasar y `createRecord` la rechaza ya con la foto en disco.
    form.set("record", JSON.stringify(correctiveBody([], {
      workOrderId, reading: 12_000, workDate: addDaysToPlainDate(today, 3), photos: [{ id: shot, kind: "correctiva" }],
    })))
    form.set(`photo:${shot}`, new File([bytes as BlobPart], `${shot}.jpg`, { type: "image/jpeg" }))
    form.set(`meta:${shot}`, JSON.stringify(await metaFor(bytes, { kind: "correctiva" })))

    const outcome = await registerWorkOrderRecordFromWeb(await syncOf(IDS.mecBio, MANT_WEB_DEVICE_ID), form)
    expect(outcome).toMatchObject({ ok: false, field: "workDate" })

    expect(await testDb.select().from(schema.mantRecordPhotos)).toEqual([])
    expect(existsSync(storageDir) ? readdirSync(storageDir) : []).toEqual([])
    expect(await testDb.select().from(schema.mantRecords)).toEqual([])
  })

  it("una foto que ya era de otra petición no se deshace: sólo se compensa lo creado aquí", async () => {
    const workOrderId = await inWorkshop()
    const shot = crypto.randomUUID()
    const bytes = await makeJpeg(32, 24, "#123456")
    const onePhoto = async (recordOverrides: Record<string, unknown>) => {
      const form = new FormData()
      form.set("record", JSON.stringify(correctiveBody([], {
        workOrderId, reading: 12_000, workDate: today, photos: [{ id: shot, kind: "correctiva" }], ...recordOverrides,
      })))
      form.set(`photo:${shot}`, new File([bytes as BlobPart], `${shot}.jpg`, { type: "image/jpeg" }))
      form.set(`meta:${shot}`, JSON.stringify(await metaFor(bytes, { kind: "correctiva" })))
      return form
    }

    // Primera petición: la foto se guarda y el registro la reclama.
    expect(await registerWorkOrderRecordFromWeb(await syncOf(IDS.mecBio, MANT_WEB_DEVICE_ID), await onePhoto({}))).toMatchObject({ ok: true })
    const [anchored] = await testDb.select().from(schema.mantRecordPhotos)
    expect(anchored?.recordId).not.toBeNull()

    // Segunda petición con la misma foto (llega como duplicada) y una segunda que falla:
    // la compensación no puede llevarse por delante la foto que ya era de la primera.
    const other = crypto.randomUUID()
    const brokenBytes = await makeJpeg(32, 24, "#6e1e1e")
    const form = await onePhoto({ id: crypto.randomUUID(), photos: [{ id: shot, kind: "correctiva" }, { id: other, kind: "correctiva" }] })
    form.set(`photo:${other}`, new File([brokenBytes as BlobPart], `${other}.jpg`, { type: "image/jpeg" }))
    form.set(`meta:${other}`, JSON.stringify(await metaFor(brokenBytes, { kind: "correctiva", sha256: "f".repeat(64) })))
    expect(await registerWorkOrderRecordFromWeb(await syncOf(IDS.mecBio, MANT_WEB_DEVICE_ID), form)).toMatchObject({ ok: false, field: "photos" })

    const photos = await testDb.select().from(schema.mantRecordPhotos)
    expect(photos.map((photo) => photo.id)).toEqual([shot])
    expect(photos[0]?.recordId).toBe(anchored?.recordId)
    expect(readdirSync(storageDir)).toHaveLength(1)
  })
})

describe("3.7 · el PDF de la revisión 1 no queda huérfano al anular", () => {
  it("borra `<id>-1.pdf` y deja el nombre de la revisión anulada (<id>-2.pdf)", async () => {
    const record = await corrective(IDS.mecBio, null)
    const vigente = pdfStorageName(record.id, pdfRevision("vigente"))
    expect(vigente).toBe(`${record.id}-1.pdf`)
    mkdirSync(storageDir, { recursive: true })
    writeFileSync(path.join(storageDir, vigente), "%PDF-1.4 archivado")
    await testDb.update(schema.mantRecords)
      .set({ pdfStorageKey: createMantencionFilePath(vigente), pdfGeneratedAt: new Date().toISOString() })
      .where(eq(schema.mantRecords.id, record.id))

    expect((await voidRecord({ recordId: record.id, reason: "Duplicada por error de digitación", viewer: await viewerOf(IDS.jefe) })).ok).toBe(true)

    expect(existsSync(path.join(storageDir, vigente))).toBe(false)
    expect(pdfStorageName(record.id, pdfRevision("anulado"))).toBe(`${record.id}-2.pdf`)
  })
})
