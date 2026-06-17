"use server"

import {
  persistServiceDraft,
  addServiceQuotation,
  deleteServiceQuotation,
  submitServiceRequest,
  selectServiceQuotation,
  cancelServiceRequest,
} from "@/lib/services/servicios"
import {
  serviceRequestSchema,
  serviceQuotationUploadSchema,
  selectServiceQuotationSchema,
  cancelServiceSchema,
} from "@/lib/validation/servicios"
import { createRequestActions } from "@/lib/requests/request-actions"
import type { ActionState } from "@/lib/validation/masters"

const actions = createRequestActions({
  moduleName: "servicios",
  permissions: {
    create:  "servicios:create",
    submit:  "servicios:submit",
    approve: "servicios:approve",
  },
  routePrefix: "/servicios",
  schemas: {
    request:          serviceRequestSchema,
    quotationUpload:  serviceQuotationUploadSchema,
    selectQuotation:  selectServiceQuotationSchema,
    cancel:           cancelServiceSchema,
  },
  services: {
    persistDraft:     persistServiceDraft as any,
    addQuotation:     addServiceQuotation as any,
    deleteQuotation:  deleteServiceQuotation as any,
    submitRequest:    submitServiceRequest as any,
    selectQuotation:  selectServiceQuotation as any,
    cancelRequest:    cancelServiceRequest as any,
  },
  itemMapper: (item: any, i: number) => ({
    id:            item.id,
    description:   item.description,
    location:      item.location,
    quantity:      item.quantity,
    unitOfMeasure: item.unitOfMeasure,
    sortOrder:     item.sortOrder ?? i,
    notes:         item.notes,
    equipmentName: item.equipmentName,
    patent:        item.patent,
    brand:         item.brand,
    model:         item.model,
  }),
  logPrefix: "servicios",
})

export const saveDraftAction         = actions.saveDraftAction
export const submitRequestAction     = actions.submitRequestAction
export const uploadQuotationAction   = actions.uploadQuotationAction
export const deleteQuotationAction   = actions.deleteQuotationAction
export const selectQuotationAction   = actions.selectQuotationAction
export const cancelRequestAction     = actions.cancelRequestAction
