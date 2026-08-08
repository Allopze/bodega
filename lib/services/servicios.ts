/**
 * Servicios service — thin wrapper sobre el factory compartido.
 *
 * Toda la lógica de negocio vive en lib/requests/request-service.ts.
 * Este archivo solo inyecta la configuración específica de servicios.
 */

import { serviceQuotations } from "@/db/schema"
import { SERVICE_ATTRIBUTE_NAMES } from "@/lib/validation/servicios"
import {
  createServiceQuotationPath,
  resolveServiceQuotationFile,
  resolveServiciosDir,
} from "@/lib/storage/config"
import { createRequestService } from "@/lib/requests/request-service"
import type { RequestModuleConfig } from "@/lib/requests/request-config"

const serviceConfig: RequestModuleConfig = {
  requestType:          "servicios",
  codePrefix:           "SER",
  quotationsTable:      serviceQuotations,
  quotationEntityType:  "service_quotation",
  attributeNames:       SERVICE_ATTRIBUTE_NAMES,
  storage: {
    dir:          resolveServiciosDir,
    createPath:   createServiceQuotationPath,
    resolveFile:  resolveServiceQuotationFile,
  },
}

const svc = createRequestService(serviceConfig)

export const persistServiceDraft            = svc.persistDraft
export const addServiceQuotation            = svc.addQuotation
export const deleteServiceQuotation         = svc.deleteQuotation
export const submitServiceRequest           = svc.submitRequest
export const selectServiceQuotation         = svc.selectQuotation
// ARQ-1: `cancelServiceRequest`/`getServiceQuotationsForRequest` sin
// consumidores — ver el mismo comentario en lib/services/repuestos.ts.
