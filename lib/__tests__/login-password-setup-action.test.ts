import path from "node:path"
import bcrypt from "bcryptjs"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import { hashInvitationToken } from "@/lib/auth/bootstrap"
import { createPendingPasswordMarker, isPasswordSetupPending } from "@/lib/auth/password-setup"

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

import { setInitialPassword } from "@/app/(auth)/login/actions"

describe("setInitialPassword", () => {
  beforeEach(async () => {
    await inMemoryDb.delete(schema.userInvitations)
    await inMemoryDb.delete(schema.users)
  })

  afterAll(async () => {
    await pg.close()
  })

  it("rejects password setup attempts without an invitation token", async () => {
    const result = await setInitialPassword({
      email: "pendiente@chome.cl",
      password: "segura123",
      confirmPassword: "segura123",
    })

    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.token).toEqual(["Necesitas una invitación válida para crear la contraseña"])
  })

  it("creates the password and consumes a matching invitation token", async () => {
    const now = new Date().toISOString()
    const token = "token-seguro"
    await inMemoryDb.insert(schema.users).values({
      id: "user-pending",
      name: "Usuario Pendiente",
      email: "pendiente@chome.cl",
      hashedPassword: createPendingPasswordMarker(),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.userInvitations).values({
      id: "invite-1",
      email: "pendiente@chome.cl",
      name: "Usuario Pendiente",
      tokenHash: hashInvitationToken(token),
      roleIdsJson: "[]",
      worksiteAssignmentsJson: "[]",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: now,
    })

    const result = await setInitialPassword({
      email: "pendiente@chome.cl",
      password: "segura123",
      confirmPassword: "segura123",
      token,
    })

    const user = await inMemoryDb.query.users.findFirst({ where: eq(schema.users.id, "user-pending") })
    const invitation = await inMemoryDb.query.userInvitations.findFirst({ where: eq(schema.userInvitations.id, "invite-1") })

    expect(result.ok).toBe(true)
    expect(user).toBeDefined()
    expect(user && isPasswordSetupPending(user.hashedPassword)).toBe(false)
    expect(user && await bcrypt.compare("segura123", user.hashedPassword)).toBe(true)
    expect(invitation?.acceptedAt).toEqual(expect.any(String))
  })
})
