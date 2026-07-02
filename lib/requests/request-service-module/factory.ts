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
import { cancelRequest as cancelRequestFn } from "./cancel-request"
import { getQuotationsForRequest as getQuotationsFn } from "./get-quotations"

export function createRequestService(config: RequestModuleConfig) {
  return {
    persistDraft:      (session: Session, data: RequestServiceInput) => persistDraftFn(config, session, data),
    addQuotation:      (input: AddQuotationInput) => addQuotationFn(config, input),
    deleteQuotation:   (input: DeleteQuotationInput) => deleteQuotationFn(config, input),
    submitRequest:     (input: SubmitRequestInput) => submitRequestFn(config, input),
    selectQuotation:   (input: SelectQuotationInput) => selectQuotationFn(config, input),
    cancelRequest:     (requestId: string, userId: string, reason: string, opts?: { userEmail?: string }) =>
      cancelRequestFn(config, requestId, userId, reason, opts),
    getQuotationsForRequest: (requestId: string) => getQuotationsFn(config, requestId),
  }
}
