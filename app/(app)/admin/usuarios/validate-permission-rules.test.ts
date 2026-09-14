/**
 * USR-001 (auditoría 2026-09-14): `validatePermissionRules` decidía qué
 * concesión es sensible mirando `p.module === "admin"`. Las cuatro llaves que
 * desactivan la segregación de funciones de Prevención viven en el módulo
 * `prevention` y pasaban sin control, de modo que quien administraba usuarios
 * sin ser administrador podía concederse la capacidad de firmar su propio
 * trabajo.
 *
 * `lib/auth/sensitive-permissions.test.ts` cubre la regla; esto cubre que la
 * regla esté realmente conectada aquí, que era la mitad que faltaba.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const findMany = vi.hoisted(() => vi.fn())
vi.mock("@/db", () => ({ db: { query: { permissions: { findMany } } } }))

const { validatePermissionRules } = await import("./actions.helpers")

const CATALOGO = [
  { id: "p-users", name: "admin:users", module: "admin" },
  { id: "p-stock", name: "warehouse:view_stock", module: "warehouse" },
  { id: "p-firma", name: "prevention:sign_own_work", module: "prevention" },
  { id: "p-capa", name: "prevention:capa:override_segregation", module: "prevention" },
]

function conCatalogo(ids: string[]) {
  findMany.mockResolvedValue(CATALOGO.filter((p) => ids.includes(p.id)))
}

describe("validatePermissionRules", () => {
  beforeEach(() => vi.clearAllMocks())

  it("deja pasar permisos corrientes a cualquiera que administre usuarios", async () => {
    conCatalogo(["p-stock"])
    expect(await validatePermissionRules(["p-stock"], false)).toBeNull()
  })

  it("sigue reservando los permisos del módulo admin", async () => {
    conCatalogo(["p-users"])
    const error = await validatePermissionRules(["p-users"], false)
    expect(error?.ok).toBe(false)
    expect(error?.fieldErrors?.permissionIds?.[0]).toMatch(/permisos de administración/i)
  })

  it("bloquea las llaves de gobierno de Prevención y las nombra", async () => {
    conCatalogo(["p-firma", "p-capa"])
    const error = await validatePermissionRules(["p-firma", "p-capa"], false)
    expect(error?.ok).toBe(false)
    const mensaje = error?.fieldErrors?.permissionIds?.[0] ?? ""
    expect(mensaje).toMatch(/permisos de gobierno/i)
    expect(mensaje).toContain("prevention:sign_own_work")
    expect(mensaje).toContain("prevention:capa:override_segregation")
  })

  it("una llave de gobierno mezclada con un permiso corriente igual bloquea", async () => {
    conCatalogo(["p-stock", "p-firma"])
    expect((await validatePermissionRules(["p-stock", "p-firma"], false))?.ok).toBe(false)
  })

  it("un administrador sí puede concederlas", async () => {
    conCatalogo(["p-users", "p-firma"])
    expect(await validatePermissionRules(["p-users", "p-firma"], true)).toBeNull()
  })

  it("rechaza un id de permiso que no existe", async () => {
    findMany.mockResolvedValue([])
    const error = await validatePermissionRules(["p-inventado"], true)
    expect(error?.fieldErrors?.permissionIds?.[0]).toMatch(/no existen/i)
  })
})
