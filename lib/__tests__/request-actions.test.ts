import { describe, it, expect, vi, beforeEach } from "vitest"
import { z } from "zod"
import { createRequestActions, type RequestActionsConfig } from "@/lib/requests/request-actions"
import type { Permission } from "@/modules/permissions"

// ── Mock cache & navigation ──────────────────────────────────────────────────
const mockRevalidatePath = vi.fn()
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
  revalidateTag: vi.fn(),
}))

// Emulate Next.js redirect behavior which throws a specific redirect error
const mockRedirect = vi.fn((path: string) => {
  const err = new Error("NEXT_REDIRECT")
  Object.defineProperty(err, "digest", { value: `NEXT_REDIRECT;307;${path};`, configurable: true })
  throw err
})
vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}))

// ── Mock Auth ──────────────────────────────────────────────────────────────────
const mockRequirePermission = vi.fn()
const mockCanAccessWorksite = vi.fn()
vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
  canAccessWorksite: (...args: unknown[]) => mockCanAccessWorksite(...args),
}))

// ── Mock DB ────────────────────────────────────────────────────────────────────
const mockFindFirst = vi.fn()
vi.mock("@/db", () => ({
  db: {
    query: {
      purchaseRequests: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
  },
}))

// ── Mock system settings ───────────────────────────────────────────────────────
const mockGetPdfMaxSizeMb = vi.fn()
vi.mock("@/lib/services/system-settings", () => ({
  getPdfMaxSizeMb: (...args: unknown[]) => mockGetPdfMaxSizeMb(...args),
}))

// ── Mock notifications ─────────────────────────────────────────────────────────
const mockGetUserIdsWithPermission = vi.fn()
const mockNotifyManyUser = vi.fn()
const mockNotifySafe = vi.fn()
vi.mock("@/lib/services/notifications", () => ({
  getUserIdsWithPermission: (...args: unknown[]) => mockGetUserIdsWithPermission(...args),
  notifyManyUser: (...args: unknown[]) => mockNotifyManyUser(...args),
  notifySafe: (...args: unknown[]) => mockNotifySafe(...args),
}))

// ── Mock file validation ───────────────────────────────────────────────────────
const mockValidateFileBuffer = vi.fn()
vi.mock("@/lib/file-validation", () => ({
  validateFileBuffer: (...args: unknown[]) => mockValidateFileBuffer(...args),
  MimeType: { QUOTATION: "quotation" },
}))

describe("createRequestActions factory", () => {
  const schemas = {
    request: z.object({
      id: z.string().optional(),
      worksiteId: z.string(),
      urgency: z.enum(["normal", "high", "critical"]),
      requiredDate: z.string(),
      justification: z.string(),
      items: z.array(z.any()),
    }),
    quotationUpload: z.object({
      requestId: z.string(),
      totalAmount: z.coerce.number(),
      supplierId: z.string().optional(),
      supplierNameFree: z.string().optional(),
      notes: z.string().optional(),
    }),
    selectQuotation: z.object({
      requestId: z.string(),
      quotationId: z.string(),
    }),
    cancel: z.object({
      requestId: z.string(),
      reason: z.string(),
    }),
  }

  const mockServices = {
    persistDraft: vi.fn(),
    submitRequest: vi.fn(),
    addQuotation: vi.fn(),
    deleteQuotation: vi.fn(),
    selectQuotation: vi.fn(),
    cancelRequest: vi.fn(),
  }

  const mockConfig: RequestActionsConfig = {
    moduleName: "repuestos",
    permissions: {
      create: "repuestos:crear" as Permission,
      submit: "repuestos:enviar" as Permission,
      approve: "repuestos:aprobar" as Permission,
    },
    routePrefix: "/compras/repuestos",
    schemas,
    services: mockServices,
    itemMapper: (x) => x,
    logPrefix: "repuestos",
  }

  const actions = createRequestActions(mockConfig)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("saveDraftAction", () => {
    it("returns error if requirePermission throws", async () => {
      mockRequirePermission.mockRejectedValue(new Error("Unauthorized"))
      const result = await actions.saveDraftAction({ ok: false, message: "" }, new FormData())
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Sin permisos")
    })

    it("returns fieldErrors if validation fails", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1" } })
      const fd = new FormData()
      fd.append("itemsJson", "[]")
      const result = await actions.saveDraftAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(false)
      expect(result.fieldErrors).toBeDefined()
    })

    it("returns error if user lacks worksite access", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1" } })
      mockCanAccessWorksite.mockReturnValue(false)
      const fd = new FormData()
      fd.append("worksiteId", "ws-1")
      fd.append("urgency", "normal")
      fd.append("requiredDate", "2026-06-20")
      fd.append("justification", "reason")
      fd.append("itemsJson", "[]")

      const result = await actions.saveDraftAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("No tienes acceso")
    })

    it("persists draft, revalidates and returns ID on success", async () => {
      const session = { user: { id: "u1" } }
      mockRequirePermission.mockResolvedValue(session)
      mockCanAccessWorksite.mockReturnValue(true)
      mockServices.persistDraft.mockResolvedValue("req-123")

      const fd = new FormData()
      fd.append("worksiteId", "ws-1")
      fd.append("urgency", "normal")
      fd.append("requiredDate", "2026-06-20")
      fd.append("justification", "reason")
      fd.append("itemsJson", "[]")

      const result = await actions.saveDraftAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(true)
      expect(result.requestId).toBe("req-123")
      expect(mockServices.persistDraft).toHaveBeenCalled()
      expect(mockRevalidatePath).toHaveBeenCalledWith("/compras/repuestos")
    })

    it("returns service error on exception", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1" } })
      mockCanAccessWorksite.mockReturnValue(true)
      mockServices.persistDraft.mockRejectedValue(new Error("Database error"))

      const fd = new FormData()
      fd.append("worksiteId", "ws-1")
      fd.append("urgency", "normal")
      fd.append("requiredDate", "2026-06-20")
      fd.append("justification", "reason")
      fd.append("itemsJson", "[]")

      const result = await actions.saveDraftAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toBe("Database error")
    })

    it("returns error on invalid itemsJson string", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1" } })
      const fd = new FormData()
      fd.append("itemsJson", "invalid-json")
      const result = await actions.saveDraftAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Revisa los datos")
    })
  })

  describe("submitRequestAction", () => {
    it("returns error if missing permissions", async () => {
      mockRequirePermission.mockRejectedValue(new Error("Unauthorized"))
      const result = await actions.submitRequestAction({ ok: false, message: "" }, new FormData())
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Sin permisos")
    })

    it("returns error if requestId is missing", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1" } })
      const result = await actions.submitRequestAction({ ok: false, message: "" }, new FormData())
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Solicitud no especificada")
    })

    it("returns error if request not found", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1" } })
      mockFindFirst.mockResolvedValue(null)
      const fd = new FormData()
      fd.append("requestId", "req-1")
      const result = await actions.submitRequestAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("no encontrada")
    })

    it("returns error if user lacks worksite access", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1" } })
      mockFindFirst.mockResolvedValue({ worksiteId: "ws-1" })
      mockCanAccessWorksite.mockReturnValue(false)
      const fd = new FormData()
      fd.append("requestId", "req-1")

      const result = await actions.submitRequestAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("No tienes acceso")
    })

    it("returns error if user is not the owner requester", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1" } })
      mockFindFirst.mockResolvedValue({ worksiteId: "ws-1", requesterId: "u2" })
      mockCanAccessWorksite.mockReturnValue(true)
      const fd = new FormData()
      fd.append("requestId", "req-1")

      const result = await actions.submitRequestAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Solo el solicitante")
    })

    it("submits request, sends notifications, and redirects on success", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1", email: "u1@test.com" } })
      mockFindFirst.mockResolvedValue({ worksiteId: "ws-1", requesterId: "u1" })
      mockCanAccessWorksite.mockReturnValue(true)
      mockGetUserIdsWithPermission.mockResolvedValue(["approver-1"])

      const fd = new FormData()
      fd.append("requestId", "req-1")

      await expect(actions.submitRequestAction({ ok: false, message: "" }, fd)).rejects.toThrow("NEXT_REDIRECT")
      expect(mockServices.submitRequest).toHaveBeenCalled()
      expect(mockRedirect).toHaveBeenCalledWith("/compras/repuestos/req-1")
    })

    it("returns service error on exception in submitRequest", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1", email: "u1@test.com" } })
      mockFindFirst.mockResolvedValue({ worksiteId: "ws-1", requesterId: "u1" })
      mockCanAccessWorksite.mockReturnValue(true)
      mockServices.submitRequest.mockRejectedValue(new Error("Database submit error"))

      const fd = new FormData()
      fd.append("requestId", "req-1")

      const result = await actions.submitRequestAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toBe("Database submit error")
    })
  })

  describe("uploadQuotationAction", () => {
    it("returns error if missing permissions", async () => {
      mockRequirePermission.mockRejectedValue(new Error("Unauthorized"))
      const result = await actions.uploadQuotationAction({ ok: false, message: "" }, new FormData())
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Sin permisos")
    })

    it("returns error if file is missing", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1" } })
      const result = await actions.uploadQuotationAction({ ok: false, message: "" }, new FormData())
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Selecciona un archivo")
    })

    it("returns error if file size exceeds system settings limit", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1" } })
      mockGetPdfMaxSizeMb.mockResolvedValue(5)
      const mockFile = new File([new Uint8Array(6 * 1024 * 1024)], "large.pdf")
      const fd = new FormData()
      fd.append("file", mockFile)

      const result = await actions.uploadQuotationAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("El archivo supera")
    })

    it("returns validation error if file buffer validation fails", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1" } })
      mockGetPdfMaxSizeMb.mockResolvedValue(5)
      mockValidateFileBuffer.mockReturnValue({ error: "Invalid signature" })

      const mockFile = new File([new Uint8Array(1024)], "quote.pdf")
      const fd = new FormData()
      fd.append("file", mockFile)

      const result = await actions.uploadQuotationAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toBe("Invalid signature")
    })

    it("saves quotation details successfully", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1", email: "u1@test.com" } })
      mockGetPdfMaxSizeMb.mockResolvedValue(5)
      mockValidateFileBuffer.mockReturnValue({ error: null, mimeType: "application/pdf" })
      mockFindFirst.mockResolvedValue({ worksiteId: "ws-1", requesterId: "u1" })
      mockCanAccessWorksite.mockReturnValue(true)

      const mockFile = new File([new Uint8Array(1024)], "quote.pdf")
      const fd = new FormData()
      fd.append("file", mockFile)
      fd.append("requestId", "req-1")
      fd.append("totalAmount", "5000")

      const result = await actions.uploadQuotationAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(true)
      expect(result.message).toBe("Cotización agregada")
      expect(mockServices.addQuotation).toHaveBeenCalled()
      expect(mockRevalidatePath).toHaveBeenCalledWith("/compras/repuestos/req-1")
    })

    it("returns service error on exception in addQuotation", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1", email: "u1@test.com" } })
      mockGetPdfMaxSizeMb.mockResolvedValue(5)
      mockValidateFileBuffer.mockReturnValue({ error: null, mimeType: "application/pdf" })
      mockFindFirst.mockResolvedValue({ worksiteId: "ws-1", requesterId: "u1" })
      mockCanAccessWorksite.mockReturnValue(true)
      mockServices.addQuotation.mockRejectedValue(new Error("Upload failed"))

      const mockFile = new File([new Uint8Array(1024)], "quote.pdf")
      const fd = new FormData()
      fd.append("file", mockFile)
      fd.append("requestId", "req-1")
      fd.append("totalAmount", "5000")

      const result = await actions.uploadQuotationAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toBe("Upload failed")
    })
  })

  describe("deleteQuotationAction", () => {
    it("calls deleteQuotation service and revalidates", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1", email: "u1@test.com" } })
      const fd = new FormData()
      fd.append("quotationId", "q-1")
      fd.append("requestId", "req-1")

      const result = await actions.deleteQuotationAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(true)
      expect(result.message).toBe("Cotización eliminada")
      expect(mockServices.deleteQuotation).toHaveBeenCalled()
      expect(mockRevalidatePath).toHaveBeenCalledWith("/compras/repuestos/req-1")
    })

    it("returns service error on exception in deleteQuotation", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1", email: "u1@test.com" } })
      mockServices.deleteQuotation.mockRejectedValue(new Error("Delete failed"))
      const fd = new FormData()
      fd.append("quotationId", "q-1")
      fd.append("requestId", "req-1")

      const result = await actions.deleteQuotationAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toBe("Delete failed")
    })
  })

  describe("selectQuotationAction", () => {
    it("calls selectQuotation service, sends notification and revalidates", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1", email: "u1@test.com", roles: ["jefa_chome"] } })
      mockFindFirst.mockResolvedValue({ worksiteId: "ws-1", requesterId: "u2", code: "REQ-001" })
      mockCanAccessWorksite.mockReturnValue(true)

      const fd = new FormData()
      fd.append("requestId", "req-1")
      fd.append("quotationId", "q-1")

      const result = await actions.selectQuotationAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(true)
      expect(result.message).toContain("Cotización aprobada")
      expect(mockServices.selectQuotation).toHaveBeenCalled()
      expect(mockNotifySafe).toHaveBeenCalled()
    })

    it("returns service error on exception in selectQuotation", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1", email: "u1@test.com", roles: ["jefa_chome"] } })
      mockFindFirst.mockResolvedValue({ worksiteId: "ws-1", requesterId: "u2", code: "REQ-001" })
      mockCanAccessWorksite.mockReturnValue(true)
      mockServices.selectQuotation.mockRejectedValue(new Error("Select failed"))

      const fd = new FormData()
      fd.append("requestId", "req-1")
      fd.append("quotationId", "q-1")

      const result = await actions.selectQuotationAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toBe("Select failed")
    })
  })

  describe("cancelRequestAction", () => {
    it("cancels request and redirects on success", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1", email: "u1@test.com" } })
      mockFindFirst.mockResolvedValue({ worksiteId: "ws-1", requesterId: "u1" })
      mockCanAccessWorksite.mockReturnValue(true)

      const fd = new FormData()
      fd.append("requestId", "req-1")
      fd.append("reason", "no longer needed")

      await expect(actions.cancelRequestAction({ ok: false, message: "" }, fd)).rejects.toThrow("NEXT_REDIRECT")
      expect(mockServices.cancelRequest).toHaveBeenCalled()
      expect(mockRedirect).toHaveBeenCalledWith("/compras/repuestos")
    })

    it("returns error if user is not the owner requester for cancelRequestAction", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1", email: "u1@test.com" } })
      mockFindFirst.mockResolvedValue({ worksiteId: "ws-1", requesterId: "u2" })

      const fd = new FormData()
      fd.append("requestId", "req-1")
      fd.append("reason", "no longer needed")

      const result = await actions.cancelRequestAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Solo el solicitante")
    })

    it("returns service error on exception in cancelRequestAction", async () => {
      mockRequirePermission.mockResolvedValue({ user: { id: "u1", email: "u1@test.com" } })
      mockFindFirst.mockResolvedValue({ worksiteId: "ws-1", requesterId: "u1" })
      mockCanAccessWorksite.mockReturnValue(true)
      mockServices.cancelRequest.mockRejectedValue(new Error("Cancel failed"))

      const fd = new FormData()
      fd.append("requestId", "req-1")
      fd.append("reason", "no longer needed")

      const result = await actions.cancelRequestAction({ ok: false, message: "" }, fd)
      expect(result.ok).toBe(false)
      expect(result.message).toBe("Cancel failed")
    })
  })
})
