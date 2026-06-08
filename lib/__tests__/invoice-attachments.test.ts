import { describe, it, expect, vi, beforeEach } from "vitest"
import { uploadInvoiceAttachment } from "@/lib/actions/invoice-attachments"

const mockGetPdfMaxSizeMb = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  canAccessWorksite: vi.fn(() => true),
  requirePermission: vi.fn(async () => ({
    user: { id: "usr-admin", email: "admin@chome.cl" },
  })),
}))

vi.mock("@/lib/auth/invoice-attachments", () => ({
  canViewInvoiceAttachments: vi.fn(() => true),
}))

vi.mock("@/lib/services/system-settings", () => ({
  getPdfMaxSizeMb: mockGetPdfMaxSizeMb,
}))

vi.mock("@/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        run: vi.fn(),
      })),
    })),
    query: {
      purchaseRequests: {
        findFirst: vi.fn(() => ({ id: "req-1", worksiteId: "ws-1" })),
      },
    },
  },
}))

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  unlink: vi.fn(async () => undefined),
}))

describe("uploadInvoiceAttachment dynamic limit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPdfMaxSizeMb.mockResolvedValue(10) // default 10MB
  })

  it("blocks PDF files exceeding the dynamic limit", async () => {
    mockGetPdfMaxSizeMb.mockResolvedValue(2) // 2MB dynamic limit

    const formData = new FormData()
    formData.append("targetType", "purchase_request")
    formData.append("targetId", "req-1")
    formData.append("invoiceNumber", "F-100")
    formData.append("invoiceDate", "2026-06-08")
    formData.append("amount", "1000")

    // Create a mock PDF file of 3 MB (3 * 1024 * 1024 bytes)
    const largeFile = new File([new Uint8Array(3 * 1024 * 1024)], "factura.pdf", {
      type: "application/pdf",
    })
    formData.append("file", largeFile)

    const res = await uploadInvoiceAttachment({ ok: false }, formData)
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.file?.[0]).toContain("no puede superar los 2 MB")
  })

  it("allows PDF files within the dynamic limit", async () => {
    mockGetPdfMaxSizeMb.mockResolvedValue(15) // 15MB limit

    const formData = new FormData()
    formData.append("targetType", "purchase_request")
    formData.append("targetId", "req-1")
    formData.append("invoiceNumber", "F-100")
    formData.append("invoiceDate", "2026-06-08")
    formData.append("amount", "1000")

    // Create a mock PDF file of 12 MB with PDF signature "%PDF-"
    const fileBytes = new Uint8Array(12 * 1024 * 1024)
    fileBytes.set([37, 80, 68, 70, 45]) // "%PDF-" magic bytes
    const pdfFile = new File([fileBytes], "factura.pdf", {
      type: "application/pdf",
    })
    formData.append("file", pdfFile)

    const res = await uploadInvoiceAttachment({ ok: false }, formData)
    expect(res.ok).toBe(true)
  })
})
