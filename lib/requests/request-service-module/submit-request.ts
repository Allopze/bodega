import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { purchaseRequests, purchaseRequestItems } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { submitItemTx } from "@/lib/services/item-state"
import type { RequestModuleConfig, SubmitRequestInput } from "../request-config"

export async function submitRequest(
  config: Pick<RequestModuleConfig, "requestType" | "quotationsTable">,
  input: SubmitRequestInput,
): Promise<void> {
  const now = new Date().toISOString()
  const qt = config.quotationsTable

  await db.transaction(async (tx) => {
    // DAT-3: lockeado — sin esto, dos envíos concurrentes (o un envío en
    // carrera con un editDraft) podían pisarse: el UPDATE final no llevaba
    // ninguna guarda de estado.
    const [request] = await tx
      .select()
      .from(purchaseRequests)
      .where(and(
        eq(purchaseRequests.id, input.requestId),
        eq(purchaseRequests.requestType, config.requestType),
      ))
      .for("update")
    if (!request) throw new Error(`Solicitud de ${config.requestType === "repuestos" ? "repuestos" : "servicios"} no encontrada`)
    if (request.status !== "draft") {
      throw new Error("Solo se pueden enviar solicitudes en borrador")
    }

    const quotations = await tx
      .select({ id: qt.id })
      .from(qt)
      .where(and(
        eq(qt.requestId, input.requestId),
        eq(qt.status, "pending"),
      ))

    if (quotations.length < 3 && !request.notes?.trim()) {
      throw new Error(
        "Se requieren al menos 3 cotizaciones. Si no es posible, agrega una justificación en las notas de la solicitud.",
      )
    }

    const items = await tx
      .select({ id: purchaseRequestItems.id })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.requestId, input.requestId),
        eq(purchaseRequestItems.status, "draft"),
      ))

    for (const item of items) {
      await submitItemTx(tx, item.id, input.userId, { userEmail: input.userEmail })
    }

    const [updated] = await tx.update(purchaseRequests).set({
      status:      "submitted",
      submittedAt: now,
      updatedAt:   now,
    }).where(and(eq(purchaseRequests.id, input.requestId), eq(purchaseRequests.status, request.status)))
      .returning({ id: purchaseRequests.id })
    if (!updated) throw new Error("La solicitud ya no está disponible: posible concurrencia")

    await recordStatusChange({
      entityType: "purchase_request",
      entityId:   input.requestId,
      fromStatus: request.status,
      toStatus:   "submitted",
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
      newState:   { status: "submitted", quotationCount: quotations.length },
    }, tx)
  })
}
