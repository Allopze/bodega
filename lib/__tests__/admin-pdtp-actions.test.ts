/**
 * Unit tests for PDTP catalog admin actions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())
const mockUpsertResponsible = vi.hoisted(() => vi.fn())
const mockUpsertSheet = vi.hoisted(() => vi.fn())
const mockParseDefaultScopeRoles = vi.hoisted(() => vi.fn((_raw: unknown, registry: string[]) => registry.slice(0, 1)))

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: mockRecordAudit,
}))
vi.mock("@/lib/services/pdtp/admin-catalogs", () => ({
  upsertPdtpResponsible: mockUpsertResponsible,
  upsertPdtpSheet: mockUpsertSheet,
  parseDefaultScopeRoles: mockParseDefaultScopeRoles,
  listRoleSlugs: vi.fn(() => ["administrador", "prevencionista", "supervisor_faena"]),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import {
  savePdtpResponsibleAction,
  savePdtpSheetAction,
} from "@/app/(app)/admin/pdtp-catalogos/actions"
import type { ActionState } from "@/lib/validation/masters"

const prevState: ActionState = { ok: false, message: "" }

function makeSession() {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "admin@test.cl",
      name: "Admin",
      roles: ["prevencionista"],
      permissions: ["admin:pdtp_catalog"],
      worksiteIds: [],
      primaryWorksiteId: "",
      avatarColor: "#000",
      isActive: true,
    },
  }
}

describe("savePdtpResponsibleAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("requires admin:pdtp_catalog", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const fd = new FormData(); fd.set("slug", "x"); fd.set("displayName", "X"); fd.set("kind", "role")
    const res = await savePdtpResponsibleAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("rejects missing display name", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const fd = new FormData(); fd.set("slug", "x"); fd.set("kind", "role")
    const res = await savePdtpResponsibleAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("nombre visible")
  })

  it("upserts and audits as pdtp_responsible", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockUpsertResponsible.mockResolvedValueOnce({
      slug: "x", displayName: "X", kind: "role", roleName: null, notes: null,
    })
    const fd = new FormData()
    fd.set("slug", "x")
    fd.set("displayName", "X")
    fd.set("kind", "role")
    const res = await savePdtpResponsibleAction(prevState, fd)
    expect(res.ok).toBe(true)
    expect(mockUpsertResponsible).toHaveBeenCalledWith(expect.objectContaining({
      displayName: "X", kind: "role",
    }))
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "pdtp_responsible",
      entityId: "x",
    }))
  })
})

describe("savePdtpSheetAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("requires admin:pdtp_catalog", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const fd = new FormData()
    fd.set("code", "C"); fd.set("label", "L"); fd.set("area", "A")
    const res = await savePdtpSheetAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("rejects missing code", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const fd = new FormData(); fd.set("label", "L"); fd.set("area", "A")
    const res = await savePdtpSheetAction(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("código")
  })

  it("calls parseDefaultScopeRoles and audits properly", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockUpsertSheet.mockResolvedValueOnce({
      id: "sht-1", code: "HOJA-1", label: "Hoja 1", area: "Operacional", defaultScopeRoles: ["administrador"],
    })
    const fd = new FormData()
    fd.set("code", "HOJA-1")
    fd.set("label", "Hoja 1")
    fd.set("area", "Operacional")
    fd.set("defaultScopeRoles", "administrador,prevencionista")

    const res = await savePdtpSheetAction(prevState, fd)

    expect(res.ok).toBe(true)
    expect(mockParseDefaultScopeRoles).toHaveBeenCalledTimes(1)
    expect(mockUpsertSheet).toHaveBeenCalledWith(expect.objectContaining({
      code: "HOJA-1",
      defaultScopeRoles: expect.any(Array),
    }))
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "pdtp_sheet",
      entityId: "sht-1",
    }))
  })
})
