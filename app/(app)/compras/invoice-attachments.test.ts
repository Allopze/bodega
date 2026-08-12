import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGetPdfMaxSizeMb = vi.fn()

vi.mock("@/lib/services/system-settings", () => ({
  getPdfMaxSizeMb: (...args: unknown[]) => mockGetPdfMaxSizeMb(...args),
}))

const { persistInvoiceFile } = await import("./invoice-attachments")

describe("persistInvoiceFile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPdfMaxSizeMb.mockResolvedValue(1)
  })

  it("rejects an oversized manual upload before copying it into a server buffer", async () => {
    const file = new File([new Uint8Array(1024 * 1024 + 1)], "factura-grande.pdf", {
      type: "application/pdf",
    })
    const readFile = vi.spyOn(file, "arrayBuffer")

    const result = await persistInvoiceFile(file)

    expect(result).toEqual({ ok: false, message: "El archivo supera el límite de 1 MB" })
    expect(readFile).not.toHaveBeenCalled()
  })
})
