"use server"

import { revalidatePath } from "next/cache"
import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { products, productAttributes, productSuppliers, productCategories, requestItemAttributes } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import { setProductSupplierPriceTx } from "@/lib/services/product-supplier-prices"
import { lockCatalogProductsForUpdateTx } from "@/lib/services/catalog-product-locks"
import { productSchema, type ActionState } from "@/lib/validation/masters"
import { safeActionMessage } from "@/lib/action-error"

import {
  formString, normalizeSelectOptions, displayOptionsText,
  generateUniqueProductSku, generateUniqueSkus,
  resolveManualEppFamily, ensureEppFamilyTx, REVALIDATE,
} from "./helpers"
import { productVariantBatchSchema, type ProductVariantBatchInput } from "./product-variant-batch.schema"
// Sólo helpers de texto/tipos: no arrastra nada de cliente ni de `@/db`.
import { normalizeProductAttributeName } from "../product-form.helpers"

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
  const sku = await generateUniqueProductSku(db, d.isEpp)

  // Mismo tratamiento que `updateProduct`: sin esto cualquier error del driver
  // salía como error de server action sin mensaje.
  try {
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
      for (const supplier of d.suppliers) {
        await setProductSupplierPriceTx(tx, {
          productId: id, supplierId: supplier.supplierId,
          unitPrice: supplier.unitPrice ?? null,
          source: "product_form", sourceId: id, userId: session.user.id,
          ensureRelation: true,
          isPreferred: supplier.isPreferred,
          notes: supplier.notes ?? null,
        })
      }
    }
  })
  } catch (e) {
    logger.error("[admin/productos] createProduct", e)
    return { ok: false, message: safeActionMessage(e, "No se pudo crear el producto") }
  }

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

  // Sin este try/catch cualquier error del driver (p.ej. el 23503 de un
  // atributo aún referenciado por una solicitud, si se cuela por la carrera)
  // escapaba como error de server action sin mensaje. `safeActionMessage` deja
  // pasar los Error de negocio y esconde el SQL de los del driver.
  try {
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

    // Los atributos se reconcilian por id en vez de borrarlos y reinsertarlos.
    // El borrado no era sólo lossy: `request_item_attributes.attribute_id`
    // apunta acá con ON DELETE no action, así que cualquier atributo que ya
    // apareció en una solicitud enviada hacía fallar el DELETE con 23503 y
    // dejaba el producto imposible de editar (28 productos en producción,
    // incluidos SRV-ALCOTEST y SRV-MONOGAS). Además reinsertar con `nanoid()`
    // rompía las referencias de las solicitudes históricas aunque el borrado
    // pasara.
    const existingAttributes = await tx.select({ id: productAttributes.id, name: productAttributes.name })
      .from(productAttributes).where(eq(productAttributes.productId, productId))
    const existingIds = new Set(existingAttributes.map((a) => a.id))

    // Sólo se acepta un id que ya pertenezca a ESTE producto: un id ajeno o
    // rancio del cliente se trata como alta, no como toma de control de otra fila.
    // Se resuelve el id de cada atributo de una vez (el existente o uno nuevo)
    // para poder referirse a ellos por id más abajo en vez de por nombre.
    const resolved = d.attributes.map((attr, i) => {
      const isExisting = !!attr.id && existingIds.has(attr.id)
      return { attr, id: isExisting ? attr.id! : nanoid(), isNew: !isExisting, sortOrder: attr.sortOrder ?? i }
    })
    const keep = resolved.filter((r) => !r.isNew)
    const insert = resolved.filter((r) => r.isNew)
    const keptIds = new Set(keep.map((r) => r.id))
    const removed = existingAttributes.filter((a) => !keptIds.has(a.id))

    if (removed.length > 0) {
      // Comprobar antes de borrar para poder nombrar el atributo culpable: el
      // 23503 crudo sólo trae el id. El catch de la action cubre la carrera.
      const referenced = await tx.select({ attributeId: requestItemAttributes.attributeId })
        .from(requestItemAttributes)
        .where(inArray(requestItemAttributes.attributeId, removed.map((a) => a.id)))
      if (referenced.length > 0) {
        const blockedIds = new Set(referenced.map((r) => r.attributeId))
        const names = removed.filter((a) => blockedIds.has(a.id)).map((a) => `«${a.name}»`)
        throw new Error(`No se puede eliminar ${names.length === 1 ? "el atributo" : "los atributos"} ${names.join(", ")}: hay solicitudes que lo${names.length === 1 ? "" : "s"} usan. Renómbralo${names.length === 1 ? "" : "s"} en vez de quitarlo${names.length === 1 ? "" : "s"}.`)
      }
      await tx.delete(productAttributes).where(inArray(productAttributes.id, removed.map((a) => a.id)))
    }

    // Dos pasadas por el índice único parcial `product_attributes_one_quantity_driver`:
    // si el driver se mueve de un atributo a otro, escribir el nuevo antes de
    // limpiar el viejo viola el índice a mitad de transacción.
    const attributeValues = ({ attr, sortOrder }: (typeof resolved)[number]) => ({
      categoryId: null, name: attr.name, type: attr.type,
      isRequired: attr.isRequired,
      options: attr.type === "select" ? normalizeSelectOptions(attr.options) : null,
      sizeFamily: attr.sizeFamily ?? null,
      sortOrder,
    })

    for (const row of keep) {
      await tx.update(productAttributes)
        .set({ ...attributeValues(row), drivesQuantity: false })
        .where(eq(productAttributes.id, row.id))
    }
    if (insert.length > 0) {
      await tx.insert(productAttributes).values(
        insert.map((row) => ({ id: row.id, productId, ...attributeValues(row), drivesQuantity: false })),
      )
    }
    // Por id y no por nombre: un match por nombre marcaría dos filas si alguna
    // vez entrara un nombre repetido, y eso viola el índice único parcial.
    const driver = resolved.find((r) => r.attr.drivesQuantity)
    if (driver) {
      await tx.update(productAttributes)
        .set({ drivesQuantity: true })
        .where(eq(productAttributes.id, driver.id))
    }

    const existingSuppliers = await tx.select().from(productSuppliers)
      .where(eq(productSuppliers.productId, productId))
    for (const supplier of d.suppliers) {
      await setProductSupplierPriceTx(tx, {
        productId, supplierId: supplier.supplierId,
        unitPrice: supplier.unitPrice ?? null,
        source: "product_form", sourceId: productId, userId: session.user.id,
        ensureRelation: true,
        isPreferred: supplier.isPreferred,
        notes: supplier.notes ?? null,
      })
    }
    const desiredSupplierIds = new Set(d.suppliers.map((supplier) => supplier.supplierId))
    for (const supplier of existingSuppliers) {
      if (desiredSupplierIds.has(supplier.supplierId)) continue
      await setProductSupplierPriceTx(tx, {
        productId,
        supplierId: supplier.supplierId,
        unitPrice: null,
        source: "product_form",
        sourceId: productId,
        userId: session.user.id,
        deleteRelationWhenNull: true,
      })
    }
  })
  } catch (e) {
    logger.error("[admin/productos] updateProduct", e)
    return { ok: false, message: safeActionMessage(e, "No se pudo actualizar el producto") }
  }

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
        orderBy: (ps, { desc }) => [desc(ps.isPreferred)],
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
      id:             a.id,
      name:           a.name,
      type:           a.type as "text" | "select" | "number" | "integer",
      isRequired:     a.isRequired,
      options:        displayOptionsText(a.options),
      sizeFamily:     a.sizeFamily ?? undefined,
      drivesQuantity: a.drivesQuantity,
      sortOrder:      a.sortOrder,
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

  // El SKU del primer producto del lote, para el audit. Antes se buscaba
  // después con `products.name === d.familyName`, que no acierta nunca: los
  // nombres de variante llevan el sufijo de talla/color, así que el audit
  // registraba "desconocido" (o el SKU de un producto ajeno que coincidiera).
  let batchFirstSku = "desconocido"

  try {
    await db.transaction(async (tx) => {
      // 1. Create or resolve EPP family
      const category = await tx.query.productCategories.findFirst({ where: eq(productCategories.id, d.categoryId) })
      if (!category) throw new Error("Categoría no encontrada")

      // La familia se crea para TODO lote de variantes, no sólo EPP: es lo que
      // agrupa las variantes en el picker de solicitudes. Sin ella
      // `groupProductVariants` cae al nombre normalizado, que ya trae el
      // sufijo de talla ("Cable 2m", "Cable 5m"), así que cada variante
      // aparecía como un producto suelto.
      let familyId: string | null = null
      if (d.variants.length > 1 || d.isEpp) {
        const family = await ensureEppFamilyTx(tx, {
          categoryId: d.categoryId, categoryName: category.name, canonicalName: d.familyName,
        })
        familyId = family.id
      }

      // 2. Generate SKUs for all variants
      const skus = await generateUniqueSkus(tx, d.variants.length, d.isEpp)
      batchFirstSku = skus[0] ?? "desconocido"

      // 3. Create each variant as a product
      const declaredByName = new Map(
        d.attributes.map((a) => [normalizeProductAttributeName(a.name), a]),
      )
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
          equipmentKind: d.equipmentKind || null,
          referencePrice: d.referencePrice ?? null,
          notes: d.notes || null,
          isActive: d.isActive,
        })

        // Los avanzados van tal cual en cada variante: tipo real, obligatoriedad
        // real y `drivesQuantity`. El índice único parcial es por producto, así
        // que un driver por variante es legal.
        if (d.advancedAttributes.length > 0) {
          await tx.insert(productAttributes).values(
            d.advancedAttributes.map((attr) => ({
              id: nanoid(), productId, categoryId: null,
              name: attr.name, type: attr.type, isRequired: attr.isRequired,
              options: null,
              drivesQuantity: attr.drivesQuantity,
              sortOrder: attr.sortOrder,
            }))
          )
        }

        if (variant.attributes.length > 0) {
          await tx.insert(productAttributes).values(
            variant.attributes.map((attr, attrIndex) => {
              const declared = declaredByName.get(normalizeProductAttributeName(attr.name))
              return {
                id: nanoid(), productId, categoryId: null,
                name: attr.name, type: "select", isRequired: true,
                options: JSON.stringify([attr.value]),
                // `d.attributes` era carga muerta: se parseaba y nunca se leía,
                // y es el único lugar por donde `sizeFamily` sobrevive el viaje
                // desde el formulario. Sin esto toda variante EPP creada por
                // lote nacía sin familia de tallas.
                sizeFamily: declared?.sizeFamily ?? null,
                sortOrder: declared?.sortOrder ?? attrIndex,
              }
            })
          )
        }
      }

      // 4. Assign supplier to each product
      if (d.supplier?.supplierId) {
        for (const productId of createdProductIds) {
          await setProductSupplierPriceTx(tx, {
            productId,
            supplierId: d.supplier.supplierId,
            unitPrice: d.supplier.unitPrice ?? null,
            source: "variant_creator",
            sourceId: productId,
            userId: session.user.id,
            ensureRelation: true,
            isPreferred: true,
            notes: d.supplier.notes ?? null,
          })
        }
      }
    })

    await recordAudit({
      userId: session.user.id, userEmail: session.user.email ?? undefined,
      action: "create", entityType: "product", entityId: `batch_${d.familyName}`,
      entityCode: batchFirstSku,
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
