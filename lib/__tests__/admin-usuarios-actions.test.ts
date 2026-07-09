/**
 * Unit tests for admin/usuarios Server Actions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockCanManageUserInAdminScope = vi.hoisted(() => vi.fn(() => true))
const mockUserHasAdministratorRole = vi.hoisted(() => vi.fn(() => false))
const mockCanManageAdministratorRole = vi.hoisted(() => vi.fn(() => true))
const mockFindFirstUser = vi.hoisted(() => vi.fn())
const mockFindFirstInvitation = vi.hoisted(() => vi.fn())
const mockFindManyRoles = vi.hoisted(() => vi.fn<() => Array<{ id: string; name: string; label: string }>>(() => []))
const mockRecordAudit = vi.hoisted(() => vi.fn())
const mockUpdateReturning = vi.hoisted(() => vi.fn(() => Promise.resolve([{ id: "updated-row" }])))
const mockUpdateWhere = vi.hoisted(() => vi.fn(() => ({ returning: mockUpdateReturning })))
const mockUpdateSet = vi.hoisted(() => vi.fn(() => ({ where: mockUpdateWhere })))
const mockInsertValues = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => {
  const db = {
    query: {
      users: { findFirst: mockFindFirstUser },
      userInvitations: { findFirst: mockFindFirstInvitation },
      roles: { findMany: mockFindManyRoles },
    },
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(() => ({ set: mockUpdateSet })),
    delete: vi.fn(() => ({ where: vi.fn() })),
    transaction: vi.fn(async <T,>(fn: (tx: typeof db) => T): Promise<T> => fn(db)),
    execute: vi.fn(() => Promise.resolve()),
    select: vi.fn(() => ({ from: vi.fn(() => ({ innerJoin: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) })),
  }
  return { db }
})

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
  canAccessWorksite: vi.fn(() => true),
  can: vi.fn(() => true),
}))
vi.mock("@/lib/auth/admin-user-scope", () => ({
  canManageUserInAdminScope: mockCanManageUserInAdminScope,
}))
vi.mock("@/lib/auth/rbac", () => ({
  clearUserRbacCache: vi.fn(),
}))
vi.mock("@/lib/auth/bootstrap", () => ({
  generateInvitationToken: vi.fn(() => "test-token-xxx"),
  hashInvitationToken: vi.fn(() => "hashed-token-xxx"),
}))
vi.mock("@/lib/auth/password-setup", () => ({
  createPendingPasswordMarker: vi.fn(() => "pending-password:test"),
  isPasswordSetupPending: vi.fn((hashedPassword: string) => hashedPassword.startsWith("pending-password:")),
  displayNameFromEmail: vi.fn((e: string) => e.split("@")[0]),
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: mockRecordAudit,
  recordStatusChange: vi.fn(),
}))
vi.mock("@/lib/email/smtp", () => ({
  getAppBaseUrl: vi.fn(() => "http://localhost:3000"),
  sendInvitationEmail: vi.fn(() => Promise.resolve({ sent: true })),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/id", () => ({ nanoid: vi.fn(() => `uid-${Math.random().toString(36).slice(2, 8)}`) }))

vi.mock("@/app/(app)/admin/usuarios/actions.helpers", () => ({
  buildWorksiteAssignments: vi.fn(() => [{ worksiteId: "ws-1", isPrimary: true }]),
  validateWorksiteAssignmentScope: vi.fn(() => null),
  validateRoleWorksiteRules: vi.fn(() => null),
  validatePermissionRules: vi.fn(() => null),
  canManageAdministratorRole: mockCanManageAdministratorRole,
  uniqueIds: vi.fn((ids: string[]) => [...new Set(ids)]),
  userHasAdministratorRole: mockUserHasAdministratorRole,
  hashStr: vi.fn(() => 42),
}))

import {
  inviteUser,
  createUser,
  updateUser,
  toggleUserActive,
  deleteUser,
  cancelInvitation,
  resendInvitation,
} from "@/app/(app)/admin/usuarios/actions"
import type { ActionState } from "@/lib/validation/masters"

const prevState: ActionState = { ok: false, message: "" }

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1", email: "admin@test.cl", name: "Administrador",
      roles: ["administrador"], permissions: ["admin:users", "admin:manage_admins"],
      worksiteIds: ["ws-1", "ws-2"], primaryWorksiteId: "ws-1",
      avatarColor: "#000", isActive: true, ...overrides,
    },
  }
}

function makeFormData(fields: Record<string, unknown> = {}): FormData {
  const fd = new FormData()
  fd.set("name", "Test User")
  fd.set("email", "test@chome.cl")
  fd.set("roleIds", "role-admin")
  fd.set("worksiteId", "ws-1")
  fd.set("primaryWorksiteId", "ws-1")
  fd.set("expiresInDays", "7")
  fd.set("isActive", "on")
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined) fd.delete(k)
    else if (Array.isArray(v)) { fd.delete(k); v.forEach((val) => fd.append(k, String(val))) }
    else fd.set(k, String(v))
  }
  return fd
}

// ═══════════════════════════════════════════════════════════════════════════════
// inviteUser
// ═══════════════════════════════════════════════════════════════════════════════

describe("inviteUser", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
    mockFindFirstUser.mockResolvedValue(undefined)
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const res = await inviteUser(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if email already registered", async () => {
    mockFindFirstUser.mockResolvedValueOnce({ id: "existing", email: "test@chome.cl" })
    const res = await inviteUser(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.email).toContain("Este correo ya tiene una cuenta")
  })

  it("creates invitation successfully", async () => {
    const res = await inviteUser(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(res.message).toContain("Invitación enviada a test@chome.cl")
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      replacedAt: expect.any(String),
      replacedByInvitationId: expect.any(String),
    }))
  })

  it("handles SMTP not configured gracefully", async () => {
    const { sendInvitationEmail } = await import("@/lib/email/smtp")
    vi.mocked(sendInvitationEmail).mockResolvedValueOnce({ sent: false, reason: "SMTP not configured" })
    const res = await inviteUser(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(res.message).toContain("SMTP")
    expect(res.data).toBeDefined()
  })

  it("handles SMTP error gracefully", async () => {
    const { sendInvitationEmail } = await import("@/lib/email/smtp")
    vi.mocked(sendInvitationEmail).mockRejectedValueOnce(new Error("Connection refused"))
    const res = await inviteUser(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(res.message).toContain("no se pudo enviar")
    expect(res.data).toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// createUser
// ═══════════════════════════════════════════════════════════════════════════════

describe("createUser", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
    mockFindFirstUser.mockResolvedValue(undefined)
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const res = await createUser(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if email already registered", async () => {
    mockFindFirstUser.mockResolvedValueOnce({ id: "existing", email: "test@chome.cl" })
    const res = await createUser(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.email).toContain("Este correo ya está registrado")
  })

  it("creates user with invitation successfully", async () => {
    const res = await createUser(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(res.message).toContain("Usuario Test User creado")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// updateUser
// ═══════════════════════════════════════════════════════════════════════════════

describe("updateUser", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const res = await updateUser(prevState, makeFormData({ id: "u-1" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if user not found", async () => {
    mockFindFirstUser.mockResolvedValueOnce(undefined)
    const res = await updateUser(prevState, makeFormData({ id: "u-1" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Usuario no encontrado")
  })

  it("returns error if actor cannot manage the target user", async () => {
    mockFindFirstUser.mockResolvedValueOnce({ id: "u-1", email: "test@chome.cl", name: "Test", isActive: true, emailNotifications: false })
    mockCanManageUserInAdminScope.mockResolvedValueOnce(false)
    const res = await updateUser(prevState, makeFormData({ id: "u-1" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No tienes acceso")
  })

  it("returns error if non-admin tries to modify admin users", async () => {
    mockFindFirstUser.mockResolvedValueOnce({ id: "u-1", email: "test@chome.cl", name: "Test Admin", isActive: true, emailNotifications: false })
    mockCanManageUserInAdminScope.mockResolvedValueOnce(true)
    mockUserHasAdministratorRole.mockResolvedValueOnce(true)
    mockCanManageAdministratorRole.mockReturnValueOnce(false)
    const res = await updateUser(prevState, makeFormData({ id: "u-1" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Solo un administrador")
  })

  it("returns error if email conflicts with another user", async () => {
    mockFindFirstUser
      .mockResolvedValueOnce({ id: "u-1", email: "old@chome.cl", name: "Test", isActive: true, emailNotifications: false })
      .mockResolvedValueOnce({ id: "u-2", email: "new@chome.cl" })
    mockCanManageUserInAdminScope.mockResolvedValueOnce(true)
    const res = await updateUser(prevState, makeFormData({ id: "u-1", email: "new@chome.cl" }))
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.email?.[0]).toContain("Este correo ya está registrado")
  })

  it("updates user successfully", async () => {
    mockFindFirstUser
      .mockResolvedValueOnce({ id: "u-1", email: "old@chome.cl", name: "Test", isActive: true, emailNotifications: false })
      .mockResolvedValueOnce(undefined)
    mockCanManageUserInAdminScope.mockResolvedValueOnce(true)
    const res = await updateUser(prevState, makeFormData({ id: "u-1", email: "new@chome.cl" }))
    expect(res.ok).toBe(true)
    expect(res.message).toContain("actualizado")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// toggleUserActive
// ═══════════════════════════════════════════════════════════════════════════════

describe("toggleUserActive", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const fd = new FormData()
    fd.set("id", "u-1")
    fd.set("activate", "true")
    const res = await toggleUserActive(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if id is missing", async () => {
    const fd = new FormData()
    fd.set("activate", "true")
    const res = await toggleUserActive(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("ID requerido")
  })

  it("returns error if actor cannot manage target user scope", async () => {
    mockCanManageUserInAdminScope.mockResolvedValueOnce(false)
    const fd = new FormData()
    fd.set("id", "u-1")
    fd.set("activate", "true")
    const res = await toggleUserActive(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No tienes acceso")
  })

  it("returns error if non-admin tries to deactivate an admin", async () => {
    mockCanManageUserInAdminScope.mockResolvedValueOnce(true)
    mockUserHasAdministratorRole.mockResolvedValueOnce(true)
    mockCanManageAdministratorRole.mockReturnValueOnce(false)
    const fd = new FormData()
    fd.set("id", "u-1")
    fd.set("activate", "false")
    const res = await toggleUserActive(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Solo un administrador")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// deleteUser
// ═══════════════════════════════════════════════════════════════════════════════

describe("deleteUser", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
    mockFindFirstUser.mockResolvedValue({ id: "u-1", email: "target@chome.cl", name: "Target", isActive: false })
  })

  function deleteForm(id = "u-1") {
    const fd = new FormData()
    fd.set("id", id)
    return fd
  }

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const res = await deleteUser(prevState, deleteForm())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if actor cannot manage target user scope", async () => {
    mockCanManageUserInAdminScope.mockResolvedValueOnce(false)
    const res = await deleteUser(prevState, deleteForm())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No tienes acceso")
  })

  it("does not allow deleting the current session user", async () => {
    const res = await deleteUser(prevState, deleteForm("user-1"))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("No puedes eliminar tu propia cuenta")
  })

  it("deletes a manageable user and records audit", async () => {
    const res = await deleteUser(prevState, deleteForm())
    expect(res.ok).toBe(true)
    expect(res.message).toContain("Usuario eliminado")
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "delete",
        entityType: "user",
        entityId: "u-1",
        oldState: expect.objectContaining({ email: "target@chome.cl" }),
      }),
      expect.anything(),
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// invitations management
// ═══════════════════════════════════════════════════════════════════════════════

describe("cancelInvitation", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
    mockFindFirstInvitation.mockResolvedValue({
      id: "inv-1",
      email: "pending@chome.cl",
      name: "Pending User",
      acceptedAt: null,
      cancelledAt: null,
      replacedAt: null,
      roleIdsJson: "[]",
      worksiteAssignmentsJson: "[]",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
    })
  })

  function cancelForm(fields: Record<string, unknown> = {}) {
    const fd = new FormData()
    fd.set("id", "inv-1")
    fd.set("reason", "Correo equivocado")
    for (const [k, v] of Object.entries(fields)) {
      if (v === null || v === undefined) fd.delete(k)
      else fd.set(k, String(v))
    }
    return fd
  }

  it("denies without admin:users", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("no"))
    const res = await cancelInvitation(prevState, cancelForm())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("validates reason length", async () => {
    const short = await cancelInvitation(prevState, cancelForm({ reason: "x" }))
    expect(short.ok).toBe(false)
    expect(short.fieldErrors?.reason?.[0]).toContain("motivo")

    const res = await cancelInvitation(prevState, cancelForm({ reason: "x".repeat(501) }))
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.reason?.[0]).toContain("500")
  })

  it("returns stale failure and skips audit when guarded cancel updates no rows", async () => {
    mockUpdateReturning.mockResolvedValueOnce([])

    const res = await cancelInvitation(prevState, cancelForm())

    expect(res.ok).toBe(false)
    expect(res.message).toBe("La invitación ya no está pendiente")
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it("denies admin-role invitation cancellation when actor cannot manage admins", async () => {
    mockCanManageAdministratorRole.mockReturnValueOnce(false)
    mockFindFirstInvitation.mockResolvedValueOnce({
      id: "inv-admin",
      email: "admin-invitado@chome.cl",
      name: "Admin Invitado",
      roleIdsJson: JSON.stringify(["rol-admin"]),
      worksiteAssignmentsJson: "[]",
      acceptedAt: null,
      cancelledAt: null,
      replacedAt: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    })
    mockFindManyRoles.mockResolvedValueOnce([{ id: "rol-admin", name: "administrador", label: "Administrador" }])

    const res = await cancelInvitation(prevState, cancelForm({ id: "inv-admin", reason: "Acceso incorrecto" }))

    expect(res.ok).toBe(false)
    expect(res.message).toContain("Solo un administrador")
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })
})

describe("resendInvitation", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequirePermission.mockResolvedValue(makeSession())
    mockFindFirstInvitation.mockResolvedValue({
      id: "inv-1",
      email: "pending@chome.cl",
      name: "Pending User",
      roleIdsJson: "[\"role-admin\"]",
      worksiteAssignmentsJson: "[{\"worksiteId\":\"ws-1\",\"isPrimary\":true}]",
      invitedByUserId: "admin-old",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
      acceptedAt: null,
      cancelledAt: null,
      replacedAt: null,
      sendCount: 2,
    })
    mockFindFirstUser.mockResolvedValue({
      id: "u-pending",
      email: "pending@chome.cl",
      hashedPassword: "pending-password:test",
    })
  })

  it("returns data.inviteUrl containing /registro?token= when SMTP unavailable", async () => {
    const { sendInvitationEmail } = await import("@/lib/email/smtp")
    vi.mocked(sendInvitationEmail).mockResolvedValueOnce({ sent: false, reason: "SMTP not configured" })

    const fd = new FormData()
    fd.set("id", "inv-1")
    const res = await resendInvitation(prevState, fd)

    expect(res.ok).toBe(true)
    expect(res.data?.inviteUrl).toEqual(expect.stringContaining("/registro?token="))
  })

  it("returns stale failure and does not insert or audit when guarded resend updates no rows", async () => {
    mockUpdateReturning.mockResolvedValueOnce([])

    const fd = new FormData()
    fd.set("id", "inv-1")
    const res = await resendInvitation(prevState, fd)

    expect(res.ok).toBe(false)
    expect(res.message).toBe("La invitación ya no está pendiente")
    expect(mockInsertValues).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it("denies admin-role invitation resend when actor cannot manage admins", async () => {
    mockCanManageAdministratorRole.mockReturnValueOnce(false)
    mockFindFirstInvitation.mockResolvedValueOnce({
      id: "inv-admin",
      email: "admin-invitado@chome.cl",
      name: "Admin Invitado",
      roleIdsJson: JSON.stringify(["rol-admin"]),
      worksiteAssignmentsJson: "[]",
      acceptedAt: null,
      cancelledAt: null,
      replacedAt: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      sendCount: 0,
    })
    mockFindManyRoles.mockResolvedValueOnce([{ id: "rol-admin", name: "administrador", label: "Administrador" }])

    const fd = new FormData()
    fd.set("id", "inv-admin")
    const res = await resendInvitation(prevState, fd)

    expect(res.ok).toBe(false)
    expect(res.message).toContain("Solo un administrador")
    expect(mockInsertValues).not.toHaveBeenCalled()
  })
})
