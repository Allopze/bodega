/**
 * Carga de otro día (rediseño de Combustible, 2026-10-31) contra Postgres real
 * (PGlite con todas las migraciones): una carga registrada con fecha pasada se
 * intercala en la serie del equipo y no debe romperla.
 *
 * Cubre: la fuente `backdated` con su motivo, el permiso, la ventana de 62 días,
 * la lectura contra la carga anterior y la siguiente, la cadena de sellos de la
 * siguiente, la posible duplicada del mismo origen, las decisiones ya tomadas
 * sobre cargas posteriores y la marca `late_entry` que lleva la carga a «Por
 * revisar».
 */

import { createHash } from "node:crypto"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, asc, eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import type { Tx } from "@/db"
import { createInternalFieldLoad, createTaeSubmission, registerFieldLoad, reviewTaeSubmission } from "@/lib/services/fuel-tae"
import { TaeSubmissionRejected } from "@/lib/services/fuel-tae/errors"
import { isPastLoadNotAllowed, isPossibleDuplicateLoad, MAX_PAST_LOAD_DAYS } from "@/lib/combustibles/field-load-rules"
import { readTaeFacts } from "@/lib/combustibles/control/projection-sources"
import { decideFlaggedLoad } from "@/lib/combustibles/control/review"
import { STALE_DECISION_REASON } from "@/lib/combustibles/control/stale-decisions"
import { addDaysToPlainDate, chileLocalDateTimeToUtc, todayInChile } from "@/lib/utils"

const tx = inMemoryDb as unknown as Tx

const WORKSITE = nanoid()
const USER = nanoid()
const PRODUCT = nanoid()
const TYPE = nanoid()
const POINT = nanoid()
const LINK_TOKEN = "past-load-link-token-1234567890"
const REASON = "Se anotó en papel en la faena y no se ingresó a tiempo"

