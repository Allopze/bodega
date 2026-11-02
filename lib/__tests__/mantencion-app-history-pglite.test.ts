import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { HISTORY_PER_EQUIPMENT, type AppHistoryRecord } from "@/lib/mantencion/contracts"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { configureZodLocale } from "@/lib/validation/zod-locale"
import { daysAgo, IDS, seedMantFixtures } from "./mantencion-sync-fixtures"
import { getRequest, idParams, makeJpeg, metaFor, photoRequest } from "./mantencion-sync-http-helpers"

/**
 * Historial de la flota para la app (`/sync/historial` y `GET /sync/fotos/[id]`)
 * contra Postgres real: tope por equipo, anulados fuera, registros de otro
 * mecánico y de otra faena dentro, nada sensible en el cuerpo, ítems, repuestos,
 * versión (ETag) que cambia al insertar y al anular, y las dos rutas con Bearer.
 */

const storageRoot = mkdtempSync(path.join(tmpdir(), "mant-app-history-"))
process.env.STORAGE_PATH = storageRoot

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const { getUserRbacById } = await import("@/lib/auth/rbac")
const { issueDeviceCredential } = await import("@/lib/services/mantencion/device-credentials")
const { loadAppHistory, historyVersion, HISTORY_FORMAT } = await import("@/lib/services/mantencion/app-history")
const historial = await import("@/app/api/mantencion/sync/historial/route")
const fotos = await import("@/app/api/mantencion/sync/fotos/[id]/route")

async function viewerOf(userId: string) {
  const rbac = await getUserRbacById(userId, true)
  if (!rbac) throw new Error(`Sin RBAC para ${userId}`)
  return { userId: rbac.id, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal }
}
const tokenFor = async (userId: string) => (await issueDeviceCredential({ userId, deviceId: crypto.randomUUID() })).token

interface Seed {
  id: string; folio: string; kind: "P" | "C"; vehicleId: string; workDate: string
  worksiteId?: string; worksiteName?: string; registeredBy?: string
  executorKind?: "yo" | "otro_mecanico" | "externo"; executorUserId?: string; executorWorkshopId?: string; executorName?: string
  voided?: boolean; reading?: number; unit?: "km" | "h"; workOrderId?: string; notes?: string
}
async function insertRecord(seed: Seed) {
  const now = new Date().toISOString()
  const registeredBy = seed.registeredBy ?? IDS.mecBio
  const kind = seed.executorKind ?? "yo"
  const unit = seed.unit ?? "km"
  await testDb.insert(schema.mantRecords).values({
    id: seed.id, folio: seed.folio, kind: seed.kind, vehicleId: seed.vehicleId,
    equipmentSnapshot: { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: seed.worksiteName ?? "Biodiversa", unit },
    worksiteId: seed.worksiteId ?? IDS.wsBio, reading: seed.reading ?? 10_000, unit, workDate: seed.workDate,
    registeredBy, executorKind: kind,
    executorUserId: kind === "externo" ? null : seed.executorUserId ?? registeredBy,
    executorWorkshopId: kind === "externo" ? seed.executorWorkshopId ?? IDS.workshop : null,
    executorName: seed.executorName ?? "Javier Roa",
    signedAt: now, receivedAt: now, status: seed.voided ? "anulado" : "vigente", workOrderId: seed.workOrderId ?? null,
    notes: seed.notes ?? (seed.kind === "P" ? "Sin novedad" : null),
    // Marcas que NO deben viajar.
    review: "observado", readingJumpAlert: true, duplicateConfirmed: true,
    ...(seed.kind === "P" ? { scheduleId: IDS.schKm, scheduleVersion: 1, scheduleNameSnapshot: "Camiones y tractos", intervalValue: 10_000, suggestedIntervalValue: 10_000 } : {}),
  })
  if (seed.voided) await testDb.insert(schema.mantRecordVoids).values({ id: `void-${seed.id}`, recordId: seed.id, reason: "Registrado por error", userId: IDS.jefe })
}

async function insertCorrective(recordId: string, extra: Partial<typeof schema.mantRecordCorrectives.$inferInsert> = {}) {
  await testDb.insert(schema.mantRecordCorrectives).values({
    recordId, workTypes: ["Mecánico"], oils: [], description: "Cambio de bomba de agua", noParts: false, hours: 3, inWorkshop: false, ...extra,
  })
}

