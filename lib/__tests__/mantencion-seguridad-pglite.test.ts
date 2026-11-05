import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq, isNull } from "drizzle-orm"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { SYSTEM_PERMISSIONS } from "@/lib/auth/system-rbac"
import { syncRecordSchema, type SyncRecord, type WorkshopUpdatePayload } from "@/lib/mantencion/contracts"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { configureZodLocale } from "@/lib/validation/zod-locale"
import { daysAgo, IDS, insertOrphanPhoto, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * Seguridad del módulo de mantención (auditoría 2026-11-04), contra un Postgres
 * de verdad (PGlite con todas las migraciones):
 *
 * - A1: el enlace registro ↔ OT no se abre nombrando al asignado como ejecutor.
 * - A2: «Sigue en taller» / «Ya salió» exige el mismo alcance que la lectura.
 * - A11: la fecha de la actualización no puede ser futura ni previa al ingreso.
 * - A4: `mant:equipment:manage` no alcanza a las faenas que no se ven.
 * - A5: la lista y la revocación de dispositivos respetan la faena.
 * - A7: una foto ya reclamada por otro registro no se roba (409, no 500).
 * - A8: dos emisiones simultáneas de credencial dejan UNA fila viva, nunca 500.
 * - A9: las violaciones únicas que no son «el mismo id» se rechazan con 409.
 * - A10: el historial de la app es de lectura abierta (excepción de producto).
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const { getUserRbacById } = await import("@/lib/auth/rbac")
const { equipmentScope } = await import("@/lib/services/mantencion/access")
const { createRecord } = await import("@/lib/services/mantencion/records-create")
const { applyWorkshopUpdate } = await import("@/lib/services/mantencion/workshop-updates")
const {
  createEquipment, updateEquipment, reactivateEquipment, retireEquipment,
} = await import("@/lib/services/mantencion/equipment")
const { commitEquipmentImport } = await import("@/lib/services/mantencion/equipment-import")
const { assignEquipment } = await import("@/lib/services/mantencion/schedule-assign")
const {
  DEVICE_OUT_OF_SCOPE, authenticateDeviceToken, issueDeviceCredential, listDeviceCredentials, revokeDeviceCredential,
} = await import("@/lib/services/mantencion/device-credentials")
const { loadAppHistory } = await import("@/lib/services/mantencion/app-history")

// ── Actores ─────────────────────────────────────────────────────────────────

type Viewer = Awaited<ReturnType<typeof viewerOf>>

async function viewerOf(userId: string) {
  const rbac = await getUserRbacById(userId, true)
  if (!rbac) throw new Error(`Sin RBAC para ${userId}`)
  return { userId: rbac.id, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal }
}

async function contextOf(userId: string) {
  const viewer = await viewerOf(userId)
  return { userName: viewer.email ?? "Prueba", deviceId: "dev-seguridad", credentialId: "cred-seguridad", viewer }
}

/** Actor de las escrituras de equipos, con el alcance que calcula la acción (`equipmentScope`). */
async function equipmentActor(userId: string) {
  const viewer = await viewerOf(userId)
  return { userId: viewer.userId, email: viewer.email, scope: equipmentScope(viewer) }
}

/** Alcance de la pantalla de dispositivos, el mismo que arma `dispositivos/actions.ts`. */
async function deviceActor(userId: string) {
  const viewer = await viewerOf(userId)
  return {
    userId: viewer.userId,
    isGlobal: viewer.isGlobal,
    viewAll: viewer.permissions.includes("mant:records:view_all"),
    worksiteIds: viewer.worksiteIds,
  }
}

// ── Datos de entrada ────────────────────────────────────────────────────────

const common = (vehicleId: string, reading: number, workDate = daysAgo(1)) => ({
  id: crypto.randomUUID(), vehicleId, reading, workDate, signedAt: new Date().toISOString(), offlineSince: null,
  deviceId: crypto.randomUUID(), appVersion: "test", readingJumpConfirmed: false, duplicateConfirmed: false, correctsRecordId: null,
})

async function photosFor(userId: string, kinds: Array<"filtros" | "sticker" | "correctiva">) {
  const photos = []
  for (const kind of kinds) {
    const id = crypto.randomUUID()
    await insertOrphanPhoto(testDb, { id, userId, kind })
    photos.push({ id, kind })
  }
  return photos
}

async function corrective(userId: string, overrides: Record<string, unknown> = {}): Promise<SyncRecord> {
  return syncRecordSchema.parse({
    ...common(IDS.truckBio, 12_000, daysAgo(2)),
    kind: "C", oilIds: [IDS.oilMotor], noOilChange: false, executor: { kind: "yo" },
    jobs: [{ workTypeId: IDS.wtMec, hours: 2, noParts: false, parts: [{ quantity: 1, description: "Manguera" }] }],
    description: "Cambio de manguera de aire",
    inWorkshop: false, workshopEntryDate: null, workshopReason: null, workOrder: null, driverIds: [IDS.driver1],
    photos: await photosFor(userId, ["correctiva"]),
    ...overrides,
  })
}

async function preventive(userId: string, overrides: Record<string, unknown> = {}): Promise<SyncRecord> {
  return syncRecordSchema.parse({
    ...common(IDS.truckBio, 12_000, daysAgo(5)),
    kind: "P", scheduleId: IDS.schKm, scheduleVersion: 1, intervalValue: 10_000, suggestedIntervalValue: 10_000, manualScheduleReason: null,
    items: [{ itemKey: "k1", value: "R", reason: null }, { itemKey: "k4", value: "R", reason: null }],
    notes: "Sin novedad",
    photos: await photosFor(userId, ["filtros", "sticker"]),
    ...overrides,
  })
}

const workshopPayload = (recordId: string, overrides: Record<string, unknown> = {}): WorkshopUpdatePayload =>
  ({ id: crypto.randomUUID(), recordId, kind: "sigue", note: "Sigue en taller esperando repuesto", createdAt: new Date().toISOString(), deviceId: crypto.randomUUID(), ...overrides }) as WorkshopUpdatePayload

/** Un registro correctivo ya firmado que dejó el equipo en taller (para A2 y A11). */
async function seedWorkshopRecord(input: { id: string; folio: string; vehicleId: string; worksiteId: string; author: string; entryDate: string }) {
  const now = new Date().toISOString()
  await testDb.insert(schema.mantRecords).values({
    id: input.id, folio: input.folio, kind: "C", vehicleId: input.vehicleId,
    equipmentSnapshot: { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Faena", unit: "km" },
    worksiteId: input.worksiteId, reading: 10_000, unit: "km", workDate: input.entryDate,
    registeredBy: input.author, executorKind: "yo", executorUserId: input.author, executorWorkshopId: null, executorName: "Mecánico",
    signedAt: now, receivedAt: now, status: "vigente",
  })
  await testDb.insert(schema.mantRecordCorrectives).values({
    recordId: input.id, workTypes: ["Mecánico"], oils: [], description: "Cambio de bomba de agua", noParts: true, hours: 2,
    inWorkshop: true, workshopEntryDate: input.entryDate, workshopReason: "Falla de la bomba de agua",
  })
}

function failure(outcome: { body: { ok: boolean } }) {
  if (outcome.body.ok) throw new Error("Se esperaba un rechazo")
  return outcome.body as { ok: false; code: string; message: string; field?: string }
}
function success(outcome: { body: { ok: boolean } }) {
  if (!outcome.body.ok) throw new Error(`Se esperaba éxito: ${(outcome.body as unknown as { message: string }).message}`)
  return outcome.body
}

// ── Base de datos ───────────────────────────────────────────────────────────

/** Tablas que cada prueba deja limpias; los equipos de A4 se crean una vez en su propio bloque. */
const CLEAN_TABLES = [
  schema.mantRecordObservations, schema.mantRecordVoids, schema.mantWorkshopUpdates, schema.mantRecordPhotos,
  schema.mantRecordParts, schema.mantRecordJobs, schema.mantRecordDrivers, schema.mantRecordCorrectives, schema.mantRecordItems,
  schema.mantWorkOrderEvents, schema.mantRecords, schema.mantWorkOrders, schema.mantFolioCounters,
  schema.mantDeviceCredentials, schema.auditLog,
]

beforeAll(async () => {
  configureZodLocale()
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedMantFixtures(testDb)
  // «Encargado de equipos de su faena»: no global, sin `view_all`, con `mant:equipment:manage`.
  const manage = SYSTEM_PERMISSIONS.find((permission) => permission.name === "mant:equipment:manage")
  if (!manage) throw new Error("Falta el permiso mant:equipment:manage")
  await testDb.insert(schema.userPermissions).values({ userId: IDS.supBio, permissionId: manage.id })
  // El mismo mecánico en dos faenas: la lista de dispositivos no debe duplicarlo.
  await testDb.insert(schema.worksiteUsers).values({ userId: IDS.mecBio2, worksiteId: IDS.wsCho, isPrimary: false })
})

beforeEach(async () => {
  for (const table of CLEAN_TABLES) await testDb.delete(table)
})

afterAll(async () => { await pg.close() })

// ── A1 · Suplantación del ejecutor en la OT ────────────────────────────────

describe("A1: el enlace con la OT no se abre nombrando al asignado como ejecutor", () => {
  /** OT en taller asignada a otro mecánico; el trabajo pedido es del mismo equipo. */
  async function runningWorkOrder() {
    await testDb.insert(schema.mantWorkOrders).values({
      id: "ot-seguridad", folio: "OT-BIO-9001", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio,
      equipmentSnapshot: { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" },
      repair: true, maintenance: false, repairDescription: "Fuga de aceite del motor", requestDate: daysAgo(3),
      requestedByUserId: IDS.adminBio, requesterName: "Ana Contrato", status: "en_ejecucion", assignedToUserId: IDS.mecBio,
      workshopKind: "interno", workshopEntryAt: daysAgo(2), startedAt: daysAgo(2), startedByUserId: IDS.mecBio,
      estimatedDeliveryDate: daysAgo(-3),
    })
  }

  it("otro mecánico no puede firmar el trabajo de la OT nombrando al asignado", async () => {
    await runningWorkOrder()
    const input = await corrective(IDS.mecBio2, { workOrderId: "ot-seguridad", executor: { kind: "otro_mecanico", userId: IDS.mecBio } })
    const rejected = failure(await createRecord(input, await contextOf(IDS.mecBio2)))
    expect(rejected.code).toBe("rejected")
    expect(rejected.field).toBe("workOrderId")
    expect(rejected.message).toContain("asignada a otra persona")
    expect(await testDb.select().from(schema.mantRecords)).toHaveLength(0)
  })

  it("el asignado sí puede firmar y sigue eligiendo «otro mecánico» como ejecutor", async () => {
    await runningWorkOrder()
    const input = await corrective(IDS.mecBio, { workOrderId: "ot-seguridad", executor: { kind: "otro_mecanico", userId: IDS.mecBio2 } })
    success(await createRecord(input, await contextOf(IDS.mecBio)))
    const [row] = await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, input.id))
    expect(row).toMatchObject({ workOrderId: "ot-seguridad", registeredBy: IDS.mecBio, executorUserId: IDS.mecBio2, executorKind: "otro_mecanico" })
  })

  it("un id de OT no se confunde con un registro de taller: el taller lo mueve la OT", async () => {
    await runningWorkOrder()
    const outcome = await applyWorkshopUpdate(workshopPayload("ot-seguridad"), await contextOf(IDS.mecBio))
    expect(outcome.status).toBe(422)
    expect(failure(outcome).message).toContain("lo controla su OT")
  })

  it("«otro mecánico» sigue permitido en correctivas sin OT", async () => {
    const input = await corrective(IDS.mecBio, { executor: { kind: "otro_mecanico", userId: IDS.mecBio2 } })
    success(await createRecord(input, await contextOf(IDS.mecBio)))
  })
})

// ── A2 · «Sigue en taller» / «Ya salió» dentro del alcance de lectura ───────

describe("A2: quien no puede leer el registro tampoco mueve su taller", () => {
  const RECORD = { id: "rec-taller", folio: "MC-BIO-9001", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, author: IDS.mecBio, entryDate: daysAgo(2) }

  it("un mecánico de la faena con sólo view_own no actualiza el taller de un registro ajeno", async () => {
    await seedWorkshopRecord(RECORD)
    const outcome = await applyWorkshopUpdate(workshopPayload(RECORD.id), await contextOf(IDS.mecBio2))
    expect(outcome.status).toBe(422)
    expect(failure(outcome).message).toBe("Ese equipo no es de tu faena: no puedes actualizar su estado en taller.")
    expect(await testDb.select().from(schema.mantWorkshopUpdates)).toHaveLength(0)
  })

  it("el autor y un supervisor de su faena sí pueden", async () => {
    await seedWorkshopRecord(RECORD)
    success(await applyWorkshopUpdate(workshopPayload(RECORD.id), await contextOf(IDS.mecBio)))
    success(await applyWorkshopUpdate(workshopPayload(RECORD.id), await contextOf(IDS.supBio)))
    expect(await testDb.select().from(schema.mantWorkshopUpdates)).toHaveLength(2)
  })

  it("un registro de otra faena tampoco se toca (view_worksite no cruza de faena)", async () => {
    await seedWorkshopRecord({ ...RECORD, worksiteId: IDS.wsCho })
    const outcome = await applyWorkshopUpdate(workshopPayload(RECORD.id), await contextOf(IDS.supBio))
    expect(outcome.status).toBe(422)
    expect(failure(outcome).message).toContain("no es de tu faena")
  })
})

// ── A11 · La fecha de la actualización tiene cota ──────────────────────────

describe("A11: la fecha de «Sigue en taller» no puede ser futura ni previa al ingreso", () => {
  const RECORD = { id: "rec-fecha", folio: "MC-BIO-9002", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, author: IDS.mecBio, entryDate: daysAgo(3) }

  it("rechaza una fecha futura más allá de la tolerancia de reloj", async () => {
    await seedWorkshopRecord(RECORD)
    const futuro = new Date(Date.now() + 60 * 60_000).toISOString()
    const outcome = await applyWorkshopUpdate(workshopPayload(RECORD.id, { createdAt: futuro }), await contextOf(IDS.mecBio))
    expect(outcome.status).toBe(422)
    expect(failure(outcome).message).toContain("no puede ser futura")
    expect(await testDb.select().from(schema.mantWorkshopUpdates)).toHaveLength(0)
  })

  it("tolera el desfase de reloj de menos de cinco minutos", async () => {
    await seedWorkshopRecord(RECORD)
    const casiAhora = new Date(Date.now() + 60_000).toISOString()
    success(await applyWorkshopUpdate(workshopPayload(RECORD.id, { createdAt: casiAhora }), await contextOf(IDS.mecBio)))
  })

  it("rechaza una fecha anterior al ingreso a taller", async () => {
    await seedWorkshopRecord(RECORD)
    const antes = new Date(Date.now() - 5 * 86_400_000).toISOString()
    const outcome = await applyWorkshopUpdate(workshopPayload(RECORD.id, { createdAt: antes }), await contextOf(IDS.mecBio))
    expect(outcome.status).toBe(422)
    expect(failure(outcome).message).toContain("anterior al ingreso a taller")
  })
})

// ── A4 · `mant:equipment:manage` limitado a las faenas ─────────────────────

describe("A4: administrar equipos no alcanza a las faenas que no se ven", () => {
  let bioVehicleId = ""
  let choVehicleId = ""

  beforeAll(async () => {
    const jefe = await equipmentActor(IDS.jefe)
    const base = {
      plate: "", noPlate: false, equipmentTypeId: "fet-test-km", brandId: IDS.brandScania, model: "R450", year: 2021,
      scheduleId: null, initialReading: null, initialReadingDate: null,
    }
    const bio = await createEquipment(jefe, { ...base, code: "KA-940", plate: "ZXCV-10", worksiteId: IDS.wsBio, newWorksiteName: "" })
    const cho = await createEquipment(jefe, { ...base, code: "KA-941", plate: "ZXCV-11", worksiteId: IDS.wsCho, newWorksiteName: "" })
    if (!bio.ok || !cho.ok) throw new Error("No se pudieron crear los equipos de prueba")
    bioVehicleId = bio.data.vehicleId
    choVehicleId = cho.data.vehicleId
  })

  it("el alcance sale de las faenas: un encargado no global queda en las suyas", async () => {
    const viewer = await viewerOf(IDS.supBio)
    expect(viewer.isGlobal).toBe(false)
    expect(viewer.permissions).toContain("mant:equipment:manage")
    expect(equipmentScope(viewer)).toEqual([IDS.wsBio])
    // Jefatura (global) y view_all siguen viendo todo.
    expect(equipmentScope(await viewerOf(IDS.jefe))).toBe("all")
    // Un mecánico sin permiso de equipos no administra ninguna.
    expect(equipmentScope(await viewerOf(IDS.mecBio))).toEqual([])
  })

  it("no crea equipos en otra faena ni crea faenas nuevas", async () => {
    const encargado = await equipmentActor(IDS.supBio)
    const otra = await createEquipment(encargado, {
      code: "KA-950", plate: "ZXCV-12", noPlate: false, equipmentTypeId: "fet-test-km", brandId: IDS.brandScania,
      model: "R450", year: 2021, worksiteId: IDS.wsCho, newWorksiteName: "", scheduleId: null, initialReading: null, initialReadingDate: null,
    })
    expect(otra).toMatchObject({ ok: false, fieldErrors: { worksiteId: expect.stringContaining("no administras") } })

    const nueva = await createEquipment(encargado, {
      code: "KA-951", plate: "ZXCV-13", noPlate: false, equipmentTypeId: "fet-test-km", brandId: IDS.brandScania,
      model: "R450", year: 2021, worksiteId: "__new__", newWorksiteName: "Faena Inventada", scheduleId: null, initialReading: null, initialReadingDate: null,
    })
    expect(nueva.ok).toBe(false)
    expect((nueva as { message: string }).message).toContain("No puedes crear faenas nuevas")
    expect(await testDb.select().from(schema.worksites).where(eq(schema.worksites.name, "Faena Inventada"))).toHaveLength(0)
  })

  it("no edita ni da de baja un equipo de otra faena, y sí el de la suya", async () => {
    const encargado = await equipmentActor(IDS.supBio)
    const input = {
      code: "KA-941", plate: "ZXCV-11", noPlate: false, equipmentTypeId: "fet-test-km", brandId: IDS.brandScania,
      model: "R500", year: 2021, worksiteId: IDS.wsCho, newWorksiteName: "", scheduleId: null, initialReading: null, initialReadingDate: null,
    }
    const edit = await updateEquipment(encargado, choVehicleId, input, { active: true, retiredReason: "" })
    expect(edit).toMatchObject({ ok: false, message: expect.stringContaining("no administras") })
    const retire = await retireEquipment(encargado, choVehicleId, "Equipo vendido a tercero")
    expect(retire).toMatchObject({ ok: false, message: expect.stringContaining("no administras") })
    const [cho] = await testDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, choVehicleId))
    expect(cho).toMatchObject({ isActive: true, model: "R450" })

    // La jefatura global sí puede, y el encargado también con su propia faena.
    const jefeEdit = await updateEquipment(await equipmentActor(IDS.jefe), choVehicleId, input, { active: true, retiredReason: "" })
    expect(jefeEdit.ok).toBe(true)
    const bioInput = { ...input, code: "KA-940", plate: "ZXCV-10", model: "R460", worksiteId: IDS.wsBio }
    expect((await updateEquipment(encargado, bioVehicleId, bioInput, { active: true, retiredReason: "" })).ok).toBe(true)
    expect((await retireEquipment(encargado, bioVehicleId, "Equipo vendido a tercero")).ok).toBe(true)
    expect((await reactivateEquipment(encargado, bioVehicleId)).ok).toBe(true)
  })

  it("no reactiva un equipo dado de baja en otra faena", async () => {
    const jefe = await equipmentActor(IDS.jefe)
    const creado = await createEquipment(jefe, {
      code: "KA-952", plate: "ZXCV-14", noPlate: false, equipmentTypeId: "fet-test-km", brandId: IDS.brandScania,
      model: "R450", year: 2021, worksiteId: IDS.wsAra, newWorksiteName: "", scheduleId: null, initialReading: null, initialReadingDate: null,
    })
    if (!creado.ok) throw new Error(creado.message)
    expect((await retireEquipment(jefe, creado.data.vehicleId, "Equipo vendido a tercero")).ok).toBe(true)
    const encargado = await equipmentActor(IDS.supBio)
    const back = await reactivateEquipment(encargado, creado.data.vehicleId)
    expect(back).toMatchObject({ ok: false, message: expect.stringContaining("no administras") })
    expect((await reactivateEquipment(jefe, creado.data.vehicleId)).ok).toBe(true)
  })

  it("no asigna pautas a equipos de otra faena", async () => {
    const encargado = await equipmentActor(IDS.supBio)
    const rechazo = await assignEquipment(encargado, { scheduleId: IDS.schKm, vehicleIds: [choVehicleId] })
    expect(rechazo).toMatchObject({ ok: false, message: "Hay equipos de otra faena en la selección: quítalos para continuar." })
    // Con equipos de su faena, la asignación corre.
    const ok = await assignEquipment(encargado, { scheduleId: IDS.schKm, vehicleIds: [bioVehicleId, choVehicleId].slice(0, 1) })
    expect(ok.ok).toBe(true)
  })

  it("la importación rechaza las filas de otra faena y escribe las propias", async () => {
    const encargado = await equipmentActor(IDS.supBio)
    const buffer = await workbookBuffer([
      ["IM-810", "BCDF-20", "Camión", "Scania", "P360", 2020, "Biodiversa", null, null, null],
      ["IM-811", "BCDF-21", "Camión", "Scania", "P360", 2020, "Cholguán", null, null, null],
    ])
    const result = await commitEquipmentImport(encargado, buffer, "equipos.xlsx")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toMatchObject({ created: 1, errors: 1 })
    const codes = (await testDb.select().from(schema.fuelVehicles)).map((row) => row.code)
    expect(codes).toContain("IM-810")
    expect(codes).not.toContain("IM-811")
  })
})

