// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { clearShellCache, MANT_LOGIN_URL, signOutToMantLogin } from "../session"

vi.mock("next-auth/react", () => ({ signOut: vi.fn(async () => undefined), getSession: vi.fn(async () => null) }))

/** Cache Storage falso: anota qué se borra. */
function fakeCaches(keys: string[]) {
  const deleted: string[] = []
  vi.stubGlobal("caches", {
    keys: async () => keys,
    delete: async (key: string) => { deleted.push(key); return true },
  })
  return deleted
}

afterEach(() => { vi.unstubAllGlobals() })

describe("cerrar sesión en una tablet compartida", () => {
  it("borra las cachés del shell de la app y deja las demás", async () => {
    const deleted = fakeCaches(["mant-shell-v2", "mant-static-v2", "otra-cache"])
    await clearShellCache()
    expect(deleted).toEqual(["mant-shell-v2"])
  })

  it("tolera un navegador sin Cache Storage", async () => {
    vi.stubGlobal("caches", undefined)
    await expect(clearShellCache()).resolves.toBeUndefined()
  })

  it("al cerrar sesión borra el shell antes de recargar el login", async () => {
    const deleted = fakeCaches(["mant-shell-v2", "mant-static-v2"])
    // jsdom no navega: la asignación a `location.href` no debe impedir que el borrado ocurra antes.
    await signOutToMantLogin().catch(() => {})
    expect(deleted).toEqual(["mant-shell-v2"])
    expect(MANT_LOGIN_URL).toBe("/m/mantencion/entrar")
  })
})
