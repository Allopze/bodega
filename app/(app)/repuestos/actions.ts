"use server"

import {
  persistRepuestoDraft,
  addQuotation,
  deleteQuotation,
  submitRepuestoRequest,
  selectRepuestoQuotation,
  cancelRepuestoRequest,
} from "@/lib/services/repuestos"
import {
  repuestoRequestSchema,
  quotationUploadSchema,
  selectQuotationSchema,
  cancelRepuestoSchema,
} from "@/lib/validation/repuestos"
import { createRequestActions } from "@/lib/requests/request-actions"
import type { RequestItemInput } from "@/lib/requests/request-config"

const actions = createRequestActions({
  moduleName: "repuestos",
  permissions: {
    create:  "repuestos:create",
    submit:  "repuestos:submit",
    approve: "repuestos:approve",
  },
  routePrefix: "/solicitudes",
  schemas: {
    request:          repuestoRequestSchema,
    quotationUpload:  quotationUploadSchema,
    selectQuotation:  selectQuotationSchema,
    cancel:           cancelRepuestoSchema,
  },
  services: {
    persistDraft:     persistRepuestoDraft,
    addQuotation:     addQuotation,
    deleteQuotation:  deleteQuotation,
    submitRequest:    submitRepuestoRequest,
    selectQuotation:  selectRepuestoQuotation,
    cancelRequest:    cancelRepuestoRequest,
  },
  itemMapper: (item: RequestItemInput, i: number): RequestItemInput => ({
    id:            item.id,
    description:   item.description,
    quantity:      item.quantity,
    unitOfMeasure: item.unitOfMeasure,
    sortOrder:     item.sortOrder ?? i,
    notes:         item.notes,
    partNumber:    item.partNumber,
    equipmentName: item.equipmentName,
    patent:        item.patent,
    brand:         item.brand,
    model:         item.model,
  }),
  logPrefix: "repuestos",
})

export const saveDraftAction         = actions.saveDraftAction
export const submitRequestAction     = actions.submitRequestAction
export const uploadQuotationAction   = actions.uploadQuotationAction
export const deleteQuotationAction   = actions.deleteQuotationAction
export const selectQuotationAction   = actions.selectQuotationAction
export const cancelRequestAction     = actions.cancelRequestAction
