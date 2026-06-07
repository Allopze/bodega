"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { eq, count } from "drizzle-orm"
import type { Session } from "next-auth"
import { db } from "@/db"
import {
  purchaseRequests, purchaseRequestItems, requestItemAttributes,
} from "@/db/schema"
import { nanoid, generateCode } from "@/lib/id"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { submitItemTx } from "@/lib/services/item-state"
import { notifyManyUser, getUserIdsWithPermission } from "@/lib/services/notifications"
import { requestSchema, type ActionState } from "@/lib/validation/operations"

const REVALIDATE = "/solicitudes"

// ── Save as draft ─────────────────────────────────────────────────────────────

export async function saveDraft(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("requests:create") }
  catch { return { ok: false, message: "Sin permisos para crear solicitudes" } }

  const result = await persistDraft(session, formData)
  if (!result.ok) return result

  revalidatePath(REVALIDATE)
  return { ok: true, message: "Borrador guardado" }
}

async function persistDraft(
  session: Session,
  formData: FormData,
): Promise<ActionState & { requestId?: string }> {
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
  if (!canAccessWorksite(session, d.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena seleccionada" }
  }

  let requestId = d.id

  db.transaction((tx) => {
    if (isEdit) {
      // Verify ownership — solicitantes can only edit their own drafts
      const existing = tx.query.purchaseRequests.findFirst({
        where: eq(purchaseRequests.id, d.id!),
      }).sync()
      if (!existing) throw new Error("Solicitud no encontrada")
      if (!["draft", "returned"].includes(existing.status)) throw new Error("Solo se pueden editar solicitudes en borrador o devueltas")
      if (existing.requesterId !== session.user.id && !session.user.permissions.includes("requests:view_all")) {
        throw new Error("Solo puedes editar tus propias solicitudes")
      }

      tx.update(purchaseRequests).set({
        worksiteId:   d.worksiteId,
        costCenterId: d.costCenterId || null,
        urgency:      d.urgency,
        status:       "draft",
        notes:        d.notes || null,
        updatedAt:    new Date().toISOString(),
      }).where(eq(purchaseRequests.id, d.id!)).run()
      requestId = d.id

      // Replace all items (delete + re-insert)
      tx.delete(purchaseRequestItems).where(eq(purchaseRequestItems.requestId, d.id!)).run()
    } else {
      // Generate code: count existing + 1
      const [{ total }] = tx.select({ total: count() }).from(purchaseRequests).all()
      const code = generateCode("SOL", (total ?? 0) + 1)
      const reqId = nanoid()
      requestId = reqId

      tx.insert(purchaseRequests).values({
        id:           reqId,
        code,
        worksiteId:   d.worksiteId,
        requesterId:  session.user.id,
        costCenterId: d.costCenterId || null,
        urgency:      d.urgency,
        status:       "draft",
        notes:        d.notes || null,
      }).run()

      recordAudit({
        userId:     session.user.id,
        userEmail:  session.user.email ?? undefined,
        action:     "create",
        entityType: "purchase_request",
        entityId:   reqId,
        entityCode: code,
        newState:   { status: "draft", worksiteId: d.worksiteId },
      }, tx)
    }

    // Insert items
    for (const [i, item] of d.items.entries()) {
      const itemId = item.id ?? nanoid()
      tx.insert(purchaseRequestItems).values({
        id:              itemId,
        requestId:       requestId!,
        productId:       item.productId || null,
        productNameFree: item.productNameFree?.trim() || null,
        quantity:        item.quantity,
        unitOfMeasure:   item.unitOfMeasure,
        status:          "draft",
        urgency:         item.urgency,
        requiredDate:    item.requiredDate || null,
        workerId:        item.workerId || null,
        sortOrder:       i,
        notes:           item.notes || null,
      }).run()

      if (item.attributes.length > 0) {
        tx.insert(requestItemAttributes).values(
          item.attributes.map((a) => ({
            id:            nanoid(),
            requestItemId: itemId,
            attributeId:   a.attributeId || null,
            attributeName: a.attributeName,
            value:         a.value,
          })),
        ).run()
      }
    }
  })

  return { ok: true, message: "Borrador guardado", requestId }
}

// ── Submit for approval ───────────────────────────────────────────────────────

export async function submitRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("requests:submit") }
  catch { return { ok: false, message: "Sin permisos para enviar solicitudes" } }

  let requestId = formData.get("requestId") as string
  if (!requestId) {
    const saved = await persistDraft(session, formData)
    if (!saved.ok) return saved
    requestId = saved.requestId ?? ""
  }
  if (!requestId) return { ok: false, message: "ID de solicitud requerido" }

  const request = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, requestId),
    with:  { items: true },
  })
  if (!request) return { ok: false, message: "Solicitud no encontrada" }
  if (request.status !== "draft") return { ok: false, message: "Solo se pueden enviar solicitudes en borrador" }
  if (request.items.length === 0) return { ok: false, message: "La solicitud debe tener al menos un ítem" }
  if (request.requesterId !== session.user.id && !session.user.permissions.includes("requests:view_all")) {
    return { ok: false, message: "Solo puedes enviar tus propias solicitudes" }
  }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta solicitud" }
  }

  const now = new Date().toISOString()

  db.transaction((tx) => {
    // Transition the request to submitted
    tx.update(purchaseRequests).set({
      status:      "submitted",
      submittedAt: now,
      updatedAt:   now,
    }).where(eq(purchaseRequests.id, requestId)).run()

    recordStatusChange({
      entityType: "purchase_request",
      entityId:   requestId,
      fromStatus: "draft",
      toStatus:   "submitted",
      changedBy:  session.user.id,
    }, tx)
    recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "status_change",
      entityType: "purchase_request",
      entityId:   requestId,
      entityCode: request.code,
      oldState:   { status: "draft" },
      newState:   { status: "submitted" },
    }, tx)

    for (const item of request.items) {
      submitItemTx(tx, item.id, session.user.id, { userEmail: session.user.email ?? undefined })
    }
  })

  // Notify approvers (fire-and-forget — never blocks the main flow)
  void getUserIdsWithPermission("approvals:approve").then((approverIds) =>
    notifyManyUser(approverIds, {
      type:       "request_submitted",
      title:      `Nueva solicitud: ${request.code}`,
      body:       `${session.user.name ?? session.user.email} envió una solicitud con ${request.items.length} ítem${request.items.length !== 1 ? "s" : ""}`,
      entityType: "purchase_request",
      entityId:   requestId,
      entityHref: `/solicitudes/${requestId}`,
    }),
  )

  revalidatePath(REVALIDATE)
  redirect(`${REVALIDATE}/${requestId}`)
}