function session(permissions: string[] = ["combustibles:approve_flagged"]): Session {
  return {
    user: {
      id: USER, name: "Jefa", email: "jefa@example.com", roles: ["jefa_chome"], permissions,
      worksiteIds: [WORKSITE], primaryWorksiteId: WORKSITE, avatarColor: null, isActive: true, isGlobal: false,
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as Session
}

/** Hora de pared de Chile de hace `daysAgo` días: `2026-10-12T14:30`. */
const localAt = (daysAgo: number, time = "10:00") => `${addDaysToPlainDate(todayInChile(), -daysAgo)}T${time}`

let vehicleSeq = 0
/** Un equipo nuevo por prueba: la serie de cada una arranca vacía y no se contaminan entre sí. */
async function newVehicle(meterType: "odometer" | "none" = "odometer") {
  vehicleSeq += 1
  const id = nanoid()
  await inMemoryDb.insert(schema.fuelVehicles).values({
    id, plate: `PL${vehicleSeq}${nanoid().slice(0, 3).toUpperCase()}`, code: `PL-${vehicleSeq}`, type: "camion", equipmentTypeId: TYPE,
    worksiteId: WORKSITE, isActive: true, meterType, tankCapacityLiters: 500, performanceUnit: "km_per_liter",
  })
  await inMemoryDb.insert(schema.fuelVehicleProducts).values({ vehicleId: id, productId: PRODUCT })
  return id
}

interface LoadOptions {
  vehicleId: string
  daysAgo?: number
  time?: string
  reading?: number | null
  liters?: number
  removed?: string
  installed?: string
  acknowledgeDuplicate?: boolean
  clientSubmissionId?: string
  reason?: string
  /** Sin `daysAgo` la carga es de hoy (la hora la pone el servidor). */
  allowPastLoad?: boolean
}

const photo = (kind: "odometer" | "liter_meter" | "removed_seal" | "installed_seal") => ({ kind, fileName: `${kind}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from([1, 2, 3]) })
const FOUR_PHOTOS = (["odometer", "liter_meter", "removed_seal", "installed_seal"] as const).map(photo)

function internalInput(options: LoadOptions) {
  return {
    clientSubmissionId: options.clientSubmissionId ?? nanoid(20),
    worksiteId: WORKSITE,
    loadingPointId: POINT,
    vehicleId: options.vehicleId,
    productId: PRODUCT,
    supplyMediumId: "fsm-tae",
    equipmentCode: "PL-1",
    plate: null,
    offline: false,
    driverWorkerId: "",
    driverName: "Conductor Uno",
    supervisorWorkerId: "",
    supervisorName: "Supervisor Uno",
    manualIdentity: false,
    meterType: "odometer" as const,
    meterReading: options.reading === undefined ? 1000 : options.reading,
    meterUnavailableReason: null,
    liters: options.liters ?? 100,
    removedSealNumber: options.removed ?? "S-0",
    installedSealNumber: options.installed ?? "S-1",
    noSealReason: null,
    notes: null,
    acknowledgeDuplicate: options.acknowledgeDuplicate ?? false,
    pastLoad: options.daysAgo == null ? null : { loadedAt: localAt(options.daysAgo, options.time), reason: options.reason ?? REASON },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

/** Carga de otro día, sin fotos (opcionales), con el permiso concedido. */
function pastLoad(options: LoadOptions) {
  return createInternalFieldLoad({ userId: USER, input: internalInput(options), evidence: [], allowPastLoad: options.allowPastLoad ?? true })
}

async function rejection(promise: Promise<unknown>) {
  try { await promise } catch (error) { return error }
  return null
}

const submissionRow = async (id: string) =>
  (await inMemoryDb.select().from(schema.fuelTaeSubmissions).where(eq(schema.fuelTaeSubmissions.id, id)))[0]!
const loadRow = async (submissionId: string) =>
  (await inMemoryDb.select().from(schema.fuelEquipmentLoads).where(eq(schema.fuelEquipmentLoads.taeSubmissionId, submissionId)))[0]!
const submissionsOf = (vehicleId: string) =>
  inMemoryDb.select().from(schema.fuelTaeSubmissions).where(eq(schema.fuelTaeSubmissions.vehicleId, vehicleId)).orderBy(asc(schema.fuelTaeSubmissions.loadedAt))
const auditsFor = (entityType: string, entityId: string) =>
  inMemoryDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityType, entityType), eq(schema.auditLog.entityId, entityId)))

describe("carga de otro día (PostgreSQL integration)", () => {
  beforeAll(async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: WORKSITE, name: "Faena Pasada", code: `FP-${nanoid().slice(0, 6)}`, isActive: true })
    await inMemoryDb.insert(schema.users).values({ id: USER, name: "Jefa", email: `jefa-${nanoid()}@example.com`, hashedPassword: "x", isActive: true })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: TYPE, slug: `camion-${nanoid().slice(0, 6)}`, name: "Camión" })
    await inMemoryDb.insert(schema.fuelProducts).values({ id: PRODUCT, code: `DIESEL-${nanoid().slice(0, 6)}`, name: "Diésel", category: "diesel", unit: "liter" })
    await inMemoryDb.insert(schema.fuelTaeLoadingPoints).values({ id: POINT, worksiteId: WORKSITE, name: "Surtidor", type: "fixed_dispenser" })
    await inMemoryDb.insert(schema.fuelTaePublicLinks).values({
      id: nanoid(), worksiteId: WORKSITE, loadingPointId: POINT, label: "Vigente",
      tokenHash: createHash("sha256").update(LINK_TOKEN).digest("hex"), createdBy: USER,
    })
  })

  afterAll(async () => {
    delete testGlobal.__db
    await pg.close()
  })

  it("guarda la fecha elegida (hora de Chile), la fuente `backdated`, el motivo y quién la registró; fotos opcionales", async () => {
    const vehicleId = await newVehicle()
    const before = Date.now()
    const result = await pastLoad({ vehicleId, daysAgo: 3, time: "10:30", reading: 5000 })

    const row = await submissionRow(result.id)
    expect(row).toMatchObject({
      source: "internal_app",
      loadedAtSource: "backdated",
      backdateReason: REASON,
      registeredBy: USER,
      meterReading: 5000,
    })
    expect(new Date(row.loadedAt).toISOString()).toBe(chileLocalDateTimeToUtc(localAt(3, "10:30")))
    // El día en que se ingresó queda aparte: es lo que dice «registrada después».
    expect(new Date(row.submittedAt).getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect(await inMemoryDb.select().from(schema.fuelTaeEvidence).where(eq(schema.fuelTaeEvidence.submissionId, result.id))).toHaveLength(0)

    const audit = await auditsFor("fuel_tae_submission", result.id)
    expect(audit).toHaveLength(1)
    expect(audit[0]!.reason).toContain(`Carga de otro día: ${REASON}`)
    expect(JSON.parse(audit[0]!.newState!)).toMatchObject({ loadedAtSource: "backdated", backdateReason: REASON })
  })

  it("la carga normal sigue exigiendo sus fotos y trae la hora del servidor; la de otro día no las exige", async () => {
    const vehicleId = await newVehicle()
    const missing = await rejection(createInternalFieldLoad({ userId: USER, input: internalInput({ vehicleId }), evidence: [] }))
    expect(missing).toBeInstanceOf(TaeSubmissionRejected)
    expect(missing).toMatchObject({ code: "evidence_missing" })

    const normal = await createInternalFieldLoad({ userId: USER, input: internalInput({ vehicleId }), evidence: FOUR_PHOTOS })
    const row = await submissionRow(normal.id)
    expect(row).toMatchObject({ loadedAtSource: "server", backdateReason: null })
    expect((await loadRow(normal.id)).flagReasons).not.toContain("late_entry")

    const past = await pastLoad({ vehicleId, daysAgo: 1, reading: 900, liters: 80, removed: "S-0", installed: "S-1" })
    expect((await submissionRow(past.id)).loadedAtSource).toBe("backdated")
  })

  it("proyecta a la serie con la marca late_entry y queda «por decidir», con el motivo en la respuesta", async () => {
    const vehicleId = await newVehicle()
    const result = await pastLoad({ vehicleId, daysAgo: 5, reading: 2000 })
    const load = await loadRow(result.id)
    expect(load).toMatchObject({ source: "field", reviewStatus: "flagged", flagReasons: ["late_entry"], vehicleId })
    expect(load.month).toBe(addDaysToPlainDate(todayInChile(), -5).slice(0, 7))
    expect(result.review).toEqual({ loadId: load.id, status: "flagged", flagReasons: ["late_entry"] })

    // La proyección lee la fuente: sólo `backdated` lleva la marca.
    const [fact] = await readTaeFacts(tx, [result.id])
    expect(fact!.sourceFlags).toContain("late_entry")
    const normalVehicle = await newVehicle()
    const normal = await createInternalFieldLoad({ userId: USER, input: internalInput({ vehicleId: normalVehicle }), evidence: FOUR_PHOTOS })
    expect((await readTaeFacts(tx, [normal.id]))[0]!.sourceFlags).not.toContain("late_entry")
    expect(normal.review).toMatchObject({ status: "ok", flagReasons: [] })
  })

  it("quien registra la carga pasada puede decidirla: no hay regla de cuatro ojos", async () => {
    const vehicleId = await newVehicle()
    const result = await pastLoad({ vehicleId, daysAgo: 4, reading: 3000 })
    const load = await loadRow(result.id)
    expect((await submissionRow(result.id)).registeredBy).toBe(USER)

    const decision = await decideFlaggedLoad(session(), { loadId: load.id, decision: "approve", note: "La fecha del papel es correcta" })
    expect(decision).toEqual({ ok: true })
    expect(await loadRow(result.id)).toMatchObject({ reviewStatus: "approved", reviewedBy: USER, flagReasons: ["late_entry"] })
  })

  it("sin el permiso, la carga de otro día se rechaza y no deja rastro; el QR tampoco puede fechar", async () => {
    const vehicleId = await newVehicle()
    const denied = await rejection(pastLoad({ vehicleId, daysAgo: 2, allowPastLoad: false }))
    expect(isPastLoadNotAllowed(denied)).toBe(true)
    expect(await submissionsOf(vehicleId)).toHaveLength(0)

    // Aunque alguien arme el llamado a mano, el servicio no acepta pastLoad desde el QR.
    const viaPublicContext = await rejection(registerFieldLoad({
      context: { source: "public_pwa", worksiteId: WORKSITE, loadingPointId: POINT, registeredBy: null },
      input: internalInput({ vehicleId }),
      evidence: FOUR_PHOTOS,
      options: { pastLoad: { loadedAt: localAt(2), reason: REASON } },
    }))
    expect(isPastLoadNotAllowed(viaPublicContext)).toBe(true)
    expect(await submissionsOf(vehicleId)).toHaveLength(0)

    // Y si a `createTaeSubmission` le llega un `pastLoad` suelto, lo ignora: la hora la pone el servidor.
    const before = Date.now()
    const viaQr = await createTaeSubmission({
      accessToken: LINK_TOKEN,
      input: { ...internalInput({ vehicleId, daysAgo: 30 }) },
      evidence: FOUR_PHOTOS,
    })
    const row = await submissionRow(viaQr.id)
    expect(row).toMatchObject({ source: "public_pwa", loadedAtSource: "server", backdateReason: null })
    expect(new Date(row.loadedAt).getTime()).toBeGreaterThanOrEqual(before - 1000)
    expect(viaQr).not.toHaveProperty("review")
  })

  it("la ventana: el día 62 se acepta, el 63 y el futuro se rechazan sin escribir nada", async () => {
    expect(MAX_PAST_LOAD_DAYS).toBe(62)
    const vehicleId = await newVehicle()
    const oldest = await pastLoad({ vehicleId, daysAgo: 62, time: "00:00", reading: 100 })
    expect((await submissionRow(oldest.id)).loadedAtSource).toBe("backdated")

    const tooOld = await rejection(pastLoad({ vehicleId, daysAgo: 63, time: "23:59", reading: 100 }))
    expect(tooOld).toBeInstanceOf(TaeSubmissionRejected)
    expect(tooOld).toMatchObject({ status: 422, code: "invalid_time", field: "pastLoadAt" })
    expect((tooOld as Error).message).toContain("62 días")

    const future = await rejection(pastLoad({ vehicleId, daysAgo: -1, reading: 200 }))
    expect(future).toMatchObject({ status: 422, code: "invalid_time" })
    expect((future as Error).message).toContain("futuras")

    const shortReason = await rejection(pastLoad({ vehicleId, daysAgo: 10, reading: 300, reason: "olvido" }))
    expect(shortReason).toMatchObject({ code: "invalid_time", field: "pastLoadReason" })
    expect(await submissionsOf(vehicleId)).toHaveLength(1)
  })

  it("la lectura respeta a los dos vecinos: no puede ser menor que la anterior ni mayor que la siguiente", async () => {
    const vehicleId = await newVehicle()
    await pastLoad({ vehicleId, daysAgo: 20, reading: 1000, removed: "S-0", installed: "S-1" })
    await pastLoad({ vehicleId, daysAgo: 10, reading: 1200, removed: "S-1", installed: "S-2" })

    const below = await rejection(pastLoad({ vehicleId, daysAgo: 15, reading: 900 }))
    expect(below).toMatchObject({ status: 422, code: "meter_regression", field: "meterReading" })
    expect((below as Error).message).toContain("1.000")
    expect((below as Error).message).toContain("menor que la última")

    const above = await rejection(pastLoad({ vehicleId, daysAgo: 15, reading: 1300 }))
    expect(above).toMatchObject({ status: 422, code: "meter_regression", field: "meterReading" })
    expect((above as Error).message).toContain("1.200")
    expect((above as Error).message).toContain("carga siguiente")
    expect(await submissionsOf(vehicleId)).toHaveLength(2)

    // Entre las dos, y también igual a cualquiera de ellas.
    const between = await pastLoad({ vehicleId, daysAgo: 15, reading: 1100, removed: "S-1", installed: "S-9" })
    expect(between.id).toBeTruthy()
    const equalToNext = await pastLoad({ vehicleId, daysAgo: 12, reading: 1200, liters: 60, removed: "S-9", installed: "S-10" })
    expect(equalToNext.id).toBeTruthy()
  })

  it("una siguiente que inició serie nueva por cambio de tablero no es tope de la lectura", async () => {
    const vehicleId = await newVehicle()
    await pastLoad({ vehicleId, daysAgo: 20, reading: 1000 })
    const reset = await pastLoad({ vehicleId, daysAgo: 10, reading: 1500, removed: "S-1", installed: "S-2" })
    // Un revisor declaró «cambio de tablero» en esa carga: su lectura reinicia la serie en 20.
    await inMemoryDb.update(schema.fuelTaeSubmissions).set({ meterReading: 20, rawRow: { meterReset: true } }).where(eq(schema.fuelTaeSubmissions.id, reset.id))
    // 1.400 supera el 20 de la siguiente, pero esa lectura es otra serie: no la limita.
    const between = await pastLoad({ vehicleId, daysAgo: 15, reading: 1400, removed: "S-1", installed: "S-1B" })
    expect(between.id).toBeTruthy()
    // Sin el reinicio, la misma lectura sí se rechaza.
    const vehicleNoReset = await newVehicle()
    await pastLoad({ vehicleId: vehicleNoReset, daysAgo: 20, reading: 1000 })
    await pastLoad({ vehicleId: vehicleNoReset, daysAgo: 10, reading: 1500, removed: "S-1", installed: "S-2" })
    expect(await rejection(pastLoad({ vehicleId: vehicleNoReset, daysAgo: 15, reading: 1600 }))).toMatchObject({ code: "meter_regression" })
  })

  it("la cadena de sellos de la carga siguiente se evalúa de nuevo con la que se intercala", async () => {
    const vehicleId = await newVehicle()
    const first = await pastLoad({ vehicleId, daysAgo: 20, reading: 1000, removed: "S-0", installed: "S-1" })
    const last = await pastLoad({ vehicleId, daysAgo: 10, reading: 1200, removed: "S-1", installed: "S-2" })
    expect(await submissionRow(first.id)).toMatchObject({ sealChainStatus: "no_previous" })
    expect(await submissionRow(last.id)).toMatchObject({ sealChainStatus: "ok", sealChainExpected: null })

    // Entre ambas se cargó otro sello: la última ya no retiró el sello que dejó la anterior.
    const middle = await pastLoad({ vehicleId, daysAgo: 15, reading: 1100, removed: "S-1", installed: "S-9" })
    expect(await submissionRow(middle.id)).toMatchObject({ sealChainStatus: "ok", sealChainExpected: null })
    expect(await submissionRow(last.id)).toMatchObject({ sealChainStatus: "mismatch", sealChainExpected: "S-9" })
    const audit = await auditsFor("fuel_tae_submission", last.id)
    const reevaluated = audit.find((entry) => entry.action === "update")
    expect(reevaluated).toBeDefined()
    expect(JSON.parse(reevaluated!.oldState!)).toMatchObject({ sealChainStatus: "ok" })
    expect(JSON.parse(reevaluated!.newState!)).toMatchObject({ sealChainStatus: "mismatch", sealChainExpected: "S-9" })
    expect(reevaluated!.reason).toContain("cadena de sellos")

    // Una intercalada que deja el sello que la siguiente retiró no cambia nada ni audita.
    const other = await newVehicle()
    await pastLoad({ vehicleId: other, daysAgo: 20, reading: 1000, removed: "A-0", installed: "A-1" })
    const tail = await pastLoad({ vehicleId: other, daysAgo: 10, reading: 1200, removed: "A-2", installed: "A-3" })
    expect(await submissionRow(tail.id)).toMatchObject({ sealChainStatus: "mismatch", sealChainExpected: "A-1" })
    await pastLoad({ vehicleId: other, daysAgo: 15, reading: 1100, removed: "A-1", installed: "A-2" })
    expect(await submissionRow(tail.id)).toMatchObject({ sealChainStatus: "ok", sealChainExpected: null })
  })

  it("una carga del mismo equipo cercana en tiempo y litros responde possible_duplicate, salvo que se confirme", async () => {
    const vehicleId = await newVehicle()
    const original = await pastLoad({ vehicleId, daysAgo: 10, time: "10:00", reading: 1000, liters: 120 })

    const similar = await rejection(pastLoad({ vehicleId, daysAgo: 10, time: "10:05", reading: 1010, liters: 120.3, removed: "S-1", installed: "S-2" }))
    expect(isPossibleDuplicateLoad(similar)).toBe(true)
    if (isPossibleDuplicateLoad(similar)) {
      expect(similar.status).toBe(422)
      expect(similar.duplicateOf).toMatchObject({ id: original.id, liters: 120, href: `/combustibles/cargas/terreno/${original.id}` })
      expect(similar.message).toContain("120 L")
    }
    expect(await submissionsOf(vehicleId)).toHaveLength(1)

    // Fuera de la ventana de duplicadas, o con otros litros, no es sospechosa.
    expect((await pastLoad({ vehicleId, daysAgo: 10, time: "11:30", reading: 1050, liters: 120, removed: "S-1", installed: "S-2" })).id).toBeTruthy()
    expect((await pastLoad({ vehicleId, daysAgo: 9, time: "10:00", reading: 1100, liters: 150, removed: "S-2", installed: "S-3" })).id).toBeTruthy()

    // Confirmada, se registra; y reenviar la misma confirmación devuelve la misma carga sin toparse consigo misma.
    const clientSubmissionId = nanoid(20)
    const confirmed = await pastLoad({ vehicleId, daysAgo: 10, time: "10:08", reading: 1020, liters: 120, removed: "S-3", installed: "S-4", acknowledgeDuplicate: true, clientSubmissionId })
    expect(confirmed.duplicate).toBe(false)
    const retried = await pastLoad({ vehicleId, daysAgo: 10, time: "10:08", reading: 1020, liters: 120, removed: "S-3", installed: "S-4", clientSubmissionId })
    expect(retried).toMatchObject({ id: confirmed.id, duplicate: true })
  })

  it("las decisiones ya tomadas sobre cargas posteriores cuya serie cambió vuelven a «por decidir», con auditoría", async () => {
    const vehicleId = await newVehicle()
    await pastLoad({ vehicleId, daysAgo: 30, reading: 1000, liters: 100, removed: "S-0", installed: "S-1" })
    const later = await pastLoad({ vehicleId, daysAgo: 20, reading: 1300, liters: 100, removed: "S-1", installed: "S-2" })
    const last = await pastLoad({ vehicleId, daysAgo: 10, reading: 1500, liters: 100, removed: "S-2", installed: "S-3" })

    // La jefatura decide las dos cargas de otro día: «cuenta».
    for (const id of [later.id, last.id]) {
      const load = await loadRow(id)
      expect(await decideFlaggedLoad(session(), { loadId: load.id, decision: "approve", note: "La fecha del papel es correcta" })).toEqual({ ok: true })
    }
    const decidedLater = await loadRow(later.id)
    const decidedLast = await loadRow(last.id)
    expect(decidedLater).toMatchObject({ reviewStatus: "approved", performanceStatus: "computed", meterDelta: 300 })

    // Se registra una carga que cae entre la primera y la segunda: cambia la serie de la segunda, no la de la tercera.
    const middle = await pastLoad({ vehicleId, daysAgo: 25, reading: 1100, liters: 60, removed: "S-1", installed: "S-1B" })

    const reopened = await loadRow(later.id)
    expect(reopened).toMatchObject({ reviewStatus: "flagged", flagReasons: ["late_entry"], reviewedBy: null, reviewedAt: null, reviewNote: null })
    expect(reopened.anchorLoadId).toBe((await loadRow(middle.id)).id)
    expect(reopened.meterDelta).toBe(200)
    // La tercera conserva su decisión: su serie no cambió.
    expect(await loadRow(last.id)).toMatchObject({ reviewStatus: "approved", reviewedBy: decidedLast.reviewedBy })

    const audit = (await auditsFor("fuel_equipment_load", reopened.id)).filter((entry) => entry.reason === STALE_DECISION_REASON)
    expect(audit).toHaveLength(1)
    expect(audit[0]!.reason!.toLowerCase()).toContain("se registró una carga anterior")
    expect(audit[0]).toMatchObject({ action: "status_change", worksiteId: WORKSITE, userId: USER })
    expect(JSON.parse(audit[0]!.oldState!)).toMatchObject({ reviewStatus: "approved", reviewNote: "La fecha del papel es correcta", reviewedBy: USER })
    expect(JSON.parse(audit[0]!.newState!)).toMatchObject({ reviewStatus: "flagged", flagReasons: ["late_entry"] })
    expect(await auditsFor("fuel_equipment_load", decidedLast.id).then((rows) => rows.filter((entry) => entry.reason === STALE_DECISION_REASON))).toHaveLength(0)
  })

  it("si la serie de las cargas posteriores no cambia, sus decisiones se conservan y no se audita nada", async () => {
    const vehicleId = await newVehicle()
    await pastLoad({ vehicleId, daysAgo: 30, reading: 1000, removed: "S-0", installed: "S-1" })
    const later = await pastLoad({ vehicleId, daysAgo: 10, reading: 1300, removed: "S-1", installed: "S-2" })
    const laterLoad = await loadRow(later.id)
    await decideFlaggedLoad(session(), { loadId: laterLoad.id, decision: "approve", note: "La fecha del papel es correcta" })

    // Una carga ANTERIOR a todas las del equipo sólo cambia a la primera, no a la ya decidida.
    await pastLoad({ vehicleId, daysAgo: 40, reading: 900, removed: "S-00", installed: "S-0" })
    expect(await loadRow(later.id)).toMatchObject({ reviewStatus: "approved" })
    expect((await auditsFor("fuel_equipment_load", laterLoad.id)).filter((entry) => entry.reason === STALE_DECISION_REASON)).toHaveLength(0)
  })

  it("una carga de otro día sin fotos no abre el caso «evidencia faltante» cuando la validan", async () => {
    await inMemoryDb.insert(schema.fuelAnomalyRules)
      .values({ id: nanoid(), code: "evidencia_faltante", name: "Evidencia faltante", severity: "medium", isActive: true })
      .onConflictDoNothing()
    const vehicleId = await newVehicle()
    const casesFor = (id: string) => inMemoryDb.select().from(schema.fuelAnomalyCases)
      .where(and(eq(schema.fuelAnomalyCases.ruleCode, "evidencia_faltante"), eq(schema.fuelAnomalyCases.referenceEntityId, id)))

    const past = await pastLoad({ vehicleId, daysAgo: 4, reading: 100 })
    await reviewTaeSubmission({ id: past.id, expectedStatus: "submitted", status: "validated", userId: USER })
    expect(await casesFor(past.id)).toHaveLength(0)

    // Control: la misma carga, de hoy y sin fotos, sí abre el caso (así la prueba no pasa por otra razón).
    const control = await pastLoad({ vehicleId, daysAgo: 3, reading: 200, removed: "S-1", installed: "S-2" })
    await inMemoryDb.update(schema.fuelTaeSubmissions).set({ loadedAtSource: "server", backdateReason: null }).where(eq(schema.fuelTaeSubmissions.id, control.id))
    await reviewTaeSubmission({ id: control.id, expectedStatus: "submitted", status: "validated", userId: USER })
    expect(await casesFor(control.id)).toHaveLength(1)
  })
})
