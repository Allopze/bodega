/**
 * Comprehensive tests for lib/storage/config.ts
 *
 * Covers all public functions: path resolution, creation, and validation
 * for deliveries, purchase-orders/invoices, repuestos, and servicios.
 */
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createDeliveryAttachmentPath,
  createInvoiceAttachmentPath,
  createQuotationAttachmentPath,
  createServiceQuotationPath,
  resolveDeliveriesDir,
  resolveDeliveryAttachmentFile,
  resolveInvoiceAttachmentFile,
  resolvePurchaseOrdersDir,
  resolveQuotationAttachmentFile,
  resolveRepuestosDir,
  resolveServiceQuotationFile,
  resolveServiciosDir,
  resolveStorageDir,
} from "@/lib/storage/config"

// ── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_STORAGE = path.join(process.cwd(), "storage")

function withStoragePath(tempPath: string, fn: () => void) {
  const prev = process.env.STORAGE_PATH
  process.env.STORAGE_PATH = tempPath
  try {
    fn()
  } finally {
    if (prev === undefined) delete process.env.STORAGE_PATH
    else process.env.STORAGE_PATH = prev
  }
}

// ── resolveStorageDir ──────────────────────────────────────────────────────

describe("resolveStorageDir", () => {
  afterEach(() => { delete process.env.STORAGE_PATH })

  it("defaults to cwd/storage when STORAGE_PATH is unset", () => {
    delete process.env.STORAGE_PATH
    expect(resolveStorageDir()).toBe(DEFAULT_STORAGE)
  })

  it("defaults to cwd/storage when STORAGE_PATH is empty", () => {
    process.env.STORAGE_PATH = ""
    expect(resolveStorageDir()).toBe(DEFAULT_STORAGE)
  })

  it("defaults to cwd/storage when STORAGE_PATH is whitespace", () => {
    process.env.STORAGE_PATH = "   "
    expect(resolveStorageDir()).toBe(DEFAULT_STORAGE)
  })

  it("resolves custom STORAGE_PATH", () => {
    withStoragePath("/custom/path", () => {
      expect(resolveStorageDir()).toBe(path.resolve("/custom/path"))
    })
  })

  it("resolves relative STORAGE_PATH to absolute", () => {
    withStoragePath("relative/storage", () => {
      expect(resolveStorageDir()).toBe(path.resolve("relative/storage"))
    })
  })
})

// ── Directory resolvers ────────────────────────────────────────────────────

describe("directory resolvers", () => {
  afterEach(() => { delete process.env.STORAGE_PATH })

  it("resolveDeliveriesDir returns deliveries subdir", () => {
    expect(resolveDeliveriesDir()).toBe(path.join(DEFAULT_STORAGE, "deliveries"))
  })

  it("resolveDeliveriesDir respects STORAGE_PATH", () => {
    withStoragePath("/mnt/store", () => {
      expect(resolveDeliveriesDir()).toBe(path.join("/mnt/store", "deliveries"))
    })
  })

  it("resolvePurchaseOrdersDir returns purchase-orders subdir", () => {
    expect(resolvePurchaseOrdersDir()).toBe(path.join(DEFAULT_STORAGE, "purchase-orders"))
  })

  it("resolvePurchaseOrdersDir respects STORAGE_PATH", () => {
    withStoragePath("/mnt/store", () => {
      expect(resolvePurchaseOrdersDir()).toBe(path.join("/mnt/store", "purchase-orders"))
    })
  })

  it("resolveRepuestosDir returns repuestos subdir", () => {
    expect(resolveRepuestosDir()).toBe(path.join(DEFAULT_STORAGE, "repuestos"))
  })

  it("resolveServiciosDir returns servicios subdir", () => {
    expect(resolveServiciosDir()).toBe(path.join(DEFAULT_STORAGE, "servicios"))
  })
})

// ── Delivery attachments ───────────────────────────────────────────────────

