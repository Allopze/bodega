"use server"

import { safeActionMessage } from "@/lib/action-error"

import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { closePhysicalInventoryCount, savePhysicalInventoryDraft } from "@/lib/services/physical-inventory"
import { registerStockDiscard, registerStockReturn } from "@/lib/services/stock"
import { registerStockDocumentTx } from "@/lib/services/stock-movement"
import { db } from "@/db"
import { worksites, worksiteStock } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import {
  returnStockSchema, adjustStockSchema,
  discardStockSchema, type ActionState,
}  from "@/lib/validation/operations"
import { logger } from "@/lib/logger"
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
    countedQuantity: formData.get("countedQuantity"),
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

  const { worksiteId, productId, countedQuantity, reason, notes } = parsed.data

  if (!canAccessWorksite(session, worksiteId)) {
    return { ok: false, message: "No tienes acceso a esta faena" }
  }

  try {
    // BOD-04 (auditoría 2026-10-05): el delta se calcula AQUÍ, dentro de la
    // transacción, contra el saldo bloqueado (`FOR UPDATE`). Un delta calculado
    // en el cliente sobre un saldo que otro movimiento ya cambió dejaba el
    // stock en un número que nadie contó. El contrato del servicio de stock
    // sigue siendo "cantidad con signo".
    const outcome = await db.transaction(async (tx) => {
      // Mismo orden de locks que `applyMovementTx` (faena y luego saldo): al
      // revés, un cierre de faena concurrente podía dejar ambas a la espera.
      await tx.select({ id: worksites.id }).from(worksites).where(eq(worksites.id, worksiteId)).for("share")
      const [stock] = await tx
        .select({ quantity: worksiteStock.quantity })
        .from(worksiteStock)
        .where(and(
          eq(worksiteStock.worksiteId, worksiteId),
          eq(worksiteStock.productId, productId),
        ))
        .for("update")
      const before = stock?.quantity ?? 0
      const delta = Math.round((countedQuantity - before) * 1000) / 1000
      if (delta === 0) {
        throw new Error(`El stock ya es ${before}: no hay nada que ajustar`)
      }
      const adjustment = await registerStockDocumentTx(tx, {
        kind: "ajuste",
        worksiteId,
        productId,
        type: "ajuste",
        quantity: delta,
        performedBy: session.user.id,
        userEmail: session.user.email ?? undefined,
        reason,
        notes: notes || undefined,
      })
      return { adjustment, before, delta }
    })

    revalidateOperationalViews([REVALIDATE])
    const { adjustment, before, delta } = outcome
    const sign = delta > 0 ? "+" : "-"
    return {
      ok: true,
      message: `Ajuste ${adjustment.code} registrado: stock ${before} → ${countedQuantity} (${sign}${Math.abs(delta)})`,
    }
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

    revalidateOperationalViews([REVALIDATE, "/seguimiento"])
    return {
      ok: true,
      message: `Conteo ${result.code} cerrado con ${result.adjustmentCount} ajuste${result.adjustmentCount === 1 ? "" : "s"}`,
    }
  } catch (e) {
    logger.error("[closePhysicalInventoryCountAction]", e)
    return { ok: false, message: safeActionMessage(e, "Error al cerrar conteo fisico") }
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
    // El borrador no mueve stock: no hay vistas operativas que revalidar.
    // (Hasta 2026-09-24, además, revalidar volvía a montar la plataforma entera
    // y se llevaba el formulario que el usuario sigue llenando.)
    return {
      ok: true,
      message: `Borrador ${result.code} guardado con ${result.itemCount} ${result.itemCount === 1 ? "producto" : "productos"}`,
    }
  } catch (e) {
    logger.error("[savePhysicalInventoryDraftAction]", e)
    return { ok: false, message: safeActionMessage(e, "Error al guardar el borrador") }
  }
}