const history = async () => (await loadAppHistory(await viewerOf(IDS.mecBio))).byVehicle

beforeAll(async () => {
  configureZodLocale()
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedMantFixtures(testDb)

  // KA-135 (Biodiversa): 12 vigentes, una por día (la 0 es la más reciente) + una anulada MUY reciente.
  for (let i = 0; i < 12; i++) {
    await insertRecord({ id: `cap-${i}`, folio: `MP-BIO-${String(i + 1).padStart(4, "0")}`, kind: "P", vehicleId: IDS.truckBio, workDate: daysAgo(i + 1), reading: 20_000 - i })
  }
  await insertRecord({ id: "cap-void", folio: "MP-BIO-0099", kind: "P", vehicleId: IDS.truckBio, workDate: daysAgo(0), voided: true })

  // KA-200 (Cholguán): lo que otro mecánico y otra faena aportan, y el detalle de cada tipo.
  await insertRecord({ id: "cho-p", folio: "MP-CHO-0001", kind: "P", vehicleId: IDS.truckCho, workDate: daysAgo(30), worksiteId: IDS.wsCho, worksiteName: "Cholguán", registeredBy: IDS.mecCho, executorName: "Pedro Cholguán", reading: 21_000 })
  await insertRecord({ id: "cho-c", folio: "MC-CHO-0001", kind: "C", vehicleId: IDS.truckCho, workDate: daysAgo(10), worksiteId: IDS.wsCho, worksiteName: "Cholguán", registeredBy: IDS.mecCho, executorKind: "otro_mecanico", executorUserId: IDS.mecBio2, executorName: "Deivis González", reading: 21_500 })
  await insertRecord({ id: "cho-x", folio: "MC-CHO-0002", kind: "C", vehicleId: IDS.truckCho, workDate: daysAgo(5), worksiteId: IDS.wsCho, worksiteName: "Cholguán", registeredBy: IDS.mecCho, executorKind: "externo", executorName: "Maestranza Melo", reading: 21_600 })

  await testDb.insert(schema.mantRecordItems).values([
    { id: "it-1", recordId: "cho-p", itemKey: "k1", groupName: "Motor", itemName: "Revisión aceite motor", sortOrder: 0, value: "R" },
    { id: "it-2", recordId: "cho-p", itemKey: "k2", groupName: "Motor", itemName: "Cambio filtro aire", sortOrder: 1, value: "NR", reason: "Sin repuesto en bodega" },
    { id: "it-3", recordId: "cho-p", itemKey: "k3", groupName: "Motor", itemName: "Regulación válvulas", sortOrder: 2, value: "NA" },
    { id: "it-4", recordId: "cho-p", itemKey: "k4", groupName: "Frenos", itemName: "Revisión pastillas", sortOrder: 3, value: "R", manufacturerWarning: true },
  ])

  await insertCorrective("cho-c", { workTypes: ["Mecánico", "Soldadura"], hours: 5, inWorkshop: true, workshopEntryDate: daysAgo(10), workshopReason: "Falla de la bomba de agua" })
  await testDb.insert(schema.mantRecordJobs).values([
    { id: "job-1", recordId: "cho-c", workTypeId: IDS.wtMec, workTypeName: "Mecánico", hours: 3, noParts: false, sortOrder: 0 },
    { id: "job-2", recordId: "cho-c", workTypeId: IDS.wtSold, workTypeName: "Soldadura", hours: 2, noParts: true, sortOrder: 1 },
  ])
  await testDb.insert(schema.mantRecordParts).values({ id: "part-1", recordId: "cho-c", jobId: "job-1", quantity: 2, description: "Bomba de agua" })
  await testDb.insert(schema.mantWorkshopUpdates).values({ id: "wu-1", recordId: "cho-c", kind: "salio", exitDate: daysAgo(4), userId: IDS.mecCho, createdAt: new Date(Date.now() - 4 * 86_400_000).toISOString() })

  // «cho-x» sigue en taller (sin salida) y viene de una OT.
  await testDb.insert(schema.mantWorkOrders).values({
    id: "ot-1", folio: "OT-CHO-0001", vehicleId: IDS.truckCho, worksiteId: IDS.wsCho,
    equipmentSnapshot: { code: "KA-200", plate: "BCDF-12", noPlate: false, type: "Camión", brand: "Volvo", model: "R450", year: 2021, worksite: "Cholguán", unit: "km" },
    repair: true, repairDescription: "Falla de la bomba de agua", requestDate: daysAgo(6), requestedByUserId: IDS.jefe, requesterName: "Alexis Morales",
  })
  await testDb.update(schema.mantRecords).set({ workOrderId: "ot-1" }).where(eq(schema.mantRecords.id, "cho-x"))
  await insertCorrective("cho-x", { inWorkshop: true, workshopEntryDate: daysAgo(5), workshopReason: "Esperando repuesto", workTypes: ["Soldadura"], hours: 1.5 })
  await testDb.insert(schema.mantRecordJobs).values({ id: "job-3", recordId: "cho-x", workTypeId: IDS.wtSold, workTypeName: "Soldadura", hours: 1.5, noParts: true, sortOrder: 0 })

  // Maquinaria en horas y un equipo dado de baja (no debe aparecer).
  await insertRecord({ id: "mq-1", folio: "MP-BIO-0200", kind: "P", vehicleId: IDS.machineBio, workDate: daysAgo(3), unit: "h", reading: 950 })
  await insertRecord({ id: "ret-1", folio: "MP-BIO-0300", kind: "P", vehicleId: IDS.retired, workDate: daysAgo(3) })
})

