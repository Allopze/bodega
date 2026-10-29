import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, asc, eq } from "drizzle-orm"
import path from "node:path"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { syncRecordSchema, type SyncRecord } from "@/lib/mantencion/contracts"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { configureZodLocale } from "@/lib/validation/zod-locale"
import { daysAgo, IDS, insertOrphanPhoto, seedMantFixtures } from "./mantencion-sync-fixtures"

/**
 * Recepción de registros de mantención (§8 y §11): idempotencia, folio
 * concurrente, revalidación en el servidor y ciclo de vida (anular, observar,
 * revisar, responder). Contra Postgres real (PGlite con todas las migraciones).
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const { createRecord } = await import("@/lib/services/mantencion/records-create")
const { voidRecord, observeRecord, markRecordReviewed, replyObservation } = await import("@/lib/services/mantencion/record-lifecycle")
const { getUserRbacById } = await import("@/lib/auth/rbac")
const { publishScheduleVersion } = await import("@/lib/services/mantencion/schedule-versions")
type Outcome = Awaited<ReturnType<typeof createRecord>>

async function contextOf(userId: string) {
  const rbac = await getUserRbacById(userId, true)
  if (!rbac) throw new Error(`Sin RBAC para ${userId}`)
  return {
    userName: rbac.name, deviceId: "dev-test", credentialId: "cred-test",
    viewer: { userId: rbac.id, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal },
  }
}

async function photosFor(userId: string, kinds: Array<"filtros" | "sticker" | "correctiva">) {
  const photos = []
  for (const kind of kinds) {
    const id = crypto.randomUUID()
    await insertOrphanPhoto(testDb, { id, userId, kind })
    photos.push({ id, kind })
  }
  return photos
}

const common = (vehicleId: string, reading: number, workDate = daysAgo(1)) => ({
  id: crypto.randomUUID(), vehicleId, reading, workDate, signedAt: new Date().toISOString(), offlineSince: null,
  deviceId: crypto.randomUUID(), appVersion: "test", readingJumpConfirmed: false, duplicateConfirmed: false, correctsRecordId: null,
})

/** Preventiva de 10.000 km sobre un camión Scania (ítems k1 y k4; k4 con aviso del fabricante). */
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