async function workbookBuffer(rows: Array<Array<string | number | null>>): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Equipos")
  sheet.addRow(["Código", "Patente", "Tipo de equipo", "Marca", "Modelo", "Año", "Faena", "Pauta", "Lectura inicial", "Fecha de la lectura"])
  for (const row of rows) sheet.addRow(row)
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

// ── A5 · Dispositivos con alcance ──────────────────────────────────────────

describe("A5: la lista y la revocación de dispositivos respetan la faena", () => {
  it("no lista credenciales de personas de otra faena ni duplica a quien tiene dos", async () => {
    const bio = await issueDeviceCredential({ userId: IDS.mecBio, deviceId: "tab-bio" })
    await issueDeviceCredential({ userId: IDS.mecBio2, deviceId: "tab-bio-2" })
    const cho = await issueDeviceCredential({ userId: IDS.mecCho, deviceId: "tab-cho" })

    const vistas = await listDeviceCredentials({ actor: await deviceActor(IDS.supBio) })
    expect(vistas.map((row) => row.deviceId).sort()).toEqual(["tab-bio", "tab-bio-2"])
    expect(vistas.some((row) => row.userEmail === `${IDS.mecCho}@chome.test`)).toBe(false)
    expect(vistas.some((row) => row.id === cho.credentialId)).toBe(false)
    // mecBio2 está en dos faenas y aparece UNA vez.
    expect(vistas.filter((row) => row.userId === IDS.mecBio2)).toHaveLength(1)
    expect(vistas.some((row) => row.id === bio.credentialId)).toBe(true)

    // Quien ve todas las faenas ve todas las credenciales.
    const todas = await listDeviceCredentials({ actor: await deviceActor(IDS.jefe) })
    expect(todas).toHaveLength(3)
  })

  it("no revoca el dispositivo de otra faena; sí el de la propia y cualquiera si es global", async () => {
    const ajeno = await issueDeviceCredential({ userId: IDS.mecCho, deviceId: "tab-cho-a" })
    const propio = await issueDeviceCredential({ userId: IDS.mecBio, deviceId: "tab-bio-a" })
    const actor = await deviceActor(IDS.supBio)

    const fuera = await revokeDeviceCredential({ credentialId: ajeno.credentialId, actorUserId: actor.userId, actor })
    expect(fuera).toEqual({ ok: false, message: DEVICE_OUT_OF_SCOPE })
    const [sigueViva] = await testDb.select().from(schema.mantDeviceCredentials).where(eq(schema.mantDeviceCredentials.id, ajeno.credentialId))
    expect(sigueViva?.revokedAt).toBeNull()

    expect((await revokeDeviceCredential({ credentialId: propio.credentialId, actorUserId: actor.userId, actor })).ok).toBe(true)
    expect((await revokeDeviceCredential({ credentialId: ajeno.credentialId, actorUserId: IDS.jefe, actor: await deviceActor(IDS.jefe) })).ok).toBe(true)
  })
})