afterAll(() => rmSync(storageRoot, { recursive: true, force: true }))

describe("historial: qué registros salen", () => {
  it("el tope por equipo es HISTORY_PER_EQUIPMENT, del más reciente al más antiguo, sin el anulado", async () => {
    const records = (await history())[IDS.truckBio] ?? []
    expect(records).toHaveLength(HISTORY_PER_EQUIPMENT)
    expect(records.map((record) => record.id)).toEqual(Array.from({ length: HISTORY_PER_EQUIPMENT }, (_, i) => `cap-${i}`))
    expect(records.map((record) => record.id)).not.toContain("cap-void")
    expect(records.map((record) => record.id)).not.toContain("cap-10")
  })

  it("trae registros de otra faena y de otro mecánico, y sólo los equipos activos", async () => {
    const byVehicle = await history()
    expect(Object.keys(byVehicle).sort()).toEqual([IDS.machineBio, IDS.truckBio, IDS.truckCho].sort())
    expect(byVehicle[IDS.retired]).toBeUndefined()
    // Pedido por un mecánico de Biodiversa: ve lo de Cholguán y lo que hizo «otro mecánico».
    const cho = byVehicle[IDS.truckCho] ?? []
    expect(cho.map((record) => record.folio)).toEqual(["MC-CHO-0002", "MC-CHO-0001", "MP-CHO-0001"])
    expect(cho.every((record) => record.worksiteName === "Cholguán")).toBe(true)
    expect(byVehicle[IDS.machineBio]?.[0]).toMatchObject({ unit: "h", reading: 950 })
  })

  it("resuelve el ejecutor: yo, otro mecánico y taller externo", async () => {
    const cho = (await history())[IDS.truckCho] ?? []
    const byFolio = Object.fromEntries(cho.map((record) => [record.folio, record]))
    expect(byFolio["MP-CHO-0001"]).toMatchObject({ executorKind: "yo", executorName: "Pedro Cholguán" })
    expect(byFolio["MC-CHO-0001"]).toMatchObject({ executorKind: "otro_mecanico", executorName: "Deivis González" })
    expect(byFolio["MC-CHO-0002"]).toMatchObject({ executorKind: "externo", executorName: "Maestranza Melo" })
  })
})

