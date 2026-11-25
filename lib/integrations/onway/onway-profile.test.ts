import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ensureOnwayProfileDir,
  onwayProfilePath,
  onwayProfileRoot,
  onwayProfileState,
  resetOnwayProfile,
  restoreOnwayProfile,
  saveOnwayProfile,
} from "./onway-profile"

const ACCOUNT = "a".repeat(64)
const OTHER_ACCOUNT = "b".repeat(64)

let dir = ""
const previousDir = process.env.ONWAY_CAPTCHA_PROFILE_DIR

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "onway-profile-"))
  process.env.ONWAY_CAPTCHA_PROFILE_DIR = dir
})

afterEach(() => {
  if (previousDir === undefined) delete process.env.ONWAY_CAPTCHA_PROFILE_DIR
  else process.env.ONWAY_CAPTCHA_PROFILE_DIR = previousDir
  rmSync(dir, { recursive: true, force: true })
})

function fakeContext(cookies: Array<{ name: string; value: string; domain: string; path: string }> = []) {
  const added: Array<Array<{ name: string; value: string; domain: string; path: string }>> = []
  return {
    added,
    storageState: vi.fn(async ({ path }: { path: string }) => {
      writeFileSync(path, JSON.stringify({ cookies, origins: [] }))
    }),
    addCookies: vi.fn(async (input: Array<{ name: string; value: string; domain: string; path: string }>) => {
      added.push(input)
    }),
  }
}

describe("rutas del perfil", () => {
  it("usa el directorio configurado y un nombre que no revela la credencial", () => {
    expect(onwayProfileRoot()).toBe(dir)
    const path = onwayProfilePath(ACCOUNT)
    expect(path.startsWith(dir)).toBe(true)
    expect(path).toContain(ACCOUNT.slice(0, 32))
    // El hash completo tiene 64 caracteres: el nombre recorta para no exponerlo.
    expect(path).not.toContain(ACCOUNT)
  })

  it("cuentas distintas no comparten archivo", () => {
    expect(onwayProfilePath(ACCOUNT)).not.toBe(onwayProfilePath(OTHER_ACCOUNT))
  })

  it("rechaza una cuenta vacía en vez de escribir en la raíz", () => {
    expect(() => onwayProfilePath("")).toThrow("ONWAY_PROFILE_ACCOUNT_REQUIRED")
  })
})

describe("ensureOnwayProfileDir", () => {
  it("crea el directorio con permisos 0700", () => {
    expect(ensureOnwayProfileDir()).toBe(true)
    expect(existsSync(dir)).toBe(true)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
  })

  it("devuelve false en vez de lanzar cuando el directorio no se puede crear", () => {
    // Un archivo donde debería ir el directorio: `mkdir` falla sin bloqueos.
    const blocked = join(dir, "no-es-un-directorio")
    writeFileSync(blocked, "")
    process.env.ONWAY_CAPTCHA_PROFILE_DIR = join(blocked, "onway")
    expect(ensureOnwayProfileDir()).toBe(false)
  })
})

describe("guardar y restaurar", () => {
  it("guarda la sesión con permisos 0600 y la restaura en un contexto nuevo", async () => {
    const context = fakeContext([{ name: "_GRECAPTCHA", value: "abc", domain: ".onway.enteldigital.cl", path: "/" }])
    await expect(saveOnwayProfile(context as never, ACCOUNT)).resolves.toBe(true)

    const path = onwayProfilePath(ACCOUNT)
    expect(existsSync(path)).toBe(true)
    expect(statSync(path).mode & 0o777).toBe(0o600)

    const fresh = fakeContext()
    await expect(restoreOnwayProfile(fresh as never, ACCOUNT)).resolves.toBe(true)
    expect(fresh.added).toEqual([[{ name: "_GRECAPTCHA", value: "abc", domain: ".onway.enteldigital.cl", path: "/" }]])
  })

  it("no restaura nada cuando no hay sesión guardada", async () => {
    const fresh = fakeContext()
    await expect(restoreOnwayProfile(fresh as never, ACCOUNT)).resolves.toBe(false)
    expect(fresh.added).toEqual([])
  })

  it("descarta un archivo corrupto en vez de lanzar", async () => {
    ensureOnwayProfileDir()
    writeFileSync(onwayProfilePath(ACCOUNT), "{ esto no es json")
    const fresh = fakeContext()
    await expect(restoreOnwayProfile(fresh as never, ACCOUNT)).resolves.toBe(false)
    expect(fresh.added).toEqual([])
  })

  it("ignora cookies sin dominio, que harían fallar a addCookies", async () => {
    ensureOnwayProfileDir()
    writeFileSync(
      onwayProfilePath(ACCOUNT),
      JSON.stringify({ cookies: [{ name: "ok", value: "1", domain: ".x.cl", path: "/" }, { name: "sin-dominio" }] }),
    )
    const fresh = fakeContext()
    await expect(restoreOnwayProfile(fresh as never, ACCOUNT)).resolves.toBe(true)
    expect(fresh.added[0]).toHaveLength(1)
  })

  it("no lanza cuando el volumen no es escribible", async () => {
    const blocked = join(dir, "archivo-bloqueante")
    writeFileSync(blocked, "")
    process.env.ONWAY_CAPTCHA_PROFILE_DIR = join(blocked, "onway")
    await expect(saveOnwayProfile(fakeContext() as never, ACCOUNT)).resolves.toBe(false)
  })
})

describe("resetOnwayProfile", () => {
  it("borra la sesión guardada y reporta si existía", async () => {
    await saveOnwayProfile(fakeContext([{ name: "a", value: "b", domain: ".x.cl", path: "/" }]) as never, ACCOUNT)
    expect(onwayProfileState(ACCOUNT).exists).toBe(true)

    expect(resetOnwayProfile(ACCOUNT)).toBe(true)
    expect(onwayProfileState(ACCOUNT).exists).toBe(false)
    expect(existsSync(onwayProfilePath(ACCOUNT))).toBe(false)

    expect(resetOnwayProfile(ACCOUNT)).toBe(false)
  })
})
