/**
 * Shared request actions — factory que elimina la duplicación entre
 * las Server Actions de repuestos y servicios.
 *
 * Uso: cada módulo crea una instancia con su config y re-exporta las funciones.
 *
 *   const actions = createRequestActions(repuestoActionsConfig)
 *   export const uploadQuotationAction = actions.uploadQuotationAction
 *   // ...
 *
 * ARQ-1: sólo quedan las tres acciones de cotización — guardar borrador,
 * enviar y cancelar viven en app/(app)/solicitudes/actions-module/, sin
 * pasar por este factory (ver el comentario de request-actions-workflow.ts).
 */

import {
  uploadQuotationActionImpl,
  deleteQuotationActionImpl,
  selectQuotationActionImpl,
} from "./request-actions-workflow"
import type { ActionState } from "@/lib/validation/masters"
import type { RequestActionsConfig } from "./request-actions.types"

export type { RequestActionsConfig } from "./request-actions.types"

// ── Factory ───────────────────────────────────────────────────────────────────

export function createRequestActions(config: RequestActionsConfig) {
  return {
    uploadQuotationAction: (prev: ActionState, formData: FormData) => uploadQuotationActionImpl(config, prev, formData),
    deleteQuotationAction: (prev: ActionState, formData: FormData) => deleteQuotationActionImpl(config, prev, formData),
    selectQuotationAction: (prev: ActionState, formData: FormData) => selectQuotationActionImpl(config, prev, formData),
  }
}

