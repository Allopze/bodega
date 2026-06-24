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
}

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))
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

    it("rejects duplicate SKU", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      mockDb.query.products.findFirst.mockResolvedValue({ id: "existing", sku: "C-001" })
      const { createProduct } = await import("@/app/(app)/admin/productos/actions")
      const fd = new FormData(); fd.set("name", "Casco"); fd.set("sku", "C-001"); fd.set("categoryId", "cat-1"); fd.set("unitOfMeasure", "unidad")
      const r = await createProduct({ ok: false }, fd)
      expect(r.ok).toBe(false); expect(r.fieldErrors?.sku).toBeDefined()
    })
  })
})
