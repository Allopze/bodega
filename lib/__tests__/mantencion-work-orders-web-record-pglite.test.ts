import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Session } from "next-auth"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { MANT_WEB_APP_VERSION, MANT_WEB_DEVICE_ID, type WorkOrderEntryPayload } from "@/lib/mantencion/contracts"
import { createWorkOrderSchema } from "@/lib/mantencion/work-order-schemas"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import { configureZodLocale } from "@/lib/validation/zod-locale"
import { IDS, seedMantFixtures } from "./mantencion-sync-fixtures"
import { correctiveBody, makeJpeg, metaFor, preventiveBody } from "./mantencion-sync-http-helpers"

/**
 * Registro de la correctiva o preventiva de una OT desde el PC
 * (`registerWorkOrderRecordAction`): la acción real, con la guardia real de
 * permisos y módulo (sólo `auth()` simulado), las fotos por `savePhoto` y el
 * registro por `createRecord`, contra Postgres real (PGlite).
 */

const storageRoot = mkdtempSync(path.join(tmpdir(), "mant-ot-web-record-"))
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
const auth = vi.fn()
vi.mock("@/lib/auth/auth", () => ({ auth: () => auth() }))

const { registerWorkOrderRecordAction } = await import("@/app/(app)/mantencion/ot/[id]/actions")
const { createWorkOrder } = await import("@/lib/services/mantencion/work-orders/create")
const transitions = await import("@/lib/services/mantencion/work-orders/transitions")
const { loadWorkOrderDetail } = await import("@/lib/services/mantencion/work-orders/query")
const { loadWorkOrderRecordForm } = await import("@/lib/services/mantencion/web-record")
const { getUserRbacById } = await import("@/lib/auth/rbac")
const { setSubmoduleToggle } = await import("@/lib/services/module-toggles")

const today = todayInChile()

async function rbacOf(userId: string) {
  const rbac = await getUserRbacById(userId, true)
  if (!rbac) throw new Error(`Sin RBAC para ${userId}`)
  return rbac
}
async function actorOf(userId: string) {
  const rbac = await rbacOf(userId)
  return { userId: rbac.id, name: rbac.name, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal }
}
async function viewerOf(userId: string) {
  const rbac = await rbacOf(userId)
  return { userId: rbac.id, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal }
}
/** La sesión del navegador de esa persona: lo único simulado de la guardia. */
async function signIn(userId: string) {
  const rbac = await rbacOf(userId)
  auth.mockResolvedValue({
    user: {
      id: rbac.id, name: rbac.name, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal,
      roles: rbac.roles, primaryWorksiteId: null, avatarColor: null, isActive: true,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as unknown as Session)
}

function ok<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!result.ok) throw new Error(`Se esperaba éxito: ${result.message}`)
  return result.value
}

const entry = (): WorkOrderEntryPayload => ({
  workshopKind: "interno", workshopId: null, workshopManagerName: null, operatorDriverId: null, operatorName: null,
  entryAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), odometer: 11_500, hourmeter: null,
  estimatedDeliveryDate: addDaysToPlainDate(today, 3),
})

/** OT de la jefatura (por asignar), asignada y, salvo que se pida otra cosa, ya en taller. */
async function otFor(mechanic: string = IDS.mecBio, options: { start?: boolean; maintenance?: boolean } = {}) {
  const input = createWorkOrderSchema.parse({
    clientRequestId: crypto.randomUUID(), vehicleId: IDS.truckBio, repair: true, maintenance: options.maintenance ?? false, requestDate: today,
    requesterName: "Alexis Morales", repairDescription: "Fuga de aceite en el motor", observations: null,
    annexItems: ["Cambiar manguera de aire"], maintenanceItems: [], assignedToUserId: null,
  })
  const id = ok(await createWorkOrder(await actorOf(IDS.jefe), input)).id
  ok(await transitions.assignWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, assignedToUserId: mechanic }))
  if (options.start !== false) ok(await transitions.startWorkOrder(await actorOf(mechanic), { workOrderId: id, entry: entry() }))
  return id
}

