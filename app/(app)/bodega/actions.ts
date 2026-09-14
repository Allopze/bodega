"use server"

import { safeActionMessage } from "@/lib/action-error"

import { db } from "@/db"
import { worksiteStock } from "@/db/schema"
import { eq, inArray } from "drizzle-orm"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { closePhysicalInventoryCount, savePhysicalInventoryDraft } from "@/lib/services/physical-inventory"
import { registerStockAdjustment, registerStockDiscard, registerStockReturn } from "@/lib/services/stock"
import {
  setMinStockSchema, setMinStockBulkSchema, returnStockSchema, adjustStockSchema,
  discardStockSchema, type ActionState,
}  from "@/lib/validation/operations"
import { logger } from "@/lib/logger"
import { recordAudit } from "@/lib/audit"
import { revalidateOperationalViews } from "@/lib/services/operational-cache"

const REVALIDATE = "/bodega"

function formValues(formData: FormData, key: string) {
  return formData.getAll(key).map((value) => String(value ?? ""))
}
/**
 * Filas efectivamente contadas del formulario de conteo físico.
 *
 * El formulario envía una fila por producto de la faena y `Number("")` es 0, así
 * que sin este filtro las filas en blanco ajustarían todo el catálogo a cero.
 */
function readCountedItems(formData: FormData) {
  const productIds = formValues(formData, "countProductId")
  const countedQuantities = formValues(formData, "countedQuantity")
  const itemNotes = formValues(formData, "itemNotes")

  return productIds
    .map((productId, index) => {
      const trimmed = countedQuantities[index]?.trim()
      return {
        productId,
        countedQuantity: trimmed !== undefined && trimmed !== "" ? Number(trimmed) : NaN,
        notes: itemNotes[index] ?? "",
      }
    })
    .filter((item) => item.productId && Number.isFinite(item.countedQuantity))
}

// ── Set minStock threshold ───────────────────────────────────────────────────

export async function setMinStockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:register_movement") }
  catch { return { ok: false, message: "Sin permisos" } }

  const parsed = setMinStockSchema.safeParse({
    stockId:  formData.get("stockId"),
    minStock: formData.get("minStock"),
  })

  if (!parsed.success) {
    return { ok: false, message: "Valor inválido" }
  }

  const { stockId, minStock } = parsed.data

  try {
    const stockRow = await db.query.worksiteStock.findFirst({ where: eq(worksiteStock.id, stockId) })
    if (!stockRow) return { ok: false, message: "Stock no encontrado" }
    if (!canAccessWorksite(session, stockRow.worksiteId)) {
      return { ok: false, message: "No tienes acceso a esta faena" }
    }

    await db.transaction(async (tx) => {
      const [lockedStock] = await tx
        .select()
        .from(worksiteStock)
        .where(eq(worksiteStock.id, stockId))
        .for("update")
      if (!lockedStock) throw new Error("Stock no encontrado")
      if (!canAccessWorksite(session, lockedStock.worksiteId)) {
        throw new Error("No tienes acceso a esta faena")
      }

      await tx.update(worksiteStock)
        .set({ minStock, updatedAt: new Date().toISOString() })
        .where(eq(worksiteStock.id, stockId))
      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "update",
        entityType: "worksite_stock",
        entityId: lockedStock.id,
        oldState: { minStock: lockedStock.minStock },
        newState: { minStock },
      }, tx)
    })
    revalidateOperationalViews([REVALIDATE])
    return { ok: true, message: `Stock mínimo actualizado a ${minStock}` }
  } catch (e) {
    logger.error("[setMinStockAction]", e)
    return { ok: false, message: "Error al actualizar stock mínimo" }
  }
}

// ── Adjust stock (manual correction) ────────────────────────────────────────

export async function adjustStockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:adjust_stock") }
  catch { return { ok: false, message: "Sin permisos para ajustar inventario" } }

  const parsed = adjustStockSchema.safeParse({
    worksiteId: formData.get("worksiteId"),
    productId:  formData.get("productId"),
    quantity:   formData.get("quantity"),
    direction:  formData.get("direction"),
    reason:     formData.get("reason"),
    notes:      formData.get("notes"),
  })

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los datos del ajuste",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const { worksiteId, productId, quantity, direction, reason, notes } = parsed.data

  if (!canAccessWorksite(session, worksiteId)) {
    return { ok: false, message: "No tienes acceso a esta faena" }
  }

  const delta = direction === "ingreso" ? quantity : -quantity

  try {
    const adjustment = await registerStockAdjustment({
      worksiteId,
      productId,
      type: "ajuste",
      quantity: delta,
      performedBy: session.user.id,
      userEmail: session.user.email ?? undefined,
      reason,
      notes: notes || undefined,
    })

    revalidateOperationalViews([REVALIDATE])
    const sign = direction === "ingreso" ? "+" : "-"
    return { ok: true, message: `Ajuste ${adjustment.code} registrado: ${sign}${quantity} unidades` }
  } catch (e) {
    logger.error("[adjustStockAction]", e)
    return { ok: false, message: safeActionMessage(e, "Error al registrar ajuste") }
  }
}

