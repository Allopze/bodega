"use server"

import { revalidatePath } from "next/cache"
import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { eppProductFamilies, products, productAttributes, productSuppliers, productCategories } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import { buildEppFamilyIdentityKey, cancelEppImportBatch, confirmEppImportBatch, reviewEppImportRow, stageEppImportXlsx } from "@/lib/services/epp-import"
import { parseCatalogWorkbook } from "@/lib/services/catalog-import"
import { productSchema, productCategorySchema, type ActionState } from "@/lib/validation/masters"

const REVALIDATE = "/admin/productos"

async function generateUniqueProductSku(isEpp: boolean) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g, "X")
    const sku = `${isEpp ? "EPP" : "PRD"}-${suffix}`
    const existing = await db.query.products.findFirst({ where: eq(products.sku, sku) })
    if (!existing) return sku
  }

  throw new Error("No se pudo generar un SKU único")
}

async function resolveManualEppFamily(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], input: { categoryId: string; name: string; isEpp: boolean }) {
  if (!input.isEpp) return null
  const category = await tx.query.productCategories.findFirst({ where: eq(productCategories.id, input.categoryId) })
  if (!category) return null
  const identityKey = buildEppFamilyIdentityKey({ categoryName: category.name, canonicalName: input.name, brand: null, model: null })
  const existing = await tx.query.eppProductFamilies.findFirst({ where: eq(eppProductFamilies.identityKey, identityKey) })
  if (existing) return existing
  const id = nanoid()
  await tx.insert(eppProductFamilies).values({ id, categoryId: input.categoryId, canonicalName: input.name, identityKey, eppType: null, brand: null, model: null })
  return { id }
}

