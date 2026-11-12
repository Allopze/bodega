import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { syncRecordSchema } from "@/lib/mantencion/contracts"
import { createMantencionFilePath } from "@/lib/storage/config"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { todayInChile } from "@/lib/utils"
import { IDS, seedMantFixtures } from "./mantencion-sync-fixtures"
import { correctiveBody } from "./mantencion-sync-http-helpers"

/**
 * D1 (auditoría 2026-11): las fotos que se suben antes que su registro y nunca
 * se reclaman (`record_id` nulo) se recogen a los 7 días, fila y archivo.
 */

const storageRoot = mkdtempSync(path.join(tmpdir(), "mant-foto-gc-"))
process.env.STORAGE_PATH = storageRoot
process.env.CRON_SECRET = "secreto-gc"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({ get db() { return testGlobal.__db }, get Tx() { return undefined } }))
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

const { purgeOrphanMantencionPhotos, ORPHAN_PHOTO_MAX_AGE_DAYS } = await import("@/lib/services/mantencion/photo-gc")
const { GET } = await import("@/app/api/cron/mantencion-fotos-huerfanas/route")
const { logger } = await import("@/lib/logger")
const { createRecord } = await import("@/lib/services/mantencion/records-create")
const { getUserRbacById } = await import("@/lib/auth/rbac")

/** Los ids de foto son UUID (el registro los valida): un sufijo legible, relleno al formato. */
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const NOW = new Date("2026-11-11T12:00:00.000Z")
const daysBefore = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()
const storageDir = path.join(storageRoot, "mantencion")

/** Foto con su archivo real en disco, recibida hace `ageDays` días. */
async function photo(id: string, ageDays: number, options: { recordId?: string | null; withFile?: boolean } = {}) {
  const storageKey = createMantencionFilePath(`${id}.jpg`)
  const file = path.join(storageDir, path.basename(storageKey))
  if (options.withFile !== false) { mkdirSync(storageDir, { recursive: true }); writeFileSync(file, "jpg") }
  await testDb.insert(schema.mantRecordPhotos).values({
    id, recordId: options.recordId ?? null, kind: "correctiva", storageKey, mimeType: "image/jpeg", sha256: "0".repeat(64),
    bytes: 3, width: 10, height: 10, stampedAt: daysBefore(ageDays), receivedAt: daysBefore(ageDays), uploadedBy: IDS.mecBio,
  })
  return file
}
/** Un registro firmado que nombra la foto, por el mismo camino que usa el teléfono. */
async function claim(photoId: string) {
  const rbac = await getUserRbacById(IDS.mecBio, true)
  if (!rbac) throw new Error("Sin RBAC")
  const outcome = await createRecord(syncRecordSchema.parse(correctiveBody([{ id: photoId, kind: "correctiva" }], { workDate: todayInChile() })), {
    userName: rbac.name, deviceId: "dev-test", credentialId: "cred-test",
    viewer: { userId: rbac.id, email: rbac.email, permissions: rbac.permissions, worksiteIds: rbac.worksiteIds, isGlobal: rbac.isGlobal },
  })
  if (!outcome.body.ok) throw new Error(`Registro rechazado: ${outcome.body.message}`)
}
const ids = async () => (await testDb.select({ id: schema.mantRecordPhotos.id }).from(schema.mantRecordPhotos)).map((row) => row.id).sort()

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedMantFixtures(testDb)
})
beforeEach(async () => {
  await testDb.delete(schema.mantRecordPhotos)
  await testDb.delete(schema.cronRuns)
  vi.mocked(logger.warn).mockClear()
})

