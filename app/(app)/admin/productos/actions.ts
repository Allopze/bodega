"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { products, productAttributes, productSuppliers, productCategories } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { productSchema, productCategorySchema, type ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/productos"

// ── Product Categories ────────────────────────────────────────────────────────

export async function createCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:products") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = productCategorySchema.safeParse({
    name:               formData.get("name"),
    slug:               formData.get("slug"),
    isEpp:              formData.get("isEpp") === "on",
    requiresPrevencion: formData.get("requiresPrevencion") === "on",
    sortOrder:          formData.get("sortOrder") || 0,
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data

  const exists = await db.query.productCategories.findFirst({ where: eq(productCategories.slug, d.slug) })
  if (exists) return { ok: false, fieldErrors: { slug: ["Este slug ya existe"] } }

  const id = nanoid()
  await db.insert(productCategories).values({ id, name: d.name, slug: d.slug, isEpp: d.isEpp, requiresPrevencion: d.requiresPrevencion, sortOrder: d.sortOrder })

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "product_category", entityId: id, newState: { name: d.name, slug: d.slug } })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Categoría ${d.name} creada` }
}

export async function updateCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:products") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = productCategorySchema.safeParse({
    id:                 formData.get("id"),
    name:               formData.get("name"),
    slug:               formData.get("slug"),
    isEpp:              formData.get("isEpp") === "on",
    requiresPrevencion: formData.get("requiresPrevencion") === "on",
    sortOrder:          formData.get("sortOrder") || 0,
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data
  if (!d.id) return { ok: false, message: "ID requerido" }

  const conflict = await db.query.productCategories.findFirst({ where: eq(productCategories.slug, d.slug) })
  if (conflict && conflict.id !== d.id) return { ok: false, fieldErrors: { slug: ["Este slug ya existe"] } }

  await db.update(productCategories).set({ name: d.name, slug: d.slug, isEpp: d.isEpp, requiresPrevencion: d.requiresPrevencion, sortOrder: d.sortOrder }).where(eq(productCategories.id, d.id))

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "product_category", entityId: d.id, newState: { name: d.name } })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `Categoría ${d.name} actualizada` }
}

// ── Products ──────────────────────────────────────────────────────────────────

export async function createProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:products") }
  catch { return { ok: false, message: "Sin permisos" } }

  // Parse attributes from JSON-encoded hidden input
  let attributesRaw: unknown[] = []
  let suppliersRaw:  unknown[] = []
  try { attributesRaw = JSON.parse(formData.get("attributesJson") as string ?? "[]") } catch { /* empty */ }
  try { suppliersRaw  = JSON.parse(formData.get("suppliersJson")  as string ?? "[]") } catch { /* empty */ }

  const parsed = productSchema.safeParse({
    sku:                formData.get("sku"),
    name:               formData.get("name"),
    description:        formData.get("description") || "",
    categoryId:         formData.get("categoryId"),
    unitOfMeasure:      formData.get("unitOfMeasure") || "unidad",
    isEpp:              formData.get("isEpp") === "on",
    requiresPrevencion: formData.get("requiresPrevencion") === "on",
    referencePrice:     formData.get("referencePrice") || null,
    notes:              formData.get("notes") || "",
    isActive:           formData.get("isActive") === "on",
    attributes:         attributesRaw,
    suppliers:          suppliersRaw,
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data

  const skuConflict = await db.query.products.findFirst({ where: eq(products.sku, d.sku) })
  if (skuConflict) return { ok: false, fieldErrors: { sku: ["Este SKU ya existe"] } }

  const id = nanoid()

  db.transaction((tx) => {
    tx.insert(products).values({
      id, sku: d.sku, name: d.name,
      description: d.description || null,
      categoryId: d.categoryId,
      unitOfMeasure: d.unitOfMeasure,
      isEpp: d.isEpp,
      requiresPrevencion: d.requiresPrevencion,
      referencePrice: d.referencePrice ?? null,
      notes: d.notes || null,
      isActive: d.isActive,
    }).run()

    if (d.attributes.length > 0) {
      tx.insert(productAttributes).values(
        d.attributes.map((a) => ({
          id: nanoid(), productId: id, categoryId: null,
          name: a.name, type: a.type, isRequired: a.isRequired,
          options: a.options ?? null, sortOrder: a.sortOrder,
        }))
      ).run()
    }

    if (d.suppliers.length > 0) {
      tx.insert(productSuppliers).values(
        d.suppliers.map((s) => ({
          id: nanoid(), productId: id,
          supplierId: s.supplierId,
          unitPrice: s.unitPrice ?? null,
          isPreferred: s.isPreferred,
          notes: s.notes ?? null,
        }))
      ).run()
    }
  })

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "product", entityId: id, entityCode: d.sku, newState: { sku: d.sku, name: d.name, categoryId: d.categoryId } })

  revalidatePath(REVALIDATE)
  return { ok: true as const, message: `Producto ${d.sku} creado` }
}

export async function updateProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:products") }
  catch { return { ok: false, message: "Sin permisos" } }

  let attributesRaw: unknown[] = []
  let suppliersRaw:  unknown[] = []
  try { attributesRaw = JSON.parse(formData.get("attributesJson") as string ?? "[]") } catch { /* empty */ }
  try { suppliersRaw  = JSON.parse(formData.get("suppliersJson")  as string ?? "[]") } catch { /* empty */ }

  const parsed = productSchema.safeParse({
    id:                 formData.get("id"),
    sku:                formData.get("sku"),
    name:               formData.get("name"),
    description:        formData.get("description") || "",
    categoryId:         formData.get("categoryId"),
    unitOfMeasure:      formData.get("unitOfMeasure") || "unidad",
    isEpp:              formData.get("isEpp") === "on",
    requiresPrevencion: formData.get("requiresPrevencion") === "on",
    referencePrice:     formData.get("referencePrice") || null,
    notes:              formData.get("notes") || "",
    isActive:           formData.get("isActive") === "on",
    attributes:         attributesRaw,
    suppliers:          suppliersRaw,
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data
  if (!d.id) return { ok: false, message: "ID requerido" }
  const productId = d.id // narrowed to string by the guard above

  const skuConflict = await db.query.products.findFirst({ where: eq(products.sku, d.sku) })
  if (skuConflict && skuConflict.id !== productId) return { ok: false, fieldErrors: { sku: ["Este SKU ya existe"] } }

  const current = await db.query.products.findFirst({ where: eq(products.id, productId) })
  if (!current) return { ok: false, message: "Producto no encontrado" }

  db.transaction((tx) => {
    tx.update(products).set({
      sku: d.sku, name: d.name,
      description: d.description || null,
      categoryId: d.categoryId,
      unitOfMeasure: d.unitOfMeasure,
      isEpp: d.isEpp,
      requiresPrevencion: d.requiresPrevencion,
      referencePrice: d.referencePrice ?? null,
      notes: d.notes || null,
      isActive: d.isActive,
      updatedAt: new Date().toISOString(),
    }).where(eq(products.id, productId)).run()

    // Replace attributes
    tx.delete(productAttributes).where(eq(productAttributes.productId, productId)).run()
    if (d.attributes.length > 0) {
      tx.insert(productAttributes).values(
        d.attributes.map((a, i) => ({
          id: nanoid(), productId: d.id!,
          categoryId: null, name: a.name, type: a.type,
          isRequired: a.isRequired, options: a.options ?? null,
          sortOrder: a.sortOrder ?? i,
        }))
      ).run()
    }

    // Replace product suppliers
    tx.delete(productSuppliers).where(eq(productSuppliers.productId, productId)).run()
    if (d.suppliers.length > 0) {
      tx.insert(productSuppliers).values(
        d.suppliers.map((s) => ({
          id: nanoid(), productId: d.id!,
          supplierId: s.supplierId,
          unitPrice: s.unitPrice ?? null,
          isPreferred: s.isPreferred,
          notes: s.notes ?? null,
        }))
      ).run()
    }
  })

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "product", entityId: productId, entityCode: d.sku, oldState: { name: current.name, isActive: current.isActive }, newState: { name: d.name, isActive: d.isActive } })

  revalidatePath(REVALIDATE)
  return { ok: true as const, message: `Producto ${d.sku} actualizado` }
}

// ── Read for edit ─────────────────────────────────────────────────────────────

export async function getProductForEdit(id: string) {
  try { await requirePermission("admin:products") }
  catch { return null }

  const product = await db.query.products.findFirst({
    where: eq(products.id, id),
    with: {
      productAttributes: { orderBy: (a, { asc }) => [asc(a.sortOrder)] },
      productSuppliers: {
        with: { supplier: true },
        orderBy: (ps, { asc }) => [asc(ps.isPreferred)],
      },
    },
  })

  if (!product) return null

  return {
    id:                 product.id,
    sku:                product.sku,
    name:               product.name,
    description:        product.description,
    categoryId:         product.categoryId,
    unitOfMeasure:      product.unitOfMeasure,
    isEpp:              product.isEpp,
    requiresPrevencion: product.requiresPrevencion,
    referencePrice:     product.referencePrice,
    notes:              product.notes,
    isActive:           product.isActive,
    attributes: product.productAttributes.map((a) => ({
      id:         a.id,
      name:       a.name,
      type:       a.type as "text" | "select" | "number",
      isRequired: a.isRequired,
      options:    a.options ?? "",
      sortOrder:  a.sortOrder,
    })),
    suppliers: product.productSuppliers.map((ps) => ({
      id:           ps.id,
      supplierId:   ps.supplierId,
      supplierName: ps.supplier?.name ?? ps.supplierId,
      unitPrice:    ps.unitPrice != null ? String(ps.unitPrice) : "",
      isPreferred:  ps.isPreferred,
      notes:        ps.notes ?? "",
    })),
  }
}

export async function toggleProductActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:products") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id       = formData.get("id") as string
  const activate = formData.get("activate") === "true"
  if (!id) return { ok: false, message: "ID requerido" }

  await db.update(products).set({ isActive: activate, updatedAt: new Date().toISOString() }).where(eq(products.id, id))

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "product", entityId: id, oldState: { isActive: !activate }, newState: { isActive: activate } })

  revalidatePath(REVALIDATE)
  return { ok: true, message: activate ? "Producto activado" : "Producto desactivado" }
}