describe("historial: contenido y privacidad", () => {
  it("no expone observaciones, revisión, anulación, sello ni quién recibió", async () => {
    const body = await loadAppHistory(await viewerOf(IDS.mecBio))
    const all = Object.values(body.byVehicle).flat()
    expect(Object.keys(body).sort()).toEqual(["byVehicle", "generatedAt", "version"])
    const baseKeys = ["corrective", "executorKind", "executorName", "folio", "id", "itemsDone", "itemsFlagged", "kind", "notes", "photos", "reading", "schedule", "unit", "vehicleId", "workDate", "workOrderFolio", "worksiteName"]
    for (const record of all) expect(Object.keys(record).sort()).toEqual(baseKeys)
    const corrective = all.find((record) => record.corrective)?.corrective
    expect(Object.keys(corrective ?? {}).sort()).toEqual(["description", "hours", "jobs", "stillInWorkshop", "workTypes", "workshopEntryDate", "workshopExitDate"])
    const text = JSON.stringify(body)
    for (const forbidden of ["review", "observ", "voidReason", "voided", "stampGap", "receivedBy", "registeredBy", "readingJump", "duplicate", "signedAt", "receivedAt", "deviceId"]) {
      expect(text).not.toContain(forbidden)
    }
    expect(text).not.toContain("MP-BIO-0099")
  })

  it("preventiva: cuenta los R y lista NR/NA con grupo, nombre y motivo, en el orden de la pauta", async () => {
    const record = ((await history())[IDS.truckCho] ?? []).find((item) => item.id === "cho-p") as AppHistoryRecord
    expect(record.itemsDone).toBe(2)
    expect(record.itemsFlagged).toEqual([
      { group: "Motor", name: "Cambio filtro aire", value: "NR", reason: "Sin repuesto en bodega" },
      { group: "Motor", name: "Regulación válvulas", value: "NA", reason: null },
    ])
    expect(record.schedule).toEqual({ name: "Camiones y tractos", intervalValue: 10_000 })
    expect(record.corrective).toBeNull()
  })

  it("correctiva: trabajos con repuestos, taller con salida y OT enlazada", async () => {
    const cho = (await history())[IDS.truckCho] ?? []
    const exited = cho.find((item) => item.id === "cho-c") as AppHistoryRecord
    expect(exited.schedule).toBeNull()
    expect(exited.itemsDone).toBe(0)
    expect(exited.corrective).toEqual({
      description: "Cambio de bomba de agua",
      hours: 5,
      workTypes: ["Mecánico", "Soldadura"],
      jobs: [
        { workTypeName: "Mecánico", hours: 3, parts: [{ quantity: 2, description: "Bomba de agua" }] },
        { workTypeName: "Soldadura", hours: 2, parts: [] },
      ],
      workshopEntryDate: daysAgo(10),
      workshopExitDate: daysAgo(4),
      stillInWorkshop: false,
    })
    expect(exited.workOrderFolio).toBeNull()

    const open = cho.find((item) => item.id === "cho-x") as AppHistoryRecord
    expect(open.corrective).toMatchObject({ workshopEntryDate: daysAgo(5), workshopExitDate: null, stillInWorkshop: true })
    expect(open.workOrderFolio).toBe("OT-CHO-0001")
  })
})

describe("historial: versión", () => {
  it("es estable, no depende de quién pide y cambia al insertar y al anular", async () => {
    const first = await historyVersion()
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(await historyVersion()).toBe(first)
    expect(HISTORY_FORMAT).toBe(1)
    expect((await loadAppHistory(await viewerOf(IDS.mecBio))).version).toBe(first)
    expect((await loadAppHistory(await viewerOf(IDS.jefe))).version).toBe(first)

    await insertRecord({ id: "ver-1", folio: "MP-BIO-0400", kind: "P", vehicleId: IDS.truckAra, workDate: daysAgo(1) })
    const afterInsert = await historyVersion()
    expect(afterInsert).not.toBe(first)

    // Anular sin tocar `updated_at`: el conteo de vigentes basta para que la versión cambie.
    await testDb.update(schema.mantRecords).set({ status: "anulado" }).where(eq(schema.mantRecords.id, "ver-1"))
    expect(await historyVersion()).not.toBe(afterInsert)
  })

  it("un cambio en la foto anclada al registro también cambia la versión", async () => {
    const before = await historyVersion()
    await testDb.insert(schema.mantRecordPhotos).values({
      id: crypto.randomUUID(), recordId: "mq-1", kind: "filtros", storageKey: "storage/x.jpg", mimeType: "image/jpeg",
      sha256: "0".repeat(64), bytes: 10, width: 10, height: 10, stampedAt: new Date().toISOString(), uploadedBy: IDS.mecBio,
    })
    expect(await historyVersion()).not.toBe(before)
  })
})

