/**
 * Unit tests for password recovery actions — forgotPasswordAction / resetPasswordAction.
 *
 * Covers:
 *  1. Validation (empty email, missing @)
 *  2. Rate limiting (blocks after threshold)
 *  3. Always-success response (anti-enumeration)
 *  4. Reset: password mismatch, short password, invalid token
 *  5. Reset: happy path
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockCheckRateLimit = vi.hoisted(() => vi.fn())
const mockRecordFailure = vi.hoisted(() => vi.fn())
const mockRequestPasswordReset = vi.hoisted(() => vi.fn())
const mockApplyPasswordReset = vi.hoisted(() => vi.fn())

vi.mock("@/lib/services/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  recordFailure: mockRecordFailure,
  recordSuccess: vi.fn(),
}))

vi.mock("@/lib/services/password-reset", () => ({
  requestPasswordReset: mockRequestPasswordReset,
  applyPasswordReset: mockApplyPasswordReset,
}))

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Map([["x-forwarded-for", "192.168.1.1"]])),
}))

// ── forgotPasswordAction ─────────────────────────────────────────────────────

describe("forgotPasswordAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({ allowed: true, waitTimeRemainingMs: 0 })
    mockRequestPasswordReset.mockResolvedValue(undefined)
  })

  it("rejects empty email", async () => {
    const { forgotPasswordAction } = await import("@/app/(auth)/recuperar/actions")
    const fd = new FormData()
    fd.set("email", "")
    const result = await forgotPasswordAction({ ok: false }, fd)
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.email).toBeDefined()
  })

  it("rejects email without @", async () => {
    const { forgotPasswordAction } = await import("@/app/(auth)/recuperar/actions")
    const fd = new FormData()
    fd.set("email", "invalido")
    const result = await forgotPasswordAction({ ok: false }, fd)
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.email).toBeDefined()
  })

  it("returns success even for non-existent email (anti-enumeration)", async () => {
    mockRequestPasswordReset.mockResolvedValue(undefined)
    const { forgotPasswordAction } = await import("@/app/(auth)/recuperar/actions")
    const fd = new FormData()
    fd.set("email", "noexiste@test.cl")
    const result = await forgotPasswordAction({ ok: false }, fd)
    expect(result.ok).toBe(true)
    expect(result.message).toContain("Si el correo existe")
    expect(mockRequestPasswordReset).toHaveBeenCalledWith("noexiste@test.cl")
  })

  it("blocks when rate limit exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, waitTimeRemainingMs: 300000 })
    const { forgotPasswordAction } = await import("@/app/(auth)/recuperar/actions")
    const fd = new FormData()
    fd.set("email", "user@test.cl")
    const result = await forgotPasswordAction({ ok: false }, fd)
    expect(result.ok).toBe(false)
    expect(result.message).toContain("Demasiados intentos")
    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
  })

  it("records failure for rate tracking", async () => {
    const { forgotPasswordAction } = await import("@/app/(auth)/recuperar/actions")
    const fd = new FormData()
    fd.set("email", "user@test.cl")
    await forgotPasswordAction({ ok: false }, fd)
    expect(mockRecordFailure).toHaveBeenCalledWith(expect.stringContaining("recuperar:ip:"))
  })
})

// ── resetPasswordAction ──────────────────────────────────────────────────────

describe("resetPasswordAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects mismatched passwords", async () => {
    const { resetPasswordAction } = await import("@/app/(auth)/recuperar/[token]/actions")
    const fd = new FormData()
    fd.set("token", "valid-token")
    fd.set("password", "password123")
    fd.set("confirmPassword", "different123")
    const result = await resetPasswordAction({ ok: false }, fd)
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.confirmPassword).toBeDefined()
  })

  it("rejects short password", async () => {
    const { resetPasswordAction } = await import("@/app/(auth)/recuperar/[token]/actions")
    const fd = new FormData()
    fd.set("token", "valid-token")
    fd.set("password", "short")
    fd.set("confirmPassword", "short")
    const result = await resetPasswordAction({ ok: false }, fd)
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.password).toBeDefined()
  })

  it("rejects empty token", async () => {
    const { resetPasswordAction } = await import("@/app/(auth)/recuperar/[token]/actions")
    const fd = new FormData()
    fd.set("token", "")
    fd.set("password", "password123")
    fd.set("confirmPassword", "password123")
    const result = await resetPasswordAction({ ok: false }, fd)
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.token).toBeDefined()
  })

  it("propagates service error for invalid token", async () => {
    mockApplyPasswordReset.mockResolvedValue({ ok: false, error: "Token inválido o expirado" })
    const { resetPasswordAction } = await import("@/app/(auth)/recuperar/[token]/actions")
    const fd = new FormData()
    fd.set("token", "bad-token")
    fd.set("password", "password123")
    fd.set("confirmPassword", "password123")
    const result = await resetPasswordAction({ ok: false }, fd)
    expect(result.ok).toBe(false)
    expect(result.message).toContain("Token inválido")
  })

  it("returns success on valid reset", async () => {
    mockApplyPasswordReset.mockResolvedValue({ ok: true })
    const { resetPasswordAction } = await import("@/app/(auth)/recuperar/[token]/actions")
    const fd = new FormData()
    fd.set("token", "good-token")
    fd.set("password", "newpassword123")
    fd.set("confirmPassword", "newpassword123")
    const result = await resetPasswordAction({ ok: false }, fd)
    expect(result.ok).toBe(true)
    expect(result.message).toContain("Contraseña actualizada")
    expect(mockApplyPasswordReset).toHaveBeenCalledWith("good-token", "newpassword123")
  })
})
