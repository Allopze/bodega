"use server"

import { revalidatePath } from "next/cache"
import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { products, productAttributes, productSuppliers, productCategories, eppProductFamilies } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import { buildEppFamilyIdentityKey } from "@/lib/services/epp-import"
import { lockCatalogProductsForUpdateTx } from "@/lib/services/catalog-product-locks"
import { productSchema, type ActionState } from "@/lib/validation/masters"

import {
  formString, normalizeSelectOptions, displayOptionsText,
  generateUniqueProductSku, generateUniqueSkus,
  resolveManualEppFamily, REVALIDATE,
} from "./helpers"
import { productVariantBatchSchema, type ProductVariantBatchInput } from "./product-variant-batch.schema"

// ── Product CRUD ──────────────────────────────────────────────────────────────

// La familia de equipos que un servicio dice atender ya no tiene que existir en
// el registro: desde que la solicitud da de alta el equipo por su código, el
// primer instrumento de una familia nace de pedir su mantención. Exigirlo antes
// dejaba el servicio imposible de guardar y de pedir a la vez.

export async function createProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:products") }
  catch { return { ok: false, message: "Sin permisos" } }

  // Parse attributes from JSON-encoded hidden input
  let attributesRaw: unknown[] = []
  let suppliersRaw:  unknown[] = []
  try { attributesRaw = JSON.parse(formData.get("attributesJson") as string ?? "[]") } catch { logger.warn("[createProduct] attributesJson inválido, se usará arreglo vacío") }
  try { suppliersRaw  = JSON.parse(formData.get("suppliersJson")  as string ?? "[]") } catch { logger.warn("[createProduct] suppliersJson inválido, se usará arreglo vacío") }

  const parsed = productSchema.safeParse({
    name:               formString(formData, "name"),
    description:        formString(formData, "description"),
    categoryId:         formString(formData, "categoryId"),
    unitOfMeasure:      formString(formData, "unitOfMeasure") || "unidad",
    isEpp:              formData.get("isEpp") === "on",
    requiresPrevencion: formData.get("requiresPrevencion") === "on",
    isService:          formData.get("isService") === "on",
    requiresWorker:     formData.get("requiresWorker") === "on",
    equipmentKind:      formData.get("equipmentKind") || undefined,
    referencePrice:     formData.get("referencePrice") || null,
    notes:              formString(formData, "notes"),
    isActive:           formData.get("isActive") === "on",
    attributes:         attributesRaw,
    suppliers:          suppliersRaw,
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data

  const id = nanoid()
  const sku = await generateUniqueProductSku(d.isEpp)

  await db.transaction(async (tx) => {
    const family = await resolveManualEppFamily(tx, { categoryId: d.categoryId, name: d.name, isEpp: d.isEpp })
    await tx.insert(products).values({
      id, sku, name: d.name,
      description: d.description || null,
      categoryId: d.categoryId,
      familyId: family?.id ?? null,
      unitOfMeasure: d.unitOfMeasure,
      isEpp: d.isEpp,
      requiresPrevencion: d.requiresPrevencion,
      isService: d.isService,
      requiresWorker: d.requiresWorker,
      equipmentKind: d.equipmentKind || null,
      referencePrice: d.referencePrice ?? null,
      notes: d.notes || null,
      isActive: d.isActive,
    })

    if (d.attributes.length > 0) {
      await tx.insert(productAttributes).values(
        d.attributes.map((a) => ({
          id: nanoid(), productId: id, categoryId: null,
          name: a.name, type: a.type, isRequired: a.isRequired,
          options: a.type === "select" ? normalizeSelectOptions(a.options) : null,
          sizeFamily: a.sizeFamily || null,
          drivesQuantity: a.drivesQuantity,
          sortOrder: a.sortOrder,
        }))
      )
    }

    if (d.suppliers.length > 0) {
      await tx.insert(productSuppliers).values(
        d.suppliers.map((s) => ({
          id: nanoid(), productId: id,
          supplierId: s.supplierId,
          unitPrice: s.unitPrice ?? null,
          isPreferred: s.isPreferred,
          notes: s.notes ?? null,
        }))
      )
    }
  })

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "product", entityId: id, entityCode: sku, newState: { sku, name: d.name, categoryId: d.categoryId } })

  revalidatePath(REVALIDATE)
  return { ok: true as const, message: `Producto ${sku} creado` }
}

