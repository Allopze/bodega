import { describe, expect, it } from "vitest"
import type { Session } from "next-auth"
import { canRegisterAnyPdtpActivity, pdtpRegistrationActorFromSession } from "./pdtp-registration"
import { SYSTEM_ROLE_PERMISSIONS, SYSTEM_PERMISSIONS, SYSTEM_ROLES } from "./system-rbac"

function session(roles: string[], permissions: string[]): Session {
  return { user: { id: "u-1", roles, permissions }, expires: "2099-01-01" } as unknown as Session
}

/** Permisos por defecto de un rol, derivados de los manifiestos (la fuente del seed). */
function defaultPermissionsOf(roleName: string): string[] {
  const roleId = SYSTEM_ROLES.find((role) => role.name === roleName)!.id
  const ids = new Set(SYSTEM_ROLE_PERMISSIONS.filter((grant) => grant.roleId === roleId).map((grant) => grant.permissionId))
  return SYSTEM_PERMISSIONS.filter((permission) => ids.has(permission.id)).map((permission) => permission.name)
}

describe("canRegisterAnyPdtpActivity — quién es Prevención/administración para PREV-I03", () => {
  it("los roles de Prevención y el administrador registran cualquier actividad", () => {
    for (const role of ["prevencionista", "prevencionista_faena", "administrador"]) {
      expect(canRegisterAnyPdtpActivity(session([role], defaultPermissionsOf(role))), role).toBe(true)
    }
  })

  /* El hallazgo: estos roles tienen `execute` por las actividades que sí son
   * suyas, no para registrar las de cualquiera. */
  it("los roles globales no operacionales y los de terreno sólo registran lo propio", () => {
    for (const role of ["gerente_legal_rrhh", "subgerente_operaciones", "jefe_mantencion", "jefe_terreno", "supervisor_terreno", "admin_contrato"]) {
      expect(canRegisterAnyPdtpActivity(session([role], defaultPermissionsOf(role))), role).toBe(false)
    }
  })

  it("el actor lleva el id y los roles de la sesión", () => {
    expect(pdtpRegistrationActorFromSession(session(["jefe_terreno"], ["prevention:pdtp:execute"]))).toEqual({
      userId: "u-1", roles: ["jefe_terreno"], canRegisterAnyActivity: false,
    })
  })
})
