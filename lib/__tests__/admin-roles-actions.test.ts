/**
 * Unit tests for role admin actions. The service layer (admin-roles) is mocked
 * so the action's validation, audit and permission-guard behavior is exercised
 * in isolation from the database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockSelectRole = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())
const mockAssertPermissionsExist = vi.hoisted(() => vi.fn())
const mockCreateRoleWithPermissions = vi.hoisted(() => vi.fn())
const mockUpdateRoleWithPermissions = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
}))
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: () => mockSelectRole() })),
      })),
    })),
  },
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: mockRecordAudit,
}))
vi.mock("@/lib/services/admin-roles", () => ({
  PROTECTED_ROLE_SLUGS: new Set(["administrador"]),
  assertPermissionsExist: mockAssertPermissionsExist,
  createRoleWithPermissions: mockCreateRoleWithPermissions,
  updateRoleWithPermissions: mockUpdateRoleWithPermissions,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { saveRoleAction } from "@/app/(app)/admin/roles/actions"
import type { ActionState } from "@/lib/validation/masters"

const prevState: ActionState = { ok: false, message: "" }

function makeSession() {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "admin@test.cl",
      name: "Admin",
      roles: ["administrador"],
      permissions: ["admin:roles"],
      worksiteIds: ["ws-1"],
      primaryWorksiteId: "ws-1",
      avatarColor: "#000",
      isActive: true,
    },
  }
}

function makeRoleFormData(fields: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("name", "jefe_bodega")
  fd.set("label", "Jefe de bodega")
  fd.set("isGlobal", "on")
  fd.set("permissionIds", "p-wh-stock,p-wh-mov")
  for (const [k, v] of Object.entries(fields)) {
    if (v === "") fd.delete(k)
    else fd.set(k, v)
  }
  return fd
}

describe("saveRoleAction", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAssertPermissionsExist.mockResolvedValue(undefined)
    mockCreateRoleWithPermissions.mockResolvedValue({
      id: "role-jefe-bodega",
      name: "jefe_bodega",
      label: "Jefe de bodega",
      description: null,
      isGlobal: false,
      permissionIds: ["p-wh-stock", "p-wh-mov"],
    })
    mockUpdateRoleWithPermissions.mockResolvedValue({
      id: "role-1",
      name: "jefe_bodega",
      label: "Jefe de bodega",
      description: null,
      isGlobal: true,
      permissionIds: ["p-wh-stock", "p-wh-mov"],
    })
  })

  it("requires admin:roles permission", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const res = await saveRoleAction(prevState, makeRoleFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("rejects a missing role name", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const res = await saveRoleAction(prevState, makeRoleFormData({ name: "" }))
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.name).toBeDefined()
  })

  it("creates a non-global role with its permissions and audits the create", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const res = await saveRoleAction(prevState, makeRoleFormData({ isGlobal: "" }))
    expect(res.ok).toBe(true)
    expect(mockAssertPermissionsExist).toHaveBeenCalledWith(["p-wh-stock", "p-wh-mov"])
    expect(mockCreateRoleWithPermissions).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "jefe_bodega",
        isGlobal: false,
        permissionIds: ["p-wh-stock", "p-wh-mov"],
      }),
      expect.objectContaining({ userId: "user-1" }),
    )
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create",
        entityType: "role",
        entityId: "role-jefe-bodega",
        entityCode: "jefe_bodega",
      }),
    )
  })

  it("updates an existing role, replacing permissions transactionally", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockSelectRole.mockResolvedValueOnce([{ id: "role-1", name: "old_slug", label: "Old", isGlobal: true }])

    const res = await saveRoleAction(prevState, makeRoleFormData({ id: "role-1" }))

    expect(res.ok).toBe(true)
    expect(mockUpdateRoleWithPermissions).toHaveBeenCalledWith(
      "role-1",
      expect.objectContaining({ permissionIds: ["p-wh-stock", "p-wh-mov"] }),
      expect.objectContaining({ userId: "user-1" }),
    )
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        entityType: "role",
        entityId: "role-1",
      }),
    )
  })

  it("surfaces service errors (e.g. protected administrador slug without permissions)", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockSelectRole.mockResolvedValueOnce([{ id: "rol-admin", name: "administrador", label: "Administrador", isGlobal: true }])
    mockUpdateRoleWithPermissions.mockRejectedValueOnce(new Error("El rol administrador debe conservar al menos un permiso"))

    const res = await saveRoleAction(prevState, makeRoleFormData({ id: "rol-admin", permissionIds: "" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("al menos un permiso")
  })

  it("surfaces invalid-permission errors from assertPermissionsExist", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockAssertPermissionsExist.mockRejectedValueOnce(new Error("Uno o más permisos seleccionados no existen"))
    const res = await saveRoleAction(prevState, makeRoleFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("permisos seleccionados")
  })
})
