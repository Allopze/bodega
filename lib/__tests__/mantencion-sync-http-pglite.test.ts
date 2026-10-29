import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { mkdtempSync, existsSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { configureZodLocale } from "@/lib/validation/zod-locale"
import { IDS, seedMantFixtures } from "./mantencion-sync-fixtures"
import {
  correctiveBody, getRequest, idParams, jsonRequest, makeJpeg, metaFor, photoRequest, preventiveBody, readJson, sha256,
} from "./mantencion-sync-http-helpers"

/**
 * Credencial de dispositivo, autenticación Bearer de `/api/mantencion/sync/*`,
 * fotos (subida y lectura) y recepción de registros, llamando los handlers
 * directamente con `Request` contra Postgres real (PGlite).
 */

const storageRoot = mkdtempSync(path.join(tmpdir(), "mant-sync-http-"))
process.env.STORAGE_PATH = storageRoot

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

type TestSession = { user: { id: string; name: string; email: string; permissions: string[]; worksiteIds: string[]; isGlobal: boolean } }
let currentSession: TestSession | null = null
const denied = { session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } }
vi.mock("@/lib/auth/can", () => ({
  guardPermission: vi.fn(async (permission: string) => currentSession?.user.permissions.includes(permission) ? { session: currentSession, error: null } : denied),
  guardAnyPermission: vi.fn(async (permissions: string[]) => currentSession && permissions.some((p) => currentSession!.user.permissions.includes(p)) ? { session: currentSession, error: null } : denied),
}))

const { getUserRbacById } = await import("@/lib/auth/rbac")
const { issueDeviceCredential, listDeviceCredentials, revokeDeviceCredential } = await import("@/lib/services/mantencion/device-credentials")
const dispositivo = await import("@/app/api/mantencion/dispositivo/route")
const catalogo = await import("@/app/api/mantencion/sync/catalogo/route")
const fotosPut = await import("@/app/api/mantencion/sync/fotos/[id]/route")
const fotosGet = await import("@/app/api/mantencion/fotos/[id]/route")
const registros = await import("@/app/api/mantencion/sync/registros/route")
const taller = await import("@/app/api/mantencion/sync/taller/route")
const observaciones = await import("@/app/api/mantencion/sync/observaciones/route")

async function sessionOf(userId: string): Promise<TestSession> {
  const rbac = await getUserRbacById(userId, true)
  if (!rbac) throw new Error(`Sin RBAC para ${userId}`)
  return { user: { id: rbac.id, name: rbac.name, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal } }
}

const tokenFor = async (userId: string, deviceId = crypto.randomUUID()) => (await issueDeviceCredential({ userId, deviceId })).token

async function uploadPhoto(token: string, kind: "filtros" | "sticker" | "correctiva") {
  const id = crypto.randomUUID()
  const buffer = await makeJpeg()
  const response = await fotosPut.PUT(photoRequest(token, id, { file: buffer, meta: await metaFor(buffer, { kind }) }), idParams(id))
  expect(response.status).toBe(200)
  return { id, kind }
}

beforeAll(async () => {
  configureZodLocale()
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedMantFixtures(testDb)
})

afterAll(() => rmSync(storageRoot, { recursive: true, force: true }))

beforeEach(async () => {
  currentSession = null
  for (const table of [
    schema.mantRecordObservations, schema.mantRecordVoids, schema.mantWorkshopUpdates, schema.mantRecordPhotos,
    schema.mantRecords, schema.mantFolioCounters, schema.auditLog, schema.mantDeviceCredentials, schema.rateLimits, schema.systemSettings,
  ]) await testDb.delete(table)
})