/** Un trabajo de correctiva para armar el registro; por defecto, con un repuesto. */
function job(workTypeId: string, hours: number, overrides: Record<string, unknown> = {}) {
  return { workTypeId, hours, noParts: false, parts: [{ quantity: 1, description: "Manguera" }], ...overrides }
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

function failure(outcome: Outcome) {
  if (outcome.body.ok) throw new Error("Se esperaba un rechazo")
  return outcome.body
}
function success(outcome: Outcome) {
  if (!outcome.body.ok) throw new Error(`Se esperaba éxito: ${outcome.body.message}`)
  return outcome.body
}

beforeAll(async () => {
  configureZodLocale()
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedMantFixtures(testDb)
})

beforeEach(async () => {
  for (const table of [
    schema.mantRecordObservations, schema.mantRecordVoids, schema.mantWorkshopUpdates, schema.mantRecordPhotos,
    schema.mantRecords, schema.mantFolioCounters, schema.auditLog,
  ]) await testDb.delete(table)
  await testDb.delete(schema.mantWorksiteSettings).where(eq(schema.mantWorksiteSettings.worksiteId, IDS.wsCho))
})

describe("registro preventivo", () => {
  it("se guarda con folio, snapshots, ítems con aviso del fabricante, fotos ancladas y bitácora", async () => {
    const ctx = await contextOf(IDS.mecBio)
    const input = await preventive(IDS.mecBio)
    const body = success(await createRecord(input, ctx))
    expect(body.folio).toBe("MP-BIO-0001")
    expect(body.duplicate).toBe(false)
    expect(body.warnings).toEqual([])

    const [row] = await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, input.id))
    expect(row).toMatchObject({
      kind: "P", worksiteId: IDS.wsBio, outOfWorksite: false, unit: "km", registeredBy: IDS.mecBio, executorKind: "yo", executorUserId: IDS.mecBio,
      executorName: "Javier Roa", scheduleNameSnapshot: "Camiones y tractos", intervalValue: 10_000, suggestedIntervalValue: 10_000,
      manualScheduleReason: null, readingJumpAlert: false, deviceId: "dev-test", status: "vigente", review: "pendiente",
    })
    expect(row?.equipmentSnapshot).toMatchObject({ code: "KA-135", plate: "RBYD-98", brand: "Scania", worksite: "Biodiversa", unit: "km", type: "Camión" })

    const items = await testDb.select().from(schema.mantRecordItems).where(eq(schema.mantRecordItems.recordId, input.id))
    expect(items.map((item) => [item.itemKey, item.groupName, item.manufacturerWarning]).sort())
      .toEqual([["k1", "Motor", false], ["k4", "Frenos", true]])
    const photos = await testDb.select().from(schema.mantRecordPhotos).where(eq(schema.mantRecordPhotos.recordId, input.id))
    expect(photos).toHaveLength(2)
    const [audit] = await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, "mant_record"), eq(schema.auditLog.entityId, input.id)))
    expect(audit).toMatchObject({ action: "create", entityCode: "MP-BIO-0001", userId: IDS.mecBio, worksiteId: IDS.wsBio })
  })

  it("idempotencia: el mismo registro tres veces deja una fila y el mismo folio; otro autor con el mismo id recibe 409", async () => {
    const ctx = await contextOf(IDS.mecBio)
    const input = await preventive(IDS.mecBio)
    const first = success(await createRecord(input, ctx))
    const second = success(await createRecord(input, ctx))
    const third = success(await createRecord(input, ctx))
    expect([first.duplicate, second.duplicate, third.duplicate]).toEqual([false, true, true])
    expect(new Set([first.folio, second.folio, third.folio]).size).toBe(1)
    expect(second.receivedAt).toBe(first.receivedAt)
    expect(await testDb.select().from(schema.mantRecords)).toHaveLength(1)
    const [counter] = await testDb.select().from(schema.mantFolioCounters)
    expect(counter?.last).toBe(1)

    const stolen = await createRecord(input, await contextOf(IDS.mecBio2))
    expect(stolen.status).toBe(409)
    expect(failure(stolen).code).toBe("rejected")
  })

  it("revalida la lectura contra la historia completa y nombra la lectura y la fecha que chocan", async () => {
    const ctx = await contextOf(IDS.mecBio)
    success(await createRecord(await preventive(IDS.mecBio), ctx))

    const lower = failure(await createRecord(await preventive(IDS.mecBio, { ...common(IDS.truckBio, 11_000, daysAgo(1)) }), ctx))
    expect(lower).toMatchObject({ code: "rejected", field: "reading" })
    expect(lower.message).toContain("12.000 km")
    expect(lower.message).toContain("MP-BIO-0001")

    const higherBefore = failure(await createRecord(await preventive(IDS.mecBio, { ...common(IDS.truckBio, 13_000, daysAgo(10)) }), ctx))
    expect(higherBefore.message).toContain("registrada después")
    expect(higherBefore.message).toContain("12.000 km")
  })

  it("el salto de lectura se acepta y el servidor calcula la alerta aunque el cliente diga que no la confirmó", async () => {
    const ctx = await contextOf(IDS.mecCho)
    // Cholguán/Volvo: inicial 20.000 → 30.000 km es un salto (> 5.000); el cliente manda `readingJumpConfirmed: false`.
    const input = await preventive(IDS.mecCho, {
      ...common(IDS.truckCho, 30_000, daysAgo(5)),
      items: [{ itemKey: "k1", value: "R", reason: null }],
    })
    const body = success(await createRecord(input, ctx))
    expect(body.warnings.map((warning) => warning.code)).toContain("reading_jump")
    const [row] = await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, input.id))
    expect(row).toMatchObject({ readingJumpAlert: true, readingJumpConfirmed: false })
  })

  it("rechaza ítems que no calzan con la pauta de la versión usada", async () => {
    const ctx = await contextOf(IDS.mecBio)
    const missing = failure(await createRecord(await preventive(IDS.mecBio, { items: [{ itemKey: "k1", value: "R", reason: null }] }), ctx))
    expect(missing).toMatchObject({ code: "rejected", field: "items" })
    expect(missing.message).toContain("Revisión pastillas")

    const noReason = failure(await createRecord(await preventive(IDS.mecBio, {
      items: [{ itemKey: "k1", value: "NR", reason: null }, { itemKey: "k4", value: "R", reason: null }],
    }), ctx))
    expect(noReason.message).toContain("motivo")

    // Volvo oculta k4 (regla X): enviarlo es enviar una pauta que no corresponde.
    const hidden = failure(await createRecord(await preventive(IDS.mecCho, {
      ...common(IDS.truckCho, 21_000, daysAgo(5)), intervalValue: 20_000, suggestedIntervalValue: 20_000,
      items: [{ itemKey: "k1", value: "R", reason: null }, { itemKey: "k2", value: "R", reason: null }, { itemKey: "k4", value: "R", reason: null }],
    }), await contextOf(IDS.mecCho)))
    expect(hidden.message).toContain("no corresponde")
    expect(await testDb.select().from(schema.mantRecords)).toHaveLength(0)
  })

  it("una pauta manual exige motivo y se guardan sugerida, usada y motivo", async () => {
    const ctx = await contextOf(IDS.mecBio)
    const manual = { intervalValue: 20_000, items: [
      { itemKey: "k1", value: "R", reason: null }, { itemKey: "k2", value: "R", reason: null }, { itemKey: "k4", value: "R", reason: null },
    ] }
    const noReason = failure(await createRecord(await preventive(IDS.mecBio, { ...manual, manualScheduleReason: null }), ctx))
    expect(noReason).toMatchObject({ code: "rejected", field: "manualScheduleReason" })
    expect(noReason.message).toContain("10.000 km")

    const input = await preventive(IDS.mecBio, { ...manual, manualScheduleReason: "Se adelantó por viaje largo" })
    success(await createRecord(input, ctx))
    const [row] = await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, input.id))
    expect(row).toMatchObject({ intervalValue: 20_000, suggestedIntervalValue: 10_000, manualScheduleReason: "Se adelantó por viaje largo" })
  })

  it("una preventiva repetida en 7 días se acepta, queda marcada y apunta a la anterior", async () => {
    const ctx = await contextOf(IDS.mecBio)
    const first = success(await createRecord(await preventive(IDS.mecBio), ctx))
    const input = await preventive(IDS.mecBio, { ...common(IDS.truckBio, 12_100, daysAgo(3)), duplicateConfirmed: true })
    const second = success(await createRecord(input, ctx))
    expect(second.warnings).toContainEqual(expect.objectContaining({ code: "duplicate", folio: first.folio, recordId: first.id }))
    const [row] = await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, input.id))
    expect(row).toMatchObject({ duplicateOfRecordId: first.id, duplicateConfirmed: true })
  })

  it("las fotos que faltan devuelven 409 y no consumen folio ni dejan registro", async () => {
    const ctx = await contextOf(IDS.mecBio)
    const input = await preventive(IDS.mecBio)
    const withGhost = syncRecordSchema.parse({ ...input, photos: [input.photos[0], { id: crypto.randomUUID(), kind: "sticker" }] })
    const refused = await createRecord(withGhost, ctx)
    expect(refused.status).toBe(409)
    expect(failure(refused).code).toBe("missing_photos")
    expect(await testDb.select().from(schema.mantRecords)).toHaveLength(0)

    // Una foto de otro mecánico tampoco vale.
    const foreign = await photosFor(IDS.mecBio2, ["filtros", "sticker"])
    expect(failure(await createRecord(await preventive(IDS.mecBio, { photos: foreign }), ctx)).code).toBe("missing_photos")

    const ok = success(await createRecord(await preventive(IDS.mecBio), ctx))
    expect(ok.folio).toBe("MP-BIO-0001")
  })

  it("exige exactamente una foto de filtros y una del sticker", async () => {
    const ctx = await contextOf(IDS.mecBio)
    const twoFilters = await photosFor(IDS.mecBio, ["filtros", "filtros"])
    const refused = failure(await createRecord(await preventive(IDS.mecBio, { photos: twoFilters }), ctx))
    expect(refused).toMatchObject({ code: "rejected", field: "photos" })
  })

  it("rechaza equipo dado de baja, inexistente, fecha futura y pauta de otra unidad", async () => {
    const ctx = await contextOf(IDS.mecBio)
    expect(failure(await createRecord(await preventive(IDS.mecBio, { ...common(IDS.retired, 2_000, daysAgo(1)) }), ctx)).message).toContain("dado de baja")
    expect(failure(await createRecord(await preventive(IDS.mecBio, { ...common("v-inexistente", 2_000, daysAgo(1)) }), ctx)).field).toBe("vehicleId")
    expect(failure(await createRecord(await preventive(IDS.mecBio, { workDate: daysAgo(-2) }), ctx)).field).toBe("workDate")
    // La pauta en km sobre una excavadora que se mide en horas.
    const unit = failure(await createRecord(await preventive(IDS.mecBio, { ...common(IDS.machineBio, 1_000, daysAgo(1)) }), ctx))
    expect(unit.field).toBe("scheduleId")
    expect(unit.message).toContain("horas")
  })
})

