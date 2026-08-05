import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { readDtePortalEnv, readDtePortalConfig, buildDtePortalClientConfig, isDteSyncEnabled } from "../config"

vi.mock("../settings", () => ({
  readStoredDteSettings: vi.fn(),
}))

import { readStoredDteSettings } from "../settings"
const mockReadStored = vi.mocked(readStoredDteSettings)

describe("dte-portal config", () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    mockReadStored.mockReset()
    mockReadStored.mockResolvedValue({})
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe("readDtePortalEnv (capa .env, síncrona)", () => {
    it("returns default values when env vars are absent", () => {
      delete process.env.DTE_PORTAL_BASE_URL
      delete process.env.DTE_PORTAL_RUT_USR
      delete process.env.DTE_PORTAL_RUT_EMP
      delete process.env.DTE_PORTAL_CLAVE
      delete process.env.DTE_PORTAL_CODEMP
      delete process.env.DTE_SYNC_ENABLED

      const env = readDtePortalEnv()

      expect(env.baseUrl).toBe("https://clientes.dtefacturaenlinea.cl/facturaenlinea")
      expect(env.credentials.rutUsr).toBe("")
      expect(env.syncEnabled).toBe(false)
      expect(env.delayMs).toBe(500)
    })

    it("reads custom environment variables", () => {
      process.env.DTE_PORTAL_RUT_USR = "11111111-1"
      process.env.DTE_PORTAL_RUT_EMP = "78023530-6"
      process.env.DTE_PORTAL_CLAVE = "secret123"
      process.env.DTE_PORTAL_CODEMP = "433"
      process.env.DTE_SYNC_ENABLED = "true"

      const env = readDtePortalEnv()

      expect(env.credentials.rutUsr).toBe("11111111-1")
      expect(env.credentials.rutEmp).toBe("78023530-6")
      expect(env.credentials.clave).toBe("secret123")
      expect(env.credentials.codEmp).toBe("433")
      expect(env.syncEnabled).toBe(true)
    })
  })

  describe("readDtePortalConfig (efectiva: base de datos > .env)", () => {
    it("stored settings win over env vars; unset fields fall back to env", async () => {
      process.env.DTE_PORTAL_RUT_USR = "env-user"
      process.env.DTE_PORTAL_RUT_EMP = "78023530-6"
      process.env.DTE_PORTAL_CLAVE = "env-pass"
      process.env.DTE_PORTAL_CODEMP = "433"
      mockReadStored.mockResolvedValue({
        rutUsr: "db-user",
        clave: "db-pass",
        syncEnabled: "true",
        delayMs: "750",
      })

      const config = await readDtePortalConfig()

      expect(config.credentials.rutUsr).toBe("db-user")
      expect(config.credentials.clave).toBe("db-pass")
      expect(config.credentials.rutEmp).toBe("78023530-6") // del .env
      expect(config.credentials.codEmp).toBe("433")        // del .env
      expect(config.syncEnabled).toBe(true)
      expect(config.delayMs).toBe(750)
    })
  })

  describe("buildDtePortalClientConfig", () => {
    it("throws clear error when effective credentials are missing", async () => {
      delete process.env.DTE_PORTAL_RUT_USR
      delete process.env.DTE_PORTAL_CLAVE

      await expect(buildDtePortalClientConfig()).rejects.toThrow("Faltan credenciales para el portal DTE")
    })

    it("returns client config when all variables are provided", async () => {
      process.env.DTE_PORTAL_RUT_USR = "11111111-1"
      process.env.DTE_PORTAL_RUT_EMP = "78023530-6"
      process.env.DTE_PORTAL_CLAVE = "secret123"
      process.env.DTE_PORTAL_CODEMP = "433"

      const config = await buildDtePortalClientConfig()

      expect(config.credentials.rutUsr).toBe("11111111-1")
      expect(config.credentials.codEmp).toBe("433")
    })

    it("uses stored settings when env vars are empty", async () => {
      delete process.env.DTE_PORTAL_RUT_USR
      delete process.env.DTE_PORTAL_RUT_EMP
      delete process.env.DTE_PORTAL_CLAVE
      delete process.env.DTE_PORTAL_CODEMP
      mockReadStored.mockResolvedValue({
        rutUsr: "db-user",
        rutEmp: "db-emp",
        clave: "db-pass",
        codEmp: "999",
      })

      const config = await buildDtePortalClientConfig()

      expect(config.credentials.rutUsr).toBe("db-user")
      expect(config.credentials.codEmp).toBe("999")
    })
  })

  describe("isDteSyncEnabled", () => {
    it("returns false if sync is not enabled", async () => {
      process.env.DTE_PORTAL_RUT_USR = "11111111-1"
      process.env.DTE_PORTAL_RUT_EMP = "78023530-6"
      process.env.DTE_PORTAL_CLAVE = "secret123"
      process.env.DTE_PORTAL_CODEMP = "433"
      process.env.DTE_SYNC_ENABLED = "false"

      await expect(isDteSyncEnabled()).resolves.toBe(false)
    })

    it("returns true only when enabled and credentials exist", async () => {
      process.env.DTE_PORTAL_RUT_USR = "11111111-1"
      process.env.DTE_PORTAL_RUT_EMP = "78023530-6"
      process.env.DTE_PORTAL_CLAVE = "secret123"
      process.env.DTE_PORTAL_CODEMP = "433"
      process.env.DTE_SYNC_ENABLED = "true"

      await expect(isDteSyncEnabled()).resolves.toBe(true)
    })

    it("treats stored syncEnabled as effective, overriding env", async () => {
      process.env.DTE_SYNC_ENABLED = "false"
      mockReadStored.mockResolvedValue({
        rutUsr: "db-user",
        rutEmp: "db-emp",
        clave: "db-pass",
        codEmp: "999",
        syncEnabled: "true",
      })

      await expect(isDteSyncEnabled()).resolves.toBe(true)
    })
  })
})
