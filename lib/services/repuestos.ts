/**
 * Repuestos service — thin wrapper sobre el factory compartido.
 *
 * Toda la lógica de negocio vive en lib/requests/request-service.ts.
 * Este archivo solo inyecta la configuración específica de repuestos.
 */

import { repuestoQuotations } from "@/db/schema"
import { REPUESTO_ATTRIBUTE_NAMES } from "@/lib/validation/repuestos"
import {
  createQuotationAttachmentPath,
  resolveQuotationAttachmentFile,
  resolveRepuestosDir,
} from "@/lib/storage/config"
import { createRequestService } from "@/lib/requests/request-service"
import type { RequestModuleConfig } from "@/lib/requests/request-config"

const repuestoConfig: RequestModuleConfig = {
  requestType:          "repuestos",
  codePrefix:           "REP",
  quotationsTable:      repuestoQuotations,
  quotationEntityType:  "repuesto_quotation",
  attributeNames:       REPUESTO_ATTRIBUTE_NAMES,
  storage: {
    dir:          resolveRepuestosDir,
    createPath:   createQuotationAttachmentPath,
    resolveFile:  resolveQuotationAttachmentFile,
  },
}

const svc = createRequestService(repuestoConfig)

export const persistRepuestoDraft     = svc.persistDraft
export const addQuotation             = svc.addQuotation
export const deleteQuotation          = svc.deleteQuotation
export const submitRepuestoRequest    = svc.submitRequest
export const selectRepuestoQuotation  = svc.selectQuotation
export const cancelRepuestoRequest    = svc.cancelRequest
export const getQuotationsForRequest  = svc.getQuotationsForRequest