// ── A7 · Re-anclaje de fotos ───────────────────────────────────────────────

describe("A7: una foto ya reclamada por otro registro no se roba", () => {
  it("si la foto se ancla a otro registro, el registro se revierte con 409 y no con 500", async () => {
    // La validación ve la foto libre; el disparador la reclama para otro registro
    // justo antes del UPDATE, que es el interleaving que la guarda cubre (PGlite
    // serializa las transacciones, así que la carrera no se puede reproducir tal cual).
    await seedWorkshopRecord({ id: "rec-foto-ajena", folio: "MC-BIO-9003", vehicleId: IDS.truckBio, worksiteId: IDS.wsBio, author: IDS.mecBio, entryDate: daysAgo(4) })
    const input = await corrective(IDS.mecBio, { ...common(IDS.truckAra, 9_000, daysAgo(1)) })
    const photoId = (input.photos[0] as { id: string }).id

    await pg.exec(`
      create or replace function test_steal_photo() returns trigger language plpgsql as $$
      begin
        update mant_record_photos set record_id = 'rec-foto-ajena' where id = '${photoId}';
        return NEW;
      end $$;
      create trigger test_steal_photo before insert on mant_records for each row execute function test_steal_photo();
    `)
    try {
      const outcome = await createRecord(input, await contextOf(IDS.mecBio))
      expect(outcome.status).toBe(409)
      expect(failure(outcome)).toMatchObject({ code: "missing_photos", field: "photos", message: "Una foto ya pertenece a otro registro: vuelve a sacarla." })
      // Nada quedó a medias: ni el registro ni la foto tomada.
      expect(await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, input.id))).toHaveLength(0)
      const [photo] = await testDb.select().from(schema.mantRecordPhotos).where(eq(schema.mantRecordPhotos.id, photoId))
      expect(photo?.recordId).toBeNull()
    } finally {
      await pg.exec("drop trigger if exists test_steal_photo on mant_records")
    }
  })

  it("el caso normal ancla la foto al registro nuevo", async () => {
    const input = await corrective(IDS.mecBio)
    success(await createRecord(input, await contextOf(IDS.mecBio)))
    const [photo] = await testDb.select().from(schema.mantRecordPhotos).where(eq(schema.mantRecordPhotos.id, (input.photos[0] as { id: string }).id))
    expect(photo?.recordId).toBe(input.id)
  })
})

