import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import { hashInvitationToken } from "@/lib/auth/bootstrap"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is structurally compatible at runtime; postgres-js type differs only in result-type HKT
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migrate(inMemoryDb, { migrationsFolder: path.resolve(process.cwd(), "db/migrations") })

const { registerUser } = await import("@/app/(auth)/registro/actions")

const INITIAL = { ok: false } as const

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

async function seedExistingUser() {
  await inMemoryDb.insert(schema.users).values({
    id: "u-existing",
    name: "Usuario Existente",
    email: "existente@chome.cl",
    hashedPassword: "hash",
    isActive: true,
  })
}

describe("registerUser — hardening (M1)", () => {
  beforeEach(async () => {
    await inMemoryDb.delete(schema.worksiteUsers)
    await inMemoryDb.delete(schema.userRoles)
    await inMemoryDb.delete(schema.userInvitations)
    await inMemoryDb.delete(schema.rolePermissions)
    await inMemoryDb.delete(schema.users)
    await inMemoryDb.delete(schema.roles)
    await inMemoryDb.delete(schema.permissions)
    await inMemoryDb.delete(schema.rateLimits)
  })

  afterAll(async () => {
    await pg.close()
  })

  it("bootstrap: the first registration on an empty DB becomes admin", async () => {
    const res = await registerUser(INITIAL, form({
      name: "Admin Inicial",
      email: "admin@chome.cl",
      password: "segura123",
      confirmPassword: "segura123",
    }))

    expect(res.ok).toBe(true)
    const [user] = await inMemoryDb.select().from(schema.users).where(eq(schema.users.email, "admin@chome.cl"))
    expect(user).toBeTruthy()
    const assigned = await inMemoryDb.select().from(schema.userRoles).where(eq(schema.userRoles.userId, user!.id))
    expect(assigned.map((r) => r.roleId)).toContain("rol-admin")
  })

  it("requires an invitation token once at least one user exists", async () => {
    await seedExistingUser()

    const res = await registerUser(INITIAL, form({
      name: "Sin Token",
      email: "nuevo@chome.cl",
      password: "segura123",
      confirmPassword: "segura123",
    }))

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.token).toEqual(["Necesitas una invitación para registrarte"])
    // No debe haberse creado el usuario (rollback).
    const rows = await inMemoryDb.select().from(schema.users).where(eq(schema.users.email, "nuevo@chome.cl"))
    expect(rows).toHaveLength(0)
  })

  it("accepts a valid invitation token, assigns its roles and consumes it", async () => {
    await seedExistingUser()
    await inMemoryDb.insert(schema.roles).values({ id: "rol-sec", name: "secretaria", label: "Secretaría" })
    const token = "invitacion-valida-123"
    await inMemoryDb.insert(schema.userInvitations).values({
      id: "inv-1",
      email: "invitado@chome.cl",
      tokenHash: hashInvitationToken(token),
      roleIdsJson: JSON.stringify(["rol-sec"]),
      worksiteAssignmentsJson: "[]",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    })

    const res = await registerUser(INITIAL, form({
      name: "Invitado",
      email: "invitado@chome.cl",
      password: "segura123",
      confirmPassword: "segura123",
      token,
    }))

    expect(res.ok).toBe(true)
    const [inv] = await inMemoryDb.select().from(schema.userInvitations).where(eq(schema.userInvitations.id, "inv-1"))
    expect(inv!.acceptedAt).toBeTruthy()
    const [user] = await inMemoryDb.select().from(schema.users).where(eq(schema.users.email, "invitado@chome.cl"))
    const assigned = await inMemoryDb.select().from(schema.userRoles).where(eq(schema.userRoles.userId, user!.id))
    expect(assigned.map((r) => r.roleId)).toEqual(["rol-sec"])
  })

  it("locks the account after repeated invalid-token attempts (rate-limit engages)", async () => {
    await seedExistingUser()
    const attempt = () => registerUser(INITIAL, form({
      name: "Atacante",
      email: "victima@chome.cl",
      password: "segura123",
      confirmPassword: "segura123",
      token: "token-incorrecto",
    }))

    // Las primeras 5 fallan por token inválido y van acumulando el contador.
    for (let i = 0; i < 5; i++) {
      const r = await attempt()
      expect(r.ok).toBe(false)
      expect(r.fieldErrors?.token).toEqual(["Invitación inválida o ya utilizada"])
    }

    // La 6ª debe quedar bloqueada por el rate-limiter.
    const blocked = await attempt()
    expect(blocked.ok).toBe(false)
    expect(blocked.message).toMatch(/Demasiados intentos/)
  })
})
