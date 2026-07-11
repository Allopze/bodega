/**
 * Unit tests for admin/productos actions — categories + products CRUD.
 *
 * Covers:
 *  1. Permission denied
 *  2. Validation errors
 *  3. Slug conflict
 *  4. Happy paths
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Session } from "next-auth"

const mockAuthFn = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())
const mockCancelEppImportBatch = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockInsertValues = vi.fn().mockResolvedValue(undefined)
const mockUpdateSetWhere = vi.fn().mockResolvedValue(undefined)
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateSetWhere }))

const mockDb = {
  query: {
    productCategories: { findFirst: vi.fn() },
    products: { findFirst: vi.fn() },
  },
  insert: vi.fn(() => ({ values: mockInsertValues })),
  update: vi.fn(() => ({ set: mockUpdateSet })),
  delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  transaction: vi.fn(async (callback: (tx: typeof mockDb) => Promise<void>) => callback(mockDb)),
}

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))
vi.mock("@/lib/services/epp-import", () => ({ cancelEppImportBatch: mockCancelEppImportBatch }))
vi.mock("@/db", () => ({ db: mockDb }))

function makeSession(perm: string): Session {
  return {
    user: {
      id: "user-1", name: "Admin", email: "admin@chome.cl",
      permissions: [perm], roles: ["administrador"], worksiteIds: [], isGlobal: true,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as unknown as Session
}

describe("admin/productos actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRecordAudit.mockResolvedValue(undefined)
    mockDb.query.productCategories.findFirst.mockResolvedValue(null)
    mockDb.query.products.findFirst.mockResolvedValue(null)
  })

  // ── createCategory ─────────────────────────────────────────────────────

  describe("createCategory", () => {
    it("denies without admin:products", async () => {
      mockAuthFn.mockResolvedValue(makeSession("other:perm"))
      const { createCategory } = await import("@/app/(app)/admin/productos/actions")
      const fd = new FormData(); fd.set("name", "EPP"); fd.set("slug", "epp")
      const r = await createCategory({ ok: false }, fd)
      expect(r.ok).toBe(false); expect(r.message).toContain("Sin permisos")
    })

    it("rejects missing name", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      const { createCategory } = await import("@/app/(app)/admin/productos/actions")
      const fd = new FormData(); fd.set("name", ""); fd.set("slug", "test")
      const r = await createCategory({ ok: false }, fd)
      expect(r.ok).toBe(false)
    })

    it("rejects duplicate slug", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      mockDb.query.productCategories.findFirst.mockResolvedValue({ id: "existing", slug: "epp" })
      const { createCategory } = await import("@/app/(app)/admin/productos/actions")
      const fd = new FormData(); fd.set("name", "EPP"); fd.set("slug", "epp")
      const r = await createCategory({ ok: false }, fd)
      expect(r.ok).toBe(false); expect(r.fieldErrors?.slug).toBeDefined()
    })

    it("creates category on happy path", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      const { createCategory } = await import("@/app/(app)/admin/productos/actions")
      const fd = new FormData(); fd.set("name", "EPP"); fd.set("slug", "epp"); fd.set("sortOrder", "1")
      const r = await createCategory({ ok: false }, fd)
      expect(r.ok).toBe(true); expect(r.message).toContain("creada")
      expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "create", entityType: "product_category" }))
    })
  })

  // ── updateCategory ─────────────────────────────────────────────────────

  describe("updateCategory", () => {
    it("denies without permission", async () => {
      mockAuthFn.mockResolvedValue(makeSession("other:perm"))
      const { updateCategory } = await import("@/app/(app)/admin/productos/actions")
      const fd = new FormData(); fd.set("id", "cat-1"); fd.set("name", "EPP"); fd.set("slug", "epp")
      const r = await updateCategory({ ok: false }, fd)
      expect(r.ok).toBe(false)
    })

    it("rejects slug conflict with different category", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      mockDb.query.productCategories.findFirst.mockResolvedValue({ id: "other-cat", slug: "epp" })
      const { updateCategory } = await import("@/app/(app)/admin/productos/actions")
      const fd = new FormData(); fd.set("id", "cat-1"); fd.set("name", "EPP"); fd.set("slug", "epp")
      const r = await updateCategory({ ok: false }, fd)
      expect(r.ok).toBe(false); expect(r.fieldErrors?.slug).toBeDefined()
    })

    it("updates category on happy path", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      mockDb.query.productCategories.findFirst.mockResolvedValue(null)
      const { updateCategory } = await import("@/app/(app)/admin/productos/actions")
      const fd = new FormData(); fd.set("id", "cat-1"); fd.set("name", "EPP Actualizado"); fd.set("slug", "epp")
      const r = await updateCategory({ ok: false }, fd)
      expect(r.ok).toBe(true); expect(r.message).toContain("actualizada")
    })
  })

  // ── createProduct ──────────────────────────────────────────────────────

  describe("createProduct", () => {
    it("denies without admin:products", async () => {
      mockAuthFn.mockResolvedValue(makeSession("other:perm"))
      const { createProduct } = await import("@/app/(app)/admin/productos/actions")
      const fd = new FormData(); fd.set("name", "Casco"); fd.set("sku", "C-001"); fd.set("categoryId", "cat-1"); fd.set("unitOfMeasure", "unidad")
      const r = await createProduct({ ok: false }, fd)
      expect(r.ok).toBe(false)
    })

    it("rejects missing required fields", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      const { createProduct } = await import("@/app/(app)/admin/productos/actions")
      const fd = new FormData(); fd.set("name", ""); fd.set("sku", "")
      const r = await createProduct({ ok: false }, fd)
      expect(r.ok).toBe(false)
    })

    it("returns domain validation messages when required product fields are absent", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      const { createProduct } = await import("@/app/(app)/admin/productos/actions")
      const r = await createProduct({ ok: false }, new FormData())
      expect(r.ok).toBe(false)
      expect(r.fieldErrors?.sku).toBeUndefined()
      expect(r.fieldErrors?.name).toContain("Nombre requerido")
      expect(r.fieldErrors?.categoryId).toContain("Selecciona una categoría")
    })

    it("generates a SKU and ignores any value submitted by the user", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      const { createProduct } = await import("@/app/(app)/admin/productos/actions")
      const fd = new FormData(); fd.set("name", "Casco"); fd.set("sku", "CUALQUIER-COSA"); fd.set("categoryId", "cat-1"); fd.set("unitOfMeasure", "unidad")
      const r = await createProduct({ ok: false }, fd)
      expect(r.ok).toBe(true)
      expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ sku: expect.stringMatching(/^PRD-[A-Z0-9]{6}$/) }))
    })

    it("normalizes EPP talla/color options as JSON for request dropdowns", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      const { createProduct } = await import("@/app/(app)/admin/productos/actions")
      const fd = new FormData()
      fd.set("name", "Guante nitrilo")
      fd.set("categoryId", "cat-epp")
      fd.set("unitOfMeasure", "par")
      fd.set("isEpp", "on")
      fd.set("attributesJson", JSON.stringify([
        { name: "Talla", type: "select", isRequired: true, options: "S, M, L, XL", sortOrder: 0 },
        { name: "Color", type: "select", isRequired: false, options: "Negro\nAzul", sortOrder: 1 },
      ]))

      const r = await createProduct({ ok: false }, fd)

      expect(r.ok).toBe(true)
      expect(mockInsertValues).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ name: "Talla", options: JSON.stringify(["S", "M", "L", "XL"]) }),
        expect.objectContaining({ name: "Color", options: JSON.stringify(["Negro", "Azul"]) }),
      ]))
    })

    it("rejects more than one preferred supplier even if the client-side guard is bypassed", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      const { createProduct } = await import("@/app/(app)/admin/productos/actions")
      const fd = new FormData()
      fd.set("name", "Casco")
      fd.set("categoryId", "cat-1")
      fd.set("suppliersJson", JSON.stringify([
        { supplierId: "sup-1", isPreferred: true },
        { supplierId: "sup-2", isPreferred: true },
      ]))
      const r = await createProduct({ ok: false }, fd)
      expect(r.ok).toBe(false)
      expect(r.fieldErrors?.suppliers).toBeDefined()
      expect(mockInsertValues).not.toHaveBeenCalled()
    })
  })

  describe("updateProduct", () => {
    it("returns domain validation messages when the submitted form is incomplete", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      const { updateProduct } = await import("@/app/(app)/admin/productos/actions")
      const r = await updateProduct({ ok: false }, new FormData())
      expect(r.ok).toBe(false)
      expect(r.fieldErrors?.sku).toBeUndefined()
      expect(r.fieldErrors?.name).toContain("Nombre requerido")
      expect(r.fieldErrors?.categoryId).toContain("Selecciona una categoría")
    })
  })

  describe("getProductForEdit", () => {
    it("allows product managers to load the edit form without import permissions", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      mockDb.query.products.findFirst.mockResolvedValue({
        id: "prod-1",
        sku: "PRD-ABC123",
        name: "Casco",
        description: null,
        categoryId: "cat-1",
        unitOfMeasure: "unidad",
        isEpp: false,
        requiresPrevencion: false,
        referencePrice: null,
        notes: null,
        isActive: true,
        productAttributes: [],
        productSuppliers: [],
      })
      const { getProductForEdit } = await import("@/app/(app)/admin/productos/actions")

      const result = await getProductForEdit("prod-1")

      expect(result?.id).toBe("prod-1")
      expect(mockAuthFn).toHaveBeenCalled()
    })
  })

  // ── cancelEppImportBatchAction ─────────────────────────────────────────

  describe("cancelEppImportBatchAction", () => {
    it("denies without admin:epp_import_confirm", async () => {
      mockAuthFn.mockResolvedValue(makeSession("other:perm"))
      const { cancelEppImportBatchAction } = await import("@/app/(app)/admin/productos/actions")
      const fd = new FormData(); fd.set("batchId", "batch-1")
      const r = await cancelEppImportBatchAction({ ok: false }, fd)
      expect(r.ok).toBe(false); expect(r.message).toContain("Sin permisos")
    })

    it("rejects missing batchId", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:epp_import_confirm"))
      const { cancelEppImportBatchAction } = await import("@/app/(app)/admin/productos/actions")
      const r = await cancelEppImportBatchAction({ ok: false }, new FormData())
      expect(r.ok).toBe(false); expect(r.message).toBe("Lote requerido")
    })

    it("cancels the batch and records an audit on happy path", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:epp_import_confirm"))
      const { cancelEppImportBatchAction } = await import("@/app/(app)/admin/productos/actions")
      const fd = new FormData(); fd.set("batchId", "batch-casco-123")
      const r = await cancelEppImportBatchAction({ ok: false }, fd)
      expect(r.ok).toBe(true)
      expect(r.message).toContain("Lote cancelado")
      expect(mockCancelEppImportBatch).toHaveBeenCalledWith("batch-casco-123")
      expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: "update", entityType: "epp_import_batch", entityId: "batch-casco-123",
        oldState: { status: "review" }, newState: { status: "cancelled" },
      }))
    })

    it("returns an error when the underlying service throws", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:epp_import_confirm"))
      mockCancelEppImportBatch.mockRejectedValueOnce(new Error("Batch not found"))
      const { cancelEppImportBatchAction } = await import("@/app/(app)/admin/productos/actions")
      const fd = new FormData(); fd.set("batchId", "batch-nonexistent")
      const r = await cancelEppImportBatchAction({ ok: false }, fd)
      expect(r.ok).toBe(false)
      expect(r.message).toBe("Batch not found")
    })
  })
})
