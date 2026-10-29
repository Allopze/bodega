import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import path from "node:path"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { MantCatalog, MantCatalogOthers } from "@/lib/mantencion/contracts"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { configureZodLocale } from "@/lib/validation/zod-locale"
import { daysAgo, IDS, insertOrphanPhoto, seedMantFixtures } from "./mantencion-sync-fixtures"
import { correctiveBody, getRequest, jsonRequest, preventiveBody, readJson } from "./mantencion-sync-http-helpers"

/**
 * Catálogo de la app (alcance por faena, ETag), actualizaciones de taller y
 * respuesta a observaciones por el endpoint Bearer. Postgres real (PGlite).
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const { issueDeviceCredential } = await import("@/lib/services/mantencion/device-credentials")
const { observeRecord } = await import("@/lib/services/mantencion/record-lifecycle")
const { getUserRbacById } = await import("@/lib/auth/rbac")
const catalogo = await import("@/app/api/mantencion/sync/catalogo/route")
const registros = await import("@/app/api/mantencion/sync/registros/route")
const taller = await import("@/app/api/mantencion/sync/taller/route")
const observaciones = await import("@/app/api/mantencion/sync/observaciones/route")

const tokens = new Map<string, string>()
async function tokenOf(userId: string): Promise<string> {
  const cached = tokens.get(userId)
  if (cached) return cached
  const { token } = await issueDeviceCredential({ userId, deviceId: crypto.randomUUID() })
  tokens.set(userId, token)
  return token
}

async function viewerOf(userId: string) {
  const rbac = (await getUserRbacById(userId, true))!
  return { userId: rbac.id, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal }
}

async function fetchCatalog(userId: string, query = "") {
  const response = await catalogo.GET(getRequest(`/api/mantencion/sync/catalogo${query}`, await tokenOf(userId)))
  expect(response.status).toBe(200)
  return { response, body: (await response.json()) as MantCatalog & MantCatalogOthers }
}

async function post(handler: { POST: (request: Request) => Promise<Response> }, path: string, userId: string, body: unknown) {
  const response = await handler.POST(jsonRequest(path, await tokenOf(userId), body))
  return { status: response.status, body: await readJson(response) }
}

async function createCorrective(userId: string, overrides: Record<string, unknown> = {}) {
  const photo = { id: crypto.randomUUID(), kind: "correctiva" }
  await insertOrphanPhoto(testDb, { id: photo.id, userId, kind: "correctiva" })
  const body = correctiveBody([photo], overrides)
  const result = await post(registros, "/api/mantencion/sync/registros", userId, body)
  expect(result.status).toBe(200)
  return { id: String(body.id), folio: String(result.body.folio) }
}

beforeAll(async () => {
  configureZodLocale()
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedMantFixtures(testDb)
})

beforeEach(async () => {
  for (const table of [
    schema.mantRecordObservations, schema.mantRecordVoids, schema.mantWorkshopUpdates, schema.mantRecordPhotos,
    schema.mantRecords, schema.mantFolioCounters, schema.auditLog, schema.rateLimits,
  ]) await testDb.delete(table)
})

describe("catálogo", () => {
  it("un mecánico recibe los equipos activos de SUS faenas; `alcance=todos` trae el resto, livianos", async () => {
    const { body } = await fetchCatalog(IDS.mecBio)
    expect(body.equipment.map((equipment) => equipment.code).sort()).toEqual(["KA-135", "MQ-01"])
    expect(body.worksites).toEqual([{ id: IDS.wsBio, name: "Biodiversa" }])
    expect(body.user).toMatchObject({ id: IDS.mecBio, name: "Javier Roa", worksiteIds: [IDS.wsBio] })
    expect(body.equipment.find((equipment) => equipment.code === "KA-999")).toBeUndefined()

    const truck = body.equipment.find((equipment) => equipment.code === "KA-135")!
    expect(truck).toMatchObject({ plate: "RBYD-98", unit: "km", brandName: "Scania", scheduleId: IDS.schKm, state: "al_dia", nextReading: 20_000, remaining: 10_000, noPlate: false })
    expect(truck.readings).toEqual([{ value: 10_000, date: daysAgo(200), source: "Lectura inicial" }])
    const machine = body.equipment.find((equipment) => equipment.code === "MQ-01")!
    expect(machine).toMatchObject({ unit: "h", noPlate: true })

    expect(body.schedules.map((schedule) => schedule.name).sort()).toEqual(["Camiones y tractos", "Maquinaria pesada"])
    expect(body.brands.map((brand) => brand.name).sort()).toEqual(["Scania", "Volvo"])
    expect(body.workTypes).toHaveLength(2)
    expect(body.oils).toHaveLength(2)
    expect(body.drivers).toHaveLength(2)
    expect(body.workshops).toEqual([{ id: IDS.workshop, name: "Maestranza Melo" }])
    // Otros mecánicos: activos, con la app y que comparten faena. Ni él mismo, ni el inactivo, ni el de otra faena.
    expect(body.mechanics).toEqual([{ id: IDS.mecBio2, name: "Deivis González" }, { id: IDS.supBio, name: "Francisco Amestica" }])

    const others = (await fetchCatalog(IDS.mecBio, "?alcance=todos")).body
    expect(others.equipment.map((equipment) => equipment.code).sort()).toEqual(["KA-200", "KA-300"])
    expect(others.equipment.every((equipment) => equipment.recentPreventives.length === 0 && equipment.workshop === null)).toBe(true)
    expect(others.equipment.find((equipment) => equipment.code === "KA-200")).toMatchObject({ brandName: "Volvo", worksiteName: "Cholguán" })
  })

  it("rol global sin faenas asignadas ve todas; sin permiso de lectura de equipos no ve flota ajena", async () => {
    const { body } = await fetchCatalog(IDS.jefe)
    expect(body.equipment.map((equipment) => equipment.code).sort()).toEqual(["KA-135", "KA-200", "KA-300", "MQ-01"])
    expect((await fetchCatalog(IDS.jefe, "?alcance=todos")).body.equipment).toHaveLength(0)
  })

  it("`alcance` inválido es un 422", async () => {
    const response = await catalogo.GET(getRequest("/api/mantencion/sync/catalogo?alcance=nada", await tokenOf(IDS.mecBio)))
    expect(response.status).toBe(422)
  })

  it("ETag: igual → 304 sin cuerpo; cambia cuando llega un registro, y es distinto por usuario y por alcance", async () => {
    const token = await tokenOf(IDS.mecBio)
    const first = await fetchCatalog(IDS.mecBio)
    const etag = first.response.headers.get("etag")!
    expect(etag).toBe(`"${first.body.version}"`)

    const same = await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", token, { "if-none-match": etag }))
    expect(same.status).toBe(304)
    expect(await same.text()).toBe("")
    const weak = await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", token, { "if-none-match": `W/${etag}, "otro"` }))
    expect(weak.status).toBe(304)
    expect((await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", token, { "if-none-match": '"viejo"' }))).status).toBe(200)

    expect((await fetchCatalog(IDS.mecBio2)).body.version).not.toBe(first.body.version)
    expect((await fetchCatalog(IDS.mecBio, "?alcance=todos")).body.version).not.toBe(first.body.version)

    const created = await createCorrective(IDS.mecBio)
    const after = await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", token, { "if-none-match": etag }))
    expect(after.status).toBe(200)
    const body = (await after.json()) as MantCatalog
    expect(body.version).not.toBe(first.body.version)
    expect(body.myRecords).toEqual([expect.objectContaining({ id: created.id, folio: created.folio, kind: "C", equipmentCode: "KA-135", status: "vigente", review: "pendiente", unit: "km" })])
    expect(body.equipment.find((equipment) => equipment.code === "KA-135")?.readings[0]).toMatchObject({ value: 12_000, source: created.folio })
  })

  it("`myRecords` incluye lo que ejecutó otra persona a su nombre, y `observations` sólo las de sus registros", async () => {
    const created = await createCorrective(IDS.mecBio, { executor: { kind: "otro_mecanico", userId: IDS.mecBio2 } })
    expect((await fetchCatalog(IDS.mecBio2)).body.myRecords.map((record) => record.id)).toEqual([created.id])
    expect((await fetchCatalog(IDS.mecCho)).body.myRecords).toEqual([])

    await observeRecord({ recordId: created.id, text: "Falta el número de orden", viewer: await viewerOf(IDS.supBio) })
    for (const userId of [IDS.mecBio, IDS.mecBio2]) {
      const { observations } = (await fetchCatalog(userId)).body
      expect(observations).toEqual([expect.objectContaining({ recordId: created.id, folio: created.folio, text: "Falta el número de orden", by: "Francisco Amestica", response: null })])
    }
    expect((await fetchCatalog(IDS.mecCho)).body.observations).toEqual([])
  })

  it("un equipo en taller aparece con su estado de taller en el catálogo", async () => {
    const created = await createCorrective(IDS.mecBio, { inWorkshop: true, workshopEntryDate: daysAgo(4), workDate: daysAgo(4) })
    const { body } = await fetchCatalog(IDS.mecBio)
    expect(body.equipment.find((equipment) => equipment.code === "KA-135")?.workshop).toMatchObject({
      recordId: created.id, folio: created.folio, entryDate: daysAgo(4), stale: true,
    })
    // El mecánico de otra faena lo ve en `alcance=todos`, pero sin el detalle del taller.
    const others = (await fetchCatalog(IDS.mecCho, "?alcance=todos")).body
    expect(others.equipment.find((equipment) => equipment.code === "KA-135")?.workshop).toBeNull()
  })
})

describe("concurrencia sobre el mismo identificador", () => {
  it("el mismo registro enviado tres veces a la vez deja una fila y un folio", async () => {
    const token = await tokenOf(IDS.mecBio)
    const filters = { id: crypto.randomUUID(), kind: "filtros" }
    const sticker = { id: crypto.randomUUID(), kind: "sticker" }
    await insertOrphanPhoto(testDb, { id: filters.id, userId: IDS.mecBio, kind: "filtros" })
    await insertOrphanPhoto(testDb, { id: sticker.id, userId: IDS.mecBio, kind: "sticker" })
    const body = preventiveBody([filters, sticker])
    const responses = await Promise.all([1, 2, 3].map(() => registros.POST(jsonRequest("/api/mantencion/sync/registros", token, body))))
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200])
    const folios = new Set((await Promise.all(responses.map(readJson))).map((result) => result.folio))
    expect(folios.size).toBe(1)
    expect(await testDb.select().from(schema.mantRecords)).toHaveLength(1)
    expect((await testDb.select().from(schema.mantFolioCounters))[0]?.last).toBe(1)
  })
})

describe("POST /sync/taller", () => {
  const sigue = (recordId: string, overrides: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID(), recordId, kind: "sigue", note: "Esperando repuesto", createdAt: new Date().toISOString(), deviceId: crypto.randomUUID(), ...overrides,
  })
  const salio = (recordId: string, exitDate: string, overrides: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID(), recordId, kind: "salio", exitDate, createdAt: new Date().toISOString(), deviceId: crypto.randomUUID(), ...overrides,
  })

  it("«Sigue» y «Salió» son idempotentes por id; tras la salida no se aceptan más; el estado de taller se libera", async () => {
    const created = await createCorrective(IDS.mecBio, { inWorkshop: true, workshopEntryDate: daysAgo(4), workDate: daysAgo(4) })
    const update = sigue(created.id)
    const first = await post(taller, "/api/mantencion/sync/taller", IDS.mecBio, update)
    expect(first).toMatchObject({ status: 200, body: { ok: true, id: update.id, duplicate: false } })
    const again = await post(taller, "/api/mantencion/sync/taller", IDS.mecBio, update)
    expect(again).toMatchObject({ status: 200, body: { ok: true, duplicate: true } })
    expect(again.body.receivedAt).toBe(first.body.receivedAt)
    expect(await testDb.select().from(schema.mantWorkshopUpdates)).toHaveLength(1)
    expect((await post(taller, "/api/mantencion/sync/taller", IDS.mecBio2, update)).status).toBe(409)

    // Con la novedad de hoy deja de estar «sin actualizar».
    const { body } = await fetchCatalog(IDS.mecBio)
    expect(body.equipment.find((equipment) => equipment.code === "KA-135")?.workshop).toMatchObject({ stale: false })

    const exit = salio(created.id, daysAgo(1))
    expect((await post(taller, "/api/mantencion/sync/taller", IDS.mecBio, exit)).status).toBe(200)
    expect((await post(taller, "/api/mantencion/sync/taller", IDS.mecBio, exit)).body.duplicate).toBe(true)
    const late = await post(taller, "/api/mantencion/sync/taller", IDS.mecBio, sigue(created.id))
    expect(late.status).toBe(409)
    expect(String(late.body.message)).toContain("ya salió")
    expect((await post(taller, "/api/mantencion/sync/taller", IDS.mecBio, salio(created.id, daysAgo(0)))).status).toBe(409)
    expect((await fetchCatalog(IDS.mecBio)).body.equipment.find((equipment) => equipment.code === "KA-135")?.workshop).toBeNull()

    const audits = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_workshop_update"))
    expect(audits).toHaveLength(2)
  })

  it("rechaza salida anterior al ingreso o futura, registros inexistentes, anulados o que no dejaron el equipo en taller", async () => {
    const created = await createCorrective(IDS.mecBio, { inWorkshop: true, workshopEntryDate: daysAgo(4), workDate: daysAgo(4) })
    const before = await post(taller, "/api/mantencion/sync/taller", IDS.mecBio, salio(created.id, daysAgo(6)))
    expect(before.status).toBe(422)
    expect(String(before.body.message)).toContain("anterior al ingreso")
    expect((await post(taller, "/api/mantencion/sync/taller", IDS.mecBio, salio(created.id, daysAgo(-1)))).status).toBe(422)
    expect((await post(taller, "/api/mantencion/sync/taller", IDS.mecBio, sigue(crypto.randomUUID()))).status).toBe(422)

    const notInWorkshop = await createCorrective(IDS.mecBio)
    expect((await post(taller, "/api/mantencion/sync/taller", IDS.mecBio, sigue(notInWorkshop.id))).status).toBe(422)
    const invalid = await post(taller, "/api/mantencion/sync/taller", IDS.mecBio, { ...sigue(created.id), note: "x" })
    expect(invalid.status).toBe(422)

    const { voidRecord } = await import("@/lib/services/mantencion/record-lifecycle")
    await voidRecord({ recordId: created.id, reason: "Registro duplicado", viewer: await viewerOf(IDS.jefe) })
    expect((await post(taller, "/api/mantencion/sync/taller", IDS.mecBio, sigue(created.id))).status).toBe(422)
    expect(await testDb.select().from(schema.mantWorkshopUpdates)).toHaveLength(0)
  })

  it("alcance: de otra faena no; quien lo registró (aunque sea de otra faena), el global y el de la faena sí", async () => {
    const created = await createCorrective(IDS.mecBio, { inWorkshop: true, workshopEntryDate: daysAgo(2) })
    const outsider = await post(taller, "/api/mantencion/sync/taller", IDS.mecCho, sigue(created.id))
    expect(outsider.status).toBe(422)
    expect(String(outsider.body.message)).toContain("no es de tu faena")

    expect((await post(taller, "/api/mantencion/sync/taller", IDS.mecBio2, sigue(created.id))).status).toBe(200)
    expect((await post(taller, "/api/mantencion/sync/taller", IDS.jefe, sigue(created.id))).status).toBe(200)

    // Mecánico de Cholguán que registró un equipo de Biodiversa (fuera de faena): puede seguirlo él mismo.
    const outOfWorksite = await createCorrective(IDS.mecCho, { vehicleId: IDS.machineBio, reading: 1_000, inWorkshop: true, workshopEntryDate: daysAgo(2) })
    expect((await post(taller, "/api/mantencion/sync/taller", IDS.mecCho, sigue(outOfWorksite.id))).status).toBe(200)
    expect((await post(taller, "/api/mantencion/sync/taller", IDS.mecBio, sigue(outOfWorksite.id))).status).toBe(200)
  })
})

describe("POST /sync/observaciones", () => {
  it("el mecánico responde con su credencial; otro, no; repetir lo mismo no falla", async () => {
    const created = await createCorrective(IDS.mecBio)
    await observeRecord({ recordId: created.id, text: "Falta el número de orden", viewer: await viewerOf(IDS.supBio) })
    const [observation] = await testDb.select().from(schema.mantRecordObservations).where(eq(schema.mantRecordObservations.recordId, created.id))
    const reply = { observationId: observation!.id, response: "Era la orden 4521" }

    expect((await post(observaciones, "/api/mantencion/sync/observaciones", IDS.mecBio2, reply)).status).toBe(422)
    expect((await post(observaciones, "/api/mantencion/sync/observaciones", IDS.mecBio, { ...reply, response: "" })).status).toBe(422)
    expect(await post(observaciones, "/api/mantencion/sync/observaciones", IDS.mecBio, reply)).toMatchObject({ status: 200, body: { ok: true } })
    expect((await post(observaciones, "/api/mantencion/sync/observaciones", IDS.mecBio, reply)).status).toBe(200)
    expect((await post(observaciones, "/api/mantencion/sync/observaciones", IDS.mecBio, { ...reply, response: "Otra cosa" })).status).toBe(422)
    expect((await fetchCatalog(IDS.mecBio)).body.observations[0]?.response).toBe("Era la orden 4521")
  })
})
