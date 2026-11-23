/**
 * Aviso de las apps del teléfono (`POST /api/pwa/aviso` y `recordPwaHeartbeat`).
 * El upsert, la purga y el alta por IP viven en SQL, por eso se prueba contra Postgres.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as unknown as { __db?: typeof inMemoryDb }
testGlobal.__db = inMemoryDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const moduleOn = vi.hoisted(() => ({ value: true }))
/** Cuando trae un error, `recordPwaHeartbeat` lo lanza en vez de guardar (para probar el 400/500 de la ruta). */
const forced = vi.hoisted(() => ({ error: null as unknown }))
vi.mock("@/lib/services/module-toggles", () => ({
  isRouteOperational: vi.fn(async () => moduleOn.value),
}))

vi.mock("@/lib/services/pwa-heartbeat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/pwa-heartbeat")>()
  return {
    ...actual,
    recordPwaHeartbeat: async (...args: Parameters<typeof actual.recordPwaHeartbeat>) => {
      if (forced.error) throw forced.error
      return actual.recordPwaHeartbeat(...args)
    },
  }
})

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const NOW = new Date("2026-11-22T15:00:00.000Z")
const HASH_ACTIVE = "a".repeat(64)
const HASH_REVOKED = "b".repeat(64)
const DAY = 86_400_000

const { hashDeviceToken } = await import("@/lib/services/mantencion/device-credentials")
const { recordPwaHeartbeat } = await import("@/lib/services/pwa-heartbeat")
const { POST } = await import("@/app/api/pwa/aviso/route")
const { isPublicPath } = await import("@/lib/security/public-paths")
const { logger } = await import("@/lib/logger")

await inMemoryDb.insert(schema.users).values([
  { id: "u-hb-mec", name: "QA Mecánico", email: "qa-hb-mec@example.com", hashedPassword: "x" },
  { id: "u-hb-otro", name: "QA Otro", email: "qa-hb-otro@example.com", hashedPassword: "x" },
  { id: "u-hb-baja", name: "QA Inactivo", email: "qa-hb-baja@example.com", hashedPassword: "x", isActive: false },
  { id: "u-hb-sinperm", name: "QA Sin permiso", email: "qa-hb-sinperm@example.com", hashedPassword: "x" },
  { id: "u-hb-clave", name: "QA Clave cambiada", email: "qa-hb-clave@example.com", hashedPassword: "x", sessionsValidFrom: "2026-11-21T00:00:00.000Z" },
])
await inMemoryDb.insert(schema.permissions).values({ id: "perm-mant-app-use", name: "mant:app:use", module: "mantencion" })
await inMemoryDb.insert(schema.userPermissions).values(
  ["u-hb-mec", "u-hb-otro", "u-hb-baja", "u-hb-clave"].map((userId) => ({ userId, permissionId: "perm-mant-app-use" })),
)
await inMemoryDb.insert(schema.worksites).values({ id: "ws-hb-1", name: "QA Faena aviso", code: "QA-HB-1" })
await inMemoryDb.insert(schema.fuelTaePublicLinks).values([
  { id: "lnk-hb-activo", worksiteId: "ws-hb-1", label: "QA enlace activo", tokenHash: HASH_ACTIVE, createdBy: "u-hb-mec" },
  { id: "lnk-hb-revocado", worksiteId: "ws-hb-1", label: "QA enlace revocado", tokenHash: HASH_REVOKED, createdBy: "u-hb-mec", revokedAt: "2026-11-01T00:00:00.000Z" },
])

/** Emite una credencial de dispositivo para (persona, teléfono) y devuelve su token. */
let credentialCounter = 0
async function issueCredential(
  userId: string,
  deviceId: string,
  overrides: Partial<typeof schema.mantDeviceCredentials.$inferInsert> = {},
): Promise<string> {
  const token = `token-hb-${++credentialCounter}`
  await inMemoryDb.insert(schema.mantDeviceCredentials).values({
    id: `cred-hb-${credentialCounter}`,
    userId,
    deviceId,
    tokenHash: hashDeviceToken(token),
    expiresAt: new Date(Date.now() + 30 * DAY).toISOString(),
    createdAt: "2026-11-10T00:00:00.000Z",
    ...overrides,
  })
  return token
}

