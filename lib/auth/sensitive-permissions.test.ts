import { describe, expect, it } from "vitest"
import { isSensitiveGrant, SENSITIVE_GRANT_PERMISSIONS } from "./sensitive-permissions"

/**
 * USR-001: conceder permisos sólo bloqueaba los del módulo `admin`, y las cuatro
 * llaves de gobierno de Prevención viven en el módulo `prevention`. Un rol no
 * administrador con `admin:users` podía concedérselas a sí mismo.
 */
describe("isSensitiveGrant", () => {
  it("marca los permisos del módulo admin", () => {
    expect(isSensitiveGrant({ name: "admin:users", module: "admin" })).toBe(true)
    expect(isSensitiveGrant({ name: "admin:roles", module: "admin" })).toBe(true)
  })

  it("marca las tres excepciones de segregación de Prevención", () => {
    for (const name of [
      "prevention:risk:override_segregation",
      "prevention:capa:override_segregation",
      "prevention:incidents:override_segregation",
    ]) {
      expect(isSensitiveGrant({ name, module: "prevention" })).toBe(true)
    }
  })

  it("marca la firma del propio trabajo", () => {
    expect(isSensitiveGrant({ name: "prevention:sign_own_work", module: "prevention" })).toBe(true)
  })

  it("no marca un permiso operativo corriente", () => {
    expect(isSensitiveGrant({ name: "prevention:capa:complete", module: "prevention" })).toBe(false)
    expect(isSensitiveGrant({ name: "receiving:register_faena", module: "receiving" })).toBe(false)
    expect(isSensitiveGrant({ name: "warehouse:adjust_stock", module: "warehouse" })).toBe(false)
  })

  it("la lista sensible es explícita y no se deriva del nombre", () => {
    // Un permiso que "parece" de gobierno pero no está declarado NO se bloquea:
    // la lista se mantiene a mano justamente para que agregarlo sea deliberado.
    expect(isSensitiveGrant({ name: "prevention:override_algo_nuevo", module: "prevention" })).toBe(false)
    expect(SENSITIVE_GRANT_PERMISSIONS.size).toBe(4)
  })
})
