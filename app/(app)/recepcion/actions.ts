"use server"

import { redirect }      from "next/navigation"
import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { registerReceipt } from "@/lib/services/receiving"
import type { ActionState } from "@/lib/validation/operations"
import type { ReceiptItemInput } from "@/lib/services/receiving"

const REVALIDATE = "/recepcion"

export async function registerReceiptAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("receiving:register") }
  catch { return { ok: false, message: "Sin permisos para registrar recepciones" } }

  const purchaseOrderId  = formData.get("purchaseOrderId")  as string | null
  const locationType     = formData.get("locationType")     as string | null
  const worksiteId       = formData.get("worksiteId")       as string | null
  const warehouseId      = formData.get("warehouseId")      as string | null
  const dispatchGuideNo  = formData.get("dispatchGuideNo")  as string | null
  const notes            = formData.get("notes")            as string | null

  if (!purchaseOrderId) return { ok: false, message: "OC no especificada" }
  if (!locationType)    return { ok: false, message: "Tipo de destino requerido" }

  if (locationType === "warehouse" && !warehouseId) {
    return { ok: false, message: "Selecciona una bodega de destino" }
  }

  // Items JSON: [{purchaseOrderItemId, quantityReceived, quantityRejected, quantityDamaged, notes}]
  let itemsRaw: unknown[] = []
  try {
    itemsRaw = JSON.parse(formData.get("itemsJson") as string ?? "[]")
  } catch {
    return { ok: false, message: "Error al procesar los ítems" }
  }

  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    return { ok: false, message: "Ingresa las cantidades recibidas" }
  }

  const items = itemsRaw as ReceiptItemInput[]

  // Validate all quantities >= 0
  for (const item of items) {
    if (item.quantityReceived < 0) {
      return { ok: false, message: "Las cantidades no pueden ser negativas" }
    }
  }

  // Filter out zero-received items (not required to receive all)
  const nonZeroItems = items.filter((i) => i.quantityReceived > 0)
  if (nonZeroItems.length === 0) {
    return { ok: false, message: "Ingresa al menos una cantidad recibida mayor a 0" }
  }

  try {
    const receiptId = await registerReceipt({
      purchaseOrderId,
      receivedBy:      session.user.id,
      userEmail:       session.user.email ?? undefined,
      locationType:    locationType as "faena" | "warehouse",
      worksiteId:      worksiteId  || null,
      warehouseId:     warehouseId || null,
      dispatchGuideNo: dispatchGuideNo || null,
      notes:           notes || null,
      items:           nonZeroItems,
    })

    revalidatePath(REVALIDATE)
    revalidatePath("/compras")
    revalidatePath("/bodega")
    redirect(`/recepcion/${receiptId}`)
  } catch (e) {
    if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) throw e
    console.error("[registerReceiptAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al registrar recepción" }
  }
}