let counter = 0
const newDeviceId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> & { deviceId: string } {
  return {
    app: "ppa",
    deviceId: newDeviceId(),
    version: "abc123def456",
    builtAt: "2026-11-20T10:00:00.000Z",
    sentAt: NOW.toISOString(),
    installed: true,
    platform: "Android · Chrome",
    pending: 0,
    failed: 0,
    oldestPendingAt: null,
    lastAttemptAt: null,
    lastError: null,
    ...overrides,
  }
}

type Payload = ReturnType<typeof payload>
const asHeartbeat = (value: Payload) => value as unknown as Parameters<typeof recordPwaHeartbeat>[0]

async function maybeDeviceRow(app: string, deviceId: string) {
  const [row] = await inMemoryDb.select().from(schema.pwaDevices)
    .where(and(eq(schema.pwaDevices.app, app), eq(schema.pwaDevices.deviceId, deviceId)))
  return row
}

async function deviceRow(app: string, deviceId: string) {
  const row = await maybeDeviceRow(app, deviceId)
  if (!row) throw new Error(`sin fila para ${app}/${deviceId}`)
  return row
}

function request(body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body)
  return new Request("http://localhost/api/pwa/aviso", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: text,
  })
}

beforeEach(() => {
  moduleOn.value = true
  forced.error = null
})