export async function updateProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:products") }
  catch { return { ok: false, message: "Sin permisos" } }

  let attributesRaw: unknown[] = []
  let suppliersRaw:  unknown[] = []
  try { attributesRaw = JSON.parse(formData.get("attributesJson") as string ?? "[]") } catch { logger.warn("[updateProduct] attributesJson inválido, se usará arreglo vacío") }
  try { suppliersRaw  = JSON.parse(formData.get("suppliersJson")  as string ?? "[]") } catch { logger.warn("[updateProduct] suppliersJson inválido, se usará arreglo vacío") }

  const parsed = productSchema.safeParse({
    id:                 formString(formData, "id"),
    name:               formString(formData, "name"),
    description:        formString(formData, "description"),
    categoryId:         formString(formData, "categoryId"),
    unitOfMeasure:      formString(formData, "unitOfMeasure") || "unidad",
    isEpp:              formData.get("isEpp") === "on",
    requiresPrevencion: formData.get("requiresPrevencion") === "on",
    isService:          formData.get("isService") === "on",
    requiresWorker:     formData.get("requiresWorker") === "on",
    equipmentKind:      formData.get("equipmentKind") || undefined,
    referencePrice:     formData.get("referencePrice") || null,
    notes:              formString(formData, "notes"),
    isActive:           formData.get("isActive") === "on",
    attributes:         attributesRaw,
    suppliers:          suppliersRaw,
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data
  if (!d.id) return { ok: false, message: "ID requerido" }
  const productId = d.id

  const current = await db.query.products.findFirst({ where: eq(products.id, productId) })
  if (!current) return { ok: false, message: "Producto no encontrado" }
  const sku = current.sku

  await db.transaction(async (tx) => {
    // Match bulk EPP import's product → family order. Taking the existing
    // product lock first prevents a cycle when both flows converge on a new
    // EPP family identity.
    const lockedProductIds = await lockCatalogProductsForUpdateTx(tx, [productId])
    if (!lockedProductIds.has(productId)) throw new Error("Producto no encontrado")
    const family = await resolveManualEppFamily(tx, { categoryId: d.categoryId, name: d.name, isEpp: d.isEpp })
    await tx.update(products).set({
      sku, name: d.name,
      description: d.description || null,
      categoryId: d.categoryId,
      familyId: family?.id ?? null,
      unitOfMeasure: d.unitOfMeasure,
      isEpp: d.isEpp,
      requiresPrevencion: d.requiresPrevencion,
      isService: d.isService,
      requiresWorker: d.requiresWorker,
      equipmentKind: d.equipmentKind || null,
      referencePrice: d.referencePrice ?? null,
      notes: d.notes || null,
      isActive: d.isActive,
      updatedAt: new Date().toISOString(),
    }).where(eq(products.id, productId))

    // Replace attributes
    await tx.delete(productAttributes).where(eq(productAttributes.productId, productId))
    if (d.attributes.length > 0) {
      await tx.insert(productAttributes).values(
        d.attributes.map((a, i) => ({
          id: nanoid(), productId: d.id!,
          categoryId: null, name: a.name, type: a.type,
          isRequired: a.isRequired,
          options: a.type === "select" ? normalizeSelectOptions(a.options) : null,
          drivesQuantity: a.drivesQuantity,
          sortOrder: a.sortOrder ?? i,
        }))
      )
    }

    // Replace product suppliers
    await tx.delete(productSuppliers).where(eq(productSuppliers.productId, productId))
    if (d.suppliers.length > 0) {
      await tx.insert(productSuppliers).values(
        d.suppliers.map((s) => ({
          id: nanoid(), productId: d.id!,
          supplierId: s.supplierId,
          unitPrice: s.unitPrice ?? null,
          isPreferred: s.isPreferred,
          notes: s.notes ?? null,
        }))
      )
    }
  })

  await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "product", entityId: productId, entityCode: sku, oldState: { name: current.name, isActive: current.isActive }, newState: { name: d.name, isActive: d.isActive } })

  revalidatePath(REVALIDATE)
  return { ok: true as const, message: `Producto ${sku} actualizado` }
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
    isService:          product.isService,
    requiresWorker:     product.requiresWorker,
    equipmentKind:      product.equipmentKind,
    referencePrice:     product.referencePrice,
    notes:              product.notes,
    isActive:           product.isActive,
    attributes: product.productAttributes.map((a) => ({
      id:         a.id,
      name:       a.name,
      type:       a.type as "text" | "select" | "number",
      isRequired: a.isRequired,
      options:    displayOptionsText(a.options),
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

// ── Toggle active ─────────────────────────────────────────────────────────────

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

export async function bulkToggleProductActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:products") }
  catch { return { ok: false, message: "Sin permisos" } }

  const idsRaw = formData.get("ids") as string
  const activate = formData.get("activate") === "true"
  if (!idsRaw) return { ok: false, message: "IDs requeridos" }

  const ids = idsRaw.split(",").map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) return { ok: false, message: "Selecciona al menos un producto" }
  if (ids.length > 100) return { ok: false, message: "Máximo 100 productos por operación" }

  const now = new Date().toISOString()
  await db.transaction(async (tx) => {
    // A set-based UPDATE has no contractual row-lock order. Establish the
    // catalog order first so it cannot deadlock with a multi-item EPP
    // preflight holding shared product locks.
    await lockCatalogProductsForUpdateTx(tx, ids)
    await tx.update(products)
      .set({ isActive: activate, updatedAt: now })
      .where(inArray(products.id, ids))
  })

  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "update", entityType: "product", entityId: `bulk:${ids.join(",")}`,
    oldState: { isActive: !activate }, newState: { isActive: activate, count: ids.length },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `${ids.length} producto${ids.length === 1 ? "" : "s"} ${activate ? "activado" : "desactivado"}${ids.length === 1 ? "" : "s"}` }
}

