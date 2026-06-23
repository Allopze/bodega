/**
 * Unit tests for changePasswordAction (perfil/actions.ts).
 *
 * Covers:
 *  1. Unauthenticated user
 *  2. Validation: empty fields
 *  3. Validation: password too short (< 8 chars)
 *  4. Validation: passwords don't match
 *  5. Validation: new password same as current
 *  6. User not found in DB
 *  7. Current password incorrect (bcrypt.compare fails)
 *  8. Happy path: password updated, bcrypt.hash called, audit recorded
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockFindFirst = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())
const mockBcryptCompare = vi.hoisted(() => vi.fn())
const mockBcryptHash = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("@/db", () => ({
  db: {
    query: { users: { findFirst: mockFindFirst } },
    update: mockUpdate,
  },
}))
vi.mock("bcryptjs", () => ({
  default: {
    compare: mockBcryptCompare,
    hash: mockBcryptHash,
  },
  compare: mockBcryptCompare,
  hash: mockBcryptHash,
}))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))

// ── Import action AFTER mocks ──────────────────────────────────────────────
const { changePasswordAction } = await import("@/app/(app)/perfil/actions")

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "user@test.cl",
      name: "User",
      roles: ["admin"],
      permissions: [],
      worksiteIds: [],
      primaryWorksiteId: null,
      avatarColor: "#000",
      isActive: true,
      ...overrides,
    },
  }
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const DEFAULT_FIELDS = {
  currentPassword: "CurrentPass123",
  newPassword: "NewSecurePass456",
  confirmPassword: "NewSecurePass456",
}

const prevState = { ok: false, message: "" }

// Mock the chainable update() call: db.update(users).set(...).where(...)
function setupUpdateChain() {
  const whereFn = vi.fn().mockResolvedValue(undefined)
  const setFn = vi.fn().mockReturnValue({ where: whereFn })
  mockUpdate.mockReturnValue({ set: setFn })
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("changePasswordAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupUpdateChain()
    mockAuthFn.mockResolvedValue(makeSession())
    mockFindFirst.mockResolvedValue({ hashedPassword: "old_hash_abc" })
    mockBcryptCompare.mockResolvedValue(true)
    mockBcryptHash.mockResolvedValue("new_hash_xyz")
  })

  it("returns error if user is not authenticated", async () => {
    mockAuthFn.mockResolvedValueOnce(null)

    const res = await changePasswordAction(prevState, form(DEFAULT_FIELDS))

    expect(res.ok).toBe(false)
    expect(res.message).toBe("No autenticado")
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it("returns error if session has no user id", async () => {
    mockAuthFn.mockResolvedValueOnce({ expires: "2099-01-01", user: undefined })

    const res = await changePasswordAction(prevState, form(DEFAULT_FIELDS))

    expect(res.ok).toBe(false)
    expect(res.message).toBe("No autenticado")
  })

  it("returns field errors when currentPassword is empty", async () => {
    const res = await changePasswordAction(prevState, form({
      ...DEFAULT_FIELDS,
      currentPassword: "",
    }))

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.currentPassword).toBeDefined()
    expect(mockBcryptCompare).not.toHaveBeenCalled()
  })

  it("returns field errors when confirmPassword is empty", async () => {
    const res = await changePasswordAction(prevState, form({
      ...DEFAULT_FIELDS,
      confirmPassword: "",
    }))

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.confirmPassword).toBeDefined()
    expect(mockBcryptCompare).not.toHaveBeenCalled()
  })

  it("returns field errors when newPassword is too short", async () => {
    const res = await changePasswordAction(prevState, form({
      ...DEFAULT_FIELDS,
      newPassword: "short",
      confirmPassword: "short",
    }))

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.newPassword).toBeDefined()
    expect(mockBcryptHash).not.toHaveBeenCalled()
  })

  it("returns field errors when passwords don't match", async () => {
    const res = await changePasswordAction(prevState, form({
      ...DEFAULT_FIELDS,
      confirmPassword: "DifferentPass789",
    }))

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.confirmPassword).toBeDefined()
    expect(res.fieldErrors?.confirmPassword).toContainEqual(
      expect.stringMatching(/coinciden/i),
    )
  })

  it("returns error when new password is the same as current", async () => {
    const same = "SamePass12345"
    const res = await changePasswordAction(prevState, form({
      currentPassword: same,
      newPassword: same,
      confirmPassword: same,
    }))

    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.newPassword).toBeDefined()
    expect(res.fieldErrors?.newPassword).toContainEqual(
      expect.stringMatching(/diferente/i),
    )
  })

  it("records audit without userEmail when session.email is null", async () => {
    mockAuthFn.mockResolvedValueOnce(makeSession({ email: null }))

    await changePasswordAction(prevState, form(DEFAULT_FIELDS))

    expect(mockRecordAudit).toHaveBeenCalledTimes(1)
    const auditArg = mockRecordAudit.mock.calls[0][0]
    expect(auditArg.userEmail).toBeUndefined()
  })

  it("returns error if user not found in DB", async () => {
    mockFindFirst.mockResolvedValueOnce(null)

    const res = await changePasswordAction(prevState, form(DEFAULT_FIELDS))

    expect(res.ok).toBe(false)
    expect(res.message).toBe("Usuario no encontrado")
    expect(mockBcryptCompare).not.toHaveBeenCalled()
  })

  it("returns error if current password is incorrect", async () => {
    mockBcryptCompare.mockResolvedValueOnce(false)

    const res = await changePasswordAction(prevState, form(DEFAULT_FIELDS))

    expect(res.ok).toBe(false)
    expect(res.message).toBe("La contraseña actual es incorrecta")
    expect(mockBcryptHash).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("updates password, hashes it, records audit, and revalidates on success", async () => {
    const res = await changePasswordAction(prevState, form(DEFAULT_FIELDS))

    // Happy path
    expect(res.ok).toBe(true)
    expect(res.message).toMatch(/actualizada/i)

    // bcrypt.compare was called with the current password and stored hash
    expect(mockBcryptCompare).toHaveBeenCalledWith(
      "CurrentPass123",
      "old_hash_abc",
    )

    // New password was hashed with bcrypt (salt rounds 12)
    expect(mockBcryptHash).toHaveBeenCalledWith("NewSecurePass456", 12)

    // DB was updated with the new hash
    expect(mockUpdate).toHaveBeenCalled()
    const setFn = mockUpdate.mock.results[0].value.set
    const setArg = setFn.mock.calls[0][0]
    expect(setArg.hashedPassword).toBe("new_hash_xyz")

    // Audit was recorded
    expect(mockRecordAudit).toHaveBeenCalledTimes(1)
    const auditArg = mockRecordAudit.mock.calls[0]?.[0]
    expect(auditArg.userId).toBe("user-1")
    expect(auditArg.userEmail).toBe("user@test.cl")
    expect(auditArg.action).toBe("update")
    expect(auditArg.entityType).toBe("user")
    expect(auditArg.entityId).toBe("user-1")
    expect(auditArg.newState).toEqual({ field: "hashedPassword" })

    // Page was revalidated
    expect(mockRevalidatePath).toHaveBeenCalledWith("/perfil")
  })

  it("calls bcrypt.hash with 12 salt rounds", async () => {
    await changePasswordAction(prevState, form(DEFAULT_FIELDS))

    expect(mockBcryptHash).toHaveBeenCalledTimes(1)
    expect(mockBcryptHash).toHaveBeenCalledWith(
      DEFAULT_FIELDS.newPassword,
      12,
    )
  })
})