// ── A8 · Emisión de credencial concurrente ─────────────────────────────────

describe("A8: dos emisiones simultáneas dejan exactamente una credencial viva", () => {
  it("ninguna falla con 500 y sólo el último token sirve", async () => {
    const deviceId = "tablet-compartida"
    const [first, second] = await Promise.all([
      issueDeviceCredential({ userId: IDS.mecBio, deviceId }),
      issueDeviceCredential({ userId: IDS.mecBio, deviceId }),
    ])
    const live = await testDb.select().from(schema.mantDeviceCredentials)
      .where(and(eq(schema.mantDeviceCredentials.userId, IDS.mecBio), eq(schema.mantDeviceCredentials.deviceId, deviceId), isNull(schema.mantDeviceCredentials.revokedAt)))
    expect(live).toHaveLength(1)
    expect(live[0]?.id).toBe(second.credentialId)
    expect(await authenticateDeviceToken(first.token)).toBeNull()
    expect((await authenticateDeviceToken(second.token))?.userId).toBe(IDS.mecBio)
  })
})

// ── A9 · Errores únicos ────────────────────────────────────────────────────

describe("A9: las violaciones únicas se rechazan con 409 y se atribuyen bien", () => {
  it("un registro sin folio contesta 409 en vez de un 200 con folio vacío", async () => {
    const input = await preventive(IDS.mecBio)
    success(await createRecord(input, await contextOf(IDS.mecBio)))
    await testDb.update(schema.mantRecords).set({ folio: null }).where(eq(schema.mantRecords.id, input.id))
    const outcome = await createRecord(input, await contextOf(IDS.mecBio))
    expect(outcome.status).toBe(409)
    expect(failure(outcome).message).toContain("sin folio")
  })

  it("una violación única que no es la PK no responde 500 (el teléfono no reintenta para siempre)", async () => {
    // El contador de Biodiversa está en cero, pero el folio que va a asignar ya existe:
    // choca contra `mant_records_folio_unique`, no contra la llave primaria.
    await seedWorkshopRecord({ id: "rec-folio-tomado", folio: "MP-BIO-0001", vehicleId: IDS.truckAra, worksiteId: IDS.wsAra, author: IDS.mecCho, entryDate: daysAgo(6) })
    const outcome = await createRecord(await preventive(IDS.mecBio), await contextOf(IDS.mecBio))
    expect(outcome.status).toBe(409)
    expect(failure(outcome)).toMatchObject({ code: "rejected" })
    expect(failure(outcome).message).toContain("conflicto con otro registro")
    // Sólo queda el registro que ya tenía ese folio: el envío no se guardó ni a medias.
    expect(await testDb.select().from(schema.mantRecords)).toHaveLength(1)
  })

  it("equipos: la patente, el vehículo ya incorporado y el resto tienen mensajes distintos", async () => {
    const jefe = await equipmentActor(IDS.jefe)
    const input = {
      code: "KA-960", plate: "ZXCV-20", noPlate: false, equipmentTypeId: "fet-test-km", brandId: IDS.brandScania,
      model: "R450", year: 2021, worksiteId: IDS.wsBio, newWorksiteName: "", scheduleId: null, initialReading: null, initialReadingDate: null,
    }

    const patente = await withUniqueViolation("fuel_vehicles", "fuel_vehicles_plate_unique", () => createEquipment(jefe, input))
    expect(patente).toMatchObject({ ok: false, fieldErrors: { plate: "Esa patente ya está en otro equipo." } })

    const perfil = await withUniqueViolation("mant_equipment_profiles", "mant_equipment_profiles_pkey", () => createEquipment(jefe, input))
    expect(perfil).toMatchObject({ ok: false, fieldErrors: { code: expect.stringContaining("ya está en la mantención") } })

    const otro = await withUniqueViolation("fuel_vehicles", "otra_restriccion", () => createEquipment(jefe, input))
    expect(otro.ok).toBe(false)
    expect((otro as { message: string }).message).toContain("otro equipo con los mismos datos ya existe")
  })
})