describe("purgeOrphanMantencionPhotos", () => {
  it("borra fila y archivo de la huérfana vencida y deja intacta la reciente", async () => {
    const oldFile = await photo(uid(1), ORPHAN_PHOTO_MAX_AGE_DAYS + 1)
    const freshFile = await photo(uid(2), ORPHAN_PHOTO_MAX_AGE_DAYS - 1)

    const result = await purgeOrphanMantencionPhotos({ now: NOW })

    expect(result).toEqual({ found: 1, deletedRows: 1, deletedFiles: 1, fileFailures: 0, hasMore: false })
    expect(await ids()).toEqual([uid(2)])
    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(freshFile)).toBe(true)
  })

  it("nunca toca una foto anclada a un registro, por vieja que sea", async () => {
    const file = await photo(uid(3), 90)
    await claim(uid(3))
    const [anchored] = await testDb.select().from(schema.mantRecordPhotos)
    expect(anchored?.recordId).not.toBeNull()

    expect((await purgeOrphanMantencionPhotos({ now: NOW })).found).toBe(0)
    expect(await ids()).toEqual([uid(3)])
    expect(existsSync(file)).toBe(true)
  })

  it("si el archivo ya no existe borra igual la fila y no lo cuenta como falla", async () => {
    await photo(uid(4), 20, { withFile: false })
    const result = await purgeOrphanMantencionPhotos({ now: NOW })
    expect(result).toMatchObject({ deletedRows: 1, fileFailures: 0 })
    expect(await ids()).toEqual([])
  })

  it("respeta el tope del lote y avisa que quedan más", async () => {
    for (const n of [1, 2, 3]) await photo(uid(4 + n), 10 + n)
    const first = await purgeOrphanMantencionPhotos({ now: NOW, batchSize: 2 })
    expect(first).toMatchObject({ found: 2, deletedRows: 2, hasMore: true })
    expect(await ids()).toEqual([uid(5)])
    const second = await purgeOrphanMantencionPhotos({ now: NOW, batchSize: 2 })
    expect(second).toMatchObject({ found: 1, deletedRows: 1, hasMore: false })
  })

  it("no pierde la foto de un registro que la reclama entre la consulta y el borrado", async () => {
    // El borrado exige `record_id IS NULL` en la misma sentencia: una fila anclada a último momento no sale.
    const file = await photo(uid(8), 40)
    const realDb = testGlobal.__db!
    let claimed = false
    const claimOnce = async () => {
      if (claimed) return
      claimed = true
      testGlobal.__db = realDb
      try { await claim(uid(8)) } finally { testGlobal.__db = racing }
    }
    const racing: DB = new Proxy(realDb, {
      get(target, prop, receiver) {
        if (prop !== "delete") return Reflect.get(target, prop, receiver)
        return (...args: Parameters<DB["delete"]>) => ({
          where: (...whereArgs: Parameters<ReturnType<DB["delete"]>["where"]>) => ({
            returning: (...returningArgs: unknown[]) => {
              const built = (target.delete(...args).where(...whereArgs) as unknown as { returning: (...a: unknown[]) => PromiseLike<unknown> }).returning(...returningArgs)
              // Entre el SELECT del lote y el DELETE llega el registro que la nombra.
              return { then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => claimOnce().then(() => built).then(resolve, reject) }
            },
          }),
        })
      },
    })
    testGlobal.__db = racing
    try {
      expect((await purgeOrphanMantencionPhotos({ now: NOW })).deletedRows).toBe(0)
    } finally {
      testGlobal.__db = realDb
    }
    expect(await ids()).toEqual([uid(8)])
    expect(existsSync(file)).toBe(true)
  })
})

describe("GET /api/cron/mantencion-fotos-huerfanas", () => {
  const call = (auth?: string) => GET(new NextRequest("http://app:3000/api/cron/mantencion-fotos-huerfanas", { headers: auth ? { authorization: auth } : {} }))

  it("sin el secreto responde 401 y no borra nada", async () => {
    await photo(uid(9), 30)
    const response = await call()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ outcome: "unauthorized", code: "MANTENCION_CRON_UNAUTHORIZED" })
    expect(await ids()).toEqual([uid(9)])
  })

  it("con el secreto barre las huérfanas vencidas y deja constancia en la bitácora de corridas", async () => {
    const file = await photo(uid(10), 30)
    const response = await call("Bearer secreto-gc")
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, outcome: "success", code: "MANTENCION_CRON_SUCCESS", deletedRows: 1, deletedFiles: 1 })
    expect(await ids()).toEqual([])
    expect(existsSync(file)).toBe(false)
    const runs = await testDb.select().from(schema.cronRuns)
    expect(runs.map((run) => [run.jobName, run.outcome])).toEqual([["mantencion-fotos-huerfanas", "success"]])
  })
})
