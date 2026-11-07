import { eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  purchaseRequests,
  purchaseRequestItems,
  requestItemAttributes,
  approvalDecisions,
  fuelVehicles,
  mantWorkOrders,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { OT_OPEN_STATUSES, type OtStatus } from "@/lib/mantencion/work-order-states"
import { nextCodeTx } from "@/lib/code-sequences"
import { recordAudit } from "@/lib/audit"
import type { RequestModuleConfig, RequestServiceInput } from "../request-config"
import type { Session } from "next-auth"

/**
 * Campos libres que describen el equipo. Con un equipo de flota elegido los dice
 * el registro del vehículo, así que no se guardan como atributos del ítem: dos
 * fuentes para el mismo dato terminaban contradiciéndose.
 */
const FREE_EQUIPMENT_FIELDS = new Set(["equipmentName", "patent", "brand", "model"])

/**
 * Valida el vínculo del ítem con la flota: el equipo existe, está activo y es de
 * la faena de la solicitud, y la OT —si viene— es una orden abierta de ese mismo
 * equipo. La base lo exige también (FK y CHECK), pero con mensajes que sólo
 * entiende quien mantiene el esquema.
 */
async function assertItemFleetLink(
  tx: Tx,
  worksiteId: string,
  item: { vehicleId?: string | null; workOrderId?: string | null },
): Promise<void> {
  const vehicleId = item.vehicleId?.trim() || null
  const workOrderId = item.workOrderId?.trim() || null
  if (!vehicleId) {
    if (workOrderId) throw new Error("La OT exige elegir el equipo de flota")
    return
  }

  const [vehicle] = await tx
    .select({ worksiteId: fuelVehicles.worksiteId, isActive: fuelVehicles.isActive })
    .from(fuelVehicles)
    .where(eq(fuelVehicles.id, vehicleId))
  if (!vehicle || !vehicle.isActive) throw new Error("El equipo seleccionado no existe o está inactivo")
  if (vehicle.worksiteId !== worksiteId) throw new Error("El equipo pertenece a otra faena")

  if (!workOrderId) return
  const [workOrder] = await tx
    .select({ vehicleId: mantWorkOrders.vehicleId, status: mantWorkOrders.status })
    .from(mantWorkOrders)
    .where(eq(mantWorkOrders.id, workOrderId))
  if (!workOrder || workOrder.vehicleId !== vehicleId) throw new Error("La OT no corresponde al equipo elegido")
  if (!(OT_OPEN_STATUSES as readonly OtStatus[]).includes(workOrder.status as OtStatus)) {
    throw new Error("La OT ya está cerrada o anulada")
  }
}

export async function persistDraft(
  config: Pick<RequestModuleConfig, "requestType" | "codePrefix" | "attributeNames">,
  session: Session,
  data: RequestServiceInput,
): Promise<string> {
  const isEdit = !!data.id
  const requestId = data.id ?? nanoid()
  const now = new Date().toISOString()
  const year = new Date().getFullYear()

  await db.transaction(async (tx) => {
    if (isEdit) {
      // DAT-3: lockeado — sin esto, un submitRequest concurrente puede mover
      // la solicitud a 'submitted' con ítems 'requested' justo entre esta
      // lectura y el DELETE de más abajo, que igual borraría esos ítems ya
      // enviados y crearía 'draft' nuevos bajo una solicitud que ya no lo es.
      const [existing] = await tx
        .select({ id: purchaseRequests.id, requesterId: purchaseRequests.requesterId, status: purchaseRequests.status })
        .from(purchaseRequests)
        .where(eq(purchaseRequests.id, requestId))
        .for("update")
      if (!existing) throw new Error("Solicitud no encontrada")
      if (existing.status !== "draft") {
        throw new Error("Solo se puede editar una solicitud en borrador")
      }
      if (existing.requesterId !== session.user.id) {
        throw new Error("Solo el solicitante puede editar su propia solicitud")
      }

      await tx.update(purchaseRequests).set({
        worksiteId:   data.worksiteId,
        urgency:      data.urgency,
        deliveryMode: data.deliveryMode ?? "directo_faena",
        requiredDate: data.requiredDate,
        notes:        data.justification || null,
        updatedAt:    now,
      }).where(eq(purchaseRequests.id, requestId))

      await tx.delete(approvalDecisions).where(
        eq(approvalDecisions.requestId, requestId),
      )

      await tx.delete(purchaseRequestItems).where(eq(purchaseRequestItems.requestId, requestId))
    } else {
      const code = await nextCodeTx(tx, config.codePrefix, year)
      await tx.insert(purchaseRequests).values({
        id:          requestId,
        code,
        worksiteId:  data.worksiteId,
        requesterId: session.user.id,
        requestType: config.requestType,
        urgency:     data.urgency,
        deliveryMode: data.deliveryMode ?? "directo_faena",
        requiredDate: data.requiredDate,
        notes:       data.justification || null,
        status:      "draft",
        createdAt:   now,
        updatedAt:   now,
      })

      await recordAudit({
        userId:     session.user.id,
        userEmail:  session.user.email ?? undefined,
        action:     "create",
        entityType: "purchase_request",
        entityId:   requestId,
        entityCode: code,
        newState:   { status: "draft", requestType: config.requestType },
      }, tx)
    }

    for (const [i, item] of data.items.entries()) {
      const itemId = item.id ?? nanoid()
      await assertItemFleetLink(tx, data.worksiteId, item)
      const vehicleId = item.vehicleId?.trim() || null

      await tx.insert(purchaseRequestItems).values({
        id:              itemId,
        requestId,
        productId:       null,
        productNameFree: item.description,
        quantity:        item.quantity,
        unitOfMeasure:   item.unitOfMeasure,
        status:          "draft",
        urgency:         data.urgency,
        requiredDate:    data.requiredDate,
        workerId:        null,
        sortOrder:       item.sortOrder ?? i,
        notes:           item.notes ?? null,
        vehicleId,
        workOrderId:     vehicleId ? (item.workOrderId?.trim() || null) : null,
        estimatedUnitPrice: item.estimatedUnitPrice ?? null,
        createdAt:       now,
        updatedAt:       now,
      })

      for (const [fieldName, displayName] of Object.entries(config.attributeNames)) {
        if (vehicleId && FREE_EQUIPMENT_FIELDS.has(fieldName)) continue
        const value = item[fieldName as keyof RequestServiceInput["items"][number]]
        if (typeof value === "string" && value.trim()) {
          await tx.insert(requestItemAttributes).values({
            id:            nanoid(),
            requestItemId: itemId,
            attributeId:   null,
            attributeName: displayName,
            value:         value.trim(),
          })
        }
      }
    }
  })

  return requestId
}