describe("folio", () => {
  it("20 registros simultáneos en la misma faena y tipo reciben 20 folios distintos", async () => {
    const ctx = await contextOf(IDS.mecBio)
    // Dos equipos de Biodiversa, misma lectura: el cuello de botella es el contador, no la validación.
    const inputs = []
    for (let index = 0; index < 20; index++) {
      inputs.push(await corrective(IDS.mecBio, index % 2 === 0 ? {} : { ...common(IDS.machineBio, 1_000, daysAgo(2)) }))
    }
    const outcomes = await Promise.all(inputs.map((input) => createRecord(input, ctx)))
    const folios = outcomes.map((outcome) => success(outcome).folio)
    expect(new Set(folios).size).toBe(20)
    expect([...folios].sort()).toEqual(Array.from({ length: 20 }, (_, index) => `MC-BIO-${String(index + 1).padStart(4, "0")}`))
    const [counter] = await testDb.select().from(schema.mantFolioCounters).where(eq(schema.mantFolioCounters.kind, "C"))
    expect(counter?.last).toBe(20)
  })

  it("una faena sin código de folio lo recibe al primer registro", async () => {
    const ctx = await contextOf(IDS.mecCho)
    expect(await testDb.select().from(schema.mantWorksiteSettings).where(eq(schema.mantWorksiteSettings.worksiteId, IDS.wsCho))).toHaveLength(0)
    const body = success(await createRecord(await corrective(IDS.mecCho, { ...common(IDS.truckCho, 21_000, daysAgo(2)) }), ctx))
    expect(body.folio).toBe("MC-CHO-0001")
    const [settings] = await testDb.select().from(schema.mantWorksiteSettings).where(eq(schema.mantWorksiteSettings.worksiteId, IDS.wsCho))
    expect(settings?.folioCode).toBe("CHO")
  })

  it("preventivas y correctivas llevan correlativos independientes", async () => {
    const ctx = await contextOf(IDS.mecBio)
    expect(success(await createRecord(await preventive(IDS.mecBio), ctx)).folio).toBe("MP-BIO-0001")
    expect(success(await createRecord(await corrective(IDS.mecBio), ctx)).folio).toBe("MC-BIO-0001")
  })
})