function formString(formData: FormData, name: string) {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

function normalizeSelectOptions(options: string | null | undefined): string | null {
  if (!options) return null

  let values: unknown[] | null = null
  try {
    const parsed = JSON.parse(options)
    if (Array.isArray(parsed)) values = parsed
  } catch {
    values = null
  }

  const rawItems = values ?? options.split(/[\n,]/)
  const items = rawItems
    .map((item) => String(item).trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)

  return items.length > 0 ? JSON.stringify(items) : null
}

function displayOptionsText(options: string | null): string {
  if (!options) return ""
  try {
    const parsed = JSON.parse(options)
    if (Array.isArray(parsed)) return parsed.map((item) => String(item)).join(", ")
  } catch {
    // Keep legacy comma/newline text editable as-is.
  }
  return options
}

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
    id:                 formString(formData, "id"),
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
  try { attributesRaw = JSON.parse(formData.get("attributesJson") as string ?? "[]") } catch { logger.warn("[createProduct] attributesJson inválido, se usará arreglo vacío") }
  try { suppliersRaw  = JSON.parse(formData.get("suppliersJson")  as string ?? "[]") } catch { logger.warn("[createProduct] suppliersJson inválido, se usará arreglo vacío") }

  const parsed = productSchema.safeParse({
    name:               formString(formData, "name"),
    description:        formString(formData, "description"),
    categoryId:         formString(formData, "categoryId"),
    unitOfMeasure:      formString(formData, "unitOfMeasure") || "unidad",
    isEpp:              formData.get("isEpp") === "on",
    requiresPrevencion: formData.get("requiresPrevencion") === "on",
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
    referencePrice:     formData.get("referencePrice") || null,
    notes:              formString(formData, "notes"),
    isActive:           formData.get("isActive") === "on",
    attributes:         attributesRaw,
    suppliers:          suppliersRaw,
  })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const d = parsed.data
  if (!d.id) return { ok: false, message: "ID requerido" }
  const productId = d.id // narrowed to string by the guard above

  const current = await db.query.products.findFirst({ where: eq(products.id, productId) })
  if (!current) return { ok: false, message: "Producto no encontrado" }
  const sku = current.sku

  await db.transaction(async (tx) => {
    const family = await resolveManualEppFamily(tx, { categoryId: d.categoryId, name: d.name, isEpp: d.isEpp })
    await tx.update(products).set({
      sku, name: d.name,
      description: d.description || null,
      categoryId: d.categoryId,
      familyId: family?.id ?? null,
      unitOfMeasure: d.unitOfMeasure,
      isEpp: d.isEpp,
      requiresPrevencion: d.requiresPrevencion,
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
  await db.update(products)
    .set({ isActive: activate, updatedAt: now })
    .where(inArray(products.id, ids))

  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "update", entityType: "product", entityId: `bulk:${ids.join(",")}`,
    oldState: { isActive: !activate }, newState: { isActive: activate, count: ids.length },
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: `${ids.length} producto${ids.length === 1 ? "" : "s"} ${activate ? "activado" : "desactivado"}${ids.length === 1 ? "" : "s"}` }
}

export async function importProductsXlsx(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:epp_import_upload") }
  catch { return { ok: false, message: "Sin permisos" } }

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, fieldErrors: { file: ["Selecciona un archivo XLSX"] } }
  }

  const fileName = file.name.toLocaleLowerCase("es-CL")
  if (!fileName.endsWith(".xlsx")) {
    return { ok: false, fieldErrors: { file: ["El archivo debe estar en formato .xlsx"] } }
  }

  const maxBytes = 5 * 1024 * 1024
  if (file.size > maxBytes) {
    return { ok: false, fieldErrors: { file: ["El archivo no puede superar 5 MB"] } }
  }

  const result = await stageEppImportXlsx({ buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, userId: session.user.id })
  if (!result.ok) {
    return {
      ok: false,
      message: "No se pudo analizar el XLSX",
      data: {
        errors: result.errors.slice(0, 20), totalErrors: result.errors.length,
      },
    }
  }
  const needsReview = result.blocked + result.pending
  return {
    ok: true,
    message: needsReview > 0
      ? `Lote de ${result.rowCount} filas: ${needsReview} necesitan revisión antes de confirmar`
      : `Lote de ${result.rowCount} filas listo para confirmar`,
    data: { batchId: result.batchId, totalRows: result.rowCount, blocked: result.blocked, pending: result.pending, ready: result.ready },
  }
}

export async function reviewEppImportRowAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try { await requirePermission("admin:epp_import_review") }
  catch { return { ok: false, message: "Sin permisos" } }
  const batchId = formString(formData, "batchId")
  const rowId = formString(formData, "rowId")
  const decision = formString(formData, "decision")
  if (!batchId || !rowId || !["create", "update", "skip"].includes(decision)) return { ok: false, message: "Decisión de revisión inválida" }
  try {
    await reviewEppImportRow({ batchId, rowId, decision: decision as "create" | "update" | "skip", targetProductId: formString(formData, "targetProductId") || null, normalizedJson: formString(formData, "normalizedJson") || undefined, reason: formString(formData, "reason") || null })
    return { ok: true, message: "Fila revisada" }
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "No se pudo revisar la fila" } }
}

export async function cancelEppImportBatchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:epp_import_confirm") }
  catch { return { ok: false, message: "Sin permisos" } }
  const batchId = formString(formData, "batchId")
  if (!batchId) return { ok: false, message: "Lote requerido" }
  try {
    await cancelEppImportBatch(batchId)
    await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "update", entityType: "epp_import_batch", entityId: batchId, oldState: { status: "review" }, newState: { status: "cancelled" }, reason: "Cancelación manual de importación EPP" })
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Lote cancelado. Puedes volver a importar el archivo." }
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "No se pudo cancelar el lote" } }
}