// ── Return stock to worksite ─────────────────────────────────────────────────

export async function returnStockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:register_movement") }
  catch { return { ok: false, message: "Sin permisos para registrar movimientos" } }

  const parsed = returnStockSchema.safeParse({
    deliveryItemId: formData.get("deliveryItemId"),
    quantity:   formData.get("quantity"),
    reason:     formData.get("reason"),
    notes:      formData.get("notes"),
  })

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los datos de la devolución",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const { deliveryItemId, quantity, reason, notes } = parsed.data

  try {
    const stockReturn = await registerStockReturn({
      deliveryItemId,
      quantity,
      performedBy: session.user.id,
      userEmail: session.user.email ?? undefined,
      reason,
      notes: notes || undefined,
    }, serviceWorksiteScope(session))

    revalidateOperationalViews([REVALIDATE])
    return { ok: true, message: `Devolución ${stockReturn.code} registrada: ${quantity} unidades` }
  } catch (e) {
    logger.error("[returnStockAction]", e)
    return { ok: false, message: safeActionMessage(e, "Error al registrar devolución") }
  }
}

// ── Close physical inventory count ──────────────────────────────────────────

export async function closePhysicalInventoryCountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:adjust_stock") }
  catch { return { ok: false, message: "Sin permisos para cerrar conteos fisicos" } }

  const worksiteId = String(formData.get("worksiteId") ?? "")
  const notes = String(formData.get("notes") ?? "")
  const countId = String(formData.get("countId") ?? "") || null
  const items = readCountedItems(formData)

  if (!worksiteId) {
    return { ok: false, message: "Selecciona una faena" }
  }
  if (items.length === 0) {
    return { ok: false, message: "Agrega al menos un producto al conteo" }
  }
  if (items.some((item) => !Number.isFinite(item.countedQuantity) || item.countedQuantity < 0)) {
    return { ok: false, message: "Revisa las cantidades contadas" }
  }

  try {
    const result = await closePhysicalInventoryCount(
      session,
      { countId, worksiteId, notes, items },
      serviceWorksiteScope(session),
    )

    revalidateOperationalViews([REVALIDATE, "/trazabilidad"])
    return {
      ok: true,
      message: `Conteo ${result.code} cerrado con ${result.adjustmentCount} ajuste${result.adjustmentCount === 1 ? "" : "s"}`,
    }
  } catch (e) {
    logger.error("[closePhysicalInventoryCountAction]", e)
    return { ok: false, message: safeActionMessage(e, "Error al cerrar conteo fisico") }
  }
}

// ── Set minStock in bulk (una faena completa) ───────────────────────────────