// ── Duplicate a request ────────────────────────────────────────────────────────

export async function duplicateRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("requests:create") }
  catch { return { ok: false, message: "Sin permisos para duplicar solicitudes" } }

  const sourceId = formData.get("requestId") as string
  if (!sourceId) return { ok: false, message: "ID de solicitud requerido" }

  const source = await db.query.purchaseRequests.findFirst({
    where: eq(purchaseRequests.id, sourceId),
    with: { items: { with: { attributes: true } } },
  })
  if (!source) return { ok: false, message: "Solicitud no encontrada" }

  const isOwner  = source.requesterId === session.user.id
  const hasViewAll = session.user.permissions.includes("requests:view_all")
  if (!isOwner && !hasViewAll) {
    return { ok: false, message: "Solo puedes duplicar tus propias solicitudes" }
  }
  if (!canAccessWorksite(session, source.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de la solicitud original" }
  }

  let newId!: string
  db.transaction((tx) => {
    const [{ total }] = tx.select({ total: count() }).from(purchaseRequests).all()
    const code = generateCode("SOL", (total ?? 0) + 1)
    newId = nanoid()

    tx.insert(purchaseRequests).values({
      id:           newId,
      code,
      worksiteId:   source.worksiteId,
      requesterId:  session.user.id,
      costCenterId: source.costCenterId ?? null,
      urgency:      source.urgency,
      status:       "draft",
      notes:        source.notes ? `[Duplicada de ${source.code}] ${source.notes}` : `[Duplicada de ${source.code}]`,
    }).run()

    recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "create",
      entityType: "purchase_request",
      entityId:   newId,
      entityCode: code,
      newState:   { status: "draft", duplicatedFrom: sourceId, worksiteId: source.worksiteId },
    })

    for (const [i, item] of source.items.entries()) {
      const itemId = nanoid()
      tx.insert(purchaseRequestItems).values({
        id:              itemId,
        requestId:       newId,
        productId:       item.productId ?? null,
        productNameFree: item.productNameFree ?? null,
        quantity:        item.quantity,
        unitOfMeasure:   item.unitOfMeasure,
        status:          "draft",
        urgency:         item.urgency,
        requiredDate:    item.requiredDate ?? null,
        workerId:        item.workerId ?? null,
        sortOrder:       i,
        notes:           item.notes ?? null,
      }).run()

      if (item.attributes.length > 0) {
        tx.insert(requestItemAttributes).values(
          item.attributes.map((a) => ({
            id:            nanoid(),
            requestItemId: itemId,
            attributeId:   a.attributeId ?? null,
            attributeName: a.attributeName,
            value:         a.value,
          })),
        ).run()
      }
    }
  })

  revalidatePath(REVALIDATE)
  redirect(`${REVALIDATE}/${newId!}`)
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
  if (request.requesterId !== session.user.id && !session.user.permissions.includes("requests:view_all")) {
    return { ok: false, message: "Solo puedes cancelar tus propias solicitudes" }
  }
  if (!canAccessWorksite(session, request.worksiteId)) {
    return { ok: false, message: "No tienes acceso a la faena de esta solicitud" }
  }

  db.transaction((tx) => {
    tx.update(purchaseRequests).set({
      status:    "cancelled",
      updatedAt: new Date().toISOString(),
    }).where(eq(purchaseRequests.id, requestId)).run()

    recordStatusChange({
      entityType: "purchase_request",
      entityId:   requestId,
      fromStatus: request.status,
      toStatus:   "cancelled",
      changedBy:  session.user.id,
    })
    recordAudit({
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
