import { describe, expect, it } from "vitest"
import { requiresWorksiteAssignment, WORKSITE_SCOPED_ROLE_NAMES } from "./role-scope"
import { SYSTEM_ROLES } from "./system-rbac"

describe("requiresWorksiteAssignment", () => {
  it("identifies roles whose access must be bounded to a worksite", () => {
    expect(requiresWorksiteAssignment("prevencionista_faena")).toBe(true)
    expect(requiresWorksiteAssignment("administrador")).toBe(false)
  })

  // Derivado de SYSTEM_ROLES a propósito, en vez de repetir la lista a mano: los nombres
  // de rol son `text` en la base y `SYSTEM_ROLES` usa `satisfies`, así que no hay unión
  // de TypeScript que atrape un rol nuevo que se olvide de acá. Así se cayó
  // `supervisor_terreno`: no global, pero ausente de la lista, de modo que
  // app/(app)/admin/usuarios lo dejaba guardar sin faena y la cuenta quedaba con scope
  // vacío —inutilizable en silencio, sin exponer datos de más.
  it("covers every non-global role in SYSTEM_ROLES", () => {
    const nonGlobal = SYSTEM_ROLES.filter((role) => !role.isGlobal).map((role) => role.name)

    expect([...nonGlobal].sort()).toEqual([...WORKSITE_SCOPED_ROLE_NAMES].sort())
  })

  it("never demands a worksite from a global role", () => {
    for (const role of SYSTEM_ROLES.filter((r) => r.isGlobal)) {
      expect(requiresWorksiteAssignment(role.name), role.name).toBe(false)
    }
  })
})
