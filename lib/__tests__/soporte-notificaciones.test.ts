/**
 * Unit tests for soporte (feedback) + notificaciones actions.
 *
 * Covers:
 *  1. Permission/auth denied
 *  2. Validation errors
 *  3. Happy paths
 *  4. Safe handling of unexpected service failures
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
const mockFs = vi.hoisted(() => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
}))

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
// El guard de módulos consulta system_settings en cada verificación de
// permiso; sin este mock, requirePermission golpea un @/db real inexistente
// en este test y falla cerrado con "No se pudo verificar el estado del módulo".
vi.mock("@/lib/services/module-toggles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/module-toggles")>()),
  assertPermissionModuleEnabled: vi.fn(async () => {}),
  assertRouteModuleEnabled: vi.fn(async () => {}),
}))
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
vi.mock("node:fs", () => ({ promises: mockFs }))
vi.mock("@/lib/storage/config", () => ({ resolveStorageDir: vi.fn(() => "/tmp/chome-test-storage") }))
vi.mock("@/lib/services/system-settings", () => ({
  getOperationalSettings: vi.fn(async () => ({ feedbackAttachmentMaxMb: 20 })),
}))
vi.mock("@/lib/file-validation", () => ({
  MimeType: { PROOF: "proof" },
  validateFileBuffer: vi.fn(() => ({ error: null, mimeType: "image/png" })),
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
    mockFs.mkdir.mockResolvedValue(undefined)
    mockFs.writeFile.mockResolvedValue(undefined)
    mockFs.rename.mockResolvedValue(undefined)
    mockFs.unlink.mockResolvedValue(undefined)
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

    it("does not reveal service errors", async () => {
      mockAuthFn.mockResolvedValue(makeSession("feedback:create"))
      mockCreateReport.mockRejectedValue(new Error("DB error"))
      const { createReportAction } = await import("@/app/(app)/soporte/actions")
      const r = await createReportAction({ tipo: "bug", titulo: "Test", descripcion: "Desc" })
      expect(r.ok).toBe(false)
      expect(r.message).toBe("No se pudo enviar el reporte. Intenta nuevamente.")
    })

    it("cleans the temporary upload when finalization fails", async () => {
      mockAuthFn.mockResolvedValue(makeSession("feedback:create"))
      mockFs.rename.mockRejectedValue(new Error("filesystem rename failure"))
      const { createReportAction } = await import("@/app/(app)/soporte/actions")
      const file = new File([new Uint8Array([1, 2, 3])], "captura.png", { type: "image/png" })

      const r = await createReportAction({
        tipo: "bug",
        titulo: "Fallo al finalizar",
        descripcion: "Debe limpiar el temporal",
        attachment: file,
      })

      expect(mockFs.rename).toHaveBeenCalled()
      expect(r.ok).toBe(false)
      expect(r.message).toBe("No se pudo enviar el reporte. Intenta nuevamente.")
      expect(mockFs.writeFile).toHaveBeenCalledWith(expect.stringContaining(".tmp"), expect.anything())
      expect(mockFs.unlink).toHaveBeenCalledWith(expect.stringContaining(".tmp"))
      expect(mockCreateReport).not.toHaveBeenCalled()
    })

    it("removes the finalized upload when report persistence fails", async () => {
      mockAuthFn.mockResolvedValue(makeSession("feedback:create"))
      mockCreateReport.mockRejectedValue(new Error("DB error"))
      const { createReportAction } = await import("@/app/(app)/soporte/actions")
      const file = new File([new Uint8Array([1, 2, 3])], "captura.png", { type: "image/png" })

      const r = await createReportAction({
        tipo: "bug",
        titulo: "Fallo al guardar reporte",
        descripcion: "Debe compensar el archivo final",
        attachment: file,
      })

      expect(mockFs.rename).toHaveBeenCalledBefore(mockCreateReport)
      expect(r.ok).toBe(false)
      expect(r.message).toBe("No se pudo enviar el reporte. Intenta nuevamente.")
      expect(mockFs.unlink).toHaveBeenCalledTimes(1)
      expect(String(mockFs.unlink.mock.calls[0]?.[0])).not.toMatch(/\.tmp$/)
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

    it("does not reveal service errors", async () => {
      mockAuthFn.mockResolvedValue(makeSession("feedback:manage"))
      mockUpdateReportStatus.mockRejectedValue(new Error("DB error"))
      const { updateReportStatusAction } = await import("@/app/(app)/soporte/actions")
      const fd = new FormData(); fd.set("id", "report-1"); fd.set("estado", "resuelto"); fd.set("notaInterna", "")

      const r = await updateReportStatusAction({ ok: false }, fd)

      expect(r.ok).toBe(false)
      expect(r.message).toBe("No se pudo actualizar el reporte. Intenta nuevamente.")
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
