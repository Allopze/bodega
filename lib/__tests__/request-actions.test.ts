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
    approveWithoutQuotation: z.object({
      requestId: z.string().min(1),
      justification: z.string().trim().nullable().optional(),
    }),
  }

  const mockServices = {
    addQuotation: vi.fn(),
    deleteQuotation: vi.fn(),
    selectQuotation: vi.fn(),
    approveWithoutQuotation: vi.fn(),
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
  describe("approveWithoutQuotationAction", () => {
    const state = { ok: false, message: "" }
    const form = (fields: Record<string, string> = { requestId: "req-1" }) => {
      const fd = new FormData()
      for (const [key, value] of Object.entries(fields)) fd.append(key, value)
      return fd
    }
    const approver = { user: { id: "u1", email: "u1@test.com", roles: ["jefa_chome"] } }

    it("exige repuestos:approve", async () => {
      mockRequirePermission.mockRejectedValue(new Error("Unauthorized"))

      const result = await actions.approveWithoutQuotationAction(state, form())

      expect(mockRequirePermission).toHaveBeenCalledWith("repuestos:approve")
      expect(result.ok).toBe(false)
      expect(result.message).toContain("Sin permisos")
      expect(mockServices.approveWithoutQuotation).not.toHaveBeenCalled()
      expect(mockNotifySafe).not.toHaveBeenCalled()
    })

    it("llama al servicio con el alcance y la justificación, avisa al solicitante y revalida", async () => {
      mockRequirePermission.mockResolvedValue(approver)
      mockFindFirst.mockResolvedValue({ worksiteId: "ws-1", requesterId: "u2", code: "REQ-001" })
      mockCanAccessWorksite.mockReturnValue(true)

      const result = await actions.approveWithoutQuotationAction(state, form({ requestId: "req-1", justification: "  Bajo costo  " }))

      expect(result).toEqual({ ok: true, message: "Solicitud aprobada. Ítems listos para orden de compra." })
      expect(mockServices.approveWithoutQuotation).toHaveBeenCalledWith(expect.objectContaining({
        requestId: "req-1", userId: "u1", userEmail: "u1@test.com", roleContext: "jefa_chome", justification: "Bajo costo",
      }))
      expect(mockNotifySafe).toHaveBeenCalledWith(expect.objectContaining({
        userId: "u2", type: "request_approved", entityType: "purchase_request", entityId: "req-1",
        entityHref: "/compras/repuestos/req-1",
      }))
      // Las mismas vistas que seleccionar una cotización: la solicitud, sus
      // listados y las pantallas de Compras donde el ítem aprobado aparece.
      for (const path of ["/compras/repuestos/req-1", "/compras/repuestos", "/solicitudes", "/solicitudes/req-1", "/compras", "/compras/nueva", "/pendientes"]) {
        expect(mockRevalidatePath).toHaveBeenCalledWith(path)
      }
    })

    it("sin justificación la manda como null", async () => {
      mockRequirePermission.mockResolvedValue(approver)
      mockFindFirst.mockResolvedValue({ worksiteId: "ws-1", requesterId: "u2", code: "REQ-001" })
      mockCanAccessWorksite.mockReturnValue(true)

      await actions.approveWithoutQuotationAction(state, form())

      expect(mockServices.approveWithoutQuotation).toHaveBeenCalledWith(expect.objectContaining({ justification: null }))
    })

    it("rechaza datos incompletos sin tocar el servicio", async () => {
      mockRequirePermission.mockResolvedValue(approver)

      const result = await actions.approveWithoutQuotationAction(state, form({ requestId: "" }))

      expect(result).toEqual({ ok: false, message: "Datos incompletos" })
      expect(mockServices.approveWithoutQuotation).not.toHaveBeenCalled()
    })

    it("no aprueba una solicitud de una faena fuera de alcance", async () => {
      mockRequirePermission.mockResolvedValue(approver)
      mockFindFirst.mockResolvedValue({ worksiteId: "ws-9", requesterId: "u2", code: "REQ-001" })
      mockCanAccessWorksite.mockReturnValue(false)

      const result = await actions.approveWithoutQuotationAction(state, form())

      expect(result).toEqual({ ok: false, message: "No tienes acceso a esta solicitud" })
      expect(mockServices.approveWithoutQuotation).not.toHaveBeenCalled()
    })

    it("responde que la solicitud no existe", async () => {
      mockRequirePermission.mockResolvedValue(approver)
      mockFindFirst.mockResolvedValue(undefined)

      const result = await actions.approveWithoutQuotationAction(state, form())

      expect(result).toEqual({ ok: false, message: "Solicitud no encontrada" })
    })

    it("devuelve el error del servicio y no notifica", async () => {
      mockRequirePermission.mockResolvedValue(approver)
      mockFindFirst.mockResolvedValue({ worksiteId: "ws-1", requesterId: "u2", code: "REQ-001" })
      mockCanAccessWorksite.mockReturnValue(true)
      mockServices.approveWithoutQuotation.mockRejectedValue(new Error("Hay cotizaciones adjuntas: selecciona la ganadora"))

      const result = await actions.approveWithoutQuotationAction(state, form())

      expect(result.ok).toBe(false)
      expect(result.message).toBe("Hay cotizaciones adjuntas: selecciona la ganadora")
      expect(mockNotifySafe).not.toHaveBeenCalled()
    })

    it("un módulo sin aprobación sin cotización (servicios) responde que no está disponible", async () => {
      const { approveWithoutQuotation: _service, ...servicesWithout } = mockServices
      const { approveWithoutQuotation: _schema, ...schemasWithout } = schemas
      const serviciosActions = createRequestActions({
        ...mockConfig,
        permissions: { submit: "servicios:submit", approve: "servicios:approve" },
        schemas: schemasWithout,
        services: servicesWithout,
      })
      mockRequirePermission.mockResolvedValue(approver)

      const result = await serviciosActions.approveWithoutQuotationAction(state, form())

      expect(result).toEqual({ ok: false, message: "Este tipo de solicitud no admite aprobación sin cotización" })
      expect(mockServices.approveWithoutQuotation).not.toHaveBeenCalled()
    })
  })
})
