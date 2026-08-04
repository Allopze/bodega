/**
 * Unit tests for admin/configuracion + admin/correo-smtp + admin/plantillas actions.
 *
 * Covers:
 *  1. Permission denied
 *  2. Validation errors
 *  3. Happy paths
 *  4. Service error propagation
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockSetCompanyProfile = vi.hoisted(() => vi.fn())
const mockSetPdfMaxSizeMb = vi.hoisted(() => vi.fn())
const mockSetEmailsEnabled = vi.hoisted(() => vi.fn())
const mockTestResendConnection = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())
const mockUpdateTemplate = vi.hoisted(() => vi.fn())
const mockResetTemplate = vi.hoisted(() => vi.fn())
const mockSeedDefaultTemplates = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/services/system-settings", () => ({
  setCompanyProfile: mockSetCompanyProfile,
  setPdfMaxSizeMb: mockSetPdfMaxSizeMb,
  setEmailsEnabled: mockSetEmailsEnabled,
}))
vi.mock("@/lib/services/smtp-settings", () => ({
  testResendConnection: mockTestResendConnection,
}))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))
vi.mock("@/lib/services/email-templates", () => ({
  updateTemplate: mockUpdateTemplate,
  resetTemplate: mockResetTemplate,
  seedDefaultTemplates: mockSeedDefaultTemplates,
}))

function makeSession(perm: string): Session {
  return {
    user: {
      id: "user-1", name: "Admin", email: "admin@chome.cl",
      permissions: [perm], roles: ["administrador"], worksiteIds: [], isGlobal: true,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as unknown as Session
}

// ── admin/configuracion ───────────────────────────────────────────────────

describe("updateSystemSettings", () => {
  beforeEach(() => { vi.clearAllMocks(); mockSetCompanyProfile.mockResolvedValue(undefined); mockSetPdfMaxSizeMb.mockResolvedValue(undefined) })

  it("denies without admin:config", async () => {
    mockAuthFn.mockResolvedValue(makeSession("other:perm"))
    const { updateSystemSettings } = await import("@/app/(app)/admin/configuracion/actions")
    const fd = new FormData(); fd.set("pdfMaxSizeMb", "50"); fd.set("companyName", "Chome")
    const r = await updateSystemSettings({ ok: false }, fd)
    expect(r.ok).toBe(false); expect(r.message).toContain("Sin permisos")
  })

  it("rejects missing company name", async () => {
    mockAuthFn.mockResolvedValue(makeSession("admin:config"))
    const { updateSystemSettings } = await import("@/app/(app)/admin/configuracion/actions")
    const fd = new FormData(); fd.set("pdfMaxSizeMb", "50"); fd.set("companyName", "")
    const r = await updateSystemSettings({ ok: false }, fd)
    expect(r.ok).toBe(false); expect(r.fieldErrors).toBeDefined()
  })

  it("rejects invalid pdfMaxSizeMb", async () => {
    mockAuthFn.mockResolvedValue(makeSession("admin:config"))
    const { updateSystemSettings } = await import("@/app/(app)/admin/configuracion/actions")
    const fd = new FormData(); fd.set("pdfMaxSizeMb", "-5"); fd.set("companyName", "Chome")
    const r = await updateSystemSettings({ ok: false }, fd)
    expect(r.ok).toBe(false)
  })

  it("updates settings on happy path", async () => {
    mockAuthFn.mockResolvedValue(makeSession("admin:config"))
    const { updateSystemSettings } = await import("@/app/(app)/admin/configuracion/actions")
    const fd = new FormData(); fd.set("pdfMaxSizeMb", "50"); fd.set("companyName", "Chome SpA")
    const r = await updateSystemSettings({ ok: false }, fd)
    expect(r.ok).toBe(true); expect(r.message).toContain("actualizada")
    expect(mockSetPdfMaxSizeMb).toHaveBeenCalledWith(50, "user-1", "admin@chome.cl")
  })
})

// ── admin/correo-smtp ─────────────────────────────────────────────────────

describe("correo-smtp actions", () => {
  beforeEach(() => { vi.clearAllMocks(); mockSetEmailsEnabled.mockResolvedValue(undefined); mockTestResendConnection.mockResolvedValue({ ok: true }); mockRecordAudit.mockResolvedValue(undefined) })

  describe("setEmailsEnabledAction", () => {
    it("denies without admin:smtp", async () => {
      mockAuthFn.mockResolvedValue(makeSession("other:perm"))
      const { setEmailsEnabledAction } = await import("@/app/(app)/admin/correo-smtp/actions")
      const fd = new FormData(); fd.set("emailsEnabled", "on")
      const r = await setEmailsEnabledAction({ ok: false }, fd)
      expect(r.ok).toBe(false)
    })

    it("enables emails", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:smtp"))
      mockSetEmailsEnabled.mockResolvedValue(undefined)
      const { setEmailsEnabledAction } = await import("@/app/(app)/admin/correo-smtp/actions")
      const fd = new FormData(); fd.set("emailsEnabled", "on")
      const r = await setEmailsEnabledAction({ ok: false }, fd)
      if (!r.ok) expect(r).toEqual({ ok: true })
      expect(r.ok).toBe(true)
    })

    it("disables emails", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:smtp"))
      mockSetEmailsEnabled.mockResolvedValue(undefined)
      const { setEmailsEnabledAction } = await import("@/app/(app)/admin/correo-smtp/actions")
      const fd = new FormData()
      const r = await setEmailsEnabledAction({ ok: false }, fd)
      if (!r.ok) expect(r).toEqual({ ok: true })
      expect(r.ok).toBe(true)
    })
  })

  describe("testResendAction", () => {
    it("denies without admin:smtp", async () => {
      mockAuthFn.mockResolvedValue(makeSession("other:perm"))
      const { testResendAction } = await import("@/app/(app)/admin/correo-smtp/actions")
      const r = await testResendAction(null, new FormData())
      expect(r.ok).toBe(false)
    })

    it("sends test email", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:smtp"))
      const { testResendAction } = await import("@/app/(app)/admin/correo-smtp/actions")
      const r = await testResendAction(null, new FormData())
      expect(r.ok).toBe(true); expect(r.message).toContain("enviado")
      expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
        entityType: "smtp_delivery_test",
        entityId: "resend",
        newState: expect.objectContaining({ recipient: "admin@chome.cl", result: "sent" }),
      }))
    })

    it("propagates service error", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:smtp"))
      mockTestResendConnection.mockResolvedValue({ ok: false, error: "API key inválida" })
      const { testResendAction } = await import("@/app/(app)/admin/correo-smtp/actions")
      const r = await testResendAction(null, new FormData())
      expect(r.ok).toBe(false); expect(r.message).toContain("API key")
    })

    it("audits a provider exception as a failed delivery test", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:smtp"))
      mockTestResendConnection.mockRejectedValue(new Error("Proveedor no disponible"))
      const { testResendAction } = await import("@/app/(app)/admin/correo-smtp/actions")
      const r = await testResendAction(null, new FormData())
      expect(r.ok).toBe(false)
      expect(r.message).toContain("Proveedor no disponible")
      expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
        newState: expect.objectContaining({ result: "failed", error: "Proveedor no disponible" }),
      }))
    })
  })
})

// ── admin/plantillas ──────────────────────────────────────────────────────

describe("plantillas actions", () => {
  beforeEach(() => { vi.clearAllMocks(); mockUpdateTemplate.mockResolvedValue(undefined); mockResetTemplate.mockResolvedValue(undefined); mockSeedDefaultTemplates.mockResolvedValue(undefined) })

  describe("updateTemplateAction", () => {
    it("denies without admin:email_templates", async () => {
      mockAuthFn.mockResolvedValue(makeSession("other:perm"))
      const { updateTemplateAction } = await import("@/app/(app)/admin/plantillas/actions")
      const fd = new FormData(); fd.set("key", "welcome"); fd.set("subject", "Hola"); fd.set("bodyHtml", "<p>Hola</p>")
      const r = await updateTemplateAction({ ok: false }, fd)
      expect(r.ok).toBe(false)
    })

    it("rejects missing key", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:email_templates"))
      const { updateTemplateAction } = await import("@/app/(app)/admin/plantillas/actions")
      const fd = new FormData(); fd.set("subject", "Hola"); fd.set("bodyHtml", "<p>Hola</p>")
      const r = await updateTemplateAction({ ok: false }, fd)
      expect(r.ok).toBe(false); expect(r.message).toContain("clave")
    })

    it("rejects missing subject", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:email_templates"))
      const { updateTemplateAction } = await import("@/app/(app)/admin/plantillas/actions")
      const fd = new FormData(); fd.set("key", "welcome"); fd.set("bodyHtml", "<p>Hola</p>")
      const r = await updateTemplateAction({ ok: false }, fd)
      expect(r.ok).toBe(false); expect(r.fieldErrors).toBeDefined()
    })

    it("updates template on happy path", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:email_templates"))
      const { updateTemplateAction } = await import("@/app/(app)/admin/plantillas/actions")
      const fd = new FormData(); fd.set("key", "welcome"); fd.set("subject", "Bienvenido"); fd.set("bodyHtml", "<p>Hola</p>")
      const r = await updateTemplateAction({ ok: false }, fd)
      expect(r.ok).toBe(true); expect(r.message).toContain("actualizada")
      expect(mockUpdateTemplate).toHaveBeenCalledWith("welcome", { subject: "Bienvenido", bodyHtml: "<p>Hola</p>" }, "user-1", "admin@chome.cl")
    })
  })

  describe("resetTemplateAction", () => {
    it("resets template", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:email_templates"))
      const { resetTemplateAction } = await import("@/app/(app)/admin/plantillas/actions")
      const fd = new FormData(); fd.set("key", "welcome")
      const r = await resetTemplateAction({ ok: false }, fd)
      expect(r.ok).toBe(true); expect(r.message).toContain("restaurada")
    })
  })

  describe("seedTemplatesAction", () => {
    it("seeds default templates", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:email_templates"))
      const { seedTemplatesAction } = await import("@/app/(app)/admin/plantillas/actions")
      const r = await seedTemplatesAction()
      expect(r.ok).toBe(true); expect(r.message).toContain("creadas")
    })

    it("propagates service error", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:email_templates"))
      mockSeedDefaultTemplates.mockRejectedValue(new Error("DB error"))
      const { seedTemplatesAction } = await import("@/app/(app)/admin/plantillas/actions")
      const r = await seedTemplatesAction()
      expect(r.ok).toBe(false); expect(r.message).toContain("sembrar")
    })
  })
})
