import { vi, describe, it, expect, beforeEach } from "vitest"
import type { Session } from "next-auth"

vi.mock("next-auth", () => {
  return {
    default: vi.fn((config: unknown) => {
      const g = globalThis as unknown as { capturedConfig: unknown }
      g.capturedConfig = config
      return {
        handlers: {},
        auth: vi.fn(),
        signIn: vi.fn(),
        signOut: vi.fn(),
      }
    }),
    CredentialsSignin: class CredentialsSignin extends Error {
      code: string
      constructor(message: string) {
        super(message)
        this.code = "generic"
      }
    }
  }
})

// Mock bcryptjs
const mockCompare = vi.fn()
vi.mock("bcryptjs", () => ({
  default: {
    compare: (p: string, h: string) => mockCompare(p, h),
  },
}))

// Mock database query
const mockFindFirst = vi.fn()
vi.mock("@/db", () => ({
  db: {
    query: {
      users: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
    },
  },
}))

// Mock audit and rbac helpers
const mockCheckRateLimit = vi.fn()
const mockRecordFailure = vi.fn()
const mockRecordSuccess = vi.fn()

vi.mock("@/lib/services/rate-limit", () => ({
  checkRateLimit: (key: string) => mockCheckRateLimit(key),
  recordFailure: (key: string) => mockRecordFailure(key),
  recordSuccess: (key: string) => mockRecordSuccess(key),
}))

const mockGetUserRbacById = vi.fn()
const mockApplyRbacToToken = vi.fn()
vi.mock("@/lib/auth/rbac", () => ({
  getUserRbacById: (id: string, bypass?: boolean) => mockGetUserRbacById(id, bypass),
  applyRbacToToken: (token: unknown, rbac: unknown) => mockApplyRbacToToken(token, rbac),
}))

const mockIsPasswordSetupPending = vi.fn()
vi.mock("@/lib/auth/password-setup", () => ({
  isPasswordSetupPending: (hash: string) => mockIsPasswordSetupPending(hash),
}))

const mockHeaders = vi.fn()
vi.mock("next/headers", () => ({
  headers: () => mockHeaders(),
}))

// Import the module under test to trigger NextAuth initialization and capture the config
import "@/lib/auth/auth"

interface MockNextAuthConfig {
  providers: Array<{
    options: {
      authorize: (credentials: Record<string, string>) => Promise<Record<string, unknown> | null>
    }
  }>
  callbacks: {
    jwt: (params: { token: Record<string, unknown>; user?: Record<string, unknown> }) => Promise<Record<string, unknown> | null>
    session: (params: { session: Session; token: Record<string, unknown> }) => Promise<Session>
  }
}

