/**
 * Unit tests for soporte (feedback) + notificaciones actions.
 *
 * Covers:
 *  1. Permission/auth denied
 *  2. Validation errors
 *  3. Happy paths
 *  4. Service error propagation
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockCreateReport = vi.hoisted(() => vi.fn())
const mockUpdateReportStatus = vi.hoisted(() => vi.fn())
const mockMarkNotificationRead = vi.hoisted(() => vi.fn())
const mockMarkAllNotificationsRead = vi.hoisted(() => vi.fn())
const mockGetUserIdsWithPermission = vi.hoisted(() => vi.fn())
const mockNotifyManyUser = vi.hoisted(() => vi.fn())
const mockNotifyAfterCommit = vi.hoisted(() => vi.fn((fn: () => void) => fn()))

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/services/feedback", () => ({
  createReport: mockCreateReport,
  updateReportStatus: mockUpdateReportStatus,
}))
vi.mock("@/lib/services/notifications", () => ({
  markNotificationRead: mockMarkNotificationRead,
  markAllNotificationsRead: mockMarkAllNotificationsRead,
  getUserIdsWithPermission: mockGetUserIdsWithPermission,
  notifyManyUser: mockNotifyManyUser,
  notifyAfterCommit: mockNotifyAfterCommit,
}))

function makeSession(perm: string): Session {
  return {
    user: {
      id: "user-1", name: "Test User", email: "user@chome.cl",
      permissions: [perm], roles: ["operador"], worksiteIds: ["ws-1"], isGlobal: false,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as unknown as Session
}

// ── soporte ───────────────────────────────────────────────────────────────

describe("soporte actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateReport.mockResolvedValue({ id: "report-1" })
    mockUpdateReportStatus.mockResolvedValue({ id: "report-1", estado: "resuelto" })
    mockGetUserIdsWithPermission.mockResolvedValue(["admin-1"])
    mockNotifyManyUser.mockResolvedValue(undefined)
  })

  describe("createReportAction", () => {
    it("denies without feedback:create", async () => {
      mockAuthFn.mockResolvedValue(makeSession("other:perm"))
      const { createReportAction } = await import("@/app/(app)/soporte/actions")
      const r = await createReportAction({ tipo: "bug", titulo: "Test", descripcion: "Desc" })
      expect(r.ok).toBe(false)
    })

    it("rejects missing titulo", async () => {
      mockAuthFn.mockResolvedValue(makeSession("feedback:create"))
      const { createReportAction } = await import("@/app/(app)/soporte/actions")
      const r = await createReportAction({ tipo: "bug", titulo: "", descripcion: "Desc" })
      expect(r.ok).toBe(false); expect(r.fieldErrors).toBeDefined()
    })

    it("creates report on happy path", async () => {
      mockAuthFn.mockResolvedValue(makeSession("feedback:create"))
      const { createReportAction } = await import("@/app/(app)/soporte/actions")
      const r = await createReportAction({ tipo: "bug", titulo: "Error en formulario", descripcion: "No guarda" })
      expect(r.ok).toBe(true); expect(r.data?.id).toBe("report-1")
      expect(mockCreateReport).toHaveBeenCalled()
    })

    it("propagates service error", async () => {
      mockAuthFn.mockResolvedValue(makeSession("feedback:create"))
      mockCreateReport.mockRejectedValue(new Error("DB error"))
      const { createReportAction } = await import("@/app/(app)/soporte/actions")
      const r = await createReportAction({ tipo: "bug", titulo: "Test", descripcion: "Desc" })
      expect(r.ok).toBe(false); expect(r.message).toContain("DB error")
    })
  })

  describe("updateReportStatusAction", () => {
    it("denies without feedback:manage", async () => {
      mockAuthFn.mockResolvedValue(makeSession("feedback:create"))
      const { updateReportStatusAction } = await import("@/app/(app)/soporte/actions")
      const fd = new FormData(); fd.set("id", "report-1"); fd.set("estado", "resuelto")
      const r = await updateReportStatusAction({ ok: false }, fd)
      expect(r.ok).toBe(false)
    })

    it("rejects missing id", async () => {
      mockAuthFn.mockResolvedValue(makeSession("feedback:manage"))
      const { updateReportStatusAction } = await import("@/app/(app)/soporte/actions")
      const fd = new FormData(); fd.set("estado", "resuelto")
      const r = await updateReportStatusAction({ ok: false }, fd)
      expect(r.ok).toBe(false)
    })

    it("updates status on happy path", async () => {
      mockAuthFn.mockResolvedValue(makeSession("feedback:manage"))
      const { updateReportStatusAction } = await import("@/app/(app)/soporte/actions")
      const fd = new FormData(); fd.set("id", "report-1"); fd.set("estado", "resuelto"); fd.set("notaInterna", "")
      const r = await updateReportStatusAction({ ok: false }, fd)
      expect(r.ok).toBe(true)
    })
  })
})

// ── notificaciones ────────────────────────────────────────────────────────

describe("notificaciones actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarkNotificationRead.mockResolvedValue(undefined)
    mockMarkAllNotificationsRead.mockResolvedValue(undefined)
  })

  describe("markReadAction", () => {
    it("denies without auth", async () => {
      mockAuthFn.mockResolvedValue(null)
      const { markReadAction } = await import("@/app/(app)/notificaciones/actions")
      const r = await markReadAction("notif-1")
      expect(r.ok).toBe(false)
    })

    it("marks notification as read", async () => {
      mockAuthFn.mockResolvedValue(makeSession("requests:read"))
      const { markReadAction } = await import("@/app/(app)/notificaciones/actions")
      const r = await markReadAction("notif-1")
      expect(r.ok).toBe(true)
      expect(mockMarkNotificationRead).toHaveBeenCalledWith("notif-1", "user-1")
    })

    it("propagates service error", async () => {
      mockAuthFn.mockResolvedValue(makeSession("requests:read"))
      mockMarkNotificationRead.mockRejectedValue(new Error("Not found"))
      const { markReadAction } = await import("@/app/(app)/notificaciones/actions")
      const r = await markReadAction("notif-bad")
      expect(r.ok).toBe(false); expect(r.error).toContain("Not found")
    })
  })

  describe("markAllReadAction", () => {
    it("marks all as read", async () => {
      mockAuthFn.mockResolvedValue(makeSession("requests:read"))
      const { markAllReadAction } = await import("@/app/(app)/notificaciones/actions")
      const r = await markAllReadAction()
      expect(r.ok).toBe(true)
      expect(mockMarkAllNotificationsRead).toHaveBeenCalledWith("user-1")
    })
  })
})
