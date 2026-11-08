import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/**
 * El helper de ajustes cifrados contra un Postgres real (PGlite): guarda, lee,
 * cae al `.env`, sobrevive a la rotación del llavero y NO cae al `.env` cuando
 * el sobre ya no se puede abrir. Las pruebas unitarias simulan la BD; ésta
 * verifica las consultas, el upsert, la auditoría con su FK y la rotación real.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof testDb }
// @ts-expect-error PGlite es compatible en tiempo de ejecución
testGlobal.__db = testDb

const USER = "u-settings-admin"
const KEY_A = Buffer.alloc(32, 3).toString("base64url")
const KEY_B = Buffer.alloc(32, 5).toString("base64url")
const KEY_C = Buffer.alloc(32, 8).toString("base64url")

function useKeyring(keys: Record<string, string>, active: string) {
  vi.stubEnv("DTE_SETTINGS_KEYRING", JSON.stringify(keys))
  vi.stubEnv("DTE_SETTINGS_ACTIVE_KEY_ID", active)
  vi.stubEnv("DTE_SETTINGS_MODE", "compat")
}

const { defineSettingsGroup, readSettingsGroup, readSettingsAdminStatus, saveSettingsGroup, clearSettingsGroup } =
  await import("@/lib/services/encrypted-settings")

// Mismas keys que usa Talana: la secreta está registrada para la rotación.
const group = defineSettingsGroup({
  name: "pglite",
  entityType: "talana_settings",
  entityId: "talana",
  fields: {
    apiToken: { key: "talana.api_token", secret: true },
    mode: { key: "talana.sync_mode", secret: false },
  },
})
const ENV = { apiToken: "token-del-entorno", mode: "off" }
const actor = { userId: USER, userEmail: "admin@test.local" }

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values({
    id: USER, name: "Admin ajustes", email: "admin@test.local", hashedPassword: "x", isActive: true,
  })
})

beforeEach(async () => {
  await testDb.delete(schema.systemSettings)
  await testDb.delete(schema.auditLog)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

async function storedValue(key: string): Promise<string | undefined> {
  const [row] = await testDb.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, key))
  return row?.value
}

describe("ajustes cifrados contra Postgres", () => {
  it("guarda cifrado, lee lo guardado y audita sin el secreto", async () => {
    useKeyring({ a: KEY_A }, "a")
    const result = await saveSettingsGroup(group, { set: { apiToken: "token-guardado", mode: "simulate" } }, actor)
    expect(result.changed).toBe(true)

    expect(await storedValue("talana.api_token")).toMatch(/^enc:v1:a:/)
    expect(await storedValue("talana.sync_mode")).toBe("simulate")

    const resolved = await readSettingsGroup(group, ENV)
    expect(resolved.values).toEqual({ apiToken: "token-guardado", mode: "simulate" })
    expect(resolved.sources).toEqual({ apiToken: "system_settings", mode: "system_settings" })

    const audits = await testDb.select().from(schema.auditLog)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ action: "update", entityType: "talana_settings", entityId: "talana", userId: USER })
    expect(JSON.stringify(audits[0])).not.toContain("token-guardado")
  })

  it("restaurar devuelve el mando al .env", async () => {
    useKeyring({ a: KEY_A }, "a")
    await saveSettingsGroup(group, { set: { apiToken: "token-guardado", mode: "apply" } }, actor)
    await clearSettingsGroup(group, actor)

    const resolved = await readSettingsGroup(group, ENV)
    expect(resolved.values).toEqual(ENV)
    expect(resolved.sources).toEqual({ apiToken: "environment", mode: "environment" })
    const status = await readSettingsAdminStatus(group, ENV)
    expect(status.hasStoredSettings).toBe(false)
  })

  it("después de la rotación del llavero el secreto se abre sólo con la clave nueva", async () => {
    useKeyring({ a: KEY_A }, "a")
    await saveSettingsGroup(group, { set: { apiToken: "token-rotado" } }, actor)
    // La rotación exige el corte a cifrado obligatorio del portal DTE.
    await testDb.insert(schema.systemSettings).values({ key: "dte.encryption_mode", value: "encrypted_only" })

    useKeyring({ a: KEY_A, b: KEY_B }, "b")
    const { rotateDteSettingsKeyring } = await import("@/lib/services/dte-portal/settings")
    const rotation = await rotateDteSettingsKeyring({ userId: USER })
    expect(rotation.keyId).toBe("b")
    expect(await storedValue("talana.api_token")).toMatch(/^enc:v1:b:/)

    // Se retira la clave anterior del host: el secreto sigue abriendo.
    useKeyring({ b: KEY_B }, "b")
    const resolved = await readSettingsGroup(group, ENV)
    expect(resolved.values.apiToken).toBe("token-rotado")
    expect(resolved.sources.apiToken).toBe("system_settings")
  })

  it("un sobre que el servidor ya no puede abrir NO cae al .env", async () => {
    useKeyring({ a: KEY_A }, "a")
    await saveSettingsGroup(group, { set: { apiToken: "token-viejo" } }, actor)

    useKeyring({ c: KEY_C }, "c")
    const resolved = await readSettingsGroup(group, ENV)
    expect(resolved.values.apiToken).toBe("")
    expect(resolved.unreadable).toEqual(["apiToken"])
    const status = await readSettingsAdminStatus(group, ENV)
    expect(status.fields.apiToken).toEqual({ configured: false, source: "missing" })
  })
})
