/**
 * Recuperación de contraseña, contra PostgreSQL real (PGlite).
 *
 * AUTH-002 (auditoría 2026-09-14). La versión anterior de este archivo simulaba
 * `db` con mocks encadenados: comprobaba que se llamara a `update` y a `insert`,
 * no lo que quedaba escrito. Una carrera vive precisamente en lo que queda
 * escrito, así que aquí se ejercita el SQL de verdad.
 *
 * PGlite es de una sola conexión y no permite dos transacciones simultáneas, de
 * modo que no se simula el entrelazado. Lo que sí se verifica son los dos
 * mecanismos que lo hacen imposible: el índice parcial de un único token activo
 * por persona, y el reclamo condicional `WHERE used_at IS NULL ... RETURNING`.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq, isNull } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import path from "node:path"
import crypto from "node:crypto"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const sentEmails: { to: string; subject: string; text: string }[] = []
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: async (mail: { to: string; subject: string; text: string }) => { sentEmails.push(mail) },
  getAppBaseUrl: () => "http://localhost:3001",
}))
const fakeHash = async (pw: string) => `hashed_${pw}`
vi.mock("bcryptjs", () => ({ hash: fakeHash, default: { hash: fakeHash } }))

const {
  requestPasswordReset, validateResetToken, applyPasswordReset,
} = await import("@/lib/services/password-reset")
const { pruneResetTokens } = await import("@/lib/services/password-reset-cleanup")

const USER = "user-pwr-1"
const hashOf = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex")

/** El enlace se emite por correo: leerlo de ahí es lo que hace la persona. */
function tokenFromLastEmail(): string {
  const last = sentEmails.at(-1)
  const match = last?.text.match(/\/recuperar\/([0-9a-f]{64})/)
  if (!match) throw new Error("El correo no traía un enlace de recuperación")
  return match[1]!
}

async function activeTokens(userId = USER) {
  return testDb.select().from(schema.passwordResetTokens).where(and(
    eq(schema.passwordResetTokens.userId, userId),
    isNull(schema.passwordResetTokens.usedAt),
  ))
}

const passwordOf = async (userId = USER) =>
  (await testDb.select({ p: schema.users.hashedPassword })
    .from(schema.users).where(eq(schema.users.id, userId)))[0]?.p