describe("credencial de dispositivo", () => {
  it("POST /dispositivo exige permiso, entrega el token una vez y guarda sólo su huella", async () => {
    const deviceId = crypto.randomUUID()
    const body = { deviceId, label: "Samsung A14 de Javier" }

    expect((await dispositivo.POST(jsonRequest("/api/mantencion/dispositivo", null, body))).status).toBe(403)
    currentSession = await sessionOf(IDS.plain)
    expect((await dispositivo.POST(jsonRequest("/api/mantencion/dispositivo", null, body))).status).toBe(403)

    currentSession = await sessionOf(IDS.mecBio)
    expect((await dispositivo.POST(jsonRequest("/api/mantencion/dispositivo", null, { deviceId: "no-es-uuid" }))).status).toBe(422)
    const response = await dispositivo.POST(jsonRequest("/api/mantencion/dispositivo", null, body))
    expect(response.status).toBe(200)
    const issued = await readJson(response)
    expect(issued.user).toMatchObject({ id: IDS.mecBio, name: "Javier Roa" })
    const token = String(issued.token)
    expect(token.length).toBeGreaterThanOrEqual(43)

    const [row] = await testDb.select().from(schema.mantDeviceCredentials)
    expect(row?.tokenHash).toBe(sha256(Buffer.from(token)))
    expect(row?.tokenHash).not.toContain(token)
    expect(Date.parse(row!.expiresAt) - Date.parse(row!.createdAt)).toBeGreaterThan(29.9 * 86_400_000)
    const audits = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_device_credential"))
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits)).not.toContain(token)
  })

  it("emitir otra para el mismo dispositivo revoca la anterior; revocar corta la sincronización", async () => {
    const deviceId = crypto.randomUUID()
    const first = await issueDeviceCredential({ userId: IDS.mecBio, deviceId })
    const second = await issueDeviceCredential({ userId: IDS.mecBio, deviceId })
    expect((await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", first.token))).status).toBe(401)
    expect((await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", second.token))).status).toBe(200)

    const listed = await listDeviceCredentials({ userId: IDS.mecBio })
    expect(listed.map((row) => row.status).sort()).toEqual(["revocada", "vigente"])
    expect(listed[0]).toMatchObject({ userName: "Javier Roa", deviceId })

    expect((await revokeDeviceCredential({ credentialId: second.credentialId, actorUserId: IDS.jefe })).ok).toBe(true)
    expect((await revokeDeviceCredential({ credentialId: second.credentialId, actorUserId: IDS.jefe })).ok).toBe(false)
    expect((await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", second.token))).status).toBe(401)
    const [revoked] = await testDb.select().from(schema.mantDeviceCredentials).where(eq(schema.mantDeviceCredentials.id, second.credentialId))
    expect(revoked?.revokedBy).toBe(IDS.jefe)
  })
})

describe("autenticación Bearer de la sincronización", () => {
  it("sin Bearer (aunque haya sesión), con token falso, vencido o de usuario sin permiso: 401/403", async () => {
    currentSession = await sessionOf(IDS.mecBio) // la sesión del navegador NO cuenta en estas rutas
    const handlers = [
      () => catalogo.GET(getRequest("/api/mantencion/sync/catalogo", null)),
      () => registros.POST(jsonRequest("/api/mantencion/sync/registros", null, {})),
      () => taller.POST(jsonRequest("/api/mantencion/sync/taller", null, {})),
      () => observaciones.POST(jsonRequest("/api/mantencion/sync/observaciones", null, {})),
      () => fotosPut.PUT(photoRequest(null, crypto.randomUUID(), {}), idParams(crypto.randomUUID())),
    ]
    for (const call of handlers) expect((await call()).status).toBe(401)

    const fake = await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", "token-inventado"))
    expect(fake.status).toBe(401)
    expect(await readJson(fake)).toMatchObject({ ok: false, code: "unauthorized" })

    const expired = await issueDeviceCredential({ userId: IDS.mecBio, deviceId: crypto.randomUUID() })
    await testDb.update(schema.mantDeviceCredentials).set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(schema.mantDeviceCredentials.id, expired.credentialId))
    expect((await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", expired.token))).status).toBe(401)

    const plain = await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", await tokenFor(IDS.plain)))
    expect(plain.status).toBe(403)
    expect(await readJson(plain)).toMatchObject({ ok: false, code: "forbidden" })
    expect((await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", await tokenFor(IDS.inactive)))).status).toBe(401)
    expect((await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", await tokenFor(IDS.mecBio)))).status).toBe(200)
  })

  it("el permiso se relee en cada llamada: quitar el rol corta la sincronización al instante", async () => {
    const token = await tokenFor(IDS.mecBio2)
    expect((await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", token))).status).toBe(200)
    await testDb.delete(schema.userRoles).where(eq(schema.userRoles.userId, IDS.mecBio2))
    expect((await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", token))).status).toBe(403)
    await testDb.insert(schema.userRoles).values({ userId: IDS.mecBio2, roleId: "rol-mecanico" })
  })

  it("el interruptor del módulo (503) y el límite de tasa (429)", async () => {
    const token = await tokenFor(IDS.mecBio)
    await testDb.insert(schema.systemSettings).values({ key: "module.enabled:mantencion_equipos", value: "false" })
    const off = await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", token))
    expect(off.status).toBe(503)
    await testDb.delete(schema.systemSettings)

    await testDb.insert(schema.rateLimits).values({ key: `mant-sync:${IDS.mecBio}`, count: 600, lockUntil: 0, updatedAt: new Date().toISOString() })
    const limited = await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", token))
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toBe("60")
    expect(await readJson(limited)).toMatchObject({ ok: false, code: "rate_limited" })
    // El límite es por usuario: otra persona no se ve afectada.
    expect((await catalogo.GET(getRequest("/api/mantencion/sync/catalogo", await tokenFor(IDS.mecBio2)))).status).toBe(200)
  })
})

describe("fotos", () => {
  it("sube una foto válida, verifica huella y dimensiones, y es idempotente", async () => {
    const token = await tokenFor(IDS.mecBio, "11111111-1111-4111-8111-111111111111")
    const id = crypto.randomUUID()
    const buffer = await makeJpeg(40, 30)
    const meta = await metaFor(buffer, { kind: "filtros", exif: { Make: "Samsung" } })

    const first = await fotosPut.PUT(photoRequest(token, id, { file: buffer, meta }), idParams(id))
    expect(first.status).toBe(200)
    expect(await readJson(first)).toMatchObject({ ok: true, id, duplicate: false })
    const [row] = await testDb.select().from(schema.mantRecordPhotos).where(eq(schema.mantRecordPhotos.id, id))
    expect(row).toMatchObject({
      recordId: null, kind: "filtros", mimeType: "image/jpeg", width: 40, height: 30, bytes: buffer.length, uploadedBy: IDS.mecBio,
      deviceId: "11111111-1111-4111-8111-111111111111", sha256: sha256(buffer),
    })
    expect(existsSync(path.join(storageRoot, "mantencion", path.basename(row!.storageKey)))).toBe(true)

    const again = await fotosPut.PUT(photoRequest(token, id, { file: buffer, meta }), idParams(id))
    expect(await readJson(again)).toMatchObject({ ok: true, duplicate: true })
    expect(await testDb.select().from(schema.mantRecordPhotos)).toHaveLength(1)
    expect(readdirSync(path.join(storageRoot, "mantencion"))).toHaveLength(1)
  })

  it("rechaza huella que no coincide, tipo falso, dimensiones mentidas, faltantes y exceso de tamaño", async () => {
    const filesOnDisk = () => (existsSync(path.join(storageRoot, "mantencion")) ? readdirSync(path.join(storageRoot, "mantencion")).length : 0)
    const filesBefore = filesOnDisk()
    const token = await tokenFor(IDS.mecBio)
    const buffer = await makeJpeg()
    const put = async (input: Parameters<typeof photoRequest>[2], id = crypto.randomUUID()) => {
      const response = await fotosPut.PUT(photoRequest(token, id, input), idParams(id))
      return { status: response.status, body: await readJson(response) }
    }

    const wrongSha = await put({ file: buffer, meta: await metaFor(buffer, { sha256: "a".repeat(64) }) })
    expect(wrongSha.status).toBe(422)
    expect(wrongSha.body).toMatchObject({ ok: false, code: "invalid" })
    expect(String(wrongSha.body.message)).toContain("huella")

    const text = Buffer.from("esto no es una foto, es texto plano")
    expect((await put({ file: text, meta: await metaFor(buffer, { sha256: sha256(text) }) })).status).toBe(422)
    expect(String((await put({ file: buffer, meta: await metaFor(buffer, { width: 999 }) })).body.message)).toContain("dimensiones")
    expect((await put({ file: null, meta: await metaFor(buffer) })).status).toBe(422)
    expect((await put({ file: buffer })).status).toBe(422)
    expect((await put({ file: buffer, meta: "{no es json" })).status).toBe(422)
    expect((await put({ file: buffer, meta: await metaFor(buffer, { kind: "otra" }) })).status).toBe(422)
    expect((await put({ file: buffer, meta: await metaFor(buffer) }, "no-es-uuid")).status).toBe(422)

    const huge = Buffer.alloc(10 * 1024 * 1024 + 1)
    buffer.copy(huge)
    expect(String((await put({ file: huge, meta: await metaFor(buffer, { sha256: sha256(huge) }) })).body.message)).toContain("10 MB")

    expect(await testDb.select().from(schema.mantRecordPhotos)).toHaveLength(0)
    // Ningún rechazo deja un archivo huérfano en disco.
    expect(filesOnDisk()).toBe(filesBefore)
  })

  it("el mismo id con otro contenido, o de otra persona, es un 409", async () => {
    const tokenA = await tokenFor(IDS.mecBio)
    const id = crypto.randomUUID()
    const original = await makeJpeg(32, 24, "#1e6e3e")
    await fotosPut.PUT(photoRequest(tokenA, id, { file: original, meta: await metaFor(original) }), idParams(id))

    const other = await makeJpeg(32, 24, "#f39200")
    const changed = await fotosPut.PUT(photoRequest(tokenA, id, { file: other, meta: await metaFor(other) }), idParams(id))
    expect(changed.status).toBe(409)
    const stolen = await fotosPut.PUT(photoRequest(await tokenFor(IDS.mecBio2), id, { file: original, meta: await metaFor(original) }), idParams(id))
    expect(stolen.status).toBe(409)
    expect(await testDb.select().from(schema.mantRecordPhotos)).toHaveLength(1)
  })

  it("GET /fotos/[id]: la huérfana es de quien la subió; la anclada, de quien ve el registro", async () => {
    const token = await tokenFor(IDS.mecBio)
    const orphan = await uploadPhoto(token, "correctiva")
    const get = async (userId: string | null, id: string) => {
      currentSession = userId ? await sessionOf(userId) : null
      return fotosGet.GET(getRequest(`/api/mantencion/fotos/${id}`, null), idParams(id))
    }

    const own = await get(IDS.mecBio, orphan.id)
    expect(own.status).toBe(200)
    expect(own.headers.get("content-type")).toBe("image/jpeg")
    expect(own.headers.get("x-content-type-options")).toBe("nosniff")
    expect(own.headers.get("cache-control")).toContain("private")
    expect(own.headers.get("content-disposition")).toMatch(/^inline;/)
    expect(Buffer.from(await own.arrayBuffer()).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    expect((await get(IDS.mecBio2, orphan.id)).status).toBe(404)
    expect((await get(IDS.jefe, orphan.id)).status).toBe(404)
    expect((await get(null, orphan.id)).status).toBe(403)

    // Ya anclada a un registro de Biodiversa: la ven supervisión de Biodiversa y jefatura; no un mecánico de otra faena ni quien no tiene permisos.
    const posted = await registros.POST(jsonRequest("/api/mantencion/sync/registros", token, correctiveBody([orphan])))
    expect(posted.status).toBe(200)
    expect((await get(IDS.mecBio, orphan.id)).status).toBe(200)
    expect((await get(IDS.supBio, orphan.id)).status).toBe(200)
    expect((await get(IDS.jefe, orphan.id)).status).toBe(200)
    expect((await get(IDS.mecCho, orphan.id)).status).toBe(404)
    expect((await get(IDS.plain, orphan.id)).status).toBe(403)
    expect((await get(IDS.mecBio, "no-es-uuid")).status).toBe(404)
  })
})

describe("POST /sync/registros", () => {
  it("el autor sale de la credencial, la respuesta es idempotente y un cuerpo inválido se rechaza con su campo", async () => {
    const token = await tokenFor(IDS.mecBio)
    const photos = [await uploadPhoto(token, "filtros"), await uploadPhoto(token, "sticker")]
    const body = preventiveBody(photos)

    const sends = []
    for (let attempt = 0; attempt < 3; attempt++) sends.push(await registros.POST(jsonRequest("/api/mantencion/sync/registros", token, body)))
    expect(sends.map((response) => response.status)).toEqual([200, 200, 200])
    const results = await Promise.all(sends.map(readJson))
    expect(results.map((result) => result.duplicate)).toEqual([false, true, true])
    expect(new Set(results.map((result) => result.folio))).toEqual(new Set(["MP-BIO-0001"]))
    const rows = await testDb.select().from(schema.mantRecords)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.registeredBy).toBe(IDS.mecBio)

    // Otro mecánico con el mismo id de registro: 409, y el registro original no cambia.
    const stolen = await registros.POST(jsonRequest("/api/mantencion/sync/registros", await tokenFor(IDS.mecBio2), body))
    expect(stolen.status).toBe(409)

    const noJson = await registros.POST(jsonRequest("/api/mantencion/sync/registros", token, "{roto"))
    expect(noJson.status).toBe(422)
    const missing = await registros.POST(jsonRequest("/api/mantencion/sync/registros", token, preventiveBody(photos, { notes: "" })))
    expect(missing.status).toBe(422)
    expect(await readJson(missing)).toMatchObject({ ok: false, code: "invalid", field: "notes" })
  })

  it("un rechazo de negocio vuelve como 422 `rejected` con el motivo, y las fotos faltantes como 409", async () => {
    const token = await tokenFor(IDS.mecBio)
    const photos = [await uploadPhoto(token, "filtros"), await uploadPhoto(token, "sticker")]
    const lower = await registros.POST(jsonRequest("/api/mantencion/sync/registros", token, preventiveBody(photos, { reading: 9_000 })))
    expect(lower.status).toBe(422)
    expect(await readJson(lower)).toMatchObject({ ok: false, code: "rejected", field: "reading" })

    const ghost = await registros.POST(jsonRequest("/api/mantencion/sync/registros", token, preventiveBody([photos[0]!, { id: crypto.randomUUID(), kind: "sticker" }])))
    expect(ghost.status).toBe(409)
    expect(await readJson(ghost)).toMatchObject({ ok: false, code: "missing_photos" })
    expect(await testDb.select().from(schema.mantRecords)).toHaveLength(0)
  })
})
