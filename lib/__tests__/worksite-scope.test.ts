import type { Session } from "next-auth"
import { describe, expect, it } from "vitest"
import {
  resolveWorksiteScope,
  isGlobalRole,
  canAccessWorksite,
  worksiteScopeSql,
} from "@/lib/auth/scope"
import type { AnyColumn } from "drizzle-orm"

function session(roles: string[], worksiteIds: string[] = []): Session {
  return {
    user: {
      id: "user-1",
      name: "User",
      email: "user@example.com",
      roles,
      permissions: [],
      worksiteIds,
      primaryWorksiteId: worksiteIds[0] ?? null,
      avatarColor: null,
      isActive: true,
    },
    expires: "2099-01-01T00:00:00.000Z",
  }
}

describe("worksite scope", () => {
  it("treats global roles as unscoped SQL access", () => {
    expect(resolveWorksiteScope(session(["administrador"]))).toEqual({
      mode: "all",
      ids: [],
    })
  })

  it("carries restricted worksite ids for SQL filters", () => {
    expect(resolveWorksiteScope(session(["solicitante_faena"], ["ws-1", "ws-2"]))).toEqual({
      mode: "some",
      ids: ["ws-1", "ws-2"],
    })
  })

  it("represents restricted users without worksites as a no-rows scope", () => {
    expect(resolveWorksiteScope(session(["solicitante_faena"]))).toEqual({
      mode: "none",
      ids: [],
    })
  })

  it("isGlobalRole returns false on null/undefined sessions or missing roles", () => {
    expect(isGlobalRole(null)).toBe(false)
    expect(isGlobalRole({ expires: "" } as unknown as Session)).toBe(false)
    expect(isGlobalRole({ user: {} } as unknown as Session)).toBe(false)
    expect(isGlobalRole({ user: { roles: [] } } as unknown as Session)).toBe(false)
  })

  it("isGlobalRole returns true on global roles", () => {
    expect(isGlobalRole(session(["administrador"]))).toBe(true)
    expect(isGlobalRole(session(["secretaria"]))).toBe(true)
    expect(isGlobalRole(session(["solicitante_faena"]))).toBe(false)
  })

  it("canAccessWorksite verifies worksite access correctly", () => {
    expect(canAccessWorksite(null, "ws-1")).toBe(false)
    expect(canAccessWorksite(session(["administrador"]), "ws-1")).toBe(true)
    expect(canAccessWorksite(session(["solicitante_faena"], ["ws-1"]), "ws-1")).toBe(true)
    expect(canAccessWorksite(session(["solicitante_faena"], ["ws-1"]), "ws-2")).toBe(false)
  })

  it("worksiteScopeSql generates correct SQL conditions", () => {
    const dummyColumn = {} as unknown as AnyColumn

    // Global role -> mode: "all" -> returns undefined
    expect(worksiteScopeSql(session(["administrador"]), dummyColumn)).toBeUndefined()

    // No role/no session -> mode: "none" -> returns SQL false condition
    const noneSql = worksiteScopeSql(null, dummyColumn)
    expect(noneSql).toBeDefined()

    // Restricted role with access ids -> mode: "some" -> returns inArray condition
    const someSql = worksiteScopeSql(session(["solicitante_faena"], ["ws-1", "ws-2"]), dummyColumn)
    expect(someSql).toBeDefined()
  })

  /**
   * El tercer parámetro (`worksiteId`) lo usa el alcance global del dashboard.
   * Se **intersecta** con el permiso del rol, nunca lo reemplaza: son 104
   * llamadores, así que la regla se fija acá y no en cada uno.
   *
   * Las aserciones comparan contra `worksiteScopeSql(null, col)` —el predicado
   * canónico de "no ve nada"— en vez de inspeccionar los internos de drizzle.
   */
  describe("worksiteScopeSql con faena elegida", () => {
    const dummyColumn = {} as unknown as AnyColumn
    const deny = () => worksiteScopeSql(null, dummyColumn)

    it("acota un rol global a la faena pedida", () => {
      const scoped = worksiteScopeSql(session(["administrador"]), dummyColumn, "ws-9")
      // Ya no es `undefined` (sin cláusula) ni una denegación: es una igualdad.
      expect(scoped).toBeDefined()
      expect(scoped).not.toEqual(deny())
    })

    it("acota un rol de faena a una que sí tiene autorizada", () => {
      const scoped = worksiteScopeSql(session(["solicitante_faena"], ["ws-1", "ws-2"]), dummyColumn, "ws-2")
      expect(scoped).toBeDefined()
      expect(scoped).not.toEqual(deny())
    })

    it("niega el acceso a una faena fuera del permiso, igual que no tener acceso", () => {
      const escalated = worksiteScopeSql(session(["solicitante_faena"], ["ws-1"]), dummyColumn, "ws-2")
      expect(escalated).toEqual(deny())
    })

    it("un usuario sin faenas sigue sin ver nada al pedir una", () => {
      expect(worksiteScopeSql(session(["solicitante_faena"], []), dummyColumn, "ws-1")).toEqual(deny())
    })

    it("sin faena elegida se comporta igual que antes", () => {
      const global = session(["administrador"])
      const scopedUser = session(["solicitante_faena"], ["ws-1"])
      expect(worksiteScopeSql(global, dummyColumn, undefined)).toBeUndefined()
      expect(worksiteScopeSql(scopedUser, dummyColumn, undefined)).toEqual(worksiteScopeSql(scopedUser, dummyColumn))
    })
  })
})
