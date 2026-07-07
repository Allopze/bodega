/**
 * Tests básicos para Server Actions de Flota
 *
 * Cubre los paths felices y validaciones básicas de:
 * - uploadFleetDocumentAction
 * - deleteFleetDocumentAction
 *
 * NOTA: Estos tests son de unidad/mock, no integración completa.
 * Para validar E2E real, usar specs de Playwright en e2e/flota-*.spec.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock de dependencias
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

vi.mock("@/lib/auth/can", () => ({
  requirePermission: vi.fn(async () => ({
    user: { id: "test-user-id", name: "Test User", email: "test@example.com" },
    roles: ["admin"],
    permissions: ["flota:view"],
    worksiteIds: ["ws-1"],
  })),
}))

vi.mock("@/lib/storage/config", () => ({
  resolveFleetDir: vi.fn(() => "/tmp/test-fleet"),
  createFleetDocumentPath: vi.fn((name: string) => `fleet/${name}`),
}))

vi.mock("node:fs", () => ({
  promises: {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
  },
}))

vi.mock("@/lib/file-validation", () => ({
  validateFileBuffer: vi.fn(() => ({ error: null, mimeType: "application/pdf" })),
  MimeType: { PROOF: "application/pdf" },
}))

vi.mock("@/lib/services/fleet", () => ({
  uploadFleetDocument: vi.fn(async () => "doc-123"),
  deleteFleetDocument: vi.fn(async () => undefined),
}))

import { uploadFleetDocumentAction, deleteFleetDocumentAction } from "@/app/(app)/flota/actions"
import type { ActionState } from "@/lib/validation/operations"

const prevState: ActionState = { ok: false, message: "" }

describe("Flota Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("uploadFleetDocumentAction", () => {
    it("debería rechazar sin vehicleId", async () => {
      const formData = new FormData()
      formData.append("documentType", "seguro")

      const result = await uploadFleetDocumentAction(prevState, formData)

      expect(result.ok).toBe(false)
      expect(result.message).toContain("Vehículo requerido")
    })

    it("debería rechazar sin documentType", async () => {
      const formData = new FormData()
      formData.append("vehicleId", "veh-1")

      const result = await uploadFleetDocumentAction(prevState, formData)

      expect(result.ok).toBe(false)
      expect(result.message).toContain("Tipo de documento requerido")
    })

    it("debería rechazar archivo vacío", async () => {
      const formData = new FormData()
      formData.append("vehicleId", "veh-1")
      formData.append("documentType", "seguro")
      formData.append("file", new File([], "empty.pdf"))

      const result = await uploadFleetDocumentAction(prevState, formData)

      expect(result.ok).toBe(false)
      expect(result.message).toContain("Archivo requerido")
    })

    it("debería rechazar archivo sobre 20MB", async () => {
      const formData = new FormData()
      formData.append("vehicleId", "veh-1")
      formData.append("documentType", "seguro")

      // Crear archivo de 21MB
      const largeBuffer = new Uint8Array(21 * 1024 * 1024)
      const largeFile = new File([largeBuffer], "large.pdf", { type: "application/pdf" })
      formData.append("file", largeFile)

      const result = await uploadFleetDocumentAction(prevState, formData)

      expect(result.ok).toBe(false)
      expect(result.message).toContain("supera el límite de 20 MB")
    })

    it("debería aceptar archivo válido bajo 20MB", async () => {
      const formData = new FormData()
      formData.append("vehicleId", "veh-1")
      formData.append("documentType", "seguro")

      // Crear archivo PDF pequeño válido
      const pdfBuffer = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // "%PDF"
      const smallFile = new File([pdfBuffer], "small.pdf", { type: "application/pdf" })
      formData.append("file", smallFile)

      const result = await uploadFleetDocumentAction(prevState, formData)

      expect(result.ok).toBe(true)
      expect(result.message).toContain("Documento subido")
      expect(result.data).toHaveProperty("id", "doc-123")
    })
  })

  describe("deleteFleetDocumentAction", () => {
    it("debería rechazar sin documentId", async () => {
      const formData = new FormData()

      const result = await deleteFleetDocumentAction(prevState, formData)

      expect(result.ok).toBe(false)
      expect(result.message).toContain("Documento requerido")
    })

    it("debería eliminar documento válido", async () => {
      const formData = new FormData()
      formData.append("documentId", "doc-123")
      formData.append("vehicleId", "veh-1")

      const result = await deleteFleetDocumentAction(prevState, formData)

      expect(result.ok).toBe(true)
      expect(result.message).toContain("Documento eliminado")
    })

    it("debería funcionar sin vehicleId (opcional)", async () => {
      const formData = new FormData()
      formData.append("documentId", "doc-123")

      const result = await deleteFleetDocumentAction(prevState, formData)

      expect(result.ok).toBe(true)
      expect(result.message).toContain("Documento eliminado")
    })
  })
})
