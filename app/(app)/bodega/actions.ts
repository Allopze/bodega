"use server"

import { revalidatePath }    from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { applyMovement }     from "@/lib/services/warehouse"
import type { ActionState }  from "@/lib/validation/operations"

const REVALIDATE = "/bodega"

// ── Dispatch from warehouse to faena ─────────────────────────────────────────

export async function dispatchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:register_movement") }
  catch { return { ok: false, message: "Sin permisos para registrar movimientos" } }

  const warehouseId = formData.get("warehouseId") as string | null
  const productId   = formData.get("productId")   as string | null
  const qtyRaw      = formData.get("quantity")     as string | null
  const reason      = (formData.get("reason") as string | null)?.trim()
  const notes       = (formData.get("notes")  as string | null)?.trim()

  if (!warehouseId) return { ok: false, message: "Selecciona una bodega" }
  if (!productId)   return { ok: false, message: "Selecciona un producto" }

  const qty = parseFloat(qtyRaw ?? "0")
  if (isNaN(qty) || qty <= 0) {
    return { ok: false, message: "La cantidad debe ser mayor a 0" }
  }
  if (!reason) {
    return { ok: false, message: "Indica el motivo del despacho" }
  }

  try {
    await applyMovement({
      warehouseId,
      productId,
      type:        "egreso_faena",
      quantity:    -qty,          // negative = out
      referenceType: "manual_dispatch",
      performedBy: session.user.id,
      userEmail:   session.user.email ?? undefined,
      reason,
      notes: notes || undefined,
    })

    revalidatePath(REVALIDATE)
    return { ok: true, message: `Despacho registrado: ${qty} unidades` }
  } catch (e) {
    console.error("[dispatchAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al registrar despacho" }
  }
}

// ── Manual stock adjustment ───────────────────────────────────────────────────

export async function adjustStockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("warehouse:adjust_stock") }
  catch { return { ok: false, message: "Sin permisos para ajustar stock" } }

  const warehouseId = formData.get("warehouseId") as string | null
  const productId   = formData.get("productId")   as string | null
  const qtyRaw      = formData.get("quantity")     as string | null
  const type        = formData.get("type")          as string | null
  const reason      = (formData.get("reason") as string | null)?.trim()

  if (!warehouseId) return { ok: false, message: "Selecciona una bodega" }
  if (!productId)   return { ok: false, message: "Selecciona un producto" }
  if (!reason)      return { ok: false, message: "El motivo es obligatorio para ajustes" }

  const qty = parseFloat(qtyRaw ?? "0")
  if (isNaN(qty) || qty <= 0) {
    return { ok: false, message: "La cantidad debe ser mayor a 0" }
  }

  const movType = type === "ajuste_negativo" ? "ajuste_negativo" : "ajuste_positivo"
  const signedQty = movType === "ajuste_negativo" ? -qty : qty

  try {
    await applyMovement({
      warehouseId,
      productId,
      type:        movType,
      quantity:    signedQty,
      referenceType: "manual_adjustment",
      performedBy: session.user.id,
      userEmail:   session.user.email ?? undefined,
      reason,
    })

    revalidatePath(REVALIDATE)
    return { ok: true, message: "Ajuste registrado" }
  } catch (e) {
    console.error("[adjustStockAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al ajustar stock" }
  }
}
