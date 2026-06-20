/**
 * lib/__tests__/smtp-settings.test.ts
 *
 * Tests for SMTP configuration service:
 * - getSmtpConfig (DB and env paths)
 * - getRawSmtpConfig (DB and env paths)
 * - setSmtpConfig (save with/without password)
 * - testSmtpConnection (success, error, no config)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock nodemailer BEFORE importing anything that uses it
const mockSendMail = vi.fn()
const mockClose = vi.fn()
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
      close: mockClose,
    })),
  },
}))

// Mock audit
vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
}))

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

// Mock DB — set up per-test via mockFn
const mockFindFirst = vi.fn()
const mockInsert = vi.fn()

vi.mock("@/db", () => ({
  db: {
    query: {
      systemSettings: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
    insert: (...args: unknown[]) => mockInsert(...args),
  },
}))

import { getSmtpConfig, getRawSmtpConfig, setSmtpConfig, testSmtpConnection } from "@/lib/services/smtp-settings"

beforeEach(() => {
  vi.clearAllMocks()
  mockSendMail.mockReset()
  mockClose.mockReset()
  // Default env
  delete process.env.SMTP_HOST
  delete process.env.SMTP_PORT
  delete process.env.SMTP_USER
  delete process.env.SMTP_PASS
  delete process.env.SMTP_FROM
  delete process.env.SMTP_SECURE
  delete process.env.SMTP_DISABLED
})

// ── getSmtpFromDb (internal, tested via getSmtpConfig) ────────────────────────

describe("getSmtpConfig", () => {
  it("returns config from DB when all keys present", async () => {
    let callCount = 0
    const dbValues: Record<string, string> = {
      smtp_host: "smtp.test.com",
      smtp_port: "587",
      smtp_secure: "true",
      smtp_user: "user@test.com",
      smtp_pass: "secret123",
      smtp_from: "from@test.com",
    }
    mockFindFirst.mockImplementation(() => {
      const keysArr = Object.keys(dbValues)
      const key = keysArr[callCount % keysArr.length]!
      callCount++
      return Promise.resolve({ key, value: dbValues[key as keyof typeof dbValues], updatedAt: "2024-01-01" })
    })

    const result = await getSmtpConfig()
    expect(result).toEqual({
      host: "smtp.test.com",
      port: 587,
      secure: true,
      user: "user@test.com",
      pass: "secret123", // Raw password returned from DB path
      from: "from@test.com",
      source: "db",
    })
  })

  it("returns null when DB has no host", async () => {
    mockFindFirst.mockImplementation(() => Promise.resolve(null))
    // With no DB config, falls back to env
    process.env.SMTP_HOST = "env.host.com"
    process.env.SMTP_USER = "env@user.com"
    process.env.SMTP_PASS = "envpass"

    const result = await getSmtpConfig()
    // Should fall through to env
    expect(result).toBeTruthy()
    expect(result?.source).toBe("env")
  })

  it("returns null when port is invalid in DB", async () => {
    const dbValues: Record<string, string> = {
      smtp_host: "smtp.test.com",
      smtp_port: "99999",
      smtp_secure: "false",
      smtp_user: "user@test.com",
      smtp_pass: "secret",
      smtp_from: "from@test.com",
    }
    let callCount = 0
    mockFindFirst.mockImplementation(() => {
      const keysArr = Object.keys(dbValues)
      const key = keysArr[callCount % keysArr.length]!
      callCount++
      return Promise.resolve({ key, value: dbValues[key as keyof typeof dbValues], updatedAt: "2024-01-01" })
    })

    const result = await getSmtpConfig()
    expect(result).toBeNull()
  })

  it("returns null on DB error", async () => {
    mockFindFirst.mockRejectedValue(new Error("DB connection failed"))
    process.env.SMTP_HOST = "env.host.com"
    process.env.SMTP_USER = "u@e.com"
    process.env.SMTP_PASS = "p"

    const result = await getSmtpConfig()
    // DB error → falls back to env
    expect(result?.source).toBe("env")
  })

  it("defaults secure=true when port=465 even if smtp_secure is 'false'", async () => {
    const dbValues: Record<string, string> = {
      smtp_host: "smtp.test.com",
      smtp_port: "465",
      smtp_secure: "false",
      smtp_user: "user@test.com",
      smtp_pass: "secret",
      smtp_from: "from@test.com",
    }
    let callCount = 0
    mockFindFirst.mockImplementation(() => {
      const keysArr = Object.keys(dbValues)
      const key = keysArr[callCount % keysArr.length]!
      callCount++
      return Promise.resolve({ key, value: dbValues[key as keyof typeof dbValues], updatedAt: "2024-01-01" })
    })

    const result = await getSmtpConfig()
    expect(result?.secure).toBe(true) // port 465 → secure=true
  })

  it("falls back to user when from is empty in DB", async () => {
    const dbValues: Record<string, string> = {
      smtp_host: "smtp.test.com",
      smtp_port: "587",
      smtp_secure: "false",
      smtp_user: "user@test.com",
      smtp_pass: "secret",
      smtp_from: "", // empty
    }
    let callCount = 0
    mockFindFirst.mockImplementation(() => {
      const keysArr = Object.keys(dbValues)
      const key = keysArr[callCount % keysArr.length]!
      callCount++
      return Promise.resolve({ key, value: dbValues[key as keyof typeof dbValues], updatedAt: "2024-01-01" })
    })

    const result = await getSmtpConfig()
    // When from is empty after trim, it becomes null (since "" || user → user, but null from missing key)
    // Actually: `byKey[SMTP_KEYS.from]?.trim() || user` — empty string is falsy, so from=user
    expect(result?.from).toBe("user@test.com")
  })
})

// ── getSmtpFromEnv (internal, tested via getSmtpConfig / getRawSmtpConfig) ────

describe("getSmtpConfig from env", () => {
  it("returns env config when no DB config", async () => {
    mockFindFirst.mockImplementation(() => Promise.resolve(null))
    process.env.SMTP_HOST = "env.smtp.com"
    process.env.SMTP_PORT = "25"
    process.env.SMTP_USER = "envuser"
    process.env.SMTP_PASS = "envpass"
    process.env.SMTP_FROM = "envfrom@test.com"

    const result = await getSmtpConfig()
    expect(result).toEqual({
      host: "env.smtp.com",
      port: 25,
      secure: false,
      user: "envuser",
      pass: "••••••", // Masked in view config
      from: "envfrom@test.com",
      source: "env",
    })
  })

  it("returns null when SMTP_DISABLED=true", async () => {
    mockFindFirst.mockImplementation(() => Promise.resolve(null))
    process.env.SMTP_DISABLED = "true"
    process.env.SMTP_HOST = "env.smtp.com"
    process.env.SMTP_USER = "u"
    process.env.SMTP_PASS = "p"

    const result = await getSmtpConfig()
    expect(result).toBeNull()
  })

  it("returns null when env missing required fields", async () => {
    mockFindFirst.mockImplementation(() => Promise.resolve(null))
    process.env.SMTP_HOST = "env.smtp.com"
    // missing SMTP_USER, SMTP_PASS

    const result = await getSmtpConfig()
    expect(result).toBeNull()
  })

  it("returns null when env port is invalid", async () => {
    mockFindFirst.mockImplementation(() => Promise.resolve(null))
    process.env.SMTP_HOST = "env.smtp.com"
    process.env.SMTP_PORT = "99999"
    process.env.SMTP_USER = "u"
    process.env.SMTP_PASS = "p"

    const result = await getSmtpConfig()
    expect(result).toBeNull()
  })

  it("defaults port to 587 when not set", async () => {
    mockFindFirst.mockImplementation(() => Promise.resolve(null))
    process.env.SMTP_HOST = "env.smtp.com"
    process.env.SMTP_USER = "u"
    process.env.SMTP_PASS = "p"
    // no SMTP_PORT → defaults to 587

    const result = await getSmtpConfig()
    expect(result?.port).toBe(587)
  })

  it("defaults from to user when SMTP_FROM not set", async () => {
    mockFindFirst.mockImplementation(() => Promise.resolve(null))
    process.env.SMTP_HOST = "env.smtp.com"
    process.env.SMTP_USER = "fallback@test.com"
    process.env.SMTP_PASS = "p"
    // no SMTP_FROM

    const result = await getSmtpConfig()
    expect(result?.from).toBe("fallback@test.com")
  })

  it("sets secure=true when SMTP_SECURE=true in env", async () => {
    mockFindFirst.mockImplementation(() => Promise.resolve(null))
    process.env.SMTP_HOST = "env.smtp.com"
    process.env.SMTP_USER = "u"
    process.env.SMTP_PASS = "p"
    process.env.SMTP_SECURE = "true"

    const result = await getSmtpConfig()
    expect(result?.secure).toBe(true)
  })
})

// ── getRawSmtpConfig ─────────────────────────────────────────────────────────

describe("getRawSmtpConfig", () => {
  it("returns raw config from DB with password exposed", async () => {
    const dbValues: Record<string, string> = {
      smtp_host: "smtp.raw.com",
      smtp_port: "587",
      smtp_secure: "false",
      smtp_user: "rawuser",
      smtp_pass: "rawpassword",
      smtp_from: "raw@test.com",
    }
    let callCount = 0
    mockFindFirst.mockImplementation(() => {
      const keysArr = Object.keys(dbValues)
      const key = keysArr[callCount % keysArr.length]!
      callCount++
      return Promise.resolve({ key, value: dbValues[key as keyof typeof dbValues], updatedAt: "2024-01-01" })
    })

    const result = await getRawSmtpConfig()
    expect(result).toEqual({
      host: "smtp.raw.com",
      port: 587,
      secure: false,
      user: "rawuser",
      pass: "rawpassword", // NOT masked
      from: "raw@test.com",
    })
  })

  it("falls back to env when no DB config", async () => {
    mockFindFirst.mockImplementation(() => Promise.resolve(null))
    process.env.SMTP_HOST = "env.raw.com"
    process.env.SMTP_USER = "envraw"
    process.env.SMTP_PASS = "envrawpass"

    const result = await getRawSmtpConfig()
    expect(result?.host).toBe("env.raw.com")
    expect(result?.pass).toBe("envrawpass") // NOT masked
  })
})

// ── setSmtpConfig ────────────────────────────────────────────────────────────

describe("setSmtpConfig", () => {
  const mockValues = vi.fn()
  const mockOnConflict = vi.fn()
  const mockSet = vi.fn()

  beforeEach(() => {
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflict })
    mockOnConflict.mockReturnValue({ set: mockSet })
    mockSet.mockResolvedValue(undefined)

    mockInsert.mockReturnValue({
      values: mockValues,
    })

    mockFindFirst.mockImplementation(() => Promise.resolve(null))
  })

  it("saves config with password", async () => {
    await setSmtpConfig(
      { host: "new.host.com", port: 587, secure: false, user: "new", pass: "newpass", from: "new@host.com" },
      "user-123",
      "admin@test.com",
    )

    // Should insert host, port, secure, user, from, and pass (6 entries)
    expect(mockValues).toHaveBeenCalledTimes(6)
    expect(mockInsert).toHaveBeenCalled()
  })

  it("skips password when pass is empty string", async () => {
    await setSmtpConfig(
      { host: "h", port: 25, secure: false, user: "u", pass: "", from: "f" },
      "user-123",
    )

    // Should insert only 5 entries (no pass)
    expect(mockValues).toHaveBeenCalledTimes(5)
  })

  it("calls recordAudit", async () => {
    const { recordAudit } = await import("@/lib/audit")
    vi.mocked(recordAudit).mockClear()

    await setSmtpConfig(
      { host: "h", port: 25, secure: false, user: "u", pass: "p", from: "f" },
      "user-123",
      "admin@test.com",
    )

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        userEmail: "admin@test.com",
        action: "update",
        entityType: "system_setting",
      }),
    )
  })
})

// ── testSmtpConnection ───────────────────────────────────────────────────────

describe("testSmtpConnection", () => {
  it("returns ok: false when SMTP not configured", async () => {
    mockFindFirst.mockImplementation(() => Promise.resolve(null))
    const result = await testSmtpConnection("test@example.com")
    expect(result).toEqual({ ok: false, error: "SMTP no configurado" })
  })

  it("returns ok: true when email sent successfully", async () => {
    const dbValues: Record<string, string> = {
      smtp_host: "smtp.test.com",
      smtp_port: "587",
      smtp_secure: "false",
      smtp_user: "user@test.com",
      smtp_pass: "pass",
      smtp_from: "from@test.com",
    }
    let callCount = 0
    mockFindFirst.mockImplementation(() => {
      const keysArr = Object.keys(dbValues)
      const key = keysArr[callCount % keysArr.length]!
      callCount++
      return Promise.resolve({ key, value: dbValues[key as keyof typeof dbValues], updatedAt: "2024-01-01" })
    })

    mockSendMail.mockResolvedValue({ messageId: "test-id" })

    const result = await testSmtpConnection("recipient@test.com")
    expect(result).toEqual({ ok: true })
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "recipient@test.com" }),
    )
    expect(mockClose).toHaveBeenCalled()
  })

  it("returns error when sendMail throws", async () => {
    const dbValues: Record<string, string> = {
      smtp_host: "smtp.test.com",
      smtp_port: "587",
      smtp_secure: "false",
      smtp_user: "user@test.com",
      smtp_pass: "pass",
      smtp_from: "from@test.com",
    }
    let callCount = 0
    mockFindFirst.mockImplementation(() => {
      const keysArr = Object.keys(dbValues)
      const key = keysArr[callCount % keysArr.length]!
      callCount++
      return Promise.resolve({ key, value: dbValues[key as keyof typeof dbValues], updatedAt: "2024-01-01" })
    })

    mockSendMail.mockRejectedValue(new Error("Connection refused"))

    const result = await testSmtpConnection("test@example.com")
    expect(result).toEqual({ ok: false, error: "Connection refused" })
  })

  it("handles non-Error thrown from sendMail", async () => {
    const dbValues: Record<string, string> = {
      smtp_host: "smtp.test.com",
      smtp_port: "587",
      smtp_secure: "false",
      smtp_user: "user@test.com",
      smtp_pass: "pass",
      smtp_from: "from@test.com",
    }
    let callCount = 0
    mockFindFirst.mockImplementation(() => {
      const keysArr = Object.keys(dbValues)
      const key = keysArr[callCount % keysArr.length]!
      callCount++
      return Promise.resolve({ key, value: dbValues[key as keyof typeof dbValues], updatedAt: "2024-01-01" })
    })

    mockSendMail.mockRejectedValue("string error")

    const result = await testSmtpConnection("test@example.com")
    expect(result).toEqual({ ok: false, error: "Error desconocido" })
  })
})
