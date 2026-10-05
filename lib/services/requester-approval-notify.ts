/**
 * Aviso al solicitante cuando se termina de revisar su solicitud.
 *
 * `APR-002` (auditoría 2026-09-14) hizo que la aprobación masiva avisara igual
 * que la individual. Pero la individual avisaba **por ítem**: en producción
 * (2026-10-05) SOL-0048 se aprobó con 20 clics en ocho minutos y su solicitante
 * recibió 20 correos "Ítem aprobado en SOL-0048"; cada rechazo mandaba otro.
 *
 * CUÁNDO. Un solo aviso cuando una decisión (aprobar, modificar o rechazar,
 * individual o masiva) deja la solicitud sin ítems por revisar. Mientras quede
 * alguno pendiente no se avisa: lo ya decidido se ve en la ficha. Un ítem
 * aprobado todavía puede rechazarse; ese rechazo tardío vuelve a avisar con el
 * resumen actualizado (la llave de deduplicación es el estado resumido).
 *
 * QUÉ. Cuántos ítems se aprobaron, cuántos con la cantidad modificada, y cada
 * rechazado con su motivo: el rechazo es lo accionable para quien pidió.
 *
 * FORMA. Igual que `requester-shortfall-notify.ts`: el destinatario y el texto
 * se resuelven **dentro** de la transacción —bajo el mismo lock que la
 * decisión— y se emiten **después del commit**, para que un ROLLBACK no deje
 * avisado a nadie. Un lote que cruza solicitudes produce un aviso por cada
 * una, a su propio solicitante: nunca se mezclan destinatarios.
 */