describe("servicio del aviso", () => {
  it("primer aviso crea el teléfono; el siguiente lo actualiza sin tocar first_seen_at", async () => {
    const body = payload({ pending: 2 })
    expect(await recordPwaHeartbeat(asHeartbeat(body), { bearer: null, now: NOW })).toBe("recorded")
    const row = await deviceRow("ppa", body.deviceId)
    expect(row.pendingCount).toBe(2)
    expect(row.firstSeenAt).toBeTruthy()

    const later = new Date("2026-11-22T16:00:00.000Z")
    await recordPwaHeartbeat(asHeartbeat({ ...body, sentAt: later.toISOString(), pending: 0 }), { bearer: null, now: later })
    const second = await deviceRow("ppa", body.deviceId)
    expect(second.pendingCount).toBe(0)
    expect(new Date(second.lastSeenAt).getTime()).toBe(later.getTime())
    expect(new Date(second.firstSeenAt).getTime()).toBe(new Date(row.firstSeenAt).getTime())
  })

  it("el último error se conserva cuando el siguiente llega sin error", async () => {
    const body = payload({ failed: 1, lastError: "El servidor rechazó el envío" })
    await recordPwaHeartbeat(asHeartbeat(body), { bearer: null, now: NOW })
    await recordPwaHeartbeat(asHeartbeat({ ...body, failed: 0, lastError: null }), { bearer: null, now: new Date("2026-11-22T16:00:00.000Z") })
    const row = await deviceRow("ppa", body.deviceId)
    expect(row.failedCount).toBe(0)
    expect(row.lastError).toBe("El servidor rechazó el envío")
    expect(new Date(row.lastErrorAt as string).toISOString()).toBe(NOW.toISOString())
  })

  it("last_error_at es cuándo apareció el error: el mismo mensaje repetido no lo re-estampa, uno distinto sí", async () => {
    const t1 = new Date("2026-11-22T16:00:00.000Z")
    const t2 = new Date("2026-11-22T17:00:00.000Z")
    const body = payload({ failed: 1, lastError: "El servidor rechazó el envío" })
    await recordPwaHeartbeat(asHeartbeat(body), { bearer: null, now: NOW })
    await recordPwaHeartbeat(asHeartbeat({ ...body, sentAt: t1.toISOString() }), { bearer: null, now: t1 })
    let row = await deviceRow("ppa", body.deviceId)
    expect(row.lastError).toBe("El servidor rechazó el envío")
    expect(new Date(row.lastErrorAt as string).toISOString()).toBe(NOW.toISOString())

    await recordPwaHeartbeat(asHeartbeat({ ...body, sentAt: t2.toISOString(), lastError: "Otro error distinto" }), { bearer: null, now: t2 })
    row = await deviceRow("ppa", body.deviceId)
    expect(row.lastError).toBe("Otro error distinto")
    expect(new Date(row.lastErrorAt as string).toISOString()).toBe(t2.toISOString())
  })

  it("last_attempt_at se conserva cuando el aviso siguiente no trae fecha de intento", async () => {
    const body = payload({ lastAttemptAt: "2026-11-22T14:30:00.000Z" })
    await recordPwaHeartbeat(asHeartbeat(body), { bearer: null, now: NOW })
    await recordPwaHeartbeat(asHeartbeat({ ...body, lastAttemptAt: null }), { bearer: null, now: NOW })
    expect(new Date((await deviceRow("ppa", body.deviceId)).lastAttemptAt as string).toISOString()).toBe("2026-11-22T14:30:00.000Z")
    await recordPwaHeartbeat(asHeartbeat({ ...body, lastAttemptAt: "2026-11-22T14:45:00.000Z" }), { bearer: null, now: NOW })
    expect(new Date((await deviceRow("ppa", body.deviceId)).lastAttemptAt as string).toISOString()).toBe("2026-11-22T14:45:00.000Z")
  })

  it("fechas del futuro se recortan a la recepción; builtAt también", async () => {
    const future2h = new Date(NOW.getTime() + 2 * 3_600_000).toISOString()
    const body = payload({ pending: 1, oldestPendingAt: future2h, lastAttemptAt: future2h, builtAt: future2h })
    await recordPwaHeartbeat(asHeartbeat(body), { bearer: null, now: NOW })
    const row = await deviceRow("ppa", body.deviceId)
    for (const value of [row.oldestPendingAt, row.lastAttemptAt, row.builtAt]) {
      expect(new Date(value as string).toISOString()).toBe(NOW.toISOString())
    }
    // Una fecha pasada se respeta.
    const past = payload({ oldestPendingAt: "2026-11-22T10:00:00.000Z" })
    await recordPwaHeartbeat(asHeartbeat(past), { bearer: null, now: NOW })
    expect(new Date((await deviceRow("ppa", past.deviceId)).oldestPendingAt as string).toISOString()).toBe("2026-11-22T10:00:00.000Z")
  })

  it("reloj del teléfono 3 h atrasado: el pendiente de hace 10 min queda de hace 10 min, no de 3 h 10", async () => {
    const skewMs = 3 * 3_600_000
    const phoneNow = new Date(NOW.getTime() - skewMs)
    const tenMinAgoOnPhone = new Date(phoneNow.getTime() - 10 * 60_000)
    const body = payload({
      sentAt: phoneNow.toISOString(),
      oldestPendingAt: tenMinAgoOnPhone.toISOString(),
      lastAttemptAt: tenMinAgoOnPhone.toISOString(),
      pending: 1,
    })
    await recordPwaHeartbeat(asHeartbeat(body), { bearer: null, now: NOW })
    const row = await deviceRow("ppa", body.deviceId)
    const expected = NOW.getTime() - 10 * 60_000
    expect(Math.abs(new Date(row.oldestPendingAt as string).getTime() - expected)).toBeLessThan(1000)
    expect(Math.abs(new Date(row.lastAttemptAt as string).getTime() - expected)).toBeLessThan(1000)
    // builtAt viene del build, no del reloj: no se corrige.
    expect(new Date(row.builtAt as string).toISOString()).toBe("2026-11-20T10:00:00.000Z")
  })

  it("reloj adelantado 2 h: el pendiente se corrige hacia atrás y nunca pasa de la recepción", async () => {
    const phoneNow = new Date(NOW.getTime() + 2 * 3_600_000)
    const body = payload({
      sentAt: phoneNow.toISOString(),
      oldestPendingAt: new Date(phoneNow.getTime() - 30 * 60_000).toISOString(),
      lastAttemptAt: phoneNow.toISOString(),
    })
    await recordPwaHeartbeat(asHeartbeat(body), { bearer: null, now: NOW })
    const row = await deviceRow("ppa", body.deviceId)
    expect(Math.abs(new Date(row.oldestPendingAt as string).getTime() - (NOW.getTime() - 30 * 60_000))).toBeLessThan(1000)
    expect(new Date(row.lastAttemptAt as string).getTime()).toBeLessThanOrEqual(NOW.getTime())
  })

  it("credencial de este teléfono asocia la persona; una revocada, ajena o inventada no la borra", async () => {
    const body = payload({ app: "mantencion" })
    const ok = await issueCredential("u-hb-mec", body.deviceId)
    await recordPwaHeartbeat(asHeartbeat(body), { bearer: ok, now: NOW })
    expect((await deviceRow("mantencion", body.deviceId)).userId).toBe("u-hb-mec")

    const revoked = await issueCredential("u-hb-otro", body.deviceId, { revokedAt: "2026-11-02T00:00:00.000Z" })
    await recordPwaHeartbeat(asHeartbeat(body), { bearer: revoked, now: NOW })
    await recordPwaHeartbeat(asHeartbeat(body), { bearer: "inventado", now: NOW })
    await recordPwaHeartbeat(asHeartbeat(body), { bearer: null, now: NOW })
    expect((await deviceRow("mantencion", body.deviceId)).userId).toBe("u-hb-mec")

    // Una credencial revocada sola deja el aviso anónimo, pero se guarda.
    const anon = payload({ app: "mantencion" })
    const revokedAlone = await issueCredential("u-hb-otro", anon.deviceId, { revokedAt: "2026-11-02T00:00:00.000Z" })
    await recordPwaHeartbeat(asHeartbeat(anon), { bearer: revokedAlone, now: NOW })
    expect((await deviceRow("mantencion", anon.deviceId)).userId).toBeNull()
  })

  it("una credencial de otro teléfono no asocia a nadie (el aviso se guarda anónimo)", async () => {
    const body = payload({ app: "mantencion" })
    const other = await issueCredential("u-hb-mec", newDeviceId())
    expect(await recordPwaHeartbeat(asHeartbeat(body), { bearer: other, now: NOW })).toBe("recorded")
    expect((await deviceRow("mantencion", body.deviceId)).userId).toBeNull()
  })

  it("una persona dada de baja, sin permiso de la app o con la clave cambiada después de la credencial no se asocia", async () => {
    for (const userId of ["u-hb-baja", "u-hb-sinperm", "u-hb-clave"]) {
      const body = payload({ app: "mantencion" })
      const token = await issueCredential(userId, body.deviceId)
      expect(await recordPwaHeartbeat(asHeartbeat(body), { bearer: token, now: NOW })).toBe("recorded")
      expect((await deviceRow("mantencion", body.deviceId)).userId, userId).toBeNull()
    }
  })

  it("el aviso no refresca last_used_at de la credencial", async () => {
    const body = payload({ app: "mantencion" })
    const staleUse = "2026-11-12T08:00:00.000Z"
    const token = await issueCredential("u-hb-mec", body.deviceId, { lastUsedAt: staleUse })
    await recordPwaHeartbeat(asHeartbeat(body), { bearer: token, now: NOW })
    expect((await deviceRow("mantencion", body.deviceId)).userId).toBe("u-hb-mec")
    const [cred] = await inMemoryDb.select().from(schema.mantDeviceCredentials)
      .where(eq(schema.mantDeviceCredentials.tokenHash, hashDeviceToken(token)))
    expect(new Date(cred?.lastUsedAt as string).toISOString()).toBe(staleUse)

    const never = payload({ app: "mantencion" })
    const fresh = await issueCredential("u-hb-otro", never.deviceId)
    await recordPwaHeartbeat(asHeartbeat(never), { bearer: fresh, now: NOW })
    const [cred2] = await inMemoryDb.select().from(schema.mantDeviceCredentials)
      .where(eq(schema.mantDeviceCredentials.tokenHash, hashDeviceToken(fresh)))
    expect(cred2?.lastUsedAt).toBeNull()
  })

  it("una credencial válida reemplaza a la persona anterior", async () => {
    const body = payload({ app: "mantencion" })
    await inMemoryDb.insert(schema.pwaDevices).values({
      app: "mantencion", deviceId: body.deviceId, lastSeenAt: "2026-11-01T00:00:00.000Z", version: "x",
      installed: true, platform: "p", userId: "u-hb-otro",
    })
    const token = await issueCredential("u-hb-mec", body.deviceId)
    await recordPwaHeartbeat(asHeartbeat(body), { bearer: token, now: NOW })
    expect((await deviceRow("mantencion", body.deviceId)).userId).toBe("u-hb-mec")
  })

  it("un enlace revocado igual se asocia, y trae la faena del enlace", async () => {
    const revoked = payload({ app: "tae", linkHash: HASH_REVOKED })
    await recordPwaHeartbeat(asHeartbeat(revoked), { bearer: null, now: NOW })
    expect(await deviceRow("tae", revoked.deviceId)).toMatchObject({ taeLinkId: "lnk-hb-revocado", worksiteId: "ws-hb-1" })

    const active = payload({ app: "tae", linkHash: HASH_ACTIVE })
    await recordPwaHeartbeat(asHeartbeat(active), { bearer: null, now: NOW })
    expect((await deviceRow("tae", active.deviceId)).taeLinkId).toBe("lnk-hb-activo")

    // Un hash desconocido no borra la asociación previa.
    await recordPwaHeartbeat(asHeartbeat({ ...active, linkHash: "c".repeat(64) }), { bearer: null, now: NOW })
    expect((await deviceRow("tae", active.deviceId)).taeLinkId).toBe("lnk-hb-activo")
  })

  it("worksiteId de PPA: se guarda si existe y se ignora si no", async () => {
    const ok = payload({ worksiteId: "ws-hb-1" })
    await recordPwaHeartbeat(asHeartbeat(ok), { bearer: null, now: NOW })
    expect((await deviceRow("ppa", ok.deviceId)).worksiteId).toBe("ws-hb-1")

    const ghost = payload({ worksiteId: "ws-que-no-existe" })
    await recordPwaHeartbeat(asHeartbeat(ghost), { bearer: null, now: NOW })
    expect((await deviceRow("ppa", ghost.deviceId)).worksiteId).toBeNull()
  })

  it("módulo apagado: no se escribe", async () => {
    moduleOn.value = false
    const body = payload()
    expect(await recordPwaHeartbeat(asHeartbeat(body), { bearer: null, now: NOW })).toBe("module_off")
    expect(await maybeDeviceRow("ppa", body.deviceId)).toBeUndefined()
  })

  it("al aparecer un teléfono nuevo se purgan los que no avisan hace más de 180 días; actualizar uno existente no purga", async () => {
    const base = { version: "x", installed: true, platform: "p" }
    const oldId = newDeviceId()
    const edgeId = newDeviceId()
    const staleButKept = newDeviceId()
    await inMemoryDb.insert(schema.pwaDevices).values([
      { app: "ppa", deviceId: oldId, lastSeenAt: new Date(NOW.getTime() - 200 * DAY).toISOString(), ...base },
      { app: "tae", deviceId: edgeId, lastSeenAt: new Date(NOW.getTime() - 181 * DAY).toISOString(), ...base },
      { app: "ppa", deviceId: staleButKept, lastSeenAt: new Date(NOW.getTime() - 100 * DAY).toISOString(), ...base },
    ])

    // Un aviso de un teléfono que ya existía no dispara la purga.
    await recordPwaHeartbeat(asHeartbeat(payload({ deviceId: staleButKept })), { bearer: null, now: NOW })
    expect(await maybeDeviceRow("ppa", oldId)).toBeDefined()
    expect(await maybeDeviceRow("tae", edgeId)).toBeDefined()

    // Uno nuevo sí.
    const fresh = payload()
    await recordPwaHeartbeat(asHeartbeat(fresh), { bearer: null, now: NOW })
    expect(await maybeDeviceRow("ppa", oldId)).toBeUndefined()
    expect(await maybeDeviceRow("tae", edgeId)).toBeUndefined()
    expect(await maybeDeviceRow("ppa", staleButKept)).toBeDefined()
    expect(await maybeDeviceRow("ppa", fresh.deviceId)).toBeDefined()
  })
})

