import { describe, it, expect, vi, beforeEach } from "vitest"
import { can, canAny, requirePermission, requireAuth, guardPermission, guardAuth } from "../auth/can"
import { auth } from "../auth/auth"
import type { Mock } from "vitest"

vi.mock("../auth/auth", () => ({
  auth: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
  },
}))

const authMock = auth as unknown as Mock

describe("auth-can helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("can", () => {
    it("returns false if session is null", () => {
      expect(can(null, "requests:create" as never)).toBe(false)
    })

    it("returns false if user has no permissions", () => {
      const session = { user: {} } as never
      expect(can(session, "requests:create" as never)).toBe(false)
    })

    it("returns true if user has the permission", () => {
      const session = { user: { permissions: ["requests:create"] } } as never
      expect(can(session, "requests:create" as never)).toBe(true)
    })

    it("returns false if user does not have the permission", () => {
      const session = { user: { permissions: ["requests:view"] } } as never
      expect(can(session, "requests:create" as never)).toBe(false)
    })
  })

  describe("canAny", () => {
    it("returns false if session is null", () => {
      expect(canAny(null, "requests:create" as never, "requests:approve" as never)).toBe(false)
    })

    it("returns true if user has at least one of the permissions", () => {
      const session = { user: { permissions: ["requests:create"] } } as never
      expect(canAny(session, "requests:approve" as never, "requests:create" as never)).toBe(true)
    })

    it("returns false if user has none of the permissions", () => {
      const session = { user: { permissions: ["requests:view"] } } as never
      expect(canAny(session, "requests:approve" as never, "requests:create" as never)).toBe(false)
    })
  })

  describe("requirePermission", () => {
    it("throws unauthorized if not authenticated", async () => {
      authMock.mockResolvedValue(null)
      await expect(requirePermission("requests:create" as never)).rejects.toThrow("Unauthorized: not authenticated")
    })

    it("throws forbidden if missing permission", async () => {
      const session = { user: { permissions: ["requests:view"] } } as never
      authMock.mockResolvedValue(session)
      await expect(requirePermission("requests:create" as never)).rejects.toThrow("Forbidden: missing permission requests:create")
    })

    it("returns session if user has the permission", async () => {
      const session = { user: { permissions: ["requests:create"] } } as never
      authMock.mockResolvedValue(session)
      const res = await requirePermission("requests:create" as never)
      expect(res).toBe(session)
    })
  })

  describe("requireAuth", () => {
    it("throws unauthorized if not authenticated", async () => {
      authMock.mockResolvedValue(null)
      await expect(requireAuth()).rejects.toThrow("Unauthorized: not authenticated")
    })

    it("returns session if authenticated", async () => {
      const session = { user: {} } as never
      authMock.mockResolvedValue(session)
      const res = await requireAuth()
      expect(res).toBe(session)
    })
  })

  describe("guardPermission", () => {
    it("returns session on success", async () => {
      const session = { user: { permissions: ["requests:create"] } } as never
      authMock.mockResolvedValue(session)
      const res = await guardPermission("requests:create" as never)
      expect(res).toEqual({ session, error: null })
    })

    it("returns error details on failure", async () => {
      authMock.mockResolvedValue(null)
      const res = await guardPermission("requests:create" as never)
      expect(res).toEqual({
        session: null,
        error: { ok: false, message: "No tienes permisos para realizar esta acción" },
      })
    })
  })

  describe("guardAuth", () => {
    it("returns session on success", async () => {
      const session = { user: {} } as never
      authMock.mockResolvedValue(session)
      const res = await guardAuth()
      expect(res).toEqual({ session, error: null })
    })

    it("returns error details on failure", async () => {
      authMock.mockResolvedValue(null)
      const res = await guardAuth()
      expect(res).toEqual({
        session: null,
        error: { ok: false, message: "Debes iniciar sesión para continuar" },
      })
    })
  })
})
