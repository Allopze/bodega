/**
 * Unit tests for lib/auth/can.ts — RBAC permission helpers.
 * No database or network calls; uses mock Session objects.
 */

import { describe, it, expect, vi } from "vitest"
import type { Session } from "next-auth"

// Mock the auth module so next-auth is not loaded in the Node/Vitest environment.
vi.mock("@/lib/auth/auth", () => ({ auth: vi.fn() }))

import { can, canAny, canAll, hasRole, hasAnyRole, canAccessWorksite } from "@/lib/auth/can"

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function makeSession(overrides: Partial<Session["user"]> = {}): Session {
  return {
    expires: "9999-12-31",
    user: {
      id:                "u-test",
      name:              "Test User",
      email:             "test@chome.cl",
      roles:             [],
      permissions:       [],
      worksiteIds:       [],
      primaryWorksiteId: null,
      avatarColor:       null,
      isActive:          true,
      ...overrides,
    },
  }
}

/* ── can() ───────────────────────────────────────────────────────────────── */

describe("can()", () => {
  it("returns false for null session", () => {
    expect(can(null, "reports:view")).toBe(false)
  })

  it("returns false when permission is absent", () => {
    const session = makeSession({ permissions: ["requests:create"] })
    expect(can(session, "reports:view")).toBe(false)
  })

  it("returns true when permission is present", () => {
    const session = makeSession({ permissions: ["reports:view", "admin:users"] })
    expect(can(session, "reports:view")).toBe(true)
  })
})

/* ── canAny() ────────────────────────────────────────────────────────────── */

describe("canAny()", () => {
  it("returns false for null session", () => {
    expect(canAny(null, "reports:view", "admin:users")).toBe(false)
  })

  it("returns true when at least one permission matches", () => {
    const session = makeSession({ permissions: ["reports:view"] })
    expect(canAny(session, "admin:users", "reports:view")).toBe(true)
  })

  it("returns false when none of the permissions match", () => {
    const session = makeSession({ permissions: ["requests:create"] })
    expect(canAny(session, "admin:users", "reports:view")).toBe(false)
  })
})

/* ── canAll() ────────────────────────────────────────────────────────────── */

describe("canAll()", () => {
  it("returns false for null session", () => {
    expect(canAll(null, "reports:view", "admin:users")).toBe(false)
  })

  it("returns true when all permissions are present", () => {
    const session = makeSession({ permissions: ["reports:view", "admin:users"] })
    expect(canAll(session, "reports:view", "admin:users")).toBe(true)
  })

  it("returns false when only some permissions are present", () => {
    const session = makeSession({ permissions: ["reports:view"] })
    expect(canAll(session, "reports:view", "admin:users")).toBe(false)
  })
})

/* ── hasRole() ───────────────────────────────────────────────────────────── */

describe("hasRole()", () => {
  it("returns false for null session", () => {
    expect(hasRole(null, "administrador")).toBe(false)
  })

  it("returns true when role is present", () => {
    const session = makeSession({ roles: ["administrador"] })
    expect(hasRole(session, "administrador")).toBe(true)
  })

  it("returns false when role is absent", () => {
    const session = makeSession({ roles: ["solicitante_faena"] })
    expect(hasRole(session, "administrador")).toBe(false)
  })
})

/* ── hasAnyRole() ────────────────────────────────────────────────────────── */

describe("hasAnyRole()", () => {
  it("returns true when any of the roles matches", () => {
    const session = makeSession({ roles: ["secretaria"] })
    expect(hasAnyRole(session, "jefa_chome", "secretaria")).toBe(true)
  })

  it("returns false when none of the roles match", () => {
    const session = makeSession({ roles: ["solicitante_faena"] })
    expect(hasAnyRole(session, "jefa_chome", "secretaria")).toBe(false)
  })

  it("returns false for null session", () => {
    expect(hasAnyRole(null, "administrador")).toBe(false)
  })
})

/* ── canAccessWorksite() ─────────────────────────────────────────────────── */

describe("canAccessWorksite()", () => {
  it("returns false for null session", () => {
    expect(canAccessWorksite(null, "ws-123")).toBe(false)
  })

  it("administrador can access any worksite", () => {
    const session = makeSession({ roles: ["administrador"], worksiteIds: [] })
    expect(canAccessWorksite(session, "ws-any")).toBe(true)
  })

  it("jefa_chome can access any worksite", () => {
    const session = makeSession({ roles: ["jefa_chome"], worksiteIds: [] })
    expect(canAccessWorksite(session, "ws-any")).toBe(true)
  })

  it("secretaria can access any worksite", () => {
    const session = makeSession({ roles: ["secretaria"], worksiteIds: [] })
    expect(canAccessWorksite(session, "ws-any")).toBe(true)
  })

  it("prevencionista can access any worksite", () => {
    const session = makeSession({ roles: ["prevencionista"], worksiteIds: [] })
    expect(canAccessWorksite(session, "ws-any")).toBe(true)
  })

  it("solicitante_faena can access only assigned worksites", () => {
    const session = makeSession({
      roles:       ["solicitante_faena"],
      worksiteIds: ["ws-assigned"],
    })
    expect(canAccessWorksite(session, "ws-assigned")).toBe(true)
    expect(canAccessWorksite(session, "ws-other")).toBe(false)
  })

  it("user with no roles can access only explicitly assigned worksites", () => {
    const session = makeSession({ roles: [], worksiteIds: ["ws-abc"] })
    expect(canAccessWorksite(session, "ws-abc")).toBe(true)
    expect(canAccessWorksite(session, "ws-xyz")).toBe(false)
  })
})
