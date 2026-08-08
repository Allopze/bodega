import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import {
  purchaseRequests,
  purchaseRequestItems,
  approvalDecisions,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import type { RequestModuleConfig, SelectQuotationInput } from "../request-config"

export async function selectQuotation(
  config: Pick<RequestModuleConfig, "requestType" | "quotationsTable">,
  input: SelectQuotationInput,
): Promise<void> {
  const now = new Date().toISOString()
  const requestTypeLabel = config.requestType === "repuestos" ? "repuestos" : "servicios"
  const qt = config.quotationsTable

  await db.transaction(async (tx) => {
    const request = await tx.query.purchaseRequests.findFirst({
      where: and(
        eq(purchaseRequests.id, input.requestId),
        eq(purchaseRequests.requestType, config.requestType),
      ),
    })
    if (!request) throw new Error(`Solicitud de ${requestTypeLabel} no encontrada`)
    if (!["submitted", "in_review"].includes(request.status)) {
      throw new Error("La solicitud no está pendiente de aprobación")
    }

    const scope = input.worksiteIds ?? "all"
    if (scope !== "all" && !scope.includes(request.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }

    const [quotation] = await tx
      .select()
      .from(qt)
      .where(and(
        eq(qt.id, input.quotationId),
        eq(qt.requestId, input.requestId),
      ))
      .for("update")
    if (!quotation) throw new Error("Cotización no encontrada")
    if (quotation.status !== "pending") {
      throw new Error("La cotización ya fue procesada")
    }

    const [selected] = await tx.update(qt)
      .set({ status: "selected", decidedBy: input.userId, selectedAt: now, updatedAt: now })
      .where(and(eq(qt.id, input.quotationId), eq(qt.status, "pending")))
      .returning({ id: qt.id })
    if (!selected) throw new Error("La cotización ya fue procesada")

    await tx.update(qt)
      .set({ status: "rejected", updatedAt: now })
      .where(and(
        eq(qt.requestId, input.requestId),
        eq(qt.status, "pending"),
      ))

    const winningSupplierId = quotation.supplierId ?? null

    const requestedItems = await tx
      .select({ id: purchaseRequestItems.id, requestId: purchaseRequestItems.requestId })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.requestId, input.requestId),
        eq(purchaseRequestItems.status, "requested"),
      ))

    for (const item of requestedItems) {
      const [updated] = await tx.update(purchaseRequestItems).set({
        status:              "approved",
        suggestedSupplierId: winningSupplierId,
        supplierHint:        !winningSupplierId ? (quotation.supplierNameFree ?? null) : null,
        updatedAt:           now,
      }).where(and(
        eq(purchaseRequestItems.id, item.id),
        eq(purchaseRequestItems.status, "requested"),
      )).returning({ id: purchaseRequestItems.id })

      if (!updated) continue

      await tx.insert(approvalDecisions).values({
        id:            nanoid(),
        requestItemId: item.id,
        requestId:     input.requestId,
        type:          "approve",
        decidedBy:     input.userId,
        decidedAt:     now,
        reason:        `Cotización seleccionada: ${quotation.supplierNameFree ?? quotation.supplierId ?? quotation.id}`,
        roleContext:   input.roleContext ?? null,
      })

      await recordStatusChange({
        entityType: "request_item",
        entityId:   item.id,
        fromStatus: "requested",
        toStatus:   "approved",
        changedBy:  input.userId,
      }, tx)

      await recordAudit({
        userId:     input.userId,
        userEmail:  input.userEmail,
        action:     "status_change",
        entityType: "request_item",
        entityId:   item.id,
        oldState:   { status: "requested" },
        newState:   { status: "approved", quotationId: input.quotationId },
      }, tx)
    }

    await tx.update(purchaseRequests).set({
      status:    "approved",
      updatedAt: now,
    }).where(eq(purchaseRequests.id, input.requestId))

    await recordStatusChange({
      entityType: "purchase_request",
      entityId:   input.requestId,
      fromStatus: request.status,
      toStatus:   "approved",
      changedBy:  input.userId,
    }, tx)

    await recordAudit({
      userId:     input.userId,
      userEmail:  input.userEmail,
      action:     "status_change",
      entityType: "purchase_request",
      entityId:   input.requestId,
      entityCode: request.code,
      oldState:   { status: request.status },
      newState:   { status: "approved", selectedQuotationId: input.quotationId },
    }, tx)
  })
}
