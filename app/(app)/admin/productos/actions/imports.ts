"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { products, productCategories } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { logger } from "@/lib/logger"
import { cancelEppImportBatch, confirmEppImportBatch, reviewEppImportRow, stageEppImportXlsx } from "@/lib/services/epp-import"
import { parseCatalogWorkbook } from "@/lib/services/catalog-import"
import type { ActionState } from "@/lib/validation/masters"
import { nanoid } from "@/lib/id"
import { formString, generateUniqueProductSku, REVALIDATE } from "./helpers"

// ── EPP Import (Excel → review → confirm) ──────────────────────────────────────

export async function importProductsXlsx(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:epp_import_upload") }
  catch { return { ok: false, message: "Sin permisos" } }

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, fieldErrors: { file: ["Selecciona un archivo Excel"] } }
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
      message: "No se pudo analizar el Excel",
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
  } catch (error) {
    logger.error("[admin/productos] reviewEppImportRowAction", error)
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo revisar la fila" }
  }
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
  } catch (error) {
    logger.error("[admin/productos] cancelEppImportBatchAction", error)
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo cancelar el lote" }
  }
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
  } catch (error) {
    logger.error("[admin/productos] confirmEppImportBatchAction", error)
    return { ok: false, message: error instanceof Error ? error.message : "No se pudo confirmar el lote" }
  }
}

// ── Catalog Import (bulk Excel → direct create/update) ─────────────────────────

async function resolveImportCategory(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], name: string) {
  const slug = name.toLowerCase().replace(/\s+/g, "_").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  const existing = await tx.query.productCategories.findFirst({ where: eq(productCategories.slug, slug) })
  if (existing) return existing
  const id = `cat-${slug}`
  await tx.insert(productCategories).values({ id, name, slug, isEpp: false, requiresPrevencion: false, sortOrder: 10 }).onConflictDoNothing()
  return { id, name }
}

export async function importProductsFromXlsx(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("admin:products") }
  catch { return { ok: false, message: "Sin permisos" } }

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, fieldErrors: { file: ["Selecciona un archivo Excel"] } }
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
