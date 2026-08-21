import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
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

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { getGlobalUserIdsWithAllPermissions, getUserIdsWithPermission, getUserIdsWithPermissionForWorksite } from "@/lib/services/notifications"

describe("getUserIdsWithPermission", () => {
  beforeEach(async () => {
    await inMemoryDb.delete(schema.userPermissions)
    await inMemoryDb.delete(schema.userRoles)
    await inMemoryDb.delete(schema.worksiteUsers)
    await inMemoryDb.delete(schema.rolePermissions)
    await inMemoryDb.delete(schema.users)
    await inMemoryDb.delete(schema.worksites)
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
    await inMemoryDb.insert(schema.userRoles).values({ userId: "u-inactive", roleId: "rol-jefa" })
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

  it("filters permission recipients to global users and users assigned to the target worksite", async () => {
    const now = new Date().toISOString()

    await inMemoryDb.insert(schema.permissions).values({
      id: "perm-ppa-review",
      name: "ppa:review",
      description: null,
      module: "ppa",
    })
    await inMemoryDb.insert(schema.roles).values([
      {
        id: "rol-reviewer-global",
        name: "prevencionista_global",
        label: "Prevencionista global",
        isGlobal: true,
      },
      {
        id: "rol-reviewer-faena",
        name: "prevencionista_faena",
        label: "Prevencionista faena",
        isGlobal: false,
      },
    ])
    await inMemoryDb.insert(schema.rolePermissions).values([
      {
        roleId: "rol-reviewer-global",
        permissionId: "perm-ppa-review",
      },
      {
        roleId: "rol-reviewer-faena",
        permissionId: "perm-ppa-review",
      },
    ])
    await inMemoryDb.insert(schema.worksites).values([
      { id: "ws-1", name: "Faena Uno", code: "F1", isActive: true },
      { id: "ws-2", name: "Faena Dos", code: "F2", isActive: true },
    ])
    await inMemoryDb.insert(schema.users).values([
      {
        id: "u-global",
        name: "Global",
        email: "global@chome.cl",
        hashedPassword: "$2a$12$test",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "u-ws1",
        name: "Faena 1",
        email: "ws1@chome.cl",
        hashedPassword: "$2a$12$test",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "u-ws2",
        name: "Faena 2",
        email: "ws2@chome.cl",
        hashedPassword: "$2a$12$test",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "u-inactive",
        name: "Inactive",
        email: "inactive-review@chome.cl",
        hashedPassword: "$2a$12$test",
        isActive: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    await inMemoryDb.insert(schema.userRoles).values([
      { userId: "u-global", roleId: "rol-reviewer-global" },
      { userId: "u-ws1", roleId: "rol-reviewer-faena" },
      { userId: "u-ws2", roleId: "rol-reviewer-faena" },
      { userId: "u-inactive", roleId: "rol-reviewer-faena" },
    ])
    await inMemoryDb.insert(schema.worksiteUsers).values([
      { userId: "u-ws1", worksiteId: "ws-1", isPrimary: true },
      { userId: "u-ws2", worksiteId: "ws-2", isPrimary: true },
      { userId: "u-inactive", worksiteId: "ws-1", isPrimary: true },
    ])

    const ids = await getUserIdsWithPermissionForWorksite("ppa:review", "ws-1")

    expect(ids).toEqual(expect.arrayContaining(["u-global", "u-ws1"]))
    expect(ids).not.toContain("u-ws2")
    expect(ids).not.toContain("u-inactive")
  })

  it("financial notifications require a global user with both base and cost permissions", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.permissions).values([
      { id: "perm-fuel-view", name: "combustibles:view", module: "combustibles" },
      { id: "perm-costs", name: "combustibles:view_costs", module: "combustibles" },
    ])
    await inMemoryDb.insert(schema.roles).values([
      { id: "role-global-cost-only", name: "global_cost_only", label: "Sólo costos global", isGlobal: true },
      { id: "role-global-fuel-finance", name: "global_fuel_finance", label: "Combustible financiero", isGlobal: true },
      { id: "role-scoped-fuel-finance", name: "scoped_fuel_finance", label: "Combustible financiero faena", isGlobal: false },
    ])
    await inMemoryDb.insert(schema.rolePermissions).values([
      { roleId: "role-global-cost-only", permissionId: "perm-costs" },
      { roleId: "role-global-fuel-finance", permissionId: "perm-fuel-view" },
      { roleId: "role-global-fuel-finance", permissionId: "perm-costs" },
      { roleId: "role-scoped-fuel-finance", permissionId: "perm-fuel-view" },
      { roleId: "role-scoped-fuel-finance", permissionId: "perm-costs" },
    ])
    await inMemoryDb.insert(schema.users).values([
      { id: "u-global-cost-only", name: "Sólo costos", email: "global-cost-only@example.test", hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now },
      { id: "u-global-both", name: "Global ambos", email: "global-both@example.test", hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now },
      { id: "u-scoped-both", name: "Scoped ambos", email: "scoped-both@example.test", hashedPassword: "x", isActive: true, createdAt: now, updatedAt: now },
    ])
    await inMemoryDb.insert(schema.userRoles).values([
      { userId: "u-global-cost-only", roleId: "role-global-cost-only" },
      { userId: "u-global-both", roleId: "role-global-fuel-finance" },
      { userId: "u-scoped-both", roleId: "role-scoped-fuel-finance" },
    ])

    await expect(getGlobalUserIdsWithAllPermissions("combustibles:view", "combustibles:view_costs"))
      .resolves.toEqual(["u-global-both"])
  })
})
