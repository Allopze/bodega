"use server"

import { revalidatePath } from "next/cache"
import type { z } from "zod"
import { guardAnyPermission } from "@/lib/auth/can"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { parseZ } from "@/lib/actions/parse-z"
import {
  assignWorkOrderSchema, changeWorkOrderEstimateSchema, conformWorkOrderSchema, editWorkOrderSchema, finishWorkOrderSchema,
  markWorkOrderItemsSchema, receiveWorkOrderSchema, rejectWorkOrderSchema, reopenWorkOrderSchema, startWorkOrderSchema,
  unassignWorkOrderSchema, updateWorkOrderEntrySchema, voidWorkOrderSchema,
} from "@/lib/mantencion/work-order-schemas"
import {
  actorFromSession, toActionState, workOrderVehicleId, type WorkOrderActionState,
} from "@/lib/services/mantencion/work-orders/action-support"
import type { LockedResult } from "@/lib/services/mantencion/work-orders/core"
import {
  assignWorkOrder, changeWorkOrderEstimate, conformWorkOrder, editWorkOrderRequest, finishWorkOrder, markWorkOrderItems,
  receiveWorkOrder, rejectWorkOrder, reopenWorkOrder, startWorkOrder, unassignWorkOrder, updateWorkOrderEntry, voidWorkOrder,
} from "@/lib/services/mantencion/work-orders/transitions"
import type { WorkOrderActor } from "@/lib/services/mantencion/work-orders/types"
import type { Permission } from "@/modules/permissions"

/**
 * Acciones sobre una OT existente. Cada una sigue el mismo camino:
 * `guardAnyPermission` (permiso grueso, en el servidor) → Zod → servicio (que
 * comprueba el permiso fino, la regla de actor y el alcance de faena bajo
 * bloqueo) → `revalidatePath`. Todas reciben el objeto ya armado (no FormData)
 * con `workOrderId` y `expectedVersion`, y devuelven `ActionState` con la
 * `data.version` nueva; si otra sesión cambió la OT, el servicio responde «La OT
 * cambió en otra sesión» en vez de pisarla.
 */

const PATH = "/mantencion/ot"

async function run<T extends { workOrderId: string }>(
  input: unknown,
  schema: z.ZodType<T>,
  permissions: Permission[],
  fallback: string,
  exec: (actor: WorkOrderActor, data: T) => Promise<LockedResult>,
): Promise<WorkOrderActionState> {
  const guard = await guardAnyPermission(permissions, PATH)
  if (guard.error) return guard.error
  const parsed = parseZ<T>(schema, input)
  if (!parsed.ok) return parsed
  try {
    const result = await exec(actorFromSession(guard.session), parsed.data)
    if (result.ok) {
      const { workOrderId } = parsed.data
      revalidatePath(PATH)
      revalidatePath(`${PATH}/${workOrderId}`)
      const vehicleId = await workOrderVehicleId(workOrderId)
      if (vehicleId) revalidatePath(`/mantencion/equipos/${vehicleId}`)
    }
    return toActionState(result)
  } catch (error) {
    return actionErrorResult(error, fallback)
  }
}

const MANAGE: Permission[] = ["mant:ot:manage"]
const EXECUTE: Permission[] = ["mant:ot:execute", "mant:ot:manage"]

export async function editWorkOrderAction(input: unknown): Promise<WorkOrderActionState> {
  return run(input, editWorkOrderSchema, ["mant:ot:manage", "mant:ot:create"], "No se pudo guardar la solicitud.", (actor, data) => editWorkOrderRequest(actor, data))
}
export async function assignWorkOrderAction(input: unknown): Promise<WorkOrderActionState> {
  return run(input, assignWorkOrderSchema, MANAGE, "No se pudo asignar la orden de trabajo.", (actor, data) => assignWorkOrder(actor, data))
}
export async function unassignWorkOrderAction(input: unknown): Promise<WorkOrderActionState> {
  return run(input, unassignWorkOrderSchema, MANAGE, "No se pudo desasignar la orden de trabajo.", (actor, data) => unassignWorkOrder(actor, data))
}
/** Registrar ingreso a taller (asignada → en_ejecucion) o corregir el ingreso ya registrado. */
export async function startWorkOrderAction(input: unknown): Promise<WorkOrderActionState> {
  return run(input, startWorkOrderSchema, EXECUTE, "No se pudo registrar el ingreso a taller.", (actor, data) => startWorkOrder(actor, data))
}
export async function updateWorkOrderEntryAction(input: unknown): Promise<WorkOrderActionState> {
  return run(input, updateWorkOrderEntrySchema, EXECUTE, "No se pudo corregir el ingreso a taller.", (actor, data) => updateWorkOrderEntry(actor, data))
}
export async function changeWorkOrderEstimateAction(input: unknown): Promise<WorkOrderActionState> {
  return run(input, changeWorkOrderEstimateSchema, EXECUTE, "No se pudo cambiar la fecha estimada.", (actor, data) => changeWorkOrderEstimate(actor, data))
}
export async function markWorkOrderItemsAction(input: unknown): Promise<WorkOrderActionState> {
  return run(input, markWorkOrderItemsSchema, EXECUTE, "No se pudieron guardar los ítems.", (actor, data) => markWorkOrderItems(actor, data))
}
/** Salida de taller (en_ejecucion → trabajo_terminado). */
export async function finishWorkOrderAction(input: unknown): Promise<WorkOrderActionState> {
  return run(input, finishWorkOrderSchema, EXECUTE, "No se pudo registrar la salida de taller.", (actor, data) => finishWorkOrder(actor, data))
}
export async function receiveWorkOrderAction(input: unknown): Promise<WorkOrderActionState> {
  return run(input, receiveWorkOrderSchema, ["mant:ot:receive"], "No se pudo registrar la recepción.", (actor, data) => receiveWorkOrder(actor, data))
}
/** Rechazo en la recepción (desde trabajo_terminado) o en la conformidad (desde recepcionada): el servicio decide por el estado. */
export async function rejectWorkOrderAction(input: unknown): Promise<WorkOrderActionState> {
  return run(input, rejectWorkOrderSchema, ["mant:ot:receive", "mant:ot:conform"], "No se pudo rechazar la orden de trabajo.", (actor, data) => rejectWorkOrder(actor, data))
}
/** Recepción en faena = conformidad; cierra la OT. */
export async function conformWorkOrderAction(input: unknown): Promise<WorkOrderActionState> {
  return run(input, conformWorkOrderSchema, ["mant:ot:conform"], "No se pudo registrar la conformidad.", (actor, data) => conformWorkOrder(actor, data))
}
export async function voidWorkOrderAction(input: unknown): Promise<WorkOrderActionState> {
  return run(input, voidWorkOrderSchema, ["mant:ot:manage", "mant:ot:create"], "No se pudo anular la orden de trabajo.", (actor, data) => voidWorkOrder(actor, data))
}
export async function reopenWorkOrderAction(input: unknown): Promise<WorkOrderActionState> {
  return run(input, reopenWorkOrderSchema, MANAGE, "No se pudo reabrir la orden de trabajo.", (actor, data) => reopenWorkOrder(actor, data))
}
