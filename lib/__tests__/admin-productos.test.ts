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

const mockSetProductSupplierPriceTx = vi.hoisted(() => vi.fn().mockResolvedValue({ changed: true, stale: false }))
const mockAuthFn = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())
const mockSelectForUpdate = vi.fn().mockResolvedValue([])
const mockSelectWhere = vi.fn(() => ({
  for: mockSelectForUpdate,
  then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
}))
// `.from(...)` tiene que ser encadenable Y esperable: la generación de SKU
// encadena `.select().from().where()` y espera el resultado, mientras que
// otras rutas usan `.select().from()` directo. `then` vive al final de la
// cadena para que ambas rutas resuelvan correctamente.
const mockSelectFrom = vi.fn(() => ({
  where: mockSelectWhere,
  then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
}))
const mockCancelEppImportBatch = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
// `.values(...)` tiene que ser esperable Y encadenable: el alta de familia usa
// `.onConflictDoNothing(...).returning(...)` para no reventar cuando dos altas
// simultáneas chocan en `identity_key`, y el resto de los inserts la esperan
// directo.
const mockReturning = vi.fn().mockResolvedValue([{ id: "fam-generada" }])
const mockOnConflictDoNothing = vi.fn(() => ({ returning: mockReturning }))
const mockInsertValues = vi.fn((_values?: unknown) => ({
  onConflictDoNothing: mockOnConflictDoNothing,
  returning: mockReturning,
  then: (resolve: (value: unknown) => unknown) => resolve(undefined),
}))
const mockUpdateSetWhere = vi.fn().mockResolvedValue(undefined)
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateSetWhere }))

const mockDb = {
  query: {
    productCategories: { findFirst: vi.fn() },
    products: { findFirst: vi.fn(), findMany: vi.fn() },
    eppProductFamilies: { findFirst: vi.fn() },
    // `ensureEppFamilyTx` ahora clasifica la familia con
    // `classifyEppTypeIdByName`, que resuelve el código de zona corporal contra
    // este catálogo. Antes sólo lo consultaba el importador XLSX.
    eppTypes: { findFirst: vi.fn() },
  },
  // Estaba anidado dentro de `query` por error: nadie lo llamaba desde ahí, así
  // que el mock nunca falló hasta que la generación de SKU pasó a usar select.
  select: vi.fn(() => ({ from: mockSelectFrom })),
  insert: vi.fn(() => ({ values: mockInsertValues })),
  update: vi.fn(() => ({ set: mockUpdateSet })),
  delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  transaction: vi.fn(async (callback: (tx: typeof mockDb) => Promise<void>) => callback(mockDb)),
}
// El guard de módulo consulta `system_settings` en cada verificación de permiso
// (CO-007). Estas pruebas mockean sólo las tablas de su caso, así que se
// declara aquí que ningún módulo está apagado; el guard tiene sus propias
// regresiones en lib/__tests__/module-toggles.test.ts.
vi.mock("@/lib/services/module-toggles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/module-toggles")>()),
  assertPermissionModuleEnabled: vi.fn(async () => {}),
  assertRouteModuleEnabled: vi.fn(async () => {}),
  getNavigationToggleState: vi.fn(async () => ({ enabledModuleIds: new Set<string>(), disabledSubmoduleHrefs: new Set<string>() })),
}))

vi.mock("@/lib/services/product-supplier-prices", () => ({ setProductSupplierPriceTx: mockSetProductSupplierPriceTx }))