export async function confirmEppImportBatchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:epp_import_confirm") }
  catch { return { ok: false, message: "Sin permisos" } }
  const batchId = formString(formData, "batchId")
  if (!batchId) return { ok: false, message: "Lote requerido" }
  try {
    const result = await confirmEppImportBatch(batchId, session.user.id)
    await recordAudit({ userId: session.user.id, userEmail: session.user.email ?? undefined, action: "create", entityType: "epp_import_batch", entityId: batchId, newState: result, reason: "Confirmación humana de importación EPP" })
    revalidatePath(REVALIDATE)
    return { ok: true, message: `Lote confirmado: ${result.created} creados, ${result.updated} actualizados`, data: result }
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "No se pudo confirmar el lote" } }
}

export async function importProductsFromXlsx(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:products") }
  catch { return { ok: false, message: "Sin permisos" } }

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, fieldErrors: { file: ["Selecciona un archivo XLSX"] } }
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, fieldErrors: { file: ["El archivo debe estar en formato .xlsx"] } }
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, fieldErrors: { file: ["El archivo no puede superar 10 MB"] } }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await parseCatalogWorkbook(buffer)
  if (!result.ok) return { ok: false, message: result.errors.join("; ") }

  const activeRows = result.rows.filter((r) => r.decision !== "skip")
  const skippedRows = result.rows.filter((r) => r.decision === "skip")
  let created = 0
  let updated = 0
  const skipped = skippedRows.length

  try {
    await db.transaction(async (tx) => {
      for (const row of activeRows) {
        const v = row.values
        const name = (v["Nombre"] ?? "").trim()
        const isActive = v["Activo"]?.trim() !== "No"
        const categoryName = (v["Categoría"] ?? "Elementos de Protección Personal").trim()
        const category = await resolveImportCategory(tx, categoryName)

        if (row.decision === "update" && row.existingId) {
          updated++
          await tx.update(products).set({
            name,
            categoryId: category.id,
            description: (v["Descripción"] ?? "").trim() || null,
            unitOfMeasure: (v["Unidad"] ?? "unidad").trim(),
            isEpp: v["EPP"]?.trim() === "Sí",
            requiresPrevencion: v["Prevención"]?.trim() === "Sí",
            referencePrice: parseFloat(v["Precio ref."] ?? "") || null,
            isActive,
            updatedAt: new Date().toISOString(),
          }).where(eq(products.id, row.existingId!))
        } else {
          created++
          const sku = await generateUniqueProductSku(false)
          const id = nanoid()
          await tx.insert(products).values({
            id, sku, name,
            categoryId: category.id,
            description: (v["Descripción"] ?? "").trim() || null,
            unitOfMeasure: (v["Unidad"] ?? "unidad").trim(),
            isEpp: v["EPP"]?.trim() === "Sí",
            requiresPrevencion: v["Prevención"]?.trim() === "Sí",
            referencePrice: parseFloat(v["Precio ref."] ?? "") || null,
            isActive,
          })
        }
      }
    })
    await recordAudit({
      userId: session.user.id, userEmail: session.user.email ?? undefined,
      action: "create", entityType: "product", entityId: "import_xlsx",
      newState: { created, updated, skipped },
    })
    revalidatePath(REVALIDATE)
    const rowErrors = skippedRows.map((row) => row.error).filter((error): error is string => Boolean(error))
    return {
      ok: true,
      message: `Importados: ${created} creados, ${updated} actualizados, ${skipped} omitidos`,
      data: { created, updated, skipped, errors: rowErrors.slice(0, 20), totalErrors: rowErrors.length },
    }
  } catch (err) {
    logger.error("[admin/productos] importXlsx", err)
    return { ok: false, message: (err as Error).message }
  }
}

async function resolveImportCategory(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], name: string) {
  const slug = name.toLowerCase().replace(/\s+/g, "_").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  const existing = await tx.query.productCategories.findFirst({ where: eq(productCategories.slug, slug) })
  if (existing) return existing
  const id = `cat-${slug}`
  await tx.insert(productCategories).values({ id, name, slug, isEpp: false, requiresPrevencion: false, sortOrder: 10 }).onConflictDoNothing()
  return { id, name }
}
