import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite is structurally compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

await migrate(inMemoryDb, { migrationsFolder: path.resolve(process.cwd(), "db/migrations") })

import { getUserIdsWithPermission } from "@/lib/services/notifications"

describe("getUserIdsWithPermission", () => {
  beforeEach(async () => {
    await inMemoryDb.delete(schema.userPermissions)
    await inMemoryDb.delete(schema.userRoles)
    await inMemoryDb.delete(schema.rolePermissions)
    await inMemoryDb.delete(schema.users)
    await inMemoryDb.delete(schema.roles)
    await inMemoryDb.delete(schema.permissions)
  })

  afterAll(async () => {
    await pg.close()
  })

  it("returns users with direct permission grants (no role)", async () => {
    const now = new Date().toISOString()

    await inMemoryDb.insert(schema.permissions).values({
      id: "perm-oc",
      name: "purchasing:create_order",
      description: null,
      module: "purchasing",
    })

    await inMemoryDb.insert(schema.users).values({
      id: "u-direct",
      name: "Usuario Direct",
      email: "direct@chome.cl",
      hashedPassword: "$2a$12$test",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    await inMemoryDb.insert(schema.userPermissions).values({
      userId: "u-direct",
      permissionId: "perm-oc",
    })

    const ids = await getUserIdsWithPermission("purchasing:create_order")
    expect(ids).toEqual(["u-direct"])
  })

  it("returns users with role-based grants", async () => {
    const now = new Date().toISOString()

    await inMemoryDb.insert(schema.permissions).values({
      id: "perm-oc",
      name: "purchasing:create_order",
      description: null,
      module: "purchasing",
    })
    await inMemoryDb.insert(schema.roles).values({
      id: "rol-jefa",
      name: "jefa_chome",
      label: "Jefa Chome",
    })
    await inMemoryDb.insert(schema.rolePermissions).values({
      roleId: "rol-jefa",
      permissionId: "perm-oc",
    })
    await inMemoryDb.insert(schema.users).values({
      id: "u-role",
      name: "Usuario Role",
      email: "role@chome.cl",
      hashedPassword: "$2a$12$test",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    await inMemoryDb.insert(schema.userRoles).values({
      userId: "u-role",
      roleId: "rol-jefa",
    })

    const ids = await getUserIdsWithPermission("purchasing:create_order")
    expect(ids).toEqual(["u-role"])
  })

  it("merges users from both role and direct grants without duplicates", async () => {
    const now = new Date().toISOString()

    await inMemoryDb.insert(schema.permissions).values({
      id: "perm-oc",
      name: "purchasing:create_order",
      description: null,
      module: "purchasing",
    })
    await inMemoryDb.insert(schema.roles).values({
      id: "rol-jefa",
      name: "jefa_chome",
      label: "Jefa Chome",
    })
    await inMemoryDb.insert(schema.rolePermissions).values({
      roleId: "rol-jefa",
      permissionId: "perm-oc",
    })

    await inMemoryDb.insert(schema.users).values([
      {
        id: "u-role",
        name: "Role",
        email: "role@chome.cl",
        hashedPassword: "$2a$12$test",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "u-direct",
        name: "Direct",
        email: "direct@chome.cl",
        hashedPassword: "$2a$12$test",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "u-both",
        name: "Both",
        email: "both@chome.cl",
        hashedPassword: "$2a$12$test",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "u-inactive",
        name: "Inactive",
        email: "inactive@chome.cl",
        hashedPassword: "$2a$12$test",
        isActive: false,
        createdAt: now,
        updatedAt: now,
      },
    ])

    await inMemoryDb.insert(schema.userRoles).values({ userId: "u-role", roleId: "rol-jefa" })
    await inMemoryDb.insert(schema.userRoles).values({ userId: "u-both", roleId: "rol-jefa" })
    await inMemoryDb.insert(schema.userPermissions).values({ userId: "u-direct", permissionId: "perm-oc" })
    await inMemoryDb.insert(schema.userPermissions).values({ userId: "u-both", permissionId: "perm-oc" })
    await inMemoryDb.insert(schema.userPermissions).values({ userId: "u-inactive", permissionId: "perm-oc" })

    const ids = await getUserIdsWithPermission("purchasing:create_order")
    expect(ids).toHaveLength(3)
    expect(ids).toContain("u-role")
    expect(ids).toContain("u-direct")
    expect(ids).toContain("u-both")
    expect(ids).not.toContain("u-inactive")
  })
})