describe("POST /api/pwa/aviso", () => {
  it("es una ruta pública y no abre otras de /api/pwa", () => {
    expect(isPublicPath("/api/pwa/aviso")).toBe(true)
    expect(isPublicPath("/api/pwa/otra")).toBe(false)
  })

  it("payload válido: 204 con cuerpo vacío y fila guardada", async () => {
    const body = payload({ pending: 3 })
    const res = await POST(request(body))
    expect(res.status).toBe(204)
    expect(await res.text()).toBe("")
    expect((await deviceRow("ppa", body.deviceId)).pendingCount).toBe(3)
  })

  it("campo extra: 400 sin escribir", async () => {
    const body = payload({ rut: "11.111.111-1" })
    const res = await POST(request(body))
    expect(res.status).toBe(400)
    expect(await res.text()).toBe("")
    expect(await maybeDeviceRow("ppa", body.deviceId)).toBeUndefined()
  })

  it("conteo negativo, enorme, cadena larga y JSON roto: 400 sin escribir", async () => {
    for (const bad of [payload({ pending: -1 }), payload({ failed: 10_001 }), payload({ lastError: "x".repeat(201) })]) {
      const res = await POST(request(bad))
      expect(res.status).toBe(400)
      expect(await maybeDeviceRow("ppa", bad.deviceId)).toBeUndefined()
    }
    expect((await POST(request("{no es json"))).status).toBe(400)
  })

  it("cuerpo de 5000 bytes: 413", async () => {
    const res = await POST(request(payload({ lastError: "x".repeat(5000) })))
    expect(res.status).toBe(413)
    expect(await res.text()).toBe("")
  })

  it("cuerpo grande sin Content-Length también: 413", async () => {
    const big = new Request("http://localhost/api/pwa/aviso", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("x".repeat(3000)))
          controller.enqueue(new TextEncoder().encode("x".repeat(3000)))
          controller.close()
        },
      }),
      // @ts-expect-error — `duplex` es requerido por undici para cuerpos en stream
      duplex: "half",
    })
    expect((await POST(big)).status).toBe(413)
  })

  it("módulo apagado: 204 y nada escrito", async () => {
    moduleOn.value = false
    const body = payload()
    expect((await POST(request(body))).status).toBe(204)
    expect(await maybeDeviceRow("ppa", body.deviceId)).toBeUndefined()
  })

  it("el Bearer de Mantención asocia la persona", async () => {
    const body = payload({ app: "mantencion" })
    const token = await issueCredential("u-hb-mec", body.deviceId)
    const res = await POST(request(body, { authorization: `Bearer ${token}` }))
    expect(res.status).toBe(204)
    expect((await deviceRow("mantencion", body.deviceId)).userId).toBe("u-hb-mec")
  })

  it("fecha anterior a 2020 o texto con byte nulo: 400 sin escribir, sin 500 ni logger.error", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined)
    try {
      const bad = [
        payload({ builtAt: "0000-01-01T00:00:00Z" }),
        payload({ sentAt: "0000-01-01T00:00:00Z" }),
        payload({ oldestPendingAt: "0000-01-01T00:00:00Z" }),
        payload({ lastAttemptAt: "1999-12-31T23:59:59Z" }),
        payload({ lastError: "mal\u0000error" }),
        payload({ version: "v\u0000" }),
        payload({ platform: "Android\nChrome" }),
        payload({ worksiteId: "ws\u0000" }),
      ]
      for (const body of bad) {
        const res = await POST(request(body))
        expect(res.status).toBe(400)
        expect(await res.text()).toBe("")
        expect(await maybeDeviceRow("ppa", body.deviceId)).toBeUndefined()
      }
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it("un error de datos de Postgres (clase 22) es 400 y se registra como aviso, sin el Error", async () => {
    // El error real: el servicio, llamado sin pasar por el esquema, con un byte nulo.
    const poisoned = asHeartbeat(payload({ version: "a\u0000b" }))
    let real: unknown
    try {
      await recordPwaHeartbeat(poisoned, { bearer: null, now: NOW })
    } catch (error) {
      real = error
    }
    expect(real).toBeInstanceOf(Error)

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined)
    try {
      forced.error = real
      const res = await POST(request(payload()))
      expect(res.status).toBe(400)
      expect(await res.text()).toBe("")
      expect(errorSpy).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0]?.every((arg) => !(arg instanceof Error))).toBe(true)

      // Cualquier otro fallo sigue siendo 500 con logger.error.
      forced.error = new Error("la base se cayó")
      expect((await POST(request(payload()))).status).toBe(500)
      expect(errorSpy).toHaveBeenCalledTimes(1)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })

  it("petición de otro sitio: 403 sin escribir", async () => {
    const casos: Array<Record<string, string>> = [
      { "sec-fetch-site": "cross-site" },
      { origin: "https://sitio-ajeno.example", host: "plataforma.example" },
      { origin: "null" },
    ]
    for (const headers of casos) {
      const body = payload()
      const res = await POST(request(body, headers))
      expect(res.status).toBe(403)
      expect(await res.text()).toBe("")
      expect(await maybeDeviceRow("ppa", body.deviceId)).toBeUndefined()
    }
    // El mismo sitio, o sin cabeceras de navegador (la app instalada), pasa.
    expect((await POST(request(payload(), { "sec-fetch-site": "same-origin" }))).status).toBe(204)
  })

  it("sin Content-Type application/json: 415 sin escribir (text/plain es lo único que un fetch no-cors de otro sitio puede mandar)", async () => {
    for (const contentType of ["text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", null]) {
      const body = payload()
      const req = new Request("http://localhost/api/pwa/aviso", {
        method: "POST",
        headers: contentType ? { "content-type": contentType } : {},
        body: JSON.stringify(body),
      })
      if (!contentType) req.headers.delete("content-type")
      const res = await POST(req)
      expect(res.status).toBe(415)
      expect(await res.text()).toBe("")
      expect(await maybeDeviceRow("ppa", body.deviceId)).toBeUndefined()
    }
    expect((await POST(request(payload(), { "content-type": "application/json; charset=utf-8" }))).status).toBe(204)
  })

  it("60 teléfonos nuevos por IP y hora: el 61.º es 429; uno ya conocido sigue pasando", async () => {
    const ip = { "cf-connecting-ip": "203.0.113.77" }
    const first = payload()
    expect((await POST(request(first, ip))).status).toBe(204)
    for (let i = 1; i < 60; i += 1) expect((await POST(request(payload(), ip))).status).toBe(204)

    const blocked = payload()
    const res = await POST(request(blocked, ip))
    expect(res.status).toBe(429)
    expect(await res.text()).toBe("")
    expect(await maybeDeviceRow("ppa", blocked.deviceId)).toBeUndefined()

    // El teléfono ya conocido no consume la cuota de altas.
    expect((await POST(request(first, ip))).status).toBe(204)
    // Otra IP no se ve afectada.
    expect((await POST(request(payload(), { "cf-connecting-ip": "203.0.113.78" }))).status).toBe(204)
  })

  it("21 avisos del mismo teléfono en 5 min: el 21.º es 429", async () => {
    const body = payload()
    for (let i = 0; i < 20; i += 1) expect((await POST(request(body))).status).toBe(204)
    const res = await POST(request(body))
    expect(res.status).toBe(429)
    expect(await res.text()).toBe("")
    // Otro teléfono no se ve afectado.
    expect((await POST(request(payload()))).status).toBe(204)
  })
})
