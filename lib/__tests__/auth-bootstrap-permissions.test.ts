import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
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
  it("derives the Permission type from the module registry instead of a legacy manual union", () => {
    const repoRoot = process.cwd()
    const authTypes = readFileSync(path.join(repoRoot, "lib/auth/types.ts"), "utf8")
    const modulePermissions = readFileSync(path.join(repoRoot, "modules/permissions.ts"), "utf8")

    expect(authTypes).not.toMatch(/export type Permission\s*=\s*\|/)
    expect(modulePermissions).toContain("export type Permission = RegistryPermission")
    expect(modulePermissions).not.toContain('export type { Permission } from "@/lib/auth/types"')
  })

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

  it("allows Jefa Dpto. Prevención de riesgos to manage catalog, suppliers, users, faenas, workers, and worker deliveries", () => {
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

  it("allows operational fuel vehicle management without exposing it to conductor lider", () => {
    expect(rolePermissions("rol-jefa")).toEqual(expect.arrayContaining([
      "combustibles:view",
      "combustibles:create",
      "combustibles:export",
      "combustibles:manage_vehicles",
    ]))
    expect(rolePermissions("rol-jefe-mant")).toEqual(expect.arrayContaining([
      "combustibles:view",
      "combustibles:create",
      "combustibles:export",
      "combustibles:manage_vehicles",
    ]))
    expect(rolePermissions("rol-sol-faena")).toEqual(expect.arrayContaining([
      "combustibles:view",
      "combustibles:manage_vehicles",
    ]))
    expect(rolePermissions("rol-prev-faena")).toEqual(expect.arrayContaining([
      "combustibles:view",
      "combustibles:manage_vehicles",
    ]))
    expect(rolePermissions("rol-admin-contrato")).toEqual(expect.arrayContaining([
      "combustibles:view",
      "combustibles:manage_vehicles",
    ]))
    expect(rolePermissions("rol-cond-lider")).not.toContain("combustibles:view")
    expect(rolePermissions("rol-cond-lider")).not.toContain("combustibles:manage_vehicles")
  })

  it("grants conductor_lider only the acompanamiento (Punto 3) evaluation permission", () => {
    const perms = rolePermissions("rol-cond-lider")

    expect(perms).toEqual(["sst:evaluate_acompanamiento"])
    expect(perms).not.toContain("sst:view")
    expect(perms).not.toContain("sst:create")
    expect(perms).not.toContain("sst:close")
  })

  it("hides the acompanamiento (Punto 3) permission from prevención roles but keeps it for admin", () => {
    expect(rolePermissions("rol-admin")).toContain("sst:evaluate_acompanamiento")
    expect(rolePermissions("rol-prev")).not.toContain("sst:evaluate_acompanamiento")
    expect(rolePermissions("rol-prev-faena")).not.toContain("sst:evaluate_acompanamiento")
  })
})
