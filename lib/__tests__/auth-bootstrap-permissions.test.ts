import { describe, expect, it } from "vitest"
import { SYSTEM_PERMISSIONS, SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/bootstrap"
import { ALL_MODULE_DEFAULT_GRANTS, ALL_MODULE_PERMISSIONS } from "@/modules/permissions"

const permissionNameById = new Map(SYSTEM_PERMISSIONS.map((permission) => [permission.id, permission.name]))

function rolePermissions(roleId: string) {
  return [
    ...new Set(
    SYSTEM_ROLE_PERMISSIONS
      .filter((row) => row.roleId === roleId)
      .map((row) => permissionNameById.get(row.permissionId)),
    ),
  ]
}

describe("system role permission matrix", () => {
  it("keeps module registry permissions in parity with system bootstrap permissions", () => {
    const registryPermissionNames = [...ALL_MODULE_PERMISSIONS].sort()
    const bootstrapPermissionNames = SYSTEM_PERMISSIONS.map((permission) => permission.name).sort()

    expect(bootstrapPermissionNames).toEqual(registryPermissionNames)
  })

  it("keeps module default grants in parity with system bootstrap role permissions", () => {
    const roleSlugById = new Map(SYSTEM_ROLES.map((role) => [role.id, role.name]))
    const permissionNameById = new Map(SYSTEM_PERMISSIONS.map((permission) => [permission.id, permission.name]))
    const bootstrapGrants = SYSTEM_ROLE_PERMISSIONS.map((grant) => ({
      roleSlug: roleSlugById.get(grant.roleId),
      permission: permissionNameById.get(grant.permissionId),
    }))
      .map((grant) => `${grant.roleSlug}:${grant.permission}`)
      .sort()
    const moduleGrants = ALL_MODULE_DEFAULT_GRANTS
      .map((grant) => `${grant.roleSlug}:${grant.permission}`)
      .sort()

    expect(bootstrapGrants).toEqual(moduleGrants)
  })

  it("allows secretaria to manage operational masters without system config or audit access", () => {
    const perms = rolePermissions("rol-sec")

    expect(perms).toEqual(expect.arrayContaining([
      "admin:users",
      "admin:worksites",
      "admin:workers",
      "admin:products",
      "admin:suppliers",
      "warehouse:register_movement",
    ]))
    expect(perms).not.toContain("admin:config")
    expect(perms).not.toContain("admin:audit_log")
  })

  it("allows prevencionista oficina to manage catalog, suppliers, users, faenas, workers, and worker deliveries", () => {
    const perms = rolePermissions("rol-prev")

    expect(perms).toEqual(expect.arrayContaining([
      "requests:create",
      "requests:view_all",
      "approvals:approve",
      "receiving:register_office",
      "warehouse:view_stock",
      "warehouse:register_movement",
      "admin:users",
      "admin:worksites",
      "admin:workers",
      "admin:products",
      "admin:suppliers",
    ]))
  })

  it("keeps prevencionista faena scoped to faena operations plus worker creation", () => {
    const perms = rolePermissions("rol-sol-faena")

    expect(perms).toEqual(expect.arrayContaining([
      "requests:create",
      "requests:view_own",
      "requests:submit",
      "receiving:register_faena",
      "warehouse:view_stock",
      "warehouse:register_movement",
      "admin:workers",
    ]))
    expect(perms).not.toContain("requests:view_all")
    expect(perms).not.toContain("admin:users")
    expect(perms).not.toContain("admin:products")
  })
})
