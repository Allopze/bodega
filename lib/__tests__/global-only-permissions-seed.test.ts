/**
 * M-05: el seed tampoco puede otorgar a un rol de faena un permiso que abarca
 * todas las faenas. La validación de /admin/roles protege las ediciones; esta
 * prueba protege los manifiestos.
 */
import { describe, expect, it } from "vitest"
import { SYSTEM_PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, SYSTEM_ROLES } from "@/lib/auth/system-rbac"
import { GLOBAL_ONLY_PERMISSIONS } from "@/lib/services/admin-roles"

describe("permisos sólo globales en el seed (M-05)", () => {
  it("ningún rol de faena recibe un permiso sólo global", () => {
    const permissionName = new Map(SYSTEM_PERMISSIONS.map((permission) => [permission.id, permission.name]))
    const scopedRoleIds = new Set(SYSTEM_ROLES.filter((role) => !role.isGlobal).map((role) => role.id))
    const offending = SYSTEM_ROLE_PERMISSIONS
      .filter((grant) => scopedRoleIds.has(grant.roleId) && GLOBAL_ONLY_PERMISSIONS.has(permissionName.get(grant.permissionId) ?? ""))
      .map((grant) => `${grant.roleId} → ${permissionName.get(grant.permissionId)}`)
    expect(offending).toEqual([])
  })

  it("cada permiso sólo global existe en los manifiestos", () => {
    const names = new Set(SYSTEM_PERMISSIONS.map((permission) => permission.name))
    for (const name of GLOBAL_ONLY_PERMISSIONS) expect(names.has(name), name).toBe(true)
  })
})
