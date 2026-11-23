/**
 * Aviso de las apps del teléfono (`POST /api/pwa/aviso` y `recordPwaHeartbeat`).
 * El upsert y el conteo por día viven en SQL, por eso se prueba contra Postgres.
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
vi.mock("@/lib/services/module-toggles", () => ({
  isRouteOperational: vi.fn(async () => moduleOn.value),
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const NOW = new Date("2026-11-22T15:00:00.000Z")
const HASH_ACTIVE = "a".repeat(64)
const HASH_REVOKED = "b".repeat(64)
const TOKEN_OK = "token-mecanico-vigente"
const TOKEN_REVOKED = "token-mecanico-revocado"

const { hashDeviceToken } = await import("@/lib/services/mantencion/device-credentials")
const { recordPwaHeartbeat } = await import("@/lib/services/pwa-heartbeat")
const { POST } = await import("@/app/api/pwa/aviso/route")
const { isPublicPath } = await import("@/lib/security/public-paths")

await inMemoryDb.insert(schema.users).values([
  { id: "u-hb-mec", name: "QA Mecánico", email: "qa-hb-mec@example.com", hashedPassword: "x" },
  { id: "u-hb-otro", name: "QA Otro", email: "qa-hb-otro@example.com", hashedPassword: "x" },
])
await inMemoryDb.insert(schema.worksites).values({ id: "ws-hb-1", name: "QA Faena aviso", code: "QA-HB-1" })
await inMemoryDb.insert(schema.fuelTaePublicLinks).values([
  { id: "lnk-hb-activo", worksiteId: "ws-hb-1", label: "QA enlace activo", tokenHash: HASH_ACTIVE, createdBy: "u-hb-mec" },
  { id: "lnk-hb-revocado", worksiteId: "ws-hb-1", label: "QA enlace revocado", tokenHash: HASH_REVOKED, createdBy: "u-hb-mec", revokedAt: "2026-11-01T00:00:00.000Z" },
])
const future = new Date(Date.now() + 30 * 86_400_000).toISOString()
await inMemoryDb.insert(schema.mantDeviceCredentials).values([
  { id: "cred-hb-ok", userId: "u-hb-mec", deviceId: "dev-cred-1", tokenHash: hashDeviceToken(TOKEN_OK), expiresAt: future },
  { id: "cred-hb-rev", userId: "u-hb-otro", deviceId: "dev-cred-2", tokenHash: hashDeviceToken(TOKEN_REVOKED), expiresAt: future, revokedAt: "2026-11-02T00:00:00.000Z" },
])

let counter = 0
const newDeviceId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> & { deviceId: string } {
  return {
    app: "ppa",
    deviceId: newDeviceId(),
    version: "abc123def456",
    builtAt: "2026-11-20T10:00:00.000Z",
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

beforeEach(() => { moduleOn.value = true })

describe("servicio del aviso", () => {
  it("primer aviso crea el teléfono y suma el día", async () => {
    const body = payload({ pending: 2 })
    expect(await recordPwaHeartbeat(asHeartbeat(body), { bearer: null, now: NOW })).toBe("recorded")
    const row = await deviceRow("ppa", body.deviceId)
    expect(row.pendingCount).toBe(2)
    expect(row.firstSeenAt).toBeTruthy()
    const days = await inMemoryDb.select().from(schema.pwaDeviceDays).where(eq(schema.pwaDeviceDays.deviceId, body.deviceId))
    expect(days).toHaveLength(1)
    // 12:00 en Chile (UTC-3 en noviembre)
    expect(days[0]).toMatchObject({ app: "ppa", day: "2026-11-22", reports: 1 })

    await recordPwaHeartbeat(asHeartbeat({ ...body, pending: 0 }), { bearer: null, now: new Date("2026-11-22T16:00:00.000Z") })
    const after = await inMemoryDb.select().from(schema.pwaDeviceDays).where(eq(schema.pwaDeviceDays.deviceId, body.deviceId))
    expect(after).toHaveLength(1)
    expect(after[0]?.reports).toBe(2)
    const second = await deviceRow("ppa", body.deviceId)
    expect(second.pendingCount).toBe(0)
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

  it("fechas del futuro se recortan a la recepción", async () => {
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

  it("credencial válida asocia la persona; una revocada no la borra", async () => {
    const body = payload({ app: "mantencion" })
    await recordPwaHeartbeat(asHeartbeat(body), { bearer: TOKEN_OK, now: NOW })
    expect((await deviceRow("mantencion", body.deviceId)).userId).toBe("u-hb-mec")

    await recordPwaHeartbeat(asHeartbeat(body), { bearer: TOKEN_REVOKED, now: NOW })
    expect((await deviceRow("mantencion", body.deviceId)).userId).toBe("u-hb-mec")
    await recordPwaHeartbeat(asHeartbeat(body), { bearer: "inventado", now: NOW })
    await recordPwaHeartbeat(asHeartbeat(body), { bearer: null, now: NOW })
    expect((await deviceRow("mantencion", body.deviceId)).userId).toBe("u-hb-mec")

    // Una credencial revocada sola deja el aviso anónimo, pero se guarda.
    const anon = payload({ app: "mantencion" })
    await recordPwaHeartbeat(asHeartbeat(anon), { bearer: TOKEN_REVOKED, now: NOW })
    expect((await deviceRow("mantencion", anon.deviceId)).userId).toBeNull()
  })

  it("una credencial válida reemplaza a la persona anterior", async () => {
    const body = payload({ app: "mantencion" })
    await inMemoryDb.insert(schema.pwaDevices).values({
      app: "mantencion", deviceId: body.deviceId, lastSeenAt: "2026-11-01T00:00:00.000Z", version: "x",
      installed: true, platform: "p", userId: "u-hb-otro",
    })
    await recordPwaHeartbeat(asHeartbeat(body), { bearer: TOKEN_OK, now: NOW })
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
    const days = await inMemoryDb.select().from(schema.pwaDeviceDays).where(eq(schema.pwaDeviceDays.deviceId, body.deviceId))
    expect(days).toHaveLength(0)
  })
})

describe("POST /api/pwa/aviso", () => {
  it("es una ruta pública exacta", () => {
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
    const res = await POST(request(body, { authorization: `Bearer ${TOKEN_OK}` }))
    expect(res.status).toBe(204)
    expect((await deviceRow("mantencion", body.deviceId)).userId).toBe("u-hb-mec")
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
