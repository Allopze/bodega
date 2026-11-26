import { z } from "zod"
import { civilDate } from "@/lib/validation/dates"
import { REASON_MIN_LENGTH } from "@/lib/validation/reason-thresholds"
import { workOrderEntrySchema } from "./contracts"
import { ACTION_TYPES, SPECIALTIES } from "./action-type"
import { OT_ITEM_MAX_PER_KIND, OT_LABOR_HOURS_MAX } from "./work-order-states"

/**
 * Esquemas de las acciones web de la OT (jefatura y administración de
 * contrato). Las operaciones del teléfono usan `workOrderOpSchema` en
 * `contracts.ts`; las dos vías terminan en los mismos servicios.
 *
 * Toda acción sobre una OT existente lleva `expectedVersion`: si otra sesión la
 * cambió, el servidor responde «La OT cambió en otra sesión» en vez de pisarla.
 */

const id = z.string().min(1).max(64)
// `civilDate` rechaza fechas que no existen (`2026-02-31`), que la regex sola dejaba pasar.
const isoDate = civilDate("Fecha inválida")
const isoDateTime = z.string().datetime({ offset: true })
const expectedVersion = z.coerce.number().int().min(1)
const reason = z.string().trim().min(REASON_MIN_LENGTH, `Escribe un motivo de al menos ${REASON_MIN_LENGTH} caracteres.`).max(1000)
const personName = z.string().trim().min(2, "Indica el nombre de quien recibe.").max(120)

const itemList = z.array(z.string().trim().min(3, "Cada ítem necesita al menos 3 caracteres.").max(300))
  .max(OT_ITEM_MAX_PER_KIND, `Máximo ${OT_ITEM_MAX_PER_KIND} ítems por lista.`)

/**
 * Clasificación Trinorma (R4). Todo opcional en el esquema: que el tipo de acción sea
 * obligatorio depende de `mantencionActionTypeRequired` y lo exige el servicio
 * (`checkClassification`), no el esquema. La faena de imputación NO viaja: es la del equipo.
 */
const classificationFields = {
  actionType: z.enum(ACTION_TYPES).nullable().optional(),
  specialties: z.array(z.enum(SPECIALTIES)).max(SPECIALTIES.length).optional(),
  executionWorksiteId: id.nullable().optional(),
}

const laborHours = z.number({ error: "Indica las horas hombre como número." })
  .min(0, "Las horas hombre no pueden ser negativas.")
  .max(OT_LABOR_HOURS_MAX, `Las horas hombre no pueden pasar de ${OT_LABOR_HOURS_MAX.toLocaleString("es-CL")}.`)

const requestFields = {
  ...classificationFields,
  repair: z.boolean(),
  maintenance: z.boolean(),
  requestDate: isoDate,
  requesterName: z.string().trim().min(2, "Indica quién solicita.").max(120),
  repairDescription: z.string().trim().max(2000).nullable(),
  observations: z.string().trim().max(2000).nullable(),
  // La OT no lleva costo (decisión 2026-11-17): los repuestos y servicios se ven
  // en las OC de las solicitudes vinculadas al equipo.
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

/**
 * Los ítems de un tipo de trabajo desmarcado no viajan (OT-5): «Trabajos anexos» pertenece a
 * REPARACIÓN y «Mantenciones solicitadas» a MANTENCIÓN. Si alguien marcó un tipo, escribió ítems,
 * lo desmarcó y envió, la lista queda oculta en el formulario: guardarla dejaría ítems que nadie ve
 * y, peor, un error de validación de un campo invisible. Se descartan ANTES de validar.
 */
export function dropHiddenItems(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input
  const data = input as Record<string, unknown>
  return {
    ...data,
    ...(data.repair === false ? { annexItems: [] } : {}),
    ...(data.maintenance === false ? { maintenanceItems: [] } : {}),
  }
}

export const createWorkOrderSchema = z.preprocess(dropHiddenItems, z.object({
  clientRequestId: z.string().uuid(),
  vehicleId: id,
  ...requestFields,
  /** Sólo jefatura (`mant:ot:manage`): asignar al crear. */
  assignedToUserId: id.nullable(),
}).superRefine(refineRequest))
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>

export const editWorkOrderSchema = z.preprocess(dropHiddenItems, z.object({
  workOrderId: id,
  expectedVersion,
  ...requestFields,
}).superRefine(refineRequest))
export type EditWorkOrderInput = z.infer<typeof editWorkOrderSchema>

/**
 * «Corregir tipo de acción»: tipo de acción, especialidades, faena de ejecución y —si la OT ya pasó
 * por la salida de taller— horas hombre, con motivo. Un campo que no llega (`undefined`) se conserva;
 * `null` lo borra.
 */
export const reclassifyWorkOrderSchema = z.object({
  workOrderId: id,
  expectedVersion,
  ...classificationFields,
  laborHours: laborHours.nullable().optional(),
  reason,
})
export type ReclassifyWorkOrderInput = z.infer<typeof reclassifyWorkOrderSchema>

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

export const finishWorkOrderSchema = z.object({
  workOrderId: id,
  expectedVersion,
  exitAt: isoDateTime,
  note: z.string().trim().max(1000).nullable(),
  /** Trinorma R4: opcionales al terminar. */
  workPerformed: z.string().trim().max(4000).nullable().optional(),
  laborHours: laborHours.nullable().optional(),
})

export const receiveWorkOrderSchema = z.object({ workOrderId: id, expectedVersion, receivedAt: isoDateTime, receiverName: personName })
export const conformWorkOrderSchema = z.object({ workOrderId: id, expectedVersion, faenaReceivedAt: isoDateTime, faenaReceiverName: personName })
export const rejectWorkOrderSchema = z.object({ workOrderId: id, expectedVersion, reason })
export const voidWorkOrderSchema = z.object({ workOrderId: id, expectedVersion, reason })
export const reopenWorkOrderSchema = z.object({ workOrderId: id, expectedVersion, reason })