/**
 * Fuerza una violación única con el nombre de restricción pedido (PGlite serializa
 * las transacciones, así que la carrera real de dos altas simultáneas no se puede
 * reproducir). Es la misma señal que Postgres entrega en esa carrera.
 */
async function withUniqueViolation<T>(table: string, constraint: string, run: () => Promise<T>): Promise<T> {
  await pg.exec(`
    create or replace function test_unique_violation() returns trigger language plpgsql as $$
    begin
      raise exception 'conflicto de prueba' using errcode = 'unique_violation', constraint = '${constraint}';
    end $$;
    drop trigger if exists test_unique_violation on ${table};
    create trigger test_unique_violation before insert on ${table} for each row execute function test_unique_violation();
  `)
  try {
    return await run()
  } finally {
    await pg.exec(`drop trigger if exists test_unique_violation on ${table}`)
  }
}

// ── A10 · Excepción del historial móvil ────────────────────────────────────

describe("A10: el historial de la app es de lectura abierta (decisión de producto)", () => {
  it("un mecánico con view_own recibe el historial completo y las fotos de otro autor", async () => {
    // Registro de OTRA faena y OTRO autor, con una foto suya.
    await seedWorkshopRecord({ id: "rec-historial", folio: "MC-CHO-9001", vehicleId: IDS.truckCho, worksiteId: IDS.wsCho, author: IDS.mecCho, entryDate: daysAgo(4) })
    const photoId = crypto.randomUUID()
    await insertOrphanPhoto(testDb, { id: photoId, userId: IDS.mecCho, kind: "correctiva" })
    await testDb.update(schema.mantRecordPhotos).set({ recordId: "rec-historial", sortOrder: 0 }).where(eq(schema.mantRecordPhotos.id, photoId))

    const viewer: Viewer = await viewerOf(IDS.mecBio)
    expect(viewer.permissions).toContain("mant:records:view_own")
    expect(viewer.permissions).not.toContain("mant:records:view_worksite")
    expect(viewer.worksiteIds).toEqual([IDS.wsBio])

    const history = await loadAppHistory(viewer)
    const otro = history.byVehicle[IDS.truckCho]?.find((record) => record.id === "rec-historial")
    expect(otro).toBeDefined()
    expect(otro).toMatchObject({ worksiteName: "Cholguán" })
    expect(otro?.photos.map((photo) => photo.id)).toContain(photoId)
  })
})
