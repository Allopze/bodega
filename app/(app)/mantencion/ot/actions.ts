"use server"

import type { ExportActionResult } from "@/components/ui/export-button"
import type { WorkOrderListFilters } from "@/lib/services/mantencion/work-orders/query"
import type { ActionState } from "@/lib/validation/masters"

/**
 * Fase 0: firmas fijas. Implementa L1; las usa la jefatura (L3).
 *
 * `createWorkOrderAction` es para `useActionState` con el `<form>` del Sheet
 * «Nueva OT». El formulario envía un campo `payload` con el JSON del
 * `createWorkOrderSchema` (las dos listas de ítems no caben bien en FormData
 * plano). Devuelve `data.id` para navegar al detalle.
 */
export async function createWorkOrderAction(_prev: ActionState, _formData: FormData): Promise<ActionState & { data?: { id: string; folio: string } }> {
  return { ok: false, message: "No implementado (fase 0)" }
}

/** Excel con los mismos filtros de la lista. Mismo contrato que `ExportButton` (base64). */
export async function exportWorkOrdersAction(_filters: Omit<WorkOrderListFilters, "page" | "pageSize">): Promise<ExportActionResult> {
  return { ok: false, message: "No implementado (fase 0)" }
}