describe("registro correctivo", () => {
  it("guarda nombres (snapshot) de tipos de trabajo, aceites y conductores", async () => {
    const ctx = await contextOf(IDS.mecBio)
    const input = await corrective(IDS.mecBio, { jobs: [job(IDS.wtMec, 8), job(IDS.wtSold, 6)], driverIds: [IDS.driver1, IDS.driver2] })
    const body = success(await createRecord(input, ctx))
    expect(body.warnings.map((warning) => warning.code)).toEqual(["hours_over_12"])
    const [detail] = await testDb.select().from(schema.mantRecordCorrectives).where(eq(schema.mantRecordCorrectives.recordId, input.id))
    expect(detail).toMatchObject({ workTypes: ["Mecánico", "Soldadura"], oils: ["Motor"], hours: 14, inWorkshop: false, noParts: false })
    const jobs = await testDb.select().from(schema.mantRecordJobs).where(eq(schema.mantRecordJobs.recordId, input.id)).orderBy(asc(schema.mantRecordJobs.sortOrder))
    expect(jobs.map((row) => [row.workTypeName, row.hours])).toEqual([["Mecánico", 8], ["Soldadura", 6]])
    const parts = await testDb.select().from(schema.mantRecordParts).where(eq(schema.mantRecordParts.recordId, input.id))
    expect(parts).toHaveLength(2)
    expect(parts.every((part) => part.jobId !== null && jobs.some((row) => row.id === part.jobId))).toBe(true)
    const drivers = await testDb.select().from(schema.mantRecordDrivers).where(eq(schema.mantRecordDrivers.recordId, input.id))
    expect(drivers.map((driver) => driver.driverName).sort()).toEqual(["AEDO POLANCO JOSE A.", "BELTRAN IRARRAZAVAL HECTOR A."])
  })

  it("«No se cambió aceite» y «No se usaron repuestos» son excluyentes de su lista", async () => {
    const ctx = await contextOf(IDS.mecBio)
    expect(failure(await createRecord(await corrective(IDS.mecBio, { oilIds: [], noOilChange: false }), ctx)).field).toBe("oilIds")
    expect(failure(await createRecord(await corrective(IDS.mecBio, { noOilChange: true }), ctx)).field).toBe("oilIds")
    success(await createRecord(await corrective(IDS.mecBio, { oilIds: [], noOilChange: true, jobs: [job(IDS.wtMec, 2, { parts: [], noParts: true })] }), ctx))
  })

  it("repuestos por trabajo: cada uno lleva repuestos o «No se usaron», nunca ambos ni ninguno", async () => {
    const ctx = await contextOf(IDS.mecBio)
    const sinNada = job(IDS.wtMec, 2, { parts: [], noParts: false })
    const ambos = job(IDS.wtMec, 2, { noParts: true })
    expect(failure(await createRecord(await corrective(IDS.mecBio, { jobs: [sinNada] }), ctx)).field).toBe("jobs")
    expect(failure(await createRecord(await corrective(IDS.mecBio, { jobs: [ambos] }), ctx)).field).toBe("jobs")
    // El segundo trabajo es el que no cumple: el primero, bien, no lo salva.
    expect(failure(await createRecord(await corrective(IDS.mecBio, { jobs: [job(IDS.wtMec, 2), { ...sinNada, workTypeId: IDS.wtSold }] }), ctx)).field).toBe("jobs")
    const mixto = await corrective(IDS.mecBio, { jobs: [job(IDS.wtMec, 2), job(IDS.wtSold, 1, { parts: [], noParts: true })] })
    success(await createRecord(mixto, ctx))
    const [row] = await testDb.select().from(schema.mantRecordCorrectives).where(eq(schema.mantRecordCorrectives.recordId, mixto.id))
    expect(row).toMatchObject({ hours: 3, noParts: false })
  })

  it("trabajos: un tipo no se repite y el total no pasa de 72 horas", async () => {
    const ctx = await contextOf(IDS.mecBio)
    // El servidor revalida aunque el contrato ya lo exija: se arma el registro sin pasar por zod.
    const forced = async (jobs: unknown[]) => ({ ...(await corrective(IDS.mecBio)), jobs }) as unknown as SyncRecord
    expect(failure(await createRecord(await forced([job(IDS.wtMec, 1), job(IDS.wtMec, 2)]), ctx)).field).toBe("jobs")
    expect(failure(await createRecord(await forced([job(IDS.wtMec, 40), job(IDS.wtSold, 32.5)]), ctx)).field).toBe("jobs")
    expect(failure(await createRecord(await forced([job(IDS.wtMec, 0.25)]), ctx)).field).toBe("jobs")
    success(await createRecord(await corrective(IDS.mecBio, { jobs: [job(IDS.wtMec, 40), job(IDS.wtSold, 32)] }), ctx))
  })

  it("quién hizo el trabajo: otro mecánico con la app, taller externo; nunca uno sin permiso ni el mismo autor", async () => {
    const ctx = await contextOf(IDS.mecBio)
    const other = await corrective(IDS.mecBio, { executor: { kind: "otro_mecanico", userId: IDS.mecBio2 } })
    success(await createRecord(other, ctx))
    const [row] = await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, other.id))
    expect(row).toMatchObject({ registeredBy: IDS.mecBio, executorKind: "otro_mecanico", executorUserId: IDS.mecBio2, executorName: "Deivis González" })

    const external = await corrective(IDS.mecBio, { executor: { kind: "externo", workshopId: IDS.workshop } })
    success(await createRecord(external, ctx))
    const [ext] = await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, external.id))
    expect(ext).toMatchObject({ executorKind: "externo", executorWorkshopId: IDS.workshop, executorUserId: null, executorName: "Maestranza Melo" })

    for (const userId of [IDS.plain, IDS.inactive, IDS.mecBio]) {
      const refused = failure(await createRecord(await corrective(IDS.mecBio, { executor: { kind: "otro_mecanico", userId } }), ctx))
      expect(refused).toMatchObject({ code: "rejected", field: "executor" })
    }
  })

  it("en taller exige fecha de ingreso no futura, y un catálogo desconocido se rechaza", async () => {
    const ctx = await contextOf(IDS.mecBio)
    expect(failure(await createRecord(await corrective(IDS.mecBio, { inWorkshop: true, workshopEntryDate: null }), ctx)).field).toBe("workshopEntryDate")
    expect(failure(await createRecord(await corrective(IDS.mecBio, { inWorkshop: true, workshopEntryDate: daysAgo(-3) }), ctx)).field).toBe("workshopEntryDate")
    // «Sí sigue en taller» exige el motivo (≥ 5 caracteres) además de la fecha.
    expect(failure(await createRecord(await corrective(IDS.mecBio, { inWorkshop: true, workshopEntryDate: daysAgo(2) }), ctx)).field).toBe("workshopReason")
    expect(failure(await createRecord(await corrective(IDS.mecBio, { inWorkshop: true, workshopEntryDate: daysAgo(2), workshopReason: " abc " }), ctx)).field).toBe("workshopReason")
    const staying = await corrective(IDS.mecBio, { inWorkshop: true, workshopEntryDate: daysAgo(2), workshopReason: "Espera un repuesto importado" })
    success(await createRecord(staying, ctx))
    const [saved] = await testDb.select().from(schema.mantRecordCorrectives).where(eq(schema.mantRecordCorrectives.recordId, staying.id))
    expect(saved?.workshopReason).toBe("Espera un repuesto importado")
    // Si ya salió, el motivo no se guarda aunque llegue.
    const left = await corrective(IDS.mecBio, { workshopReason: "no corresponde" })
    success(await createRecord(left, ctx))
    const [notSaved] = await testDb.select().from(schema.mantRecordCorrectives).where(eq(schema.mantRecordCorrectives.recordId, left.id))
    expect(notSaved?.workshopReason).toBeNull()

    expect(failure(await createRecord(await corrective(IDS.mecBio, { jobs: [job("wt-fantasma", 1)] }), ctx)).field).toBe("jobs")
    expect(failure(await createRecord(await corrective(IDS.mecBio, { driverIds: ["dr-fantasma"] }), ctx)).field).toBe("driverIds")
  })

  it("el mecánico de otra faena registra con `out_of_worksite`; la jefatura global no", async () => {
    const outside = await corrective(IDS.mecCho)
    const body = success(await createRecord(outside, await contextOf(IDS.mecCho)))
    expect(body.warnings.map((warning) => warning.code)).toContain("out_of_worksite")
    const [row] = await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, outside.id))
    expect(row).toMatchObject({ outOfWorksite: true, worksiteId: IDS.wsBio, registeredBy: IDS.mecCho })

    const global = await corrective(IDS.jefe, { ...common(IDS.truckBio, 12_500, daysAgo(1)) })
    expect(success(await createRecord(global, await contextOf(IDS.jefe))).warnings).toEqual([])
    const [own] = await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, global.id))
    expect(own?.outOfWorksite).toBe(false)
  })
})

