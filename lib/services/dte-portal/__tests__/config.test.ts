import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readDtePortalEnv, buildDtePortalClientConfig, isDteSyncEnabled } from "../config"

describe("dte-portal config", () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe("readDtePortalEnv", () => {
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

  describe("buildDtePortalClientConfig", () => {
    it("throws clear error when required env vars are missing", () => {
      delete process.env.DTE_PORTAL_RUT_USR
      delete process.env.DTE_PORTAL_CLAVE

      expect(() => buildDtePortalClientConfig()).toThrow("Faltan variables de entorno")
    })

    it("returns client config when all variables are provided", () => {
      process.env.DTE_PORTAL_RUT_USR = "11111111-1"
      process.env.DTE_PORTAL_RUT_EMP = "78023530-6"
      process.env.DTE_PORTAL_CLAVE = "secret123"
      process.env.DTE_PORTAL_CODEMP = "433"

      const config = buildDtePortalClientConfig()

      expect(config.credentials.rutUsr).toBe("11111111-1")
      expect(config.credentials.codEmp).toBe("433")
    })
  })

  describe("isDteSyncEnabled", () => {
    it("returns false if DTE_SYNC_ENABLED is not true", () => {
      process.env.DTE_PORTAL_RUT_USR = "11111111-1"
      process.env.DTE_PORTAL_RUT_EMP = "78023530-6"
      process.env.DTE_PORTAL_CLAVE = "secret123"
      process.env.DTE_PORTAL_CODEMP = "433"
      process.env.DTE_SYNC_ENABLED = "false"

      expect(isDteSyncEnabled()).toBe(false)
    })

    it("returns true only when ENABLED is true and credentials exist", () => {
      process.env.DTE_PORTAL_RUT_USR = "11111111-1"
      process.env.DTE_PORTAL_RUT_EMP = "78023530-6"
      process.env.DTE_PORTAL_CLAVE = "secret123"
      process.env.DTE_PORTAL_CODEMP = "433"
      process.env.DTE_SYNC_ENABLED = "true"

      expect(isDteSyncEnabled()).toBe(true)
    })
  })
})
