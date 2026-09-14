"use server"

import { revalidatePath } from "next/cache"
import { eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { products, productAttributes, productSuppliers, productCategories, eppProductFamilies, requestItemAttributes, purchaseRequestItems, purchaseOrderItems, inventoryMovements, deliveryItems, worksiteStock } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import { setProductSupplierPriceTx } from "@/lib/services/product-supplier-prices"
import { lockCatalogProductsForUpdateTx } from "@/lib/services/catalog-product-locks"
import { productSchema, type ActionState } from "@/lib/validation/masters"
import { safeActionMessage } from "@/lib/action-error"
import { assertIdentityStable, MasterIdentityError } from "@/lib/services/master-identity"
import { describeProductStockBlockers, productsWithStock } from "@/lib/services/product-deactivation"

/** Un booleano de formulario, dicho como lo lee una persona en el mensaje de error. */
const siNo = (value: boolean) => (value ? "sí" : "no")

import {
  formString, normalizeSelectOptions,
  generateUniqueProductSku, generateUniqueSkus,
  resolveManualEppFamily, ensureEppFamilyTx, applyEppFamilyFichaTx, REVALIDATE,
} from "./helpers"
import { resolveVariantAttributes } from "@/lib/products/variant-grouping"
import { productVariantBatchSchema, type ProductVariantBatchInput } from "./product-variant-batch.schema"
import type { AttributeRow } from "../product-form.types"
// Sólo helpers de texto/tipos: no arrastra nada de cliente ni de `@/db`.
import { normalizeProductAttributeName, parseOptionsText } from "../product-form.helpers"

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
  try {
    attributesRaw = JSON.parse(formData.get("attributesJson") as string ?? "[]")
    suppliersRaw = JSON.parse(formData.get("suppliersJson") as string ?? "[]")
  } catch { return { ok: false, message: "Los atributos o proveedores no tienen un formato válido. Recarga el formulario." } }

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
    familyCertification:         formString(formData, "familyCertification"),
    familyLifespanMonths:        formData.get("familyLifespanMonths") || null,
    familyLifespanNotApplicable: formData.get("familyLifespanNotApplicable") === "on",
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
    const family = await resolveManualEppFamily(
      tx,
      { categoryId: d.categoryId, name: d.name, isEpp: d.isEpp },
      { certification: d.familyCertification, lifespanMonths: d.familyLifespanMonths, lifespanNotApplicable: d.familyLifespanNotApplicable },
    )
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
  try {
    attributesRaw = JSON.parse(formData.get("attributesJson") as string)
    suppliersRaw = JSON.parse(formData.get("suppliersJson") as string)
  } catch { return { ok: false, message: "Los atributos o proveedores no tienen un formato válido. Recarga el formulario." } }

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
    familyCertification:         formString(formData, "familyCertification"),
    familyLifespanMonths:        formData.get("familyLifespanMonths") || null,
    familyLifespanNotApplicable: formData.get("familyLifespanNotApplicable") === "on",
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
    const lockedProduct = await tx.query.products.findFirst({ where: eq(products.id, productId) })
    if (!lockedProduct) throw new Error("Producto no encontrado")
    const oldAttributes = await tx.select().from(productAttributes).where(eq(productAttributes.productId, productId))
    const identity = (attrs: typeof d.attributes | typeof oldAttributes) => JSON.stringify(
      resolveVariantAttributes(attrs).map((a) => [normalizeProductAttributeName(a.name), a.value]).sort(),
    )
    /*
     * La sonda de historia se resuelve una sola vez y perezosamente: la usan
     * tanto la guarda de atributos como la de unidad/servicio (CAT-002), y una
     * edición de nombre o de precio no debe pagarla.
     */
    let historyProbe: Promise<boolean> | null = null
    const hasHistory = () => (historyProbe ??= tx.select({ used: sql<boolean>`
      exists(select 1 from ${purchaseRequestItems} where ${purchaseRequestItems.productId} = ${productId})
      or exists(select 1 from ${purchaseOrderItems} where ${purchaseOrderItems.productId} = ${productId})
      or exists(select 1 from ${inventoryMovements} where ${inventoryMovements.productId} = ${productId})
      or exists(select 1 from ${deliveryItems} where ${deliveryItems.productId} = ${productId} or ${deliveryItems.returnProductId} = ${productId})
      or exists(select 1 from ${worksiteStock} where ${worksiteStock.productId} = ${productId})
    ` }).from(products).where(eq(products.id, productId)).then(([row]) => Boolean(row?.used)))

    if (identity(oldAttributes) !== identity(d.attributes)) {
      if (await hasHistory()) throw new Error("No se puede cambiar la talla, color u otros valores de una variante con solicitudes, compras o inventario. Crea otra variante para conservar el historial.")
    }

    /*
     * CAT-002 (auditoría 2026-09-14): la guarda de arriba cubría los atributos
     * de identidad y dejaba pasar, en el mismo `UPDATE`, tres campos que
     * reinterpretan el inventario ya registrado.
     *
     * `worksite_stock` no guarda unidad propia, así que cambiar la unidad de
     * medida convierte 40 «unidades» en 40 «cajas» en el saldo, la valorización
     * y el kardex, hacia atrás. Marcar un producto con saldo como servicio lo
     * saca del flujo físico: la recepción deja de mover stock y la entrega lo
     * rechaza. Y `isEpp` decide si la entrega exige trabajador y acredita PDTP.
     *
     * Es el mismo criterio de tres líneas más arriba, aplicado a los campos que
     * se habían quedado fuera.
     */
    await assertIdentityStable({
      fields: [
        { key: "unitOfMeasure", label: "la unidad de medida", before: lockedProduct.unitOfMeasure, after: d.unitOfMeasure },
        { key: "isService", label: "la condición de servicio", before: siNo(lockedProduct.isService), after: siNo(d.isService) },
        { key: "isEpp", label: "la condición de EPP", before: siNo(lockedProduct.isEpp), after: siNo(d.isEpp) },
      ],
      hasHistory,
      reason: "el producto ya tiene solicitudes, compras, movimientos, entregas o inventario, y el cambio reinterpretaría hacia atrás lo ya registrado",
      remedy: "Crea otro producto y da de baja este cuando quede sin saldo.",
    })
    // Editing a variant does not create a new family or discard its metadata.
    const family = lockedProduct.familyId && lockedProduct.categoryId === d.categoryId && lockedProduct.isEpp === d.isEpp
      ? await (async () => {
          await applyEppFamilyFichaTx(tx, lockedProduct.familyId!, {
            certification: d.familyCertification,
            lifespanMonths: d.familyLifespanMonths,
            lifespanNotApplicable: d.familyLifespanNotApplicable,
          })
          return { id: lockedProduct.familyId! }
        })()
      : await resolveManualEppFamily(
          tx,
          { categoryId: d.categoryId, name: d.name, isEpp: d.isEpp },
          { certification: d.familyCertification, lifespanMonths: d.familyLifespanMonths, lifespanNotApplicable: d.familyLifespanNotApplicable },
        )
    await tx.update(products).set({
      name: d.name,
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
    // CAT-002: el bloqueo de identidad se devuelve sobre el campo que se
    // intentó cambiar, no como un error general del formulario: quien edita
    // tiene que ver dónde está el problema sin releer todo.
    if (e instanceof MasterIdentityError) {
      return {
        ok: false,
        fieldErrors: Object.fromEntries(e.fieldKeys.map((key) => [key, [e.message]])),
      }
    }
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
      options:        a.options ?? "",
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

// ── Read family for "añadir variante" ─────────────────────────────────────────

/** Snapshot de una familia para el modo "añadir variante(s)" del asistente.
 *  Devuelve la identidad de la familia (canonicalName, categoría, flags) y los
 *  ejes `select` existentes, más la firma de cada variante ya creada — el
 *  cliente la usa para no ofrecer crear una combinación repetida. */
export async function getProductFamilyForAddVariant(familyId: string) {
  try { await requirePermission("admin:products") }
  catch { return null }

  const family = await db.query.eppProductFamilies.findFirst({
    where: eq(eppProductFamilies.id, familyId),
    with: {
      category: true,
      products: {
        with: {
          productAttributes: { orderBy: (a, { asc }) => [asc(a.sortOrder)] },
          productSuppliers: {
            with: { supplier: true },
            orderBy: (ps, { desc }) => [desc(ps.isPreferred)],
          },
        },
      },
    },
  })
  if (!family) return null

  // La familia sin variantes no tiene ejes propios; los lee de cualquiera de
  // sus productos (todas las variantes de la familia comparten ejes). Los
  // valores del eje se unen a través de TODAS las variantes: cada variante
  // guarda en options sólo su propio valor (["Negro"]), así que el primer
  // producto no basta para listar todos los colores/tallas ya usados.
  const allAttrs = family.products.flatMap((p) => p.productAttributes)
  const sample = family.products[0]?.productAttributes ?? []
  const selectMap = new Map<string, { name: string; type: "select"; values: string[]; sizeFamily?: string }>()
  for (const attr of allAttrs) {
    if (attr.type !== "select") continue
    const key = normalizeProductAttributeName(attr.name)
    const existing = selectMap.get(key)
    const parsed = parseOptionsText(attr.options ?? "")
    if (existing) {
      existing.values = [...new Set([...existing.values, ...parsed])]
    } else {
      selectMap.set(key, {
        name: attr.name,
        type: "select" as const,
        values: parsed,
        sizeFamily: attr.sizeFamily ?? undefined,
      })
    }
  }
  const selectAttrs = [...selectMap.values()]

  const advancedAttrs: AttributeRow[] = sample
    .filter((a) => a.type !== "select")
    .map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type as "text" | "number" | "integer",
      isRequired: a.isRequired,
      options: a.options ?? "",
      sortOrder: a.sortOrder,
      sizeFamily: a.sizeFamily ?? undefined,
      drivesQuantity: a.drivesQuantity,
    }))

  const keys = family.products.map((product) => JSON.stringify(
    resolveVariantAttributes(product.productAttributes)
      .map((a) => [normalizeProductAttributeName(a.name), a.value])
      .sort(),
  ))

  const preferred = family.products
    .flatMap((p) => p.productSuppliers)
    .find((ps) => ps.isPreferred)
    ?? family.products[0]?.productSuppliers[0]
    ?? null

  return {
    id: family.id,
    canonicalName: family.canonicalName,
    categoryId: family.categoryId,
    categoryName: family.category?.name ?? "",
    unitOfMeasure: family.products[0]?.unitOfMeasure ?? "unidad",
    isEpp: family.products[0]?.isEpp ?? true,
    requiresPrevencion: family.products[0]?.requiresPrevencion ?? true,
    isActive: family.products[0]?.isActive ?? true,
    referencePrice: family.products[0]?.referencePrice ?? null,
    // Ficha de la familia: el asistente la muestra al añadir variantes para que
    // se vea lo que ya está declarado y se pueda completar si falta.
    certification: family.certification,
    lifespanMonths: family.lifespanMonths,
    lifespanNotApplicable: family.lifespanNotApplicable,
    attributes: selectAttrs,
    advancedAttributes: advancedAttrs,
    existingVariantKeys: keys,
    supplier: preferred ? {
      id: preferred.id,
      supplierId: preferred.supplierId,
      supplierName: preferred.supplier?.name ?? preferred.supplierId,
      unitPrice: preferred.unitPrice != null ? String(preferred.unitPrice) : "",
      isPreferred: preferred.isPreferred,
      notes: preferred.notes ?? "",
    } : null,
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

  /*
   * CAT-001 (auditoría 2026-09-14): desactivar no comprobaba nada, y un
   * producto con saldo queda inmovilizado —la entrega lo rechaza, la guía no
   * lo ofrece, la solicitud lo filtra— mientras su inventario sigue contando
   * en el kardex y en la valorización. Mismo criterio que el cierre de faena.
   */
  try {
    await db.transaction(async (tx) => {
      if (!activate) {
        await lockCatalogProductsForUpdateTx(tx, [id])
        const blockers = await productsWithStock(tx, [id])
        if (blockers.length > 0) throw new Error(describeProductStockBlockers(blockers))
      }
      await tx.update(products).set({ isActive: activate, updatedAt: new Date().toISOString() }).where(eq(products.id, id))
    })
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "No se pudo cambiar el estado del producto") }
  }

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
  try {
    await db.transaction(async (tx) => {
      // A set-based UPDATE has no contractual row-lock order. Establish the
      // catalog order first so it cannot deadlock with a multi-item EPP
      // preflight holding shared product locks.
      await lockCatalogProductsForUpdateTx(tx, ids)
      // CAT-001: el lote es donde más importa. Cien productos desactivados de
      // una vez pueden esconder cien saldos, y nadie los revisaría uno a uno.
      // O pasa el lote entero o no pasa ninguno: desactivar "los que se puedan"
      // dejaría a quien lo pidió sin saber cuáles quedaron fuera.
      if (!activate) {
        const blockers = await productsWithStock(tx, ids)
        if (blockers.length > 0) throw new Error(describeProductStockBlockers(blockers))
      }
      await tx.update(products)
        .set({ isActive: activate, updatedAt: now })
        .where(inArray(products.id, ids))
    })
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "No se pudo cambiar el estado de los productos") }
  }

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
      let familyId: string | null = d.familyId ?? null
      if (familyId) {
        // Modo añadir-variante: la familia ya existe y se reutiliza tal cual.
        // Validar dentro de la transacción (no fiarse del snapshot del cliente)
        // que la familia siga existiendo y que la combinación no esté ya creada.
        const family = await tx.query.eppProductFamilies.findFirst({ where: eq(eppProductFamilies.id, familyId) })
        if (!family) throw new Error("La familia ya no existe. Recarga el catálogo.")
        const existingProducts = await tx.query.products.findMany({
          where: eq(products.familyId, familyId),
          with: { productAttributes: true },
        })
        const existingSignatures = new Set(existingProducts.map((product) => JSON.stringify(
          resolveVariantAttributes(product.productAttributes)
            .map((a) => [normalizeProductAttributeName(a.name), a.value])
            .sort(),
        )))
        for (const variant of d.variants) {
          const signature = JSON.stringify(
            variant.attributes.map((a) => [normalizeProductAttributeName(a.name), a.value]).sort(),
          )
          if (existingSignatures.has(signature)) {
            throw new Error(`La variante «${variant.name}» ya existe en la familia. No se puede volver a crear la misma combinación.`)
          }
        }
      } else if (d.variants.length > 1 || d.isEpp) {
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
      action: "create", entityType: "product", entityId: d.familyId ? `family_${d.familyId}` : `batch_${d.familyName}`,
      entityCode: batchFirstSku,
      newState: { familyName: d.familyName, familyId: d.familyId ?? null, variantCount: d.variants.length },
      reason: d.familyId ? "Adición de variantes a familia existente" : "Creación por asistente EPP",
    })

    revalidatePath(REVALIDATE)
    return { ok: true, message: d.familyId
      ? `${d.variants.length} variante${d.variants.length === 1 ? "" : "s"} creada${d.variants.length === 1 ? "" : "s"} en la familia`
      : `${d.variants.length} producto${d.variants.length === 1 ? "" : "s"} creado${d.variants.length === 1 ? "" : "s"}` }
  } catch (error) {
    logger.error("[admin/productos] createProductVariantBatch", error)
    return { ok: false, message: safeActionMessage(error, "No se pudo crear el lote de variantes") }
  }
}