import { createHash } from "node:crypto"
import { asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { approvalDecisions, products, purchaseRequestItems, purchaseRequests } from "@/db/schema"
import { notifyAfterCommit, notifyManyUser } from "./notifications"
import type { PendingRequesterNotification } from "./requester-shortfall-notify"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type { PendingRequesterNotification }

/** Estados en los que un ítem todavía espera decisión del aprobador. */
const UNDER_REVIEW = new Set(["draft", "requested"])
/** Rechazados que se nombran en el cuerpo; el resto se cuenta. */
const MAX_LISTED_REJECTIONS = 5

/**
 * Resuelve los avisos de las solicitudes cuya revisión quedó cerrada.
 *
 * Devuelve las notificaciones listas para emitir; no las emite. El caller las
 * suelta con `flushRequesterApprovalNotifications` una vez commiteada la
 * transacción de negocio.
 */
export async function collectReviewSummaryNoticesTx(
  tx: Tx,
  requestIds: string[],
  opts?: { reviewerName?: string },
): Promise<PendingRequesterNotification[]> {
  const ids = [...new Set(requestIds)].filter(Boolean)
  if (ids.length === 0) return []

  const requests = await tx
    .select({ id: purchaseRequests.id, code: purchaseRequests.code, requesterId: purchaseRequests.requesterId })
    .from(purchaseRequests)
    .where(inArray(purchaseRequests.id, ids))
  const items = await tx
    .select({
      id: purchaseRequestItems.id,
      requestId: purchaseRequestItems.requestId,
      status: purchaseRequestItems.status,
      name: products.name,
      nameFree: purchaseRequestItems.productNameFree,
    })
    .from(purchaseRequestItems)
    .leftJoin(products, eq(products.id, purchaseRequestItems.productId))
    .where(inArray(purchaseRequestItems.requestId, ids))
  const decisions = await tx
    .select({
      requestItemId: approvalDecisions.requestItemId,
      type: approvalDecisions.type,
      reason: approvalDecisions.reason,
    })
    .from(approvalDecisions)
    .where(inArray(approvalDecisions.requestId, ids))
    .orderBy(asc(approvalDecisions.decidedAt))

  // La última decisión de cada ítem: un rechazo tardío pisa la aprobación.
  const lastDecision = new Map<string, { type: string; reason: string | null }>()
  for (const decision of decisions) {
    if (decision.requestItemId) lastDecision.set(decision.requestItemId, decision)
  }

  const reviewer = opts?.reviewerName?.trim()
  const notices: PendingRequesterNotification[] = []
  for (const request of requests) {
    const requestItems = items.filter((item) => item.requestId === request.id)
    if (!request.requesterId || requestItems.length === 0) continue
    if (requestItems.some((item) => UNDER_REVIEW.has(item.status))) continue

    const rejected = requestItems.filter((item) => item.status === "rejected")
    const approved = requestItems.filter((item) => item.status !== "rejected")
    const modified = approved.filter((item) => lastDecision.get(item.id)?.type === "modify")

    const sentences: string[] = []
    if (approved.length > 0) {
      const modifiedNote = modified.length > 0 ? ` (${modified.length} con cantidad modificada)` : ""
      sentences.push(rejected.length === 0
        ? approved.length === 1
          ? `Se aprobó el ítem${modifiedNote}`
          : `Se aprobaron los ${approved.length} ítems${modifiedNote}`
        : `${approved.length} ${approved.length === 1 ? "ítem aprobado" : "ítems aprobados"}${modifiedNote}`)
    }
    if (rejected.length > 0) {
      const listed = rejected.slice(0, MAX_LISTED_REJECTIONS).map((item) => {
        const reason = lastDecision.get(item.id)?.reason?.trim()
        return reason ? `${itemName(item)} — ${reason}` : itemName(item)
      })
      const more = rejected.length > MAX_LISTED_REJECTIONS ? `; y ${rejected.length - MAX_LISTED_REJECTIONS} más` : ""
      sentences.push(`${rejected.length} ${rejected.length === 1 ? "rechazado" : "rechazados"}: ${listed.join("; ")}${more}`)
    }
    if (approved.length > 0) sentences.push("Lo aprobado ya está disponible para Compras")
    if (reviewer) sentences.push(`Revisión cerrada por ${reviewer}`)

    const outcome = rejected.length === 0 ? "aprobada" : approved.length === 0 ? "rechazada" : "revisada"
    // El estado resumido es la llave: reintentar la misma decisión no vuelve a
    // avisar; un rechazo tardío de un ítem aprobado sí, con el resumen nuevo.
    const state = requestItems
      .map((item) => `${item.id}:${item.status === "rejected" ? "rejected" : lastDecision.get(item.id)?.type ?? "approve"}`)
      .sort()
      .join(",")
    notices.push({
      userIds: [request.requesterId],
      input: {
        type: approved.length === 0 ? "request_rejected" : "request_approved",
        title: `Solicitud ${request.code} ${outcome}`,
        body: `${sentences.join(". ")}.`,
        entityType: "purchase_request",
        entityId: request.id,
        entityHref: `/solicitudes/${request.id}`,
        dedupeKey: `revision-solicitud:${request.id}:${createHash("sha256").update(state).digest("hex").slice(0, 16)}`,
      },
    })
  }

  return notices
}

function itemName(item: { name: string | null; nameFree: string | null }): string {
  return item.name?.trim() || item.nameFree?.trim() || "Ítem sin nombre"
}

/**
 * Emite los avisos después del commit. Fire-and-forget: `notifyManyUser` traga
 * y loguea cualquier error, así que un aviso caído nunca tumba una aprobación
 * ya commiteada.
 */
export function flushRequesterApprovalNotifications(notices: PendingRequesterNotification[]): void {
  const emitted = new Set<string>()
  for (const notice of notices) {
    for (const userId of notice.userIds) {
      const key = notice.input.dedupeKey ? `${userId}|${notice.input.dedupeKey}` : null
      if (key) {
        if (emitted.has(key)) continue
        emitted.add(key)
      }
      notifyAfterCommit(() => notifyManyUser([userId], notice.input))
    }
  }
}
