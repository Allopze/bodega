"use server"

/* eslint-disable @typescript-eslint/no-explicit-any -- Drizzle dynamic table types are too complex for proper typing here */

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

const actions = createRequestActions({
  moduleName: "repuestos",
  permissions: {
    create:  "repuestos:create",
    submit:  "repuestos:submit",
    approve: "repuestos:approve",
  },
  routePrefix: "/repuestos",
  schemas: {
    request:          repuestoRequestSchema,
    quotationUpload:  quotationUploadSchema,
    selectQuotation:  selectQuotationSchema,
    cancel:           cancelRepuestoSchema,
  },
  services: {
    persistDraft:     persistRepuestoDraft as any,
    addQuotation:     addQuotation as any,
    deleteQuotation:  deleteQuotation as any,
    submitRequest:    submitRepuestoRequest as any,
    selectQuotation:  selectRepuestoQuotation as any,
    cancelRequest:    cancelRepuestoRequest as any,
  },
  itemMapper: (item: any, i: number) => ({
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
