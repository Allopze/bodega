import type { RequestModuleConfig } from "../request-config"
import type { Session } from "next-auth"
import type {
  AddQuotationInput,
  DeleteQuotationInput,
  SubmitRequestInput,
  SelectQuotationInput,
  RequestServiceInput,
} from "../request-config"
import { persistDraft as persistDraftFn } from "./persist-draft"
import { addQuotation as addQuotationFn } from "./add-quotation"
import { deleteQuotation as deleteQuotationFn } from "./delete-quotation"
import { submitRequest as submitRequestFn } from "./submit-request"
import { selectQuotation as selectQuotationFn } from "./select-quotation"

/**
 * ARQ-1: ya no incluye `cancelRequest`/`getQuotationsForRequest` — sin
 * consumidores tras la unificación de cancelación (F1-1/F1-2) y la lectura
 * directa de cotizaciones en el detalle de la solicitud. La cancelación real
 * llama a lib/requests/request-service-module/cancel-request.ts directo.
 */
export function createRequestService(config: RequestModuleConfig) {
  return {
    persistDraft:      (session: Session, data: RequestServiceInput) => persistDraftFn(config, session, data),
    addQuotation:      (input: AddQuotationInput) => addQuotationFn(config, input),
    deleteQuotation:   (input: DeleteQuotationInput) => deleteQuotationFn(config, input),
    submitRequest:     (input: SubmitRequestInput) => submitRequestFn(config, input),
    selectQuotation:   (input: SelectQuotationInput) => selectQuotationFn(config, input),
  }
}