type Photo = { id: string; kind: "filtros" | "sticker" | "correctiva"; buffer: Buffer; meta?: Record<string, unknown> }

async function photo(kind: Photo["kind"], color = "#1e6e3e"): Promise<Photo> {
  return { id: crypto.randomUUID(), kind, buffer: await makeJpeg(32, 24, color) }
}

/** El `FormData` que arma el formulario: el registro en JSON y, por foto, el archivo y su meta. */
async function webForm(record: Record<string, unknown>, photos: Photo[]): Promise<FormData> {
  const form = new FormData()
  form.set("record", JSON.stringify({ ...record, photos: photos.map((item) => ({ id: item.id, kind: item.kind })) }))
  for (const item of photos) {
    form.set(`photo:${item.id}`, new File([item.buffer as BlobPart], `${item.id}.jpg`, { type: "image/jpeg" }))
    form.set(`meta:${item.id}`, JSON.stringify(await metaFor(item.buffer, { kind: item.kind, ...item.meta })))
  }
  return form
}

const corrective = (workOrderId: string | null, overrides: Record<string, unknown> = {}) =>
  correctiveBody([], { workOrderId, reading: 12_000, workDate: today, ...overrides })

async function records() {
  return testDb.select().from(schema.mantRecords)
}
async function photoRows() {
  return testDb.select().from(schema.mantRecordPhotos)
}
async function detailFor(userId: string, workOrderId: string) {
  const detail = await loadWorkOrderDetail(await viewerOf(userId), workOrderId)
  if (!detail) throw new Error("OT no visible")
  return detail
}

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
  await setSubmoduleToggle("mantencion_equipos", "/mantencion/ot", true, { userId: IDS.jefe })
  auth.mockReset()
})