vi.mock("@/lib/auth/auth", () => ({ auth: mockAuthFn }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/audit", () => ({ recordAudit: mockRecordAudit }))
vi.mock("@/lib/services/epp-import", async (importOriginal) => {
  const original: Record<string, unknown> = await importOriginal()
  return { ...original, cancelEppImportBatch: mockCancelEppImportBatch }
})
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
    mockDb.query.products.findMany.mockResolvedValue([])
    mockDb.query.eppProductFamilies.findFirst.mockResolvedValue(null)
    mockDb.query.eppTypes.findFirst.mockResolvedValue(null)
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
      expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ sku: expect.stringMatching(/^PRD-\d{3}$/) }))
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

    it("carries drivesQuantity and sizeFamily through to the edit form", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      mockDb.query.products.findFirst.mockResolvedValue({
        id: "prod-1", sku: "PRD-ABC123", name: "Vacuna", description: null,
        categoryId: "cat-1", unitOfMeasure: "unidad", isEpp: false, requiresPrevencion: false,
        isService: true, requiresWorker: true, equipmentKind: null, referencePrice: null, notes: null, isActive: true,
        productAttributes: [
          { id: "attr-1", name: "Dosis", type: "integer", isRequired: true, options: null, sizeFamily: null, drivesQuantity: true, sortOrder: 0 },
        ],
        productSuppliers: [],
      })
      const { getProductForEdit } = await import("@/app/(app)/admin/productos/actions")

      const result = await getProductForEdit("prod-1")

      expect(result?.attributes[0]).toMatchObject({ name: "Dosis", type: "integer", drivesQuantity: true })
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

  // ── createProductVariantBatch ─────────────────────────────────────────

  describe("createProductVariantBatch", () => {
    const VALID_INPUT = {
      categoryId: "cat-epp",
      familyName: "Casco de seguridad",
      unitOfMeasure: "unidad",
      isEpp: true,
      requiresPrevencion: false,
      isActive: true,
      referencePrice: null,
      attributes: [
        { name: "Color", type: "select" as const, options: JSON.stringify(["Blanco", "Azul"]), sortOrder: 0 },
      ],
      variants: [
        { name: "Casco de seguridad Blanco", attributes: [{ name: "Color", value: "Blanco" }] },
        { name: "Casco de seguridad Azul", attributes: [{ name: "Color", value: "Azul" }] },
      ],
      supplier: undefined,
    }

    it("denies without admin:products", async () => {
      mockAuthFn.mockResolvedValue(makeSession("other:perm"))
      const { createProductVariantBatch } = await import("@/app/(app)/admin/productos/actions")
      const r = await createProductVariantBatch(VALID_INPUT)
      expect(r.ok).toBe(false); expect(r.message).toContain("Sin permisos")
    })

    it("rejects missing categoryId", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      const { createProductVariantBatch } = await import("@/app/(app)/admin/productos/actions")
      const r = await createProductVariantBatch({ ...VALID_INPUT, categoryId: "" })
      expect(r.ok).toBe(false)
    })

    it("rejects empty variants array", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      const { createProductVariantBatch } = await import("@/app/(app)/admin/productos/actions")
      const r = await createProductVariantBatch({ ...VALID_INPUT, variants: [] })
      expect(r.ok).toBe(false)
    })

    it("rejects familyName that is too short", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      const { createProductVariantBatch } = await import("@/app/(app)/admin/productos/actions")
      const r = await createProductVariantBatch({ ...VALID_INPUT, familyName: "X" })
      expect(r.ok).toBe(false)
    })

    it("creates all variants on happy path", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      mockDb.query.productCategories.findFirst.mockResolvedValue({ id: "cat-epp", name: "EPP", slug: "epp" })
      mockDb.query.eppProductFamilies.findFirst.mockResolvedValue(null)

      const { createProductVariantBatch } = await import("@/app/(app)/admin/productos/actions")
      const r = await createProductVariantBatch(VALID_INPUT)

      expect(r.ok).toBe(true)
      expect(r.message).toContain("2 productos")
      expect(mockDb.transaction).toHaveBeenCalled()
      expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: "create", entityType: "product",
        newState: { familyName: "Casco de seguridad", familyId: null, variantCount: 2 },
      }))
    })

    it("returns error when category is not found", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      // findFirst returns null = category not found
      mockDb.query.productCategories.findFirst.mockResolvedValue(null)

      const { createProductVariantBatch } = await import("@/app/(app)/admin/productos/actions")
      const r = await createProductVariantBatch(VALID_INPUT)

      expect(r.ok).toBe(false)
      expect(r.message).toContain("Categoría no encontrada")
    })

    it("creates variants with supplier when provided", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      mockDb.query.productCategories.findFirst.mockResolvedValue({ id: "cat-epp", name: "EPP", slug: "epp" })
      mockDb.query.eppProductFamilies.findFirst.mockResolvedValue(null)

      const { createProductVariantBatch } = await import("@/app/(app)/admin/productos/actions")
      const withSupplier = {
        ...VALID_INPUT,
        variants: [{ name: "Casco Blanco", attributes: [{ name: "Color", value: "Blanco" }] }],
        supplier: { supplierId: "sup-1", unitPrice: 5000, notes: "Entrega 15 días" },
      }
      const r = await createProductVariantBatch(withSupplier)

      expect(r.ok).toBe(true)
      expect(r.message).toContain("1 producto")
      expect(mockSetProductSupplierPriceTx).toHaveBeenCalledWith(mockDb, expect.objectContaining({
        productId: expect.any(String),
        supplierId: "sup-1",
        unitPrice: 5000,
        source: "variant_creator",
        userId: "user-1",
        isPreferred: true,
        notes: "Entrega 15 días",
      }))
    })

    it("traza el audit con el SKU real del primer producto del lote", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      mockDb.query.productCategories.findFirst.mockResolvedValue({ id: "cat-epp", name: "EPP", slug: "epp" })
      mockDb.query.eppProductFamilies.findFirst.mockResolvedValue(null)

      const { createProductVariantBatch } = await import("@/app/(app)/admin/productos/actions")
      const r = await createProductVariantBatch(VALID_INPUT)

      expect(r.ok).toBe(true)

      // El SKU trazado tiene que ser el del primer producto que se insertó, no
      // el resultado de buscar `products.name === familyName`: los nombres de
      // variante llevan sufijo ("Casco de seguridad Blanco"), así que esa
      // búsqueda no acertaba nunca y el audit registraba "desconocido".
      const insertedSkus = mockInsertValues.mock.calls
        .flatMap(([values]) => (Array.isArray(values) ? values : [values]))
        .filter((row) => typeof row?.sku === "string")
        .map((row) => row.sku as string)

      expect(insertedSkus.length).toBe(2)
      expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
        entityId: "batch_Casco de seguridad",
        entityCode: insertedSkus[0],
        reason: "Creación por asistente EPP",
      }))
      expect(insertedSkus[0]).toMatch(/^EPP-/)
    })

    it("reutiliza la familia existente cuando llega familyId (modo añadir-variante)", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      mockDb.query.productCategories.findFirst.mockResolvedValue({ id: "cat-epp", name: "EPP", slug: "epp" })
      // La familia existe y NO debe volver a crearse por nombre.
      mockDb.query.eppProductFamilies.findFirst.mockResolvedValue({ id: "fam-existente", canonicalName: "Lente de seguridad", categoryId: "cat-epp" })
      // Ninguna variante existente con ese color todavía.
      mockDb.query.products.findMany.mockResolvedValue([
        { id: "p-1", sku: "EPP-001", productAttributes: [{ id: "pa-1", name: "Color", type: "select", options: JSON.stringify(["Negro"]) }] },
      ])

      const { createProductVariantBatch } = await import("@/app/(app)/admin/productos/actions")
      const r = await createProductVariantBatch({
        ...VALID_INPUT,
        familyName: "Lente de seguridad",
        familyId: "fam-existente",
        variants: [{ name: "Lente de seguridad Azul", attributes: [{ name: "Color", value: "Azul" }] }],
        existingVariantKeys: [JSON.stringify([["color", "negro"]])],
      })

      expect(r.ok).toBe(true)
      // `ensureEppFamilyTx` no debe haberse llamado: la familia se reutiliza.
      expect(mockDb.query.eppProductFamilies.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.anything() }))
      // El audit distingue la adición sobre familia existente.
      expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
        entityId: "family_fam-existente",
        reason: "Adición de variantes a familia existente",
      }))
    })

    it("rechaza crear una combinación que ya existe en la familia", async () => {
      mockAuthFn.mockResolvedValue(makeSession("admin:products"))
      mockDb.query.productCategories.findFirst.mockResolvedValue({ id: "cat-epp", name: "EPP", slug: "epp" })
      mockDb.query.eppProductFamilies.findFirst.mockResolvedValue({ id: "fam-existente", canonicalName: "Lente de seguridad", categoryId: "cat-epp" })
      mockDb.query.products.findMany.mockResolvedValue([
        { id: "p-1", sku: "EPP-001", productAttributes: [{ id: "pa-1", name: "Color", type: "select", options: JSON.stringify(["Azul"]) }] },
      ])

      const { createProductVariantBatch } = await import("@/app/(app)/admin/productos/actions")
      const r = await createProductVariantBatch({
        ...VALID_INPUT,
        familyName: "Lente de seguridad",
        familyId: "fam-existente",
        variants: [{ name: "Lente de seguridad Azul", attributes: [{ name: "Color", value: "Azul" }] }],
        existingVariantKeys: [],
      })

      expect(r.ok).toBe(false)
      expect(r.message).toContain("ya existe en la familia")
    })
  })
})
