import { describe, expect, it } from "vitest"
import { SYSTEM_PERMISSIONS, SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/bootstrap"

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