describe("NextAuth configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({ allowed: true, waitTimeRemainingMs: 0 })
    mockHeaders.mockResolvedValue({ get: (key: string) => key === "cf-connecting-ip" ? "203.0.113.1" : null })
    mockIsPasswordSetupPending.mockReturnValue(false)
  })

  it("captured configuration successfully", () => {
    const g = globalThis as unknown as { capturedConfig: unknown }
    expect(g.capturedConfig).toBeDefined()
    const config = g.capturedConfig as MockNextAuthConfig
    expect(config.providers).toBeDefined()
    expect(config.callbacks).toBeDefined()
  })

  describe("Credentials Provider authorize method", () => {
    let authorize: (credentials: Record<string, string>) => Promise<Record<string, unknown> | null>

    beforeEach(() => {
      const g = globalThis as unknown as { capturedConfig: unknown }
      const config = g.capturedConfig as MockNextAuthConfig
      authorize = config.providers[0]!.options.authorize
    })

    it("returns null if credentials are invalid or missing", async () => {
      const result = await authorize({ email: "", password: "" })
      expect(result).toBeNull()
    })

    it("throws IpRateLimited if the client IP is rate limited", async () => {
      mockCheckRateLimit.mockImplementation(async (key: string) => {
        if (key === "203.0.113.1") {
          return { allowed: false, waitTimeRemainingMs: 120_000 }
        }
        return { allowed: true, waitTimeRemainingMs: 0 }
      })

      await expect(authorize({ email: "test@example.com", password: "pwd" }))
        .rejects.toThrow(/Blocked for 2 min/)
    })

    it("throws EmailRateLimited if the email is rate limited", async () => {
      mockCheckRateLimit.mockImplementation(async (key: string) => {
        if (key === "test@example.com") {
          return { allowed: false, waitTimeRemainingMs: 180_000 }
        }
        return { allowed: true, waitTimeRemainingMs: 0 }
      })

      await expect(authorize({ email: "test@example.com", password: "pwd" }))
        .rejects.toThrow(/Blocked for 3 min/)
    })

    it("returns null if user does not exist in DB", async () => {
      mockFindFirst.mockResolvedValue(null)
      mockCompare.mockResolvedValue(false)

      const result = await authorize({ email: "missing@example.com", password: "pwd" })
      expect(result).toBeNull()
      expect(mockRecordFailure).toHaveBeenCalledWith("203.0.113.1")
    })

    it("mantiene la clave IP aunque rote X-Forwarded-For", async () => {
      mockFindFirst.mockResolvedValue(null)
      mockCompare.mockResolvedValue(false)
      mockHeaders.mockResolvedValue({
        get: (key: string) => key === "cf-connecting-ip"
          ? "203.0.113.1"
          : key === "x-forwarded-for"
            ? "10.0.0.1"
            : null,
      })

      await authorize({ email: "spray-a@example.com", password: "pwd" })

      mockHeaders.mockResolvedValue({
        get: (key: string) => key === "cf-connecting-ip"
          ? "203.0.113.1"
          : key === "x-forwarded-for"
            ? "10.0.0.2"
            : null,
      })

      await authorize({ email: "spray-b@example.com", password: "pwd" })

      expect(mockCheckRateLimit.mock.calls.map(([key]) => key)).toEqual([
        "203.0.113.1",
        "spray-a@example.com",
        "203.0.113.1",
        "spray-b@example.com",
      ])
      expect(mockRecordFailure.mock.calls.map(([key]) => key)).toEqual([
        "203.0.113.1",
        "spray-a@example.com",
        "203.0.113.1",
        "spray-b@example.com",
      ])
    })

    it("returns user safe data on successful login", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        isActive: true,
        hashedPassword: "hashed_password"
      }
      mockFindFirst.mockResolvedValue(mockUser)
      mockGetUserRbacById.mockResolvedValue({ id: "user-123", email: "test@example.com", isActive: true })
      mockCompare.mockResolvedValue(true)

      const result = await authorize({ email: "test@example.com", password: "pwd" })
      expect(result).toBeDefined()
      expect(result!.id).toBe("user-123")
      expect(result!._hashedPassword).toBeUndefined()
      expect(mockRecordSuccess).toHaveBeenCalledWith("203.0.113.1")
      expect(mockRecordSuccess).toHaveBeenCalledWith("test@example.com")
    })

    it("returns null if user is inactive or rbac is inactive", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        isActive: false,
        hashedPassword: "hashed_password"
      }
      mockFindFirst.mockResolvedValue(mockUser)

      const result = await authorize({ email: "test@example.com", password: "pwd" })
      expect(result).toBeNull()
    })

    it("returns null if password setup is pending", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        isActive: true,
        hashedPassword: "hashed_password"
      }
      mockFindFirst.mockResolvedValue(mockUser)
      mockGetUserRbacById.mockResolvedValue({ id: "user-123", email: "test@example.com", isActive: true })
      mockIsPasswordSetupPending.mockReturnValue(true)

      const result = await authorize({ email: "test@example.com", password: "pwd" })
      expect(result).toBeNull()
    })
  })

  describe("Callbacks", () => {
    it("jwt callback embeds rbac into token on sign in", async () => {
      const g = globalThis as unknown as { capturedConfig: unknown }
      const config = g.capturedConfig as MockNextAuthConfig
      const jwt = config.callbacks.jwt
      const mockUser = { id: "user-123", email: "test@example.com", isActive: true }
      const token = { name: "test" }

      const result = await jwt({ token, user: mockUser })
      expect(mockApplyRbacToToken).toHaveBeenCalledWith(token, mockUser)
      expect(result).toBe(token)
    })

    it("jwt callback refreshes rbac dynamically and bypasses cache", async () => {
      const g = globalThis as unknown as { capturedConfig: unknown }
      const config = g.capturedConfig as MockNextAuthConfig
      const jwt = config.callbacks.jwt
      const token = { id: "user-123" }
      const mockRbac = { id: "user-123", email: "test@example.com", isActive: true }
      mockGetUserRbacById.mockResolvedValue(mockRbac)

      const result = await jwt({ token })
      expect(mockGetUserRbacById).toHaveBeenCalledWith("user-123", true)
      expect(mockApplyRbacToToken).toHaveBeenCalledWith(token, mockRbac)
      expect(result).toBe(token)
    })

    /*
     * AUTH-003 (auditoría 2026-09-14). El callback refrescaba RBAC pero no
     * comparaba nada temporal: restablecer la contraseña no dejaba ninguna
     * condición observable que hiciera fallar a una sesión emitida antes, de
     * modo que una cookie robada seguía entrando hasta expirar sola.
     */
    it("AUTH-003: el callback jwt descarta una sesión emitida antes del cambio de contraseña", async () => {
      const g = globalThis as unknown as { capturedConfig: unknown }
      const config = g.capturedConfig as MockNextAuthConfig
      const jwt = config.callbacks.jwt
      const cambioDeClave = new Date("2026-09-14T12:00:00.000Z")
      const token = { id: "user-123", sessionIssuedAt: cambioDeClave.getTime() - 60_000 }
      mockGetUserRbacById.mockResolvedValue({
        id: "user-123", email: "test@example.com", isActive: true,
        sessionsValidFrom: cambioDeClave.toISOString(),
      })

      const result = await jwt({ token })

      expect(result).toBeNull()
      expect(mockApplyRbacToToken).not.toHaveBeenCalled()
    })

    it("AUTH-003: la sesión iniciada después del cambio de contraseña sobrevive", async () => {
      const g = globalThis as unknown as { capturedConfig: unknown }
      const config = g.capturedConfig as MockNextAuthConfig
      const jwt = config.callbacks.jwt
      const cambioDeClave = new Date("2026-09-14T12:00:00.000Z")
      const token = { id: "user-123", sessionIssuedAt: cambioDeClave.getTime() + 1_000 }
      const mockRbac = {
        id: "user-123", email: "test@example.com", isActive: true,
        sessionsValidFrom: cambioDeClave.toISOString(),
      }
      mockGetUserRbacById.mockResolvedValue(mockRbac)

      const result = await jwt({ token })

      expect(result).toBe(token)
      expect(mockApplyRbacToToken).toHaveBeenCalledWith(token, mockRbac)
    })

    it("AUTH-003: sin revocación registrada no se cierra ninguna sesión (el despliegue no expulsa a nadie)", async () => {
      const g = globalThis as unknown as { capturedConfig: unknown }
      const config = g.capturedConfig as MockNextAuthConfig
      const jwt = config.callbacks.jwt
      const token = { id: "user-123" } // cookie antigua, sin la marca nueva
      mockGetUserRbacById.mockResolvedValue({
        id: "user-123", email: "test@example.com", isActive: true, sessionsValidFrom: null,
      })

      expect(await jwt({ token })).toBe(token)
    })

    it("AUTH-003: el inicio de sesión graba su propia marca temporal (iat lo reescribe Auth.js en cada reemisión)", async () => {
      const g = globalThis as unknown as { capturedConfig: unknown }
      const config = g.capturedConfig as MockNextAuthConfig
      const jwt = config.callbacks.jwt
      const token: Record<string, unknown> = { name: "test" }

      const antes = Date.now()
      await jwt({ token, user: { id: "user-123", email: "test@example.com", isActive: true } })

      expect(typeof token.sessionIssuedAt).toBe("number")
      expect(token.sessionIssuedAt as number).toBeGreaterThanOrEqual(antes)
    })

    it("session callback maps token to session user object", async () => {
      const g = globalThis as unknown as { capturedConfig: unknown }
      const config = g.capturedConfig as MockNextAuthConfig
      const sessionCb = config.callbacks.session
      const token = {
        id: "user-123",
        roles: ["admin"],
        permissions: ["read"],
        worksiteIds: ["ws-1"],
        primaryWorksiteId: "ws-1",
        avatarColor: "#000",
        isActive: true
      }
      const session = { user: {} } as unknown as Session

      const result = await sessionCb({ session, token })
      expect(result.user.id).toBe("user-123")
      expect(result.user.roles).toEqual(["admin"])
      expect(result.user.permissions).toEqual(["read"])
      expect(result.user.worksiteIds).toEqual(["ws-1"])
      expect(result.user.primaryWorksiteId).toBe("ws-1")
      expect(result.user.avatarColor).toBe("#000")
      expect(result.user.isActive).toBe(true)
    })
  })
})
