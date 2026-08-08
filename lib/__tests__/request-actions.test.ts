import { describe, it, expect, vi, beforeEach } from "vitest"
import { z } from "zod"
import { createRequestActions, type RequestActionsConfig } from "@/lib/requests/request-actions"

// ── Mock cache & navigation ──────────────────────────────────────────────────
const mockRevalidatePath = vi.fn()
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
  revalidateTag: vi.fn(),
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
const mockNotifySafe = vi.fn()
vi.mock("@/lib/services/notifications", () => ({
  notifySafe: (...args: unknown[]) => mockNotifySafe(...args),
}))

// ── Mock file validation ───────────────────────────────────────────────────────
const mockValidateFileBuffer = vi.fn()
vi.mock("@/lib/file-validation", () => ({
  validateFileBuffer: (...args: unknown[]) => mockValidateFileBuffer(...args),
  MimeType: { QUOTATION: "quotation" },
}))

describe("createRequestActions factory", () => {
  // ARQ-1: el factory quedó acotado a las 3 acciones de cotización — guardar
  // borrador/enviar/cancelar viven en solicitudes/actions-module/, no aquí.
  const schemas = {
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
  }

  const mockServices = {
    addQuotation: vi.fn(),
    deleteQuotation: vi.fn(),
    selectQuotation: vi.fn(),
  }

  const mockConfig: RequestActionsConfig = {
    permissions: {
      submit: "repuestos:submit",
      approve: "repuestos:approve",
    },
    routePrefix: "/compras/repuestos",
    schemas,
    services: mockServices,
    logPrefix: "repuestos",
  }

  const actions = createRequestActions(mockConfig)

  beforeEach(() => {
    vi.clearAllMocks()
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
})
