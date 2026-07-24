/**
 * Unit tests for password-reset service.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockFindFirst = vi.hoisted(() => vi.fn())
const mockInsert = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockDelete = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())
const mockSendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockGetAppBaseUrl = vi.hoisted(() => vi.fn(() => "http://localhost:3001"))

vi.mock("@/db", () => ({
  db: {
    query: {
      users: { findFirst: mockFindFirst },
      passwordResetTokens: { findFirst: vi.fn() },
    },
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    transaction: mockTransaction,
  },
}))
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: mockSendEmail,
  getAppBaseUrl: mockGetAppBaseUrl,
}))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("@/lib/id", () => ({ nanoid: vi.fn(() => "reset-nanoid-123") }))

// Mock bcryptjs
vi.mock("bcryptjs", () => ({
  hash: vi.fn(async (pw: string) => `hashed_${pw}`),
}))

import {
  requestPasswordReset,
  validateResetToken,
  applyPasswordReset,
} from "@/lib/services/password-reset"
import { pruneResetTokens } from "@/lib/services/password-reset-cleanup"

describe("requestPasswordReset", () => {
  beforeEach(() => vi.clearAllMocks())

  it("does nothing (returns silently) if user not found", async () => {
    mockFindFirst.mockResolvedValue(null)
    await requestPasswordReset("nonexistent@test.cl")
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("sends email and stores token when user found", async () => {
    mockFindFirst.mockResolvedValue({ id: "user-1", name: "Juan", email: "juan@test.cl" })
    const setChain = vi.fn().mockResolvedValue(undefined)
    mockUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: setChain }) })
    const valuesChain = vi.fn().mockResolvedValue(undefined)
    mockInsert.mockReturnValue({ values: valuesChain })

    await requestPasswordReset("Juan@Test.CL")

    expect(mockInsert).toHaveBeenCalled()
    expect(mockSendEmail).toHaveBeenCalled()
    const emailCall = mockSendEmail.mock.calls[0]?.[0] as { to: string; subject: string } | undefined
    expect(emailCall?.to).toBe("juan@test.cl")
    expect(emailCall?.subject).toContain("Restablecer")
  })
})

describe("validateResetToken", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns invalid if token not found", async () => {
    const dbModule = await import("@/db")
    const findFirst = (dbModule.db.query.passwordResetTokens.findFirst as ReturnType<typeof vi.fn>)
    findFirst.mockResolvedValue(null)
    const result = await validateResetToken("some-token")
    expect(result.valid).toBe(false)
  })

  it("returns invalid if token expired", async () => {
    const dbModule = await import("@/db")
    const findFirst = (dbModule.db.query.passwordResetTokens.findFirst as ReturnType<typeof vi.fn>)
    findFirst.mockResolvedValue({
      id: "t-1",
      userId: "user-1",
      expiresAt: "2020-01-01T00:00:00Z",
      usedAt: null,
    })
    const result = await validateResetToken("expired-token")
    expect(result.valid).toBe(false)
  })

  it("returns valid with userId if token is valid and unexpired", async () => {
    const dbModule = await import("@/db")
    const findFirst = (dbModule.db.query.passwordResetTokens.findFirst as ReturnType<typeof vi.fn>)
    findFirst.mockResolvedValue({
      id: "t-1",
      userId: "user-1",
      expiresAt: "2099-01-01T00:00:00Z",
      usedAt: null,
    })
    const result = await validateResetToken("valid-token")
    expect(result.valid).toBe(true)
    expect(result.userId).toBe("user-1")
  })
})

describe("applyPasswordReset", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns error if token invalid in transaction", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        query: { passwordResetTokens: { findFirst: vi.fn().mockResolvedValue(null) } },
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      }
      return fn(tx as unknown as Record<string, unknown>)
    })
    const result = await applyPasswordReset("bad-token", "newpass123")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("Token inválido")
  })

  it("returns error if token expired in transaction", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        query: {
          passwordResetTokens: {
            findFirst: vi.fn().mockResolvedValue({
              id: "t-1", userId: "user-1", expiresAt: "2020-01-01T00:00:00Z", usedAt: null,
            }),
          },
        },
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      }
      return fn(tx as unknown as Record<string, unknown>)
    })
    const result = await applyPasswordReset("expired-token", "newpass123")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("expirado")
  })

  it("succeeds with valid token", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        query: {
          passwordResetTokens: {
            findFirst: vi.fn().mockResolvedValue({
              id: "t-1", userId: "user-1", expiresAt: "2099-01-01T00:00:00Z", usedAt: null,
            }),
          },
        },
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
      }
      return fn(tx as unknown as Record<string, unknown>)
    })
    const result = await applyPasswordReset("valid-token", "newpass123")
    expect(result.ok).toBe(true)
  })
})

describe("pruneResetTokens", () => {
  beforeEach(() => vi.clearAllMocks())

  it("calls delete with timestamp condition", async () => {
    const whereChain = vi.fn().mockResolvedValue(undefined)
    mockDelete.mockReturnValue({ where: whereChain })
    await pruneResetTokens()
    expect(mockDelete).toHaveBeenCalled()
  })
})
