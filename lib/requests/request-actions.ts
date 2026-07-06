/**
 * Shared request actions — factory que elimina la duplicación entre
 * las Server Actions de repuestos y servicios.
 *
 * Uso: cada módulo crea una instancia con su config y re-exporta las funciones.
 *
 *   const actions = createRequestActions(repuestoActionsConfig)
 *   export const saveDraftAction = actions.saveDraftAction
 *   // ...
 */

import { saveDraftActionImpl } from "./request-actions-draft"
import {
  submitRequestActionImpl,
  uploadQuotationActionImpl,
  deleteQuotationActionImpl,
  selectQuotationActionImpl,
  cancelRequestActionImpl,
} from "./request-actions-workflow"
import type { ActionState } from "@/lib/validation/masters"
import type { RequestActionsConfig } from "./request-actions.types"

export type { RequestActionsConfig } from "./request-actions.types"

// ── Factory ───────────────────────────────────────────────────────────────────

export function createRequestActions(config: RequestActionsConfig) {
  return {
    saveDraftAction:       (prev: ActionState, formData: FormData) => saveDraftActionImpl(config, prev, formData),
    submitRequestAction:   (prev: ActionState, formData: FormData) => submitRequestActionImpl(config, prev, formData),
    uploadQuotationAction: (prev: ActionState, formData: FormData) => uploadQuotationActionImpl(config, prev, formData),
    deleteQuotationAction: (prev: ActionState, formData: FormData) => deleteQuotationActionImpl(config, prev, formData),
    selectQuotationAction: (prev: ActionState, formData: FormData) => selectQuotationActionImpl(config, prev, formData),
    cancelRequestAction:   (prev: ActionState, formData: FormData) => cancelRequestActionImpl(config, prev, formData),
  }
}

