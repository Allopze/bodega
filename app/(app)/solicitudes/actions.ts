"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { eq, count } from "drizzle-orm"
import { db } from "@/db"
import {
  purchaseRequests, purchaseRequestItems, requestItemAttributes,
} from "@/db/schema"
import { nanoid, generateCode } from "@/lib/id"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { requirePermission } from "@/lib/auth/can"
import { submitItem } from "@/lib/services/item-state"
import { requestSchema, type ActionState } from "@/lib/validation/operations"

const REVALIDATE = "/solicitudes"

// ── Save as draft ─────────────────────────────────────────────────────────────

export async function saveDraft(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("requests:create") }
  catch { return { ok: false, message: "Sin permisos para crear solicitudes" } }

  // Parse items from JSON hidden input
  let itemsRaw: unknown[] = []
  try { itemsRaw = JSON.parse(formData.get("itemsJson") as string ?? "[]") } catch { /* ignore */ }

  const parsed = requestSchema.safeParse({
    id:           formData.get("id") || undefined,
    worksiteId:   formData.get("worksiteId"),
    costCenterId: formData.get("costCenterId") || null,
    urgency:      formData.get("urgency") || "normal",
    requiredDate: formData.get("requiredDate") || null,
    notes:        formData.get("notes") || "",
    items:        itemsRaw,
  })
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  const d = parsed.data

  const isEdit = !!d.id

  await db.transaction(async (tx) => {
    if (isEdit) {
      // Verify ownership — solicitantes can only edit their own drafts
      const existing = await tx.query.purchaseRequests.findFirst({
        where: eq(purchaseRequests.id, d.id!),
      })
      if (!existing) throw new Error("Solicitud no encontrada")
      if (existing.status !== "draft") throw new Error("Solo se pueden editar solicitudes en borrador")

      await tx.update(purchaseRequests).set({
        worksiteId:   d.worksiteId,
        costCenterId: d.costCenterId || null,
        urgency:      d.urgency,
        notes:        d.notes || null,
        updatedAt:    new Date().toISOString(),
      }).where(eq(purchaseRequests.id, d.id!))

      // Replace all items (delete + re-insert)
      await tx.delete(purchaseRequestItems).where(eq(purchaseRequestItems.requestId, d.id!))
    } else {
      // Generate code: count existing + 1
      const [{ total }] = await tx.select({ total: count() }).from(purchaseRequests)
      const code = generateCode("SOL", (total ?? 0) + 1)
      const reqId = nanoid()
      d.id = reqId

      await tx.insert(purchaseRequests).values({
        id:           reqId,
        code,
        worksiteId:   d.worksiteId,
        requesterId:  session.user.id,
        costCenterId: d.costCenterId || null,
        urgency:      d.urgency,
        status:       "draft",
        notes:        d.notes || null,
      })

      await recordAudit({
        userId:     session.user.id,
        userEmail:  session.user.email ?? undefined,
        action:     "create",
        entityType: "purchase_request",
        entityId:   reqId,
        entityCode: code,
        newState:   { status: "draft", worksiteId: d.worksiteId },
      })
    }

    // Insert items
    for (const [i, item] of d.items.entries()) {
      const itemId = item.id ?? nanoid()
      await tx.insert(purchaseRequestItems).values({
        id:              itemId,
        requestId:       d.id!,
        productId:       item.productId || null,
        productNameFree: item.productNameFree || null,
        quantity:        item.quantity,
        unitOfMeasure:   item.unitOfMeasure,
        status:          "draft",
        urgency:         item.urgency,
        requiredDate:    item.requiredDate || null,
        workerId:        item.workerId || null,
        sortOrder:       i,
        notes:           item.notes || null,
      })

      if (item.attributes.length > 0) {
        await tx.insert(requestItemAttributes).values(
          item.attributes.map((a) => ({
            id:            nanoid(),
            requestItemId: itemId,
            attributeId:   a.attributeId || null,
            attributeName: a.attributeName,
            value:         a.value,
          })),
        )
      }
    }
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: "Borrador guardado" }
}

// ── Submit for approval ───────────────────────────────────────────────────────

export async function submitRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("requests:submit") }
  catch { return { ok: false, message: "Sin permisos para enviar solicitudes" } }

  const requestId = formData.get("requestId") as string
  if (!requestId) return { ok: false, message: "ID de solicitud requerido" }

  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestId),
    with:  { items: true },
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }
  if (request.status !== "draft") return { ok: false, message: "Solo se pueden enviar solicitudes en borrador" }
  if (request.items.length === 0) return { ok: false, message: "La solicitud debe tener al menos un ítem" }

  const now = new Date().toISOString()

  await db.transaction(async (tx) => {
    // Transition the request to submitted
    await tx.update(purchaseRequests).set({
      status:      "submitted",
      submittedAt: now,
      updatedAt:   now,
    }).where(eq(purchaseRequests.id, requestId))

    await recordStatusChange({
      entityType: "purchase_request",
      entityId:   requestId,
      fromStatus: "draft",
      toStatus:   "submitted",
      changedBy:  session.user.id,
    })
    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "status_change",
      entityType: "purchase_request",
      entityId:   requestId,
      entityCode: request.code,
      oldState:   { status: "draft" },
      newState:   { status: "submitted" },
    })
  })

  // Transition each item (outside the first transaction, each in its own)
  for (const item of request.items) {
    await submitItem(item.id, session.user.id, { userEmail: session.user.email ?? undefined })
  }

  revalidatePath(REVALIDATE)
  redirect(`${REVALIDATE}/${requestId}`)
}

// ── Cancel a draft ────────────────────────────────────────────────────────────

export async function cancelRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("requests:create") }
  catch { return { ok: false, message: "Sin permisos" } }

  const requestId = formData.get("requestId") as string
  if (!requestId) return { ok: false, message: "ID requerido" }

  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestId),
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }
  if (!["draft", "returned"].includes(request.status)) {
    return { ok: false, message: "No se puede cancelar una solicitud en estado " + request.status }
  }

  await db.transaction(async (tx) => {
    await tx.update(purchaseRequests).set({
      status:    "cancelled",
      updatedAt: new Date().toISOString(),
    }).where(eq(purchaseRequests.id, requestId))

    await recordStatusChange({
      entityType: "purchase_request",
      entityId:   requestId,
      fromStatus: request.status,
      toStatus:   "cancelled",
      changedBy:  session.user.id,
    })
    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "status_change",
      entityType: "purchase_request",
      entityId:   requestId,
      entityCode: request.code,
      oldState:   { status: request.status },
      newState:   { status: "cancelled" },
    })
  })

  revalidatePath(REVALIDATE)
  redirect(REVALIDATE)
}
