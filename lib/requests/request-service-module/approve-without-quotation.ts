import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import {
  purchaseRequests,
  purchaseRequestItems,
  approvalDecisions,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import type { ApproveWithoutQuotationInput, RequestModuleConfig } from "../request-config"

/** Motivo base de la decisión; el fundamento de quien aprueba, si lo hay, va a continuación. */
const DECISION_REASON = "Aprobada sin cotización (bajo umbral o vía rápida)"

/**
 * Aprueba una solicitud de repuestos que se envió sin cotización: bajo el
 * umbral (`ops.repuestos.quotation_threshold_clp`) o por la vía rápida de
 * urgencia crítica. Es el espejo de `selectQuotation` sin una oferta ganadora:
 * mismo lock del padre, mismos estados y alcance, mismas decisiones y bitácora.
 *
 * Los ítems conservan el proveedor sugerido y su precio estimado (los lee la
 * OC al prefijar el precio); no se escribe ninguna `awardedQuotation*` porque
 * no hubo adjudicación que referenciar.
 *
 * Si alguna cotización sigue pendiente, la decisión correcta es elegir la
 * ganadora: aprobar «sin cotización» dejaría ofertas vivas sin resolver y
 * borraría el rastro de contra qué se compró.
 */
export async function approveWithoutQuotation(
  config: Pick<RequestModuleConfig, "requestType" | "quotationsTable">,
  input: ApproveWithoutQuotationInput,
): Promise<void> {
  // En servicios sigue rigiendo «al menos una cotización» (el envío ya lo
  // exige), así que aprobar sin ella sería saltarse esa regla: no es una
  // vía que este servicio abra.
  if (config.requestType !== "repuestos") {
    throw new Error("Aprobar sin cotización sólo aplica a solicitudes de repuestos")
  }

  const now = new Date().toISOString()
  const qt = config.quotationsTable

  await db.transaction(async (tx) => {
    // Mismo patrón que selectQuotation y submitRequest: sin el lock del padre,
    // un cancelRequest concurrente commiteaba entremedio y el UPDATE final
    // pisaba 'cancelled' con 'approved'.
    const [request] = await tx
      .select()
      .from(purchaseRequests)
      .where(and(
        eq(purchaseRequests.id, input.requestId),
        eq(purchaseRequests.requestType, config.requestType),
      ))
      .for("update")
    if (!request) throw new Error("Solicitud de repuestos no encontrada")
    if (!["submitted", "in_review"].includes(request.status)) {
      throw new Error("La solicitud no está pendiente de aprobación")
    }

    const scope = input.worksiteIds ?? "all"
    if (scope !== "all" && !scope.includes(request.worksiteId)) {
      throw new Error("No tienes acceso a esta faena")
    }

    const [pendingQuotation] = await tx
      .select({ id: qt.id })
      .from(qt)
      .where(and(
        eq(qt.requestId, input.requestId),
        eq(qt.status, "pending"),
      ))
      .limit(1)
    if (pendingQuotation) throw new Error("Hay cotizaciones adjuntas: selecciona la ganadora")

    const justification = input.justification?.trim() || null
    const reason = justification ? `${DECISION_REASON}. Fundamento: ${justification}` : DECISION_REASON

    const requestedItems = await tx
      .select({ id: purchaseRequestItems.id })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.requestId, input.requestId),
        eq(purchaseRequestItems.status, "requested"),
      ))

    for (const item of requestedItems) {
      const [updated] = await tx.update(purchaseRequestItems).set({
        status:    "approved",
        updatedAt: now,
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
        reason,
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
        newState:   { status: "approved", withoutQuotation: true, justification },
      }, tx)
    }

    const [updatedRequest] = await tx.update(purchaseRequests).set({
      status:    "approved",
      updatedAt: now,
    }).where(and(
      eq(purchaseRequests.id, input.requestId),
      eq(purchaseRequests.status, request.status),
    )).returning({ id: purchaseRequests.id })
    if (!updatedRequest) throw new Error("La solicitud ya no está disponible: posible concurrencia")

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
      newState:   { status: "approved", withoutQuotation: true },
    }, tx)
  })
}
