import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import { hashInvitationToken } from "@/lib/auth/bootstrap"
import { createPendingPasswordMarker } from "@/lib/auth/password-setup"

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

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

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
    await inMemoryDb.delete(schema.workers)
    await inMemoryDb.delete(schema.worksites)
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

  it("associates the invited account with its selected worker", async () => {
    await seedExistingUser()
    await inMemoryDb.insert(schema.roles).values({ id: "rol-worker", name: "trabajador", label: "Trabajador" })
    await inMemoryDb.insert(schema.worksites).values({ id: "ws-1", name: "Faena Norte", code: "NORTE" })
    await inMemoryDb.insert(schema.workers).values({
      id: "worker-1",
      firstName: "María",
      lastName: "Pérez",
      worksiteId: "ws-1",
      isActive: true,
    })
    const token = "invitacion-trabajadora-123"
    await inMemoryDb.insert(schema.userInvitations).values({
      id: "inv-worker-1",
      email: "maria@chome.cl",
      workerId: "worker-1",
      tokenHash: hashInvitationToken(token),
      roleIdsJson: JSON.stringify(["rol-worker"]),
      worksiteAssignmentsJson: JSON.stringify([{ worksiteId: "ws-1", isPrimary: true }]),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    })

    const res = await registerUser(INITIAL, form({
      name: "María Pérez",
      email: "maria@chome.cl",
      password: "segura123",
      confirmPassword: "segura123",
      token,
    }))

    expect(res.ok).toBe(true)
    const [user] = await inMemoryDb.select().from(schema.users).where(eq(schema.users.email, "maria@chome.cl"))
    expect(user?.workerId).toBe("worker-1")
  })

  it("rejects a cancelled invitation token", async () => {
    await seedExistingUser()
    const token = "invitacion-cancelada-123"
    await inMemoryDb.insert(schema.userInvitations).values({
      id: "inv-cancelled",
      email: "cancelado@chome.cl",
      tokenHash: hashInvitationToken(token),
      roleIdsJson: "[]",
      worksiteAssignmentsJson: "[]",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      cancelledAt: new Date().toISOString(),
      cancelReason: "Solicitud duplicada",
    })

    const res = await registerUser(INITIAL, form({
      name: "Cancelado",
      email: "cancelado@chome.cl",
      password: "segura123",
      confirmPassword: "segura123",
      token,
    }))

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.token).toEqual(["Invitación inválida o ya utilizada"])
    const rows = await inMemoryDb.select().from(schema.users).where(eq(schema.users.email, "cancelado@chome.cl"))
    expect(rows).toHaveLength(0)
  })

  it("rejects a replaced invitation token", async () => {
    await seedExistingUser()
    const token = "invitacion-reemplazada-123"
    await inMemoryDb.insert(schema.userInvitations).values({
      id: "inv-replaced",
      email: "reemplazado@chome.cl",
      tokenHash: hashInvitationToken(token),
      roleIdsJson: "[]",
      worksiteAssignmentsJson: "[]",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      replacedAt: new Date().toISOString(),
      replacedByInvitationId: "inv-newer",
    })

    const res = await registerUser(INITIAL, form({
      name: "Reemplazado",
      email: "reemplazado@chome.cl",
      password: "segura123",
      confirmPassword: "segura123",
      token,
    }))

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.token).toEqual(["Invitación inválida o ya utilizada"])
    const rows = await inMemoryDb.select().from(schema.users).where(eq(schema.users.email, "reemplazado@chome.cl"))
    expect(rows).toHaveLength(0)
  })

  /*
   * AUTH-001 (auditoría 2026-09-14). Antes del arreglo la acción consultaba
   * `users` por correo ANTES de mirar la invitación y devolvía
   * `email: ["Este correo ya está registrado"]`, distinguible de
   * `token: ["Necesitas una invitación para registrarte"]`. Con eso, cualquiera
   * sin token enumeraba las cuentas de la organización correo por correo.
   */
  it("AUTH-001: sin invitación, un correo ya registrado responde exactamente igual que uno desconocido", async () => {
    await seedExistingUser()

    const conCuenta = await registerUser(INITIAL, form({
      name: "Enumerador",
      email: "existente@chome.cl",
      password: "segura123",
      confirmPassword: "segura123",
    }))
    const sinCuenta = await registerUser(INITIAL, form({
      name: "Enumerador",
      email: "desconocido@chome.cl",
      password: "segura123",
      confirmPassword: "segura123",
    }))

    expect(conCuenta).toEqual(sinCuenta)
    expect(conCuenta.fieldErrors?.email).toBeUndefined()
  })

  /*
   * AUTH-001, segunda mitad: aquel retorno anticipado tampoco llamaba a
   * `recordFailure`, así que la enumeración era además gratuita — el contador
   * de la propia acción nunca veía esos intentos.
   */
  it("AUTH-001: el intento sobre un correo ya registrado sí gasta el límite de intentos", async () => {
    await seedExistingUser()

    await registerUser(INITIAL, form({
      name: "Enumerador",
      email: "existente@chome.cl",
      password: "segura123",
      confirmPassword: "segura123",
    }))

    const [row] = await inMemoryDb.select().from(schema.rateLimits)
      .where(eq(schema.rateLimits.key, "registro:email:existente@chome.cl"))
    expect(row?.count).toBe(1)
  })

  /*
   * AUTH-001 no puede romper el caso legítimo: una cuenta pre-creada por un
   * admin (sin contraseña definida) todavía puede completarse, pero ahora sólo
   * exhibiendo la invitación vigente emitida para ese mismo correo.
   */
  it("AUTH-001: una cuenta pendiente de configurar aún se completa con su invitación", async () => {
    await seedExistingUser()
    await inMemoryDb.insert(schema.users).values({
      id: "u-pendiente",
      name: "Pendiente",
      email: "pendiente@chome.cl",
      hashedPassword: createPendingPasswordMarker(),
      isActive: false,
    })
    const token = "token-pendiente"
    await inMemoryDb.insert(schema.userInvitations).values({
      id: "inv-pendiente",
      email: "pendiente@chome.cl",
      tokenHash: hashInvitationToken(token),
      roleIdsJson: "[]",
      worksiteAssignmentsJson: "[]",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    })

    const res = await registerUser(INITIAL, form({
      name: "Pendiente",
      email: "pendiente@chome.cl",
      password: "segura123",
      confirmPassword: "segura123",
      token,
    }))

    expect(res.ok).toBe(true)
    const [user] = await inMemoryDb.select().from(schema.users).where(eq(schema.users.email, "pendiente@chome.cl"))
    expect(user?.id).toBe("u-pendiente")
    expect(user?.isActive).toBe(true)
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
