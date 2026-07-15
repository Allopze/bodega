import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { afterAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import {
  ensureSystemRbac,
  getUserCount,
  generateInvitationToken,
  hashInvitationToken,
} from "@/lib/auth/bootstrap"

describe("auth bootstrap service", () => {
  afterAll(async () => {
    await pg.close()
  })

  it("ensureSystemRbac seeds database idempotently using default executor", async () => {
    // Run seeding
    await ensureSystemRbac()

    // Verify roles seeded
    const roles = await inMemoryDb.select().from(schema.roles)
    expect(roles.length).toBeGreaterThan(0)

    // Run seeding again (idempotent)
    await expect(ensureSystemRbac()).resolves.toBeUndefined()
  })

  it("ensureSystemRbac works with a transaction executor tx", async () => {
    await inMemoryDb.transaction(async (tx) => {
      await ensureSystemRbac(tx)
    })

    const roles = await inMemoryDb.select().from(schema.roles)
    expect(roles.length).toBeGreaterThan(0)
  })

  it("retires the obsolete PDTP permission and every existing grant", async () => {
    const retiredPermission = {
      id: "p-prev-pdtp-manage",
      name: "prevention:pdtp:manage",
      module: "prevention",
      description: "Permiso retirado",
    }
    await inMemoryDb.insert(schema.permissions).values(retiredPermission)
    await inMemoryDb.insert(schema.rolePermissions).values({
      roleId: "rol-prev",
      permissionId: retiredPermission.id,
    })
    await inMemoryDb.insert(schema.users).values({
      id: "user-retired-permission",
      name: "Permiso retirado",
      email: "retired-permission@example.com",
      hashedPassword: "password_hash",
      isActive: true,
    })
    await inMemoryDb.insert(schema.userPermissions).values({
      userId: "user-retired-permission",
      permissionId: retiredPermission.id,
    })

    await ensureSystemRbac()

    expect((await inMemoryDb.select().from(schema.permissions)).find((permission) => permission.id === retiredPermission.id)).toBeUndefined()
    expect((await inMemoryDb.select().from(schema.rolePermissions)).some((grant) => grant.permissionId === retiredPermission.id)).toBe(false)
    expect((await inMemoryDb.select().from(schema.userPermissions)).some((grant) => grant.permissionId === retiredPermission.id)).toBe(false)
  })

  it("getUserCount returns user count accurately", async () => {
    // Initial user count on empty db (since we haven't added users yet)
    await inMemoryDb.delete(schema.users)
    let countVal = await getUserCount()
    expect(countVal).toBe(0)

    // Insert user
    await inMemoryDb.insert(schema.users).values({
      id: "user-test-bootstrap",
      name: "Test User",
      email: "test@example.com",
      hashedPassword: "password_hash",
      isActive: true,
    })

    countVal = await getUserCount()
    expect(countVal).toBe(1)
  })

  it("generateInvitationToken returns base64url string", () => {
    const token = generateInvitationToken()
    expect(token).toBeTypeOf("string")
    expect(token.length).toBeGreaterThan(10)
  })

  it("hashInvitationToken returns hexadecimal sha256 hash", () => {
    const token = "my-token-123"
    const hashed = hashInvitationToken(token)
    expect(hashed).toBeTypeOf("string")
    expect(hashed).toHaveLength(64) // SHA-256 in hex is 64 characters
    expect(hashed).toBe(hashInvitationToken(token))
  })
})
