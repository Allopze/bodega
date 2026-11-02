"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { guardAnyPermission } from "@/lib/auth/can"
import { actionErrorResult } from "@/lib/actions/action-error-result"
import { parseZ } from "@/lib/actions/parse-z"
import type { ExportActionResult } from "@/components/ui/export-button"
import { createWorkOrderSchema } from "@/lib/mantencion/work-order-schemas"
import { actorFromSession } from "@/lib/services/mantencion/work-orders/action-support"
import { createWorkOrder } from "@/lib/services/mantencion/work-orders/create"
import { exportWorkOrders } from "@/lib/services/mantencion/work-orders/export"
import { WORK_ORDER_TABS, type WorkOrderListFilters } from "@/lib/services/mantencion/work-orders/query"
import type { ActionState } from "@/lib/validation/masters"

/**
 * Acciones de la lista de órdenes de trabajo. Cada una pide su permiso en el
 * servidor (el botón de la página sólo lo refleja) y el servicio vuelve a
 * comprobar permiso y alcance de faena: aquí no se confía en la interfaz.
 *
 * `createWorkOrderAction` es para `useActionState` con el `<form>` del Sheet
 * «Nueva OT». El formulario envía un campo `payload` con el JSON del
 * `createWorkOrderSchema` (las dos listas de ítems no caben bien en FormData
 * plano). Devuelve `data.id` para navegar al detalle.
 */

const PATH = "/mantencion/ot"

export async function createWorkOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState & { data?: { id: string; folio: string } }> {
  const guard = await guardAnyPermission(["mant:ot:create"], PATH)
  if (guard.error) return guard.error

  const raw = formData.get("payload")
  let payload: unknown
  try {
    payload = typeof raw === "string" ? JSON.parse(raw) : null
  } catch {
    payload = null
  }
  const parsed = parseZ(createWorkOrderSchema, payload)
  if (!parsed.ok) return parsed

  try {
    const result = await createWorkOrder(actorFromSession(guard.session), parsed.data)
    if (!result.ok) {
      return { ok: false, message: result.message, ...(result.field ? { fieldErrors: { [result.field]: [result.message] } } : {}) }
    }
    revalidatePath(PATH)
    revalidatePath(`/mantencion/equipos/${parsed.data.vehicleId}`)
    return { ok: true, message: `Orden de trabajo ${result.value.folio} creada.`, data: { id: result.value.id, folio: result.value.folio } }
  } catch (error) {
    return actionErrorResult(error, "No se pudo crear la orden de trabajo. Inténtalo de nuevo.")
  }
}

const exportFiltersSchema = z.object({
  tab: z.enum(WORK_ORDER_TABS),
  worksiteId: z.string().max(64).optional(),
  vehicleId: z.string().max(64).optional(),
  assignedToUserId: z.string().max(64).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().max(100).optional(),
})

/** Excel con los mismos filtros de la lista. Mismo contrato que `ExportButton` (base64). */
export async function exportWorkOrdersAction(filters: Omit<WorkOrderListFilters, "page" | "pageSize">): Promise<ExportActionResult> {
  const guard = await guardAnyPermission(["mant:ot:view_worksite", "mant:ot:view_all", "mant:ot:execute"], PATH)
  if (guard.error) return guard.error
  const parsed = exportFiltersSchema.safeParse(filters)
  if (!parsed.success) return { ok: false, message: "Los filtros de la exportación no son válidos." }
  try {
    return await exportWorkOrders({ session: guard.session, filters: parsed.data })
  } catch (error) {
    return actionErrorResult(error, "No se pudo generar el Excel. Inténtalo de nuevo.")
  }
}
