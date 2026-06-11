"use server"

import { redirect }      from "next/navigation"
import { revalidatePath } from "next/cache"
import { db } from "@/db"
import { purchaseOrders } from "@/db/schema"
import { eq } from "drizzle-orm"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { registerReceipt } from "@/lib/services/receiving"
import { receiptSchema, type ActionState } from "@/lib/validation/operations"
import { logger } from "@/lib/logger"

const REVALIDATE = "/recepcion"

export async function registerReceiptAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Each stage has its own permission: office reception is global, faena reception is scoped.
  const stage = formData.get("stage") === "faena" ? "faena" : "office"
  const requiredPermission = stage === "faena" ? "receiving:register_faena" : "receiving:register_office"

  let session
  try { session = await requirePermission(requiredPermission) }
  catch {
    const label = stage === "faena" ? "recepciones en faena" : "llegadas a oficina"
    return { ok: false, message: `Sin permisos para registrar ${label}` }
  }

  let itemsRaw: unknown[] = []
  try {
    itemsRaw = JSON.parse(formData.get("itemsJson") as string ?? "[]")
  } catch {
    return { ok: false, message: "Error al procesar los ítems", fieldErrors: { items: ["Formato de ítems inválido"] } }
  }

  const parsed = receiptSchema.safeParse({
    purchaseOrderId: formData.get("purchaseOrderId"),
    stage,
    worksiteId:      formData.get("worksiteId"),
    dispatchGuideNo: formData.get("dispatchGuideNo"),
    notes:           formData.get("notes"),
    items:           itemsRaw,
  })

  if (!parsed.success) {
    const flattened = parsed.error.flatten()
    return {
      ok: false,
      message: "Revisa los datos de recepción",
      fieldErrors: {
        ...flattened.fieldErrors,
        items: flattened.fieldErrors.items ?? flattened.formErrors,
      },
    }
  }

  const {
    purchaseOrderId,
    worksiteId,
    dispatchGuideNo,
    notes,
    items,
  } = parsed.data

  const order = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, purchaseOrderId),
  })
  if (!order) return { ok: false, message: "OC no encontrada" }
  // Faena reception is scoped to the OC's worksite; office reception is global.
  if (stage === "faena" && !canAccessWorksite(session, order.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta OC" }
  }

  const nonZeroItems = items.filter((i) => i.quantityReceived > 0)
  if (nonZeroItems.length === 0) {
    return { ok: false, message: "Ingresa al menos una cantidad recibida mayor a 0" }
  }

  let receiptId: string
  try {
    receiptId = await registerReceipt({
      purchaseOrderId,
      receivedBy:      session.user.id,
      userEmail:       session.user.email ?? undefined,
      stage,
      worksiteId:      worksiteId || order.worksiteId,
      dispatchGuideNo: dispatchGuideNo || null,
      notes:           notes || null,
      items:           nonZeroItems,
    })

    revalidatePath(REVALIDATE)
    revalidatePath("/compras")
    revalidatePath("/bodega")
  } catch (e) {
    logger.error("[registerReceiptAction]", e)
    return { ok: false, message: e instanceof Error ? e.message : "Error al registrar recepción" }
  }
  redirect(`/recepcion/${receiptId}`)
}