describe("recuperación de contraseña", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await testDb.insert(schema.users).values([
      { id: USER, name: "Juan", email: "juan@test.cl", hashedPassword: "original", isActive: true },
      { id: "user-pwr-off", name: "Ana", email: "ana@test.cl", hashedPassword: "original", isActive: false },
    ])
  })
  afterAll(async () => pg.close())
  beforeEach(async () => {
    sentEmails.length = 0
    await testDb.delete(schema.passwordResetTokens)
    // AUTH-003: la marca de revocación también se limpia entre pruebas.
    await testDb.update(schema.users).set({ hashedPassword: "original", sessionsValidFrom: null })
  })

  describe("emisión", () => {
    it("no emite ni avisa nada para una cuenta que no existe o está inactiva", async () => {
      await requestPasswordReset("nadie@test.cl")
      await requestPasswordReset("ana@test.cl")
      expect(sentEmails).toEqual([])
      expect(await testDb.select().from(schema.passwordResetTokens)).toEqual([])
    })

    it("emite un enlace y guarda sólo su hash, nunca el token", async () => {
      await requestPasswordReset("Juan@Test.CL")   // el correo se normaliza

      expect(sentEmails).toHaveLength(1)
      expect(sentEmails[0]!.to).toBe("juan@test.cl")
      const raw = tokenFromLastEmail()

      const rows = await activeTokens()
      expect(rows).toHaveLength(1)
      expect(rows[0]!.tokenHash).toBe(hashOf(raw))
      expect(rows[0]!.tokenHash).not.toContain(raw)
    })

    it("pedirlo dos veces deja un solo enlace vivo: el anterior muere", async () => {
      await requestPasswordReset("juan@test.cl")
      const primero = tokenFromLastEmail()
      await requestPasswordReset("juan@test.cl")
      const segundo = tokenFromLastEmail()

      expect(segundo).not.toBe(primero)
      expect(await activeTokens()).toHaveLength(1)
      expect((await validateResetToken(primero)).valid).toBe(false)
      expect((await validateResetToken(segundo)).valid).toBe(true)
    })

    /**
     * AUTH-002: el corazón del arreglo. Antes "un solo token activo" era el
     * orden de dos escrituras sueltas, y dos solicitudes entrelazadas dejaban
     * dos enlaces vivos. Ahora lo impone la base.
     */
    it("la base rechaza un segundo token activo para la misma persona", async () => {
      await requestPasswordReset("juan@test.cl")

      await expect(testDb.insert(schema.passwordResetTokens).values({
        id: "t-colado", userId: USER, tokenHash: hashOf("colado"),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      })).rejects.toThrow()

      expect(await activeTokens()).toHaveLength(1)
    })

    it("un token ya usado no ocupa el cupo del siguiente", async () => {
      await requestPasswordReset("juan@test.cl")
      await applyPasswordReset(tokenFromLastEmail(), "clave-nueva-1")
      await requestPasswordReset("juan@test.cl")
      expect(await activeTokens()).toHaveLength(1)
    })
  })

  describe("aplicación", () => {
    it("cambia la contraseña con un enlace válido", async () => {
      await requestPasswordReset("juan@test.cl")
      const result = await applyPasswordReset(tokenFromLastEmail(), "clave-nueva-1")

      expect(result.ok).toBe(true)
      expect(await passwordOf()).toBe("hashed_clave-nueva-1")
      expect(await activeTokens()).toHaveLength(0)
    })

    /*
     * AUTH-003 (auditoría 2026-09-14): el restablecimiento sólo escribía el
     * hash. Con sesiones JWT eso deja intactas las cookies ya emitidas: una
     * sesión robada antes del cambio seguía sirviendo hasta expirar sola,
     * porque no quedaba ningún dato del lado del servidor contra el cual
     * pudiera fallar. Ahora la misma transacción adelanta `sessionsValidFrom`,
     * que es lo que el callback JWT compara.
     */
    it("AUTH-003: restablecer marca desde cuándo valen las sesiones, en la misma transacción", async () => {
      const antes = await testDb.select({ v: schema.users.sessionsValidFrom })
        .from(schema.users).where(eq(schema.users.id, USER))
      expect(antes[0]?.v).toBeNull()

      const inicio = Date.now()
      await requestPasswordReset("juan@test.cl")
      expect((await applyPasswordReset(tokenFromLastEmail(), "clave-nueva-1")).ok).toBe(true)

      const [fila] = await testDb.select({ v: schema.users.sessionsValidFrom })
        .from(schema.users).where(eq(schema.users.id, USER))
      expect(fila?.v).not.toBeNull()
      expect(new Date(fila!.v!).getTime()).toBeGreaterThanOrEqual(inicio - 1000)
    })

    it("AUTH-003: un enlace que no se pudo consumir no revoca ninguna sesión", async () => {
      const fallido = await applyPasswordReset("token-inventado", "clave-del-atacante")
      expect(fallido.ok).toBe(false)

      const [fila] = await testDb.select({ v: schema.users.sessionsValidFrom })
        .from(schema.users).where(eq(schema.users.id, USER))
      expect(fila?.v).toBeNull()
    })

    /**
     * AUTH-002: antes se leía el token, se escribía la contraseña y recién al
     * final se marcaba usado sin condición. Dos aplicaciones del mismo enlace
     * informaban éxito las dos y ganaba la última en confirmar.
     */
    it("el mismo enlace no sirve dos veces, y el segundo intento no toca la contraseña", async () => {
      await requestPasswordReset("juan@test.cl")
      const raw = tokenFromLastEmail()

      expect((await applyPasswordReset(raw, "clave-nueva-1")).ok).toBe(true)

      const segundo = await applyPasswordReset(raw, "clave-del-atacante")
      expect(segundo.ok).toBe(false)
      expect(segundo.error).toMatch(/ya fue utilizado/i)
      expect(await passwordOf()).toBe("hashed_clave-nueva-1")
    })

    it("un enlace vencido no cambia nada", async () => {
      await requestPasswordReset("juan@test.cl")
      const raw = tokenFromLastEmail()
      await testDb.update(schema.passwordResetTokens)
        .set({ expiresAt: "2020-01-01T00:00:00.000Z" })

      const result = await applyPasswordReset(raw, "clave-tardia")
      expect(result.ok).toBe(false)
      expect(await passwordOf()).toBe("original")
      // Y sigue sin consumirse: el reclamo no se lleva lo que no puede usar.
      expect(await activeTokens()).toHaveLength(1)
    })

    it("un token inventado no cambia nada", async () => {
      const result = await applyPasswordReset("f".repeat(64), "clave-inventada")
      expect(result.ok).toBe(false)
      expect(await passwordOf()).toBe("original")
    })
  })

  describe("pruneResetTokens", () => {
    it("borra lo viejo y respeta lo reciente, usado o no", async () => {
      const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString()
      await testDb.insert(schema.passwordResetTokens).values([
        { id: "t-viejo", userId: USER, tokenHash: hashOf("viejo"), expiresAt: hace(9), usedAt: hace(9), createdAt: hace(10) },
        { id: "t-reciente", userId: USER, tokenHash: hashOf("reciente"), expiresAt: hace(-1), createdAt: hace(1) },
      ])

      await pruneResetTokens()

      const quedan = await testDb.select({ id: schema.passwordResetTokens.id })
        .from(schema.passwordResetTokens)
      expect(quedan.map((r) => r.id)).toEqual(["t-reciente"])
    })
  })

  describe("validateResetToken", () => {
    it("distingue vigente, vencido y desconocido", async () => {
      expect((await validateResetToken("desconocido")).valid).toBe(false)

      await requestPasswordReset("juan@test.cl")
      const raw = tokenFromLastEmail()
      expect(await validateResetToken(raw)).toEqual({ valid: true, userId: USER })

      await testDb.update(schema.passwordResetTokens).set({ expiresAt: "2020-01-01T00:00:00.000Z" })
      expect((await validateResetToken(raw)).valid).toBe(false)
    })
  })
})