export async function setMinStockBulkAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  // Mismo permiso que la edición fila a fila: es la misma operación, en lote.
  try { session = await requirePermission("warehouse:register_movement") }
  catch { return { ok: false, message: "Sin permisos" } }

  const worksiteId = String(formData.get("worksiteId") ?? "")
  const stockIds = formValues(formData, "minStockId")
  const rawValues = formValues(formData, "minStockValue")

  // Una celda en blanco significa "no tocar". Sin este filtro `Number("")` es 0
  // y guardar el formulario pondría el umbral en cero a toda la faena.
  const items = stockIds
    .map((stockId, index) => ({ stockId, raw: rawValues[index]?.trim() ?? "" }))
    .filter((row) => row.stockId && row.raw !== "")
    .map((row) => ({ stockId: row.stockId, minStock: Number(row.raw) }))

  const parsed = setMinStockBulkSchema.safeParse({ worksiteId, items })
  if (!parsed.success) {
    return { ok: false, message: items.length === 0 ? "Escribe al menos un mínimo" : "Revisa los valores ingresados" }
  }

  if (!canAccessWorksite(session, parsed.data.worksiteId)) {
    return { ok: false, message: "No tienes acceso a esta faena" }
  }

  try {
    let changed = 0
    await db.transaction(async (tx) => {
      const ids = parsed.data.items.map((item) => item.stockId)
      const locked = await tx
        .select()
        .from(worksiteStock)
        .where(inArray(worksiteStock.id, ids))
        .for("update")
      const byId = new Map(locked.map((row) => [row.id, row]))

      for (const item of parsed.data.items) {
        const row = byId.get(item.stockId)
        if (!row) throw new Error("Alguna línea de stock ya no existe")
        // Alcance verificado fila a fila y no sólo sobre la faena del formulario:
        // los ids viajan en el cliente y podrían apuntar a otra parte.
        if (row.worksiteId !== parsed.data.worksiteId || !canAccessWorksite(session, row.worksiteId)) {
          throw new Error("No tienes acceso a esta faena")
        }
        if (row.minStock === item.minStock) continue
        changed += 1
        await tx.update(worksiteStock)
          .set({ minStock: item.minStock, updatedAt: new Date().toISOString() })
          .where(eq(worksiteStock.id, item.stockId))
        await recordAudit({
          userId: session.user.id,
          userEmail: session.user.email ?? undefined,
          action: "update",
          entityType: "worksite_stock",
          entityId: row.id,
          oldState: { minStock: row.minStock },
          newState: { minStock: item.minStock },
        }, tx)
      }
    })

    // Sólo en éxito: con `loading.tsx`, revalidar desmonta el árbol y el usuario
    // perdería lo tecleado en el resto del formulario.
    revalidateOperationalViews([REVALIDATE])
    return {
      ok: true,
      message: changed === 0
        ? "Sin cambios: los mínimos ya tenían esos valores"
        : `${changed} ${changed === 1 ? "mínimo actualizado" : "mínimos actualizados"}`,
    }
  } catch (e) {
    logger.error("[setMinStockBulkAction]", e)
    return { ok: false, message: safeActionMessage(e, "Error al guardar los mínimos") }
  }
}

// ── Discard stock (baja por desecho) ────────────────────────────────────────

export async function discardStockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:adjust_stock") }
  catch { return { ok: false, message: "Sin permisos para dar de baja existencias" } }

  const parsed = discardStockSchema.safeParse({
    worksiteId: formData.get("worksiteId"),
    productId:  formData.get("productId"),
    quantity:   formData.get("quantity"),
    reason:     formData.get("reason"),
    notes:      formData.get("notes"),
  })

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los datos de la baja",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const { worksiteId, productId, quantity, reason, notes } = parsed.data

  if (!canAccessWorksite(session, worksiteId)) {
    return { ok: false, message: "No tienes acceso a esta faena" }
  }

  try {
    const discard = await registerStockDiscard({
      worksiteId,
      productId,
      quantity,
      performedBy: session.user.id,
      userEmail: session.user.email ?? undefined,
      reason,
      notes: notes || undefined,
    })

    revalidateOperationalViews([REVALIDATE])
    // STK-001: el folio y el kardex ya no pueden divergir — el servicio rechaza
    // una baja mayor al saldo—, así que el mensaje puede afirmar la cantidad.
    return { ok: true, message: `Baja ${discard.code} registrada: ${discard.appliedQuantity} unidades` }
  } catch (e) {
    logger.error("[discardStockAction]", e)
    return { ok: false, message: safeActionMessage(e, "Error al registrar la baja") }
  }
}

// ── Save physical inventory draft ───────────────────────────────────────────

export async function savePhysicalInventoryDraftAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:adjust_stock") }
  catch { return { ok: false, message: "Sin permisos para guardar conteos" } }

  const worksiteId = String(formData.get("worksiteId") ?? "")
  const notes = String(formData.get("notes") ?? "")
  const items = readCountedItems(formData)

  if (!worksiteId) return { ok: false, message: "Selecciona una faena" }
  if (items.length === 0) return { ok: false, message: "Escribe al menos una cantidad contada" }

  try {
    const result = await savePhysicalInventoryDraft(
      session,
      { worksiteId, notes, items },
      serviceWorksiteScope(session),
    )
    // El borrador no mueve stock: no hay vistas operativas que revalidar, y
    // revalidar desmontaría el formulario que el usuario sigue llenando.
    return {
      ok: true,
      message: `Borrador ${result.code} guardado con ${result.itemCount} ${result.itemCount === 1 ? "producto" : "productos"}`,
    }
  } catch (e) {
    logger.error("[savePhysicalInventoryDraftAction]", e)
    return { ok: false, message: safeActionMessage(e, "Error al guardar el borrador") }
  }
}
