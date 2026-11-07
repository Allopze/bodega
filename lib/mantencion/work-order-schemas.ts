import { z } from "zod"
import { REASON_MIN_LENGTH } from "@/lib/validation/reason-thresholds"
import { workOrderEntrySchema } from "./contracts"
import { OT_ITEM_MAX_PER_KIND } from "./work-order-states"

/**
 * Esquemas de las acciones web de la OT (jefatura y administración de
 * contrato). Las operaciones del teléfono usan `workOrderOpSchema` en
 * `contracts.ts`; las dos vías terminan en los mismos servicios.
 *
 * Toda acción sobre una OT existente lleva `expectedVersion`: si otra sesión la
 * cambió, el servidor responde «La OT cambió en otra sesión» en vez de pisarla.
 */

const id = z.string().min(1).max(64)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
const isoDateTime = z.string().datetime({ offset: true })
const expectedVersion = z.coerce.number().int().min(1)
const reason = z.string().trim().min(REASON_MIN_LENGTH, `Escribe un motivo de al menos ${REASON_MIN_LENGTH} caracteres.`).max(1000)
const personName = z.string().trim().min(2, "Indica el nombre de quien recibe.").max(120)

const itemList = z.array(z.string().trim().min(3, "Cada ítem necesita al menos 3 caracteres.").max(300))
  .max(OT_ITEM_MAX_PER_KIND, `Máximo ${OT_ITEM_MAX_PER_KIND} ítems por lista.`)

const requestFields = {
  repair: z.boolean(),
  maintenance: z.boolean(),
  requestDate: isoDate,
  requesterName: z.string().trim().min(2, "Indica quién solicita.").max(120),
  repairDescription: z.string().trim().max(2000).nullable(),
  observations: z.string().trim().max(2000).nullable(),
  /**
   * Costo de mano de obra o taller externo de la OT (CLP), opcional; puede quedar
   * vacío. Desde el 2026-11-07 los repuestos y servicios no van acá: se suman
   * desde las OC de las solicitudes vinculadas al equipo.
   */
  totalCost: z.number().finite().min(0).max(999_999_999).nullable().optional(),
  annexItems: itemList,
  maintenanceItems: itemList,
}

function refineRequest<T extends { repair: boolean; maintenance: boolean; repairDescription: string | null }>(data: T, ctx: z.RefinementCtx) {
  if (!data.repair && !data.maintenance) {
    ctx.addIssue({ code: "custom", path: ["repair"], message: "Marca REPARACIÓN, MANTENCIÓN o ambas." })
  }
  if (data.repair && (data.repairDescription ?? "").trim().length < 5) {
    ctx.addIssue({ code: "custom", path: ["repairDescription"], message: "Describe la reparación que se pide." })
  }
}

export const createWorkOrderSchema = z.object({
  clientRequestId: z.string().uuid(),
  vehicleId: id,
  ...requestFields,
  /** Sólo jefatura (`mant:ot:manage`): asignar al crear. */
  assignedToUserId: id.nullable(),
}).superRefine(refineRequest)
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>

export const editWorkOrderSchema = z.object({
  workOrderId: id,
  expectedVersion,
  ...requestFields,
}).superRefine(refineRequest)
export type EditWorkOrderInput = z.infer<typeof editWorkOrderSchema>

export const assignWorkOrderSchema = z.object({ workOrderId: id, expectedVersion, assignedToUserId: id })
export const unassignWorkOrderSchema = z.object({ workOrderId: id, expectedVersion })

export const startWorkOrderSchema = z.object({ workOrderId: id, expectedVersion, entry: workOrderEntrySchema })
export const updateWorkOrderEntrySchema = startWorkOrderSchema

export const changeWorkOrderEstimateSchema = z.object({
  workOrderId: id,
  expectedVersion,
  estimatedDeliveryDate: isoDate,
  reason: z.string().trim().max(1000).nullable(),
})

export const markWorkOrderItemsSchema = z.object({
  workOrderId: id,
  expectedVersion,
  marks: z.array(z.object({ itemId: id, done: z.enum(["si", "no"]), note: z.string().trim().max(300).nullable() })).max(24),
  added: z.array(z.object({ kind: z.enum(["anexo", "mantencion"]), description: z.string().trim().min(3).max(300) })).max(24),
})

export const finishWorkOrderSchema = z.object({ workOrderId: id, expectedVersion, exitAt: isoDateTime, note: z.string().trim().max(1000).nullable() })

export const receiveWorkOrderSchema = z.object({ workOrderId: id, expectedVersion, receivedAt: isoDateTime, receiverName: personName })
export const conformWorkOrderSchema = z.object({ workOrderId: id, expectedVersion, faenaReceivedAt: isoDateTime, faenaReceiverName: personName })
export const rejectWorkOrderSchema = z.object({ workOrderId: id, expectedVersion, reason })
export const voidWorkOrderSchema = z.object({ workOrderId: id, expectedVersion, reason })
export const reopenWorkOrderSchema = z.object({ workOrderId: id, expectedVersion, reason })