describe("ciclo de vida", () => {
  async function seedRecord(userId = IDS.mecBio) {
    const input = await corrective(userId)
    success(await createRecord(input, await contextOf(userId)))
    return input.id
  }

  it("anular exige permiso y motivo, invalida el PDF, deja el registro visible y lo saca de las lecturas", async () => {
    const id = await seedRecord()
    await testDb.update(schema.mantRecords).set({ pdfStorageKey: "storage/mantencion/x.pdf" }).where(eq(schema.mantRecords.id, id))
    const jefe = (await contextOf(IDS.jefe)).viewer

    expect((await voidRecord({ recordId: id, reason: "Error de digitación", viewer: (await contextOf(IDS.mecBio)).viewer })).ok).toBe(false)
    expect((await voidRecord({ recordId: id, reason: "no", viewer: jefe })).ok).toBe(false)
    expect((await voidRecord({ recordId: id, reason: "Error de digitación", viewer: jefe })).ok).toBe(true)
    expect((await voidRecord({ recordId: id, reason: "Otra vez", viewer: jefe })).ok).toBe(false)

    const [row] = await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, id))
    expect(row).toMatchObject({ status: "anulado", pdfStorageKey: null })
    expect(await testDb.select().from(schema.mantRecordVoids).where(eq(schema.mantRecordVoids.recordId, id))).toHaveLength(1)
    const [audit] = await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, id), eq(schema.auditLog.action, "cancel")))
    expect(audit).toMatchObject({ entityType: "mant_record", reason: "Error de digitación", userId: IDS.jefe })

    // Anulada, su lectura (12.000) ya no cuenta: una menor es válida de nuevo.
    success(await createRecord(await corrective(IDS.mecBio, { ...common(IDS.truckBio, 11_000, daysAgo(1)) }), await contextOf(IDS.mecBio)))
  })

  it("observar: el supervisor sólo en su faena; marca «observado»; revisar es sólo de jefatura", async () => {
    const bioId = await seedRecord()
    const choInput = await corrective(IDS.mecCho, { ...common(IDS.truckCho, 21_000, daysAgo(2)) })
    success(await createRecord(choInput, await contextOf(IDS.mecCho)))
    const sup = (await contextOf(IDS.supBio)).viewer
    const jefe = (await contextOf(IDS.jefe)).viewer

    expect((await observeRecord({ recordId: choInput.id, text: "Revisar el torque", viewer: sup })).ok).toBe(false)
    expect((await observeRecord({ recordId: bioId, text: "x", viewer: sup })).ok).toBe(false)
    expect((await observeRecord({ recordId: bioId, text: "Falta detallar la manguera", viewer: (await contextOf(IDS.mecBio)).viewer })).ok).toBe(false)
    expect((await observeRecord({ recordId: bioId, text: "Falta detallar la manguera", viewer: sup })).ok).toBe(true)
    expect((await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, bioId)))[0]?.review).toBe("observado")

    expect((await markRecordReviewed({ recordId: bioId, viewer: sup })).ok).toBe(false)
    expect((await markRecordReviewed({ recordId: bioId, viewer: jefe })).ok).toBe(true)
    expect((await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, bioId)))[0]?.review).toBe("revisado")
  })

  it("el mecánico responde una vez, sólo quien registró; la bitácora lo anota", async () => {
    const id = await seedRecord()
    await observeRecord({ recordId: id, text: "Falta detallar la manguera", viewer: (await contextOf(IDS.supBio)).viewer })
    const [observation] = await testDb.select().from(schema.mantRecordObservations).where(eq(schema.mantRecordObservations.recordId, id))
    const observationId = observation!.id

    expect((await replyObservation({ observationId, response: "Era la manguera trasera", userId: IDS.mecBio2 })).ok).toBe(false)
    expect((await replyObservation({ observationId, response: "x", userId: IDS.mecBio })).ok).toBe(false)
    expect((await replyObservation({ observationId, response: "Era la manguera trasera", userId: IDS.mecBio })).ok).toBe(true)
    // Reintento idéntico (se perdió la confirmación): sigue siendo ok; otra respuesta no.
    expect((await replyObservation({ observationId, response: "Era la manguera trasera", userId: IDS.mecBio })).ok).toBe(true)
    expect((await replyObservation({ observationId, response: "Mejor otra cosa", userId: IDS.mecBio })).ok).toBe(false)

    const [saved] = await testDb.select().from(schema.mantRecordObservations).where(eq(schema.mantRecordObservations.id, observationId))
    expect(saved).toMatchObject({ response: "Era la manguera trasera", respondedBy: IDS.mecBio })
    const audits = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_record_observation"))
    expect(audits).toHaveLength(1)
  })
})

describe("versión de pauta", () => {
  it("un registro firmado con una versión anterior se valida contra ELLA y avisa que la pauta cambió", async () => {
    const ctx = await contextOf(IDS.mecBio)
    await testDb.transaction((tx) => publishScheduleVersion(tx, { scheduleId: IDS.schH, userId: IDS.jefe, summary: "Cambio de prueba" }))
    // 1.000 h con base 300 → punto 900 → toca la de 300 h.
    const input = await preventive(IDS.mecBio, {
      ...common(IDS.machineBio, 1_000, daysAgo(1)), scheduleId: IDS.schH, scheduleVersion: 1, intervalValue: 300, suggestedIntervalValue: 300,
      items: [{ itemKey: "h1", value: "R", reason: null }],
    })
    const body = success(await createRecord(input, ctx))
    expect(body.warnings.map((warning) => warning.code)).toContain("schedule_outdated")
    const [row] = await testDb.select().from(schema.mantRecords).where(eq(schema.mantRecords.id, input.id))
    expect(row).toMatchObject({ scheduleVersion: 1, scheduleId: IDS.schH })
  })
})
