import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { fuelVehicles, purchaseRequests, purchaseRequestItems } from "@/db/schema"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { submitItemTx } from "@/lib/services/item-state"
import { getOperationalSettings } from "@/lib/services/system-settings"
import { inactiveRequestProductsMessage } from "../inactive-request-products"
import {
  estimatedRequestTotal,
  evaluateQuotationRequirement,
  fastPathCoversRequest,
  quotationRequirementMessage,
} from "../quotation-requirement"
import { assertLinkedWorkOrderOpen } from "./linked-work-order"
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

    // Se lee todo lo que la regla necesita ANTES de transicionar los ítems: el
    // estimado sale de los ítems `draft` y deja de existir una vez enviados.
    const quotations = await tx
      .select({ id: qt.id, totalAmount: qt.totalAmount })
      .from(qt)
      .where(and(
        eq(qt.requestId, input.requestId),
        eq(qt.status, "pending"),
      ))

    const items = await tx
      .select({
        id: purchaseRequestItems.id,
        quantity: purchaseRequestItems.quantity,
        estimatedUnitPrice: purchaseRequestItems.estimatedUnitPrice,
        vehicleId: purchaseRequestItems.vehicleId,
        workOrderId: purchaseRequestItems.workOrderId,
        productId: purchaseRequestItems.productId,
      })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.requestId, input.requestId),
        eq(purchaseRequestItems.status, "draft"),
      ))

    // Un producto dado de baja no entra a aprobación. Se mira aquí, bajo el
    // bloqueo de la solicitud y sobre los ítems que se van a enviar: mirarlo
    // antes en la acción dejaba una ventana para editar el borrador entre la
    // revisión y el envío.
    const inactiveMessage = await inactiveRequestProductsMessage(items.map((item) => item.productId), tx)
    if (inactiveMessage) throw new Error(inactiveMessage)

    /*
     * Regla única de cotizaciones (`quotation-requirement.ts`). Sin ninguna
     * cotización la solicitud sólo nace con salida si es de repuestos y está
     * bajo el umbral (o va por la vía rápida): se aprueba con
     * `approveWithoutQuotation`. En servicios `thresholdClp` es null y rige la
     * regla de siempre: aprobar sólo ocurre al seleccionar una ganadora, y
     * adjuntarlas exige estado 'draft', al que ya no se vuelve.
     */
    const thresholdClp = config.requestType === "repuestos"
      ? (await getOperationalSettings(tx)).repuestosQuotationThresholdClp
      : null

    // La OT vinculada se valida al guardar el borrador, pero puede haberse
    // cerrado o anulado desde entonces: la vía rápida cuelga de que siga abierta.
    const linkedOrders = new Map<string, string>()
    for (const item of items) {
      if (item.workOrderId && item.vehicleId) linkedOrders.set(item.workOrderId, item.vehicleId)
      else if (item.workOrderId) throw new Error("La OT exige elegir el equipo de flota")
    }
    for (const [workOrderId, vehicleId] of linkedOrders) {
      await assertLinkedWorkOrderOpen(tx, { workOrderId, vehicleId }, ": quita el vínculo o elige otra OT antes de enviar la solicitud")
    }

    // Vía rápida: una OT vinculada, o un equipo que no está operativo. Por ítem:
    // una línea de vía rápida no exime a las demás (`fastPathCoversRequest`).
    // Sólo se consulta la flota cuando la respuesta puede cambiar algo.
    const nonOperationalVehicles = new Set<string>()
    const vehicleIds = [...new Set(items.flatMap((item) => (item.vehicleId && !item.workOrderId ? [item.vehicleId] : [])))]
    if (thresholdClp !== null && vehicleIds.length > 0) {
      const vehicles = await tx
        .select({ id: fuelVehicles.id, operationalStatus: fuelVehicles.operationalStatus })
        .from(fuelVehicles)
        .where(inArray(fuelVehicles.id, vehicleIds))
      for (const vehicle of vehicles) if (vehicle.operationalStatus !== "operativo") nonOperationalVehicles.add(vehicle.id)
    }
    const fastPathEligible = fastPathCoversRequest(items.map((item) => ({
      quantity: item.quantity,
      estimatedUnitPrice: item.estimatedUnitPrice,
      fastPath: !!item.workOrderId || (!!item.vehicleId && nonOperationalVehicles.has(item.vehicleId)),
    })), thresholdClp)

    const verdict = evaluateQuotationRequirement({
      quotationTotals: quotations.map((quotation) => Number(quotation.totalAmount)),
      estimatedTotal: estimatedRequestTotal(items),
      thresholdClp,
      urgency: request.urgency,
      fastPathEligible,
      hasJustification: !!request.notes?.trim(),
    })
    if (!verdict.ok) throw new Error(quotationRequirementMessage(verdict.reason, thresholdClp))

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
