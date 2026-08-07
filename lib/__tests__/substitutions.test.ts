import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite compatibility
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const ADMIN_ID = "u-sub-admin"
const ORIGINAL_USER = "u-orig-1"

beforeEach(async () => {
  await inMemoryDb.delete(schema.worksiteUsers)
  await inMemoryDb.delete(schema.userRoles)
  await inMemoryDb.delete(schema.userInvitations)
  await inMemoryDb.delete(schema.roles)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: ADMIN_ID,
    name: "Jefe Prevencion",
    email: "jefe@example.test",
    hashedPassword: "x",
  })

  await inMemoryDb.insert(schema.users).values({
    id: ORIGINAL_USER,
    name: "Prevencionista Titular",
    email: "titular@example.test",
    hashedPassword: "x",
  })

  await inMemoryDb.insert(schema.roles).values({
    id: "r-prevencionista",
    name: "prevencionista",
    label: "Prevencionista",
  })

  await inMemoryDb.insert(schema.userRoles).values({
    userId: ORIGINAL_USER,
    roleId: "r-prevencionista",
  })
})

describe("Substitutions Service (R7)", () => {
  it("crea una cuenta temporal de reemplazo heredando roles del titular", async () => {
    const { createTemporarySubstituteUser, listActiveSubstitutions } = await import("@/lib/services/substitutions")
    const { hashInvitationToken } = await import("@/lib/auth/bootstrap")
    const { isPasswordSetupPending } = await import("@/lib/auth/password-setup")

    const tempUser = await createTemporarySubstituteUser({
      name: "Reemplazo Temporal",
      email: "reemplazo@example.test",
      substituteForUserId: ORIGINAL_USER,
      validUntilDays: 15,
    }, ADMIN_ID, true)

    expect(tempUser!.isTemporary).toBe(true)
    expect(tempUser!.substituteForUserId).toBe(ORIGINAL_USER)
    expect(tempUser!.validUntil).toBeDefined()
    expect(isPasswordSetupPending(tempUser!.hashedPassword)).toBe(true)

    const activeList = await listActiveSubstitutions()
    expect(activeList).toHaveLength(1)
    expect(activeList[0]!.user.email).toBe("reemplazo@example.test")

    // Verificar que heredó el rol
    const roles = await inMemoryDb.select().from(schema.userRoles).where(eq(schema.userRoles.userId, tempUser!.id))
    expect(roles).toHaveLength(1)
    expect(roles[0]!.roleId).toBe("r-prevencionista")

    const [invitation] = await inMemoryDb.select().from(schema.userInvitations).where(eq(schema.userInvitations.email, tempUser!.email))
    expect(invitation).toMatchObject({
      name: tempUser!.name,
      invitedByUserId: ADMIN_ID,
      roleIdsJson: JSON.stringify(["r-prevencionista"]),
    })
    expect(Date.parse(invitation!.expiresAt)).toBe(Date.parse(tempUser!.validUntil!))
    expect(invitation!.tokenHash).toBe(hashInvitationToken(tempUser!.invitationToken))
  })

  it("rechaza crear la suplencia de un administrador sin admin:manage_admins", async () => {
    const { createTemporarySubstituteUser } = await import("@/lib/services/substitutions")

    await inMemoryDb.insert(schema.roles).values({ id: "rol-admin", name: "administrador", label: "Administrador" })
    await inMemoryDb.insert(schema.userRoles).values({ userId: ORIGINAL_USER, roleId: "rol-admin" })

    await expect(createTemporarySubstituteUser({
      name: "Suplente Escalador",
      email: "escalador@example.test",
      substituteForUserId: ORIGINAL_USER,
      validUntilDays: 90,
    }, ADMIN_ID, false)).rejects.toThrow(/Solo un administrador/)

    // La transacción revierte: ni usuario temporal ni invitación quedan creados.
    const leftovers = await inMemoryDb.select().from(schema.users).where(eq(schema.users.email, "escalador@example.test"))
    expect(leftovers).toHaveLength(0)
    const invitations = await inMemoryDb.select().from(schema.userInvitations).where(eq(schema.userInvitations.email, "escalador@example.test"))
    expect(invitations).toHaveLength(0)

    // Con el permiso sí se permite.
    const allowed = await createTemporarySubstituteUser({
      name: "Suplente Legitimo",
      email: "legitimo@example.test",
      substituteForUserId: ORIGINAL_USER,
      validUntilDays: 90,
    }, ADMIN_ID, true)
    expect(allowed!.isTemporary).toBe(true)
  })

  it("rechaza reactivar una suplencia de administrador sin admin:manage_admins", async () => {
    const { createTemporarySubstituteUser, extendTemporarySubstituteValidity, revokeTemporarySubstitute } = await import("@/lib/services/substitutions")

    await inMemoryDb.insert(schema.roles).values({ id: "rol-admin", name: "administrador", label: "Administrador" })
    await inMemoryDb.insert(schema.userRoles).values({ userId: ORIGINAL_USER, roleId: "rol-admin" })

    const tempUser = await createTemporarySubstituteUser({
      name: "Suplente Admin",
      email: "suplente-admin@example.test",
      substituteForUserId: ORIGINAL_USER,
      validUntilDays: 7,
    }, ADMIN_ID, true)
    await revokeTemporarySubstitute(tempUser!.id, ADMIN_ID)

    await expect(extendTemporarySubstituteValidity(tempUser!.id, 30, ADMIN_ID, false)).rejects.toThrow(/Solo un administrador/)

    const [stillRevoked] = await inMemoryDb.select().from(schema.users).where(eq(schema.users.id, tempUser!.id))
    expect(stillRevoked!.isActive).toBe(false)
  })

  it("permite extender vigencia y revocar la cuenta", async () => {
    const { createTemporarySubstituteUser, extendTemporarySubstituteValidity, revokeTemporarySubstitute } = await import("@/lib/services/substitutions")

    const tempUser = await createTemporarySubstituteUser({
      name: "Reemplazo 2",
      email: "reemplazo2@example.test",
      substituteForUserId: ORIGINAL_USER,
      validUntilDays: 7,
    }, ADMIN_ID, true)

    const extended = await extendTemporarySubstituteValidity(tempUser!.id, 10, ADMIN_ID, true)
    expect(extended!.isActive).toBe(true)

    const revoked = await revokeTemporarySubstitute(tempUser!.id, ADMIN_ID)
    expect(revoked!.isActive).toBe(false)
  })

  it("desactiva cuentas temporales vencidas automáticamente", async () => {
    const { expireLapsedTemporaryUsers } = await import("@/lib/services/substitutions")

    // Insertar cuenta vencida
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    await inMemoryDb.insert(schema.users).values({
      id: "u-expired-1",
      name: "Usuario Vencido",
      email: "vencido@example.test",
      hashedPassword: "x",
      isActive: true,
      isTemporary: true,
      validUntil: pastDate,
      substituteForUserId: ORIGINAL_USER,
    })

    const res = await expireLapsedTemporaryUsers()
    expect(res.expiredCount).toBe(1)

    const [user] = await inMemoryDb.select().from(schema.users).where(eq(schema.users.id, "u-expired-1"))
    expect(user!.isActive).toBe(false)
  })

  it("niega el snapshot RBAC de una suplencia vencida aunque el cron no haya corrido", async () => {
    const { getUserRbacById } = await import("@/lib/auth/rbac")
    await inMemoryDb.insert(schema.users).values({
      id: "u-expired-auth",
      name: "Suplente vencido",
      email: "vencido-auth@example.test",
      hashedPassword: "x",
      isActive: true,
      isTemporary: true,
      validUntil: new Date(Date.now() - 1_000).toISOString(),
    })
    await inMemoryDb.insert(schema.userRoles).values({ userId: "u-expired-auth", roleId: "r-prevencionista" })

    await expect(getUserRbacById("u-expired-auth", true)).resolves.toBeNull()
  })
})
