import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

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

import {
  assertPermissionsExist,
  createRoleWithPermissions,
  listRolesWithPermissions,
  updateRoleWithPermissions,
} from "@/lib/services/admin-roles"

describe("admin roles service persistence", () => {
  beforeEach(async () => {
    await inMemoryDb.delete(schema.rolePermissions)
    await inMemoryDb.delete(schema.roles)
    await inMemoryDb.delete(schema.permissions)
    await inMemoryDb.insert(schema.permissions).values([
      { id: "perm-read", name: "catalog:read", description: "Leer catálogo", module: "catalog" },
      { id: "perm-write", name: "catalog:write", description: "Editar catálogo", module: "catalog" },
      { id: "perm-export", name: "catalog:export", description: "Exportar catálogo", module: "catalog" },
      { id: "perm-pdtp-program", name: "prevention:pdtp:program:manage", description: "Programa PDTP", module: "prevention" },
    ])
  })

  afterAll(async () => {
    delete testGlobal.__db
    await pg.close()
  })

  it.each([
    ["none", []],
    ["one", ["perm-read"]],
    ["many", ["perm-read", "perm-write", "perm-export"]],
  ])("validates %s permission selection against persisted rows", async (_label, permissionIds) => {
    await expect(assertPermissionsExist(permissionIds)).resolves.toBeUndefined()
  })

  it("rejects a selection containing a missing permission", async () => {
    await expect(assertPermissionsExist(["perm-read", "perm-missing"])).rejects.toThrow("no existen")
  })

  it("persists, replaces and lists role grants transactionally", async () => {
    const actor = { userId: "admin-test", userEmail: "admin@test.local" }
    const created = await createRoleWithPermissions({
      id: "role-catalog",
      name: "Catalogo Operativo",
      label: "Catálogo operativo",
      description: "Rol de prueba",
      isGlobal: false,
      permissionIds: ["perm-read"],
    }, actor)

    expect(created.name).toBe("catalogo_operativo")
    expect(created.permissionIds).toEqual(["perm-read"])

    const updated = await updateRoleWithPermissions("role-catalog", {
      id: "role-catalog",
      name: "Catalogo Operativo",
      label: "Catálogo operativo actualizado",
      description: "Rol actualizado",
      isGlobal: true,
      permissionIds: ["perm-read", "perm-write", "perm-export"],
    }, actor)
    expect(updated.permissionIds).toEqual(["perm-read", "perm-write", "perm-export"])

    const listed = await listRolesWithPermissions()
    expect(listed).toEqual([expect.objectContaining({
      id: "role-catalog",
      label: "Catálogo operativo actualizado",
      isGlobal: true,
      permissionIds: expect.arrayContaining(["perm-read", "perm-write", "perm-export"]),
    })])
  })

  it("un rol de faena no puede recibir un permiso que abarca todas las faenas (M-05)", async () => {
    const actor = { userId: "admin-test", userEmail: "admin@test.local" }
    const base = { name: "Prevencionista Faena X", label: "Prevencionista faena X", isGlobal: false, permissionIds: ["perm-read", "perm-pdtp-program"] }
    await expect(createRoleWithPermissions({ id: "role-faena", ...base }, actor)).rejects.toThrow("sólo se puede otorgar a un rol con visibilidad global")

    await createRoleWithPermissions({ id: "role-faena", ...base, permissionIds: ["perm-read"] }, actor)
    await expect(updateRoleWithPermissions("role-faena", { id: "role-faena", ...base }, actor)).rejects.toThrow("visibilidad global")
    // Global, sí.
    await expect(updateRoleWithPermissions("role-faena", { id: "role-faena", ...base, isGlobal: true }, actor)).resolves.toMatchObject({ isGlobal: true })
  })
})
