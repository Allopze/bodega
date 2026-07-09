"use server"

import { revalidatePath, revalidateTag } from "next/cache"
  revalidateTag("badge-counts", { expire: 0 })
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequests, purchaseRequestItems, requestItemAttributes } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit } from "@/lib/audit"
import { canAccessWorksite, requirePermission } from "@/lib/auth/can"
import { type ActionState } from "@/lib/validation/operations"

const REVALIDATE = "/solicitudes"

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
  await db.transaction(async (tx) => {
    const code = await nextCodeTx(tx, "SOL")
    newId = nanoid()

    await tx.insert(purchaseRequests).values({
      id:           newId,
      code,
      worksiteId:   source.worksiteId,
      requesterId:  session.user.id,
      requestType:  source.requestType,
      urgency:      source.urgency,
      requiredDate: source.requiredDate ?? source.items.find((item) => item.requiredDate)?.requiredDate ?? null,
      status:       "draft",
      notes:        source.notes ? `[Duplicada de ${source.code}] ${source.notes}` : `[Duplicada de ${source.code}]`,
    })

    await recordAudit({
      userId:     session.user.id,
      userEmail:  session.user.email ?? undefined,
      action:     "create",
      entityType: "purchase_request",
      entityId:   newId,
      entityCode: code,
      newState:   { status: "draft", duplicatedFrom: sourceId, worksiteId: source.worksiteId },
    }, tx)

    for (const [i, item] of source.items.entries()) {
      const itemId = nanoid()
      await tx.insert(purchaseRequestItems).values({
        id:                  itemId,
        requestId:           newId,
        productId:           item.productId ?? null,
        productNameFree:     item.productNameFree ?? null,
        quantity:            item.quantity,
        unitOfMeasure:       item.unitOfMeasure,
        status:              "draft",
        urgency:             item.urgency,
        requiredDate:        source.requiredDate ?? item.requiredDate ?? null,
        workerId:            null,
        suggestedSupplierId: item.suggestedSupplierId ?? null,
        supplierHint:        item.supplierHint ?? null,
        sortOrder:           i,
        notes:               item.notes ?? null,
      })

      if (item.attributes.length > 0) {
        await tx.insert(requestItemAttributes).values(
          item.attributes.map((a) => ({
            id:            nanoid(),
            requestItemId: itemId,
            attributeId:   a.attributeId ?? null,
            attributeName: a.attributeName,
            value:         a.value,
          })),
        )
      }
    }
  })

  revalidatePath(REVALIDATE)
  revalidateTag("badge-counts", { expire: 0 })
  redirect(`${REVALIDATE}/${newId!}`)
}