describe("GET /sync/historial", () => {
  beforeEach(async () => { await testDb.delete(schema.rateLimits) })

  it("exige Bearer: sin token o con uno inventado es 401", async () => {
    expect((await historial.GET(getRequest("/api/mantencion/sync/historial", null))).status).toBe(401)
    expect((await historial.GET(getRequest("/api/mantencion/sync/historial", "token-inventado"))).status).toBe(401)
    // Una cuenta sin permiso de la app no lo lee.
    expect((await historial.GET(getRequest("/api/mantencion/sync/historial", await tokenFor(IDS.plain)))).status).toBe(403)
  })

  it("responde con ETag igual a `version`, y 304 con If-None-Match", async () => {
    const token = await tokenFor(IDS.mecBio)
    const ok = await historial.GET(getRequest("/api/mantencion/sync/historial", token))
    expect(ok.status).toBe(200)
    expect(ok.headers.get("cache-control")).toBe("private, no-cache")
    const etag = ok.headers.get("etag") as string
    const body = await ok.json() as { version: string; byVehicle: Record<string, unknown[]> }
    expect(etag).toBe(`"${body.version}"`)
    expect(Object.keys(body.byVehicle)).toContain(IDS.truckBio)

    const cached = await historial.GET(getRequest("/api/mantencion/sync/historial", token, { "if-none-match": etag }))
    expect(cached.status).toBe(304)
    expect(cached.headers.get("etag")).toBe(etag)
    expect(await cached.text()).toBe("")
    const weak = await historial.GET(getRequest("/api/mantencion/sync/historial", token, { "if-none-match": `W/${etag}` }))
    expect(weak.status).toBe(304)
    // Otra versión: se vuelve a enviar.
    expect((await historial.GET(getRequest("/api/mantencion/sync/historial", token, { "if-none-match": '"otra"' }))).status).toBe(200)
  })
})

describe("GET /sync/fotos/[id]", () => {
  beforeEach(async () => { await testDb.delete(schema.rateLimits) })

  async function upload(token: string, kind: "filtros" | "sticker" | "correctiva" = "filtros") {
    const id = crypto.randomUUID()
    const buffer = await makeJpeg(1200, 800)
    const response = await fotos.PUT(photoRequest(token, id, { file: buffer, meta: await metaFor(buffer, { kind }) }), idParams(id))
    expect(response.status).toBe(200)
    return id
  }
  const get = (token: string | null, id: string, query = "") => fotos.GET(getRequest(`/api/mantencion/sync/fotos/${id}${query}`, token), idParams(id))

  it("sin token es 401", async () => {
    expect((await get(null, crypto.randomUUID())).status).toBe(401)
    expect((await get("token-inventado", crypto.randomUUID())).status).toBe(401)
  })

  it("sirve la foto de un registro vigente de otra faena y otro autor, como attachment y nosniff", async () => {
    const id = await upload(await tokenFor(IDS.mecCho), "correctiva")
    await testDb.update(schema.mantRecordPhotos).set({ recordId: "cho-c" }).where(eq(schema.mantRecordPhotos.id, id))

    const response = await get(await tokenFor(IDS.mecBio), id)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/jpeg")
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/)
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("cache-control")).toMatch(/^private, max-age=\d+/)
    const full = Buffer.from(await response.arrayBuffer())
    expect(full.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))

    const thumb = await get(await tokenFor(IDS.mecBio), id, "?v=thumb")
    expect(thumb.status).toBe(200)
    expect(thumb.headers.get("content-type")).toBe("image/jpeg")
    expect(Buffer.from(await thumb.arrayBuffer()).length).toBeLessThan(full.length)
    expect((await get(await tokenFor(IDS.mecBio), id, "?v=raro")).status).toBe(422)
  })

  it("una foto huérfana, la de un registro anulado o un id que no existe son un 404 igual", async () => {
    const token = await tokenFor(IDS.mecBio)
    const orphan = await upload(token)
    expect((await get(token, orphan)).status).toBe(404)

    const voided = await upload(token)
    await testDb.update(schema.mantRecordPhotos).set({ recordId: "cap-void" }).where(eq(schema.mantRecordPhotos.id, voided))
    expect((await get(token, voided)).status).toBe(404)

    expect((await get(token, crypto.randomUUID())).status).toBe(404)
    expect((await get(token, "no-es-uuid")).status).toBe(404)
  })
})