// ── Product Variant Batch (EPP wizard) ─────────────────────────────────────

export async function createProductVariantBatch(input: ProductVariantBatchInput): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:products") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = productVariantBatchSchema.safeParse(input)
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data

  try {
    await db.transaction(async (tx) => {
      // 1. Create or resolve EPP family
      const category = await tx.query.productCategories.findFirst({ where: eq(productCategories.id, d.categoryId) })
      if (!category) throw new Error("Categoría no encontrada")

      let familyId: string | null = null
      if (d.isEpp) {
        const identityKey = buildEppFamilyIdentityKey({ categoryName: category.name, canonicalName: d.familyName, brand: null, model: null })
        const existingFamily = await tx.query.eppProductFamilies.findFirst({ where: eq(eppProductFamilies.identityKey, identityKey) })
        if (existingFamily) {
          familyId = existingFamily.id
        } else {
          familyId = nanoid()
          await tx.insert(eppProductFamilies).values({
            id: familyId, categoryId: d.categoryId, canonicalName: d.familyName,
            identityKey, eppType: null, brand: null, model: null,
          })
        }
      }

      // 2. Generate SKUs for all variants
      const skus = await generateUniqueSkus(d.variants.length, d.isEpp)

      // 3. Create each variant as a product
      const createdProductIds: string[] = []
      for (let i = 0; i < d.variants.length; i++) {
        const variant = d.variants[i]!
        const sku = skus[i]!
        const productId = nanoid()
        createdProductIds.push(productId)

        await tx.insert(products).values({
          id: productId, sku, name: variant.name,
          description: d.description || null,
          categoryId: d.categoryId,
          familyId,
          unitOfMeasure: d.unitOfMeasure,
          isEpp: d.isEpp,
          requiresPrevencion: d.requiresPrevencion,
          isService: d.isService,
          requiresWorker: d.requiresWorker,
          referencePrice: d.referencePrice ?? null,
          notes: d.notes || null,
          isActive: d.isActive,
        })

        if (variant.attributes.length > 0) {
          await tx.insert(productAttributes).values(
            variant.attributes.map((attr, attrIndex) => ({
              id: nanoid(), productId, categoryId: null,
              name: attr.name, type: "select", isRequired: true,
              options: JSON.stringify([attr.value]),
              sortOrder: attrIndex,
            }))
          )
        }
      }

      // 4. Assign supplier to each product
      if (d.supplier?.supplierId) {
        for (const productId of createdProductIds) {
          await tx.insert(productSuppliers).values({
            id: nanoid(),
            productId,
            supplierId: d.supplier.supplierId,
            unitPrice: d.supplier.unitPrice ?? null,
            isPreferred: true,
            notes: d.supplier.notes ?? null,
          })
        }
      }
    })

    const firstSku = (await db.query.products.findFirst({
      where: eq(products.name, d.familyName),
      orderBy: (p, { asc }) => [asc(p.createdAt)],
    }))?.sku ?? "desconocido"

    await recordAudit({
      userId: session.user.id, userEmail: session.user.email ?? undefined,
      action: "create", entityType: "product", entityId: `batch_${d.familyName}`,
      entityCode: firstSku,
      newState: { familyName: d.familyName, variantCount: d.variants.length },
      reason: "Creación por asistente EPP",
    })

    revalidatePath(REVALIDATE)
    return { ok: true, message: `${d.variants.length} producto${d.variants.length === 1 ? "" : "s"} creado${d.variants.length === 1 ? "" : "s"}` }
  } catch (error) {
    logger.error("[admin/productos] createProductVariantBatch", error)
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo crear el lote de variantes" }
  }
}