describe("registrar la correctiva o preventiva de la OT desde el PC", () => {
  it("el asignado registra una correctiva con foto: queda enlazada, firmada «desde el PC» a la hora del servidor, y la salida ya procede", async () => {
    const id = await otFor()
    const before = await detailFor(IDS.mecBio, id)
    expect(before).toMatchObject({ canRegisterRecord: true, needsLinkedRecord: true })

    await signIn(IDS.mecBio)
    const shot = await photo("correctiva")
    // El navegador manda un reloj atrasado, «sin señal» y otro dispositivo: el servidor no le cree nada de eso.
    const sentAt = new Date(Date.now() - 2 * 86_400_000).toISOString()
    const form = await webForm(corrective(id, { signedAt: sentAt, offlineSince: sentAt, deviceId: crypto.randomUUID(), appVersion: "9.9.9" }), [shot])
    const started = Date.now()
    const result = await registerWorkOrderRecordAction(form)
    expect(result).toMatchObject({ ok: true, data: { duplicate: false } })
    expect(result.data?.folio).toMatch(/^MC-BIO-\d{4}$/)

    const [record] = await records()
    expect(record).toMatchObject({ workOrderId: id, deviceId: MANT_WEB_DEVICE_ID, appVersion: MANT_WEB_APP_VERSION, offlineSince: null, registeredBy: IDS.mecBio, kind: "C" })
    expect(new Date(record!.signedAt).getTime()).toBeGreaterThanOrEqual(started - 1_000)
    const [stored] = await photoRows()
    expect(stored).toMatchObject({ id: shot.id, recordId: record!.id, kind: "correctiva", deviceId: MANT_WEB_DEVICE_ID, uploadedBy: IDS.mecBio })

    expect((await detailFor(IDS.mecBio, id)).needsLinkedRecord).toBe(false)
    const items = await testDb.select().from(schema.mantWorkOrderItems).where(eq(schema.mantWorkOrderItems.workOrderId, id))
    ok(await transitions.markWorkOrderItems(await actorOf(IDS.mecBio), { workOrderId: id, marks: items.map((item) => ({ itemId: item.id, done: "si" as const, note: null })), added: [] }))
    ok(await transitions.finishWorkOrder(await actorOf(IDS.mecBio), { workOrderId: id, exitAt: new Date(Date.now() - 60_000).toISOString(), note: null }))
  })

  it("reenviar lo mismo devuelve el mismo folio como duplicado y deja una sola fila", async () => {
    const id = await otFor()
    await signIn(IDS.mecBio)
    const shot = await photo("correctiva")
    const record = corrective(id)
    const first = await registerWorkOrderRecordAction(await webForm(record, [shot]))
    const again = await registerWorkOrderRecordAction(await webForm(record, [shot]))
    expect(first.ok && again.ok).toBe(true)
    expect(again.data).toMatchObject({ folio: first.data?.folio, duplicate: true })
    expect(await records()).toHaveLength(1)
    expect(await photoRows()).toHaveLength(1)
  })

  it("una preventiva con la foto de los filtros y la del sticker", async () => {
    const id = await otFor(IDS.mecBio, { maintenance: true })
    await signIn(IDS.mecBio)
    const shots = [await photo("filtros"), await photo("sticker", "#6e1e1e")]
    const result = await registerWorkOrderRecordAction(await webForm(preventiveBody([], { workOrderId: id, workDate: today }), shots))
    expect(result).toMatchObject({ ok: true })
    expect(result.data?.folio).toMatch(/^MP-BIO-\d{4}$/)
    const [record] = await records()
    expect(record).toMatchObject({ kind: "P", workOrderId: id, deviceId: MANT_WEB_DEVICE_ID })
    expect((await photoRows()).map((row) => row.recordId)).toEqual([record!.id, record!.id])
  })

  it("el formulario trae el equipo de la OT con su pauta y los catálogos, sin quien registra entre los «otros mecánicos»", async () => {
    const form = await loadWorkOrderRecordForm(await viewerOf(IDS.mecBio), { vehicleId: IDS.truckBio, worksiteId: IDS.wsBio })
    expect(form?.equipment).toMatchObject({ id: IDS.truckBio, code: "KA-135", unit: "km", scheduleId: IDS.schKm })
    expect(form?.schedule?.intervals).toEqual([10_000, 20_000, 40_000])
    expect(form?.workTypes.map((type) => type.id)).toEqual(expect.arrayContaining([IDS.wtMec, IDS.wtSold]))
    expect(form?.mechanics.map((mechanic) => mechanic.id)).toContain(IDS.mecBio2)
    expect(form?.mechanics.map((mechanic) => mechanic.id)).not.toContain(IDS.mecBio)
  })

  describe("rechazos (y ninguna foto huérfana cuando no hay permiso)", () => {
    it("otro mecánico que no es el asignado", async () => {
      const id = await otFor()
      expect((await detailFor(IDS.jefe, id)).canRegisterRecord).toBe(true)
      await signIn(IDS.mecBio2)
      const result = await registerWorkOrderRecordAction(await webForm(corrective(id), [await photo("correctiva")]))
      expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/mecánico asignado o la jefatura/) })
      expect(await photoRows()).toHaveLength(0)
      expect(await records()).toHaveLength(0)
    })

    it("el administrador de contrato (sin la app del mecánico)", async () => {
      const id = await otFor()
      expect((await detailFor(IDS.adminBio, id)).canRegisterRecord).toBe(false)
      await signIn(IDS.adminBio)
      const result = await registerWorkOrderRecordAction(await webForm(corrective(id), [await photo("correctiva")]))
      expect(result).toMatchObject({ ok: false, message: "No tienes permisos para realizar esta acción" })
      expect(await photoRows()).toHaveLength(0)
    })

    it("una OT que todavía no entra a taller («Asignada»)", async () => {
      const id = await otFor(IDS.mecBio, { start: false })
      expect((await detailFor(IDS.mecBio, id))).toMatchObject({ canRegisterRecord: false, needsLinkedRecord: false })
      await signIn(IDS.mecBio)
      const result = await registerWorkOrderRecordAction(await webForm(corrective(id), [await photo("correctiva")]))
      expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/sólo se registra trabajo mientras está «En taller»/) })
      expect(await photoRows()).toHaveLength(0)
    })

    it("un registro sin la OT", async () => {
      await otFor()
      await signIn(IDS.mecBio)
      const result = await registerWorkOrderRecordAction(await webForm(corrective(null), [await photo("correctiva")]))
      expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/enlazado a la orden de trabajo/), fieldErrors: { workOrderId: [expect.any(String)] } })
    })

    it("una foto con otra huella y una cuarta foto", async () => {
      const id = await otFor()
      await signIn(IDS.mecBio)
      const tampered = { ...(await photo("correctiva")), meta: { sha256: "f".repeat(64) } }
      const altered = await registerWorkOrderRecordAction(await webForm(corrective(id), [tampered]))
      expect(altered).toMatchObject({ ok: false, message: expect.stringMatching(/huella no coincide/), fieldErrors: { photos: [expect.any(String)] } })

      const four = await Promise.all(["#111111", "#222222", "#333333", "#444444"].map((color) => photo("correctiva", color)))
      const tooMany = await registerWorkOrderRecordAction(await webForm(corrective(id), four))
      expect(tooMany).toMatchObject({ ok: false, fieldErrors: { photos: [expect.any(String)] } })
      expect(await records()).toHaveLength(0)
      expect(await photoRows()).toHaveLength(0)
    })

    it("una foto que no es JPG ni PNG", async () => {
      const id = await otFor()
      await signIn(IDS.mecBio)
      const shot = await photo("correctiva")
      const form = await webForm(corrective(id), [shot])
      form.set(`photo:${shot.id}`, new File([shot.buffer as BlobPart], "foto.heic", { type: "image/heic" }))
      const result = await registerWorkOrderRecordAction(form)
      expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/JPG o PNG/) })
    })

    it("con el submódulo de OT apagado", async () => {
      const id = await otFor()
      await setSubmoduleToggle("mantencion_equipos", "/mantencion/ot", false, { userId: IDS.jefe })
      await signIn(IDS.mecBio)
      const result = await registerWorkOrderRecordAction(await webForm(corrective(id), [await photo("correctiva")]))
      expect(result).toMatchObject({ ok: false, message: "El módulo está inactivo temporalmente" })
      expect(await photoRows()).toHaveLength(0)
    })
  })

  it("después de un rechazo vuelve a faltar el registro, y uno nuevo desde el PC lo cumple", async () => {
    const id = await otFor()
    await signIn(IDS.mecBio)
    expect((await registerWorkOrderRecordAction(await webForm(corrective(id), [await photo("correctiva")]))).ok).toBe(true)
    const items = await testDb.select().from(schema.mantWorkOrderItems).where(eq(schema.mantWorkOrderItems.workOrderId, id))
    ok(await transitions.markWorkOrderItems(await actorOf(IDS.mecBio), { workOrderId: id, marks: items.map((item) => ({ itemId: item.id, done: "si" as const, note: null })), added: [] }))
    ok(await transitions.finishWorkOrder(await actorOf(IDS.mecBio), { workOrderId: id, exitAt: new Date(Date.now() - 60_000).toISOString(), note: null }))
    // La recepción lo devuelve a taller.
    ok(await transitions.rejectWorkOrder(await actorOf(IDS.jefe), { workOrderId: id, reason: "Sigue la fuga de aceite en el motor" }))

    expect(await detailFor(IDS.mecBio, id)).toMatchObject({ status: "en_ejecucion", needsLinkedRecord: true, canRegisterRecord: true })
    const again = await registerWorkOrderRecordAction(await webForm(corrective(id, { reading: 12_050 }), [await photo("correctiva", "#225588")]))
    expect(again).toMatchObject({ ok: true, data: { duplicate: false } })
    expect((await detailFor(IDS.mecBio, id)).needsLinkedRecord).toBe(false)
  })
})