describe("delivery attachment paths", () => {
  it("createDeliveryAttachmentPath builds portable path", () => {
    expect(createDeliveryAttachmentPath("proof.pdf")).toBe("storage/deliveries/proof.pdf")
  })

  it("createDeliveryAttachmentPath rejects empty name", () => {
    expect(() => createDeliveryAttachmentPath("")).toThrow("Invalid delivery attachment file name")
  })

  it("createDeliveryAttachmentPath rejects dot", () => {
    expect(() => createDeliveryAttachmentPath(".")).toThrow("Invalid delivery attachment file name")
  })

  it("createDeliveryAttachmentPath rejects dotdot", () => {
    expect(() => createDeliveryAttachmentPath("..")).toThrow("Invalid delivery attachment file name")
  })

  it("createDeliveryAttachmentPath rejects name with slash (path traversal)", () => {
    expect(() => createDeliveryAttachmentPath("../secret.pdf")).toThrow("Invalid delivery attachment file name")
  })

  it("resolveDeliveryAttachmentFile resolves valid path", () => {
    withStoragePath("/mnt/store", () => {
      expect(resolveDeliveryAttachmentFile("storage/deliveries/proof.pdf"))
        .toBe(path.join("/mnt/store", "deliveries", "proof.pdf"))
    })
  })

  it("resolveDeliveryAttachmentFile returns null for wrong prefix", () => {
    expect(resolveDeliveryAttachmentFile("storage/other/proof.pdf")).toBeNull()
  })

  it("resolveDeliveryAttachmentFile returns null for path traversal", () => {
    expect(resolveDeliveryAttachmentFile("storage/deliveries/../secret.pdf")).toBeNull()
  })

  it("resolveDeliveryAttachmentFile returns null for nested path", () => {
    expect(resolveDeliveryAttachmentFile("storage/deliveries/sub/proof.pdf")).toBeNull()
  })
})

// ── Invoice / purchase-order attachments ────────────────────────────────────

describe("invoice attachment paths", () => {
  it("createInvoiceAttachmentPath builds portable path", () => {
    expect(createInvoiceAttachmentPath("inv-123.pdf")).toBe("storage/purchase-orders/inv-123.pdf")
  })

  it("createInvoiceAttachmentPath rejects invalid name", () => {
    expect(() => createInvoiceAttachmentPath(".")).toThrow("Invalid invoice attachment file name")
  })

  it("createInvoiceAttachmentPath rejects path traversal", () => {
    expect(() => createInvoiceAttachmentPath("../../etc/passwd")).toThrow("Invalid invoice attachment file name")
  })

  it("resolveInvoiceAttachmentFile resolves valid path", () => {
    withStoragePath("/data", () => {
      expect(resolveInvoiceAttachmentFile("storage/purchase-orders/inv-123.pdf"))
        .toBe(path.join("/data", "purchase-orders", "inv-123.pdf"))
    })
  })

  it("resolveInvoiceAttachmentFile returns null for wrong prefix", () => {
    expect(resolveInvoiceAttachmentFile("storage/deliveries/proof.pdf")).toBeNull()
  })

  it("resolveInvoiceAttachmentFile returns null for traversed name", () => {
    expect(resolveInvoiceAttachmentFile("storage/purchase-orders/../secret.pdf")).toBeNull()
  })
})

// ── Repuesto quotation attachments ──────────────────────────────────────────

describe("quotation attachment paths (repuestos)", () => {
  it("createQuotationAttachmentPath builds portable path", () => {
    expect(createQuotationAttachmentPath("quote-a.pdf")).toBe("storage/repuestos/quote-a.pdf")
  })

  it("createQuotationAttachmentPath rejects invalid name", () => {
    expect(() => createQuotationAttachmentPath("..")).toThrow("Invalid quotation attachment file name")
  })

  it("resolveQuotationAttachmentFile resolves valid path", () => {
    withStoragePath("/store", () => {
      expect(resolveQuotationAttachmentFile("storage/repuestos/quote-a.pdf"))
        .toBe(path.join("/store", "repuestos", "quote-a.pdf"))
    })
  })

  it("resolveQuotationAttachmentFile returns null for wrong prefix", () => {
    expect(resolveQuotationAttachmentFile("storage/other/quote-a.pdf")).toBeNull()
  })

  it("resolveQuotationAttachmentFile returns null for traversal", () => {
    expect(resolveQuotationAttachmentFile("storage/repuestos/../../secret.pdf")).toBeNull()
  })
})

// ── Servicio quotation attachments ──────────────────────────────────────────

describe("service quotation paths", () => {
  it("createServiceQuotationPath builds portable path", () => {
    expect(createServiceQuotationPath("serv-quote.pdf")).toBe("storage/servicios/serv-quote.pdf")
  })

  it("createServiceQuotationPath rejects invalid name", () => {
    expect(() => createServiceQuotationPath(".")).toThrow("Invalid service quotation file name")
  })

  it("createServiceQuotationPath rejects traversal", () => {
    expect(() => createServiceQuotationPath("../leak.pdf")).toThrow("Invalid service quotation file name")
  })

  it("resolveServiceQuotationFile resolves valid path", () => {
    withStoragePath("/base", () => {
      expect(resolveServiceQuotationFile("storage/servicios/serv-quote.pdf"))
        .toBe(path.join("/base", "servicios", "serv-quote.pdf"))
    })
  })

  it("resolveServiceQuotationFile returns null for wrong prefix", () => {
    expect(resolveServiceQuotationFile("storage/other/serv-quote.pdf")).toBeNull()
  })

  it("resolveServiceQuotationFile returns null for traversal", () => {
    expect(resolveServiceQuotationFile("storage/servicios/../../secret.pdf")).toBeNull()
  })
})
