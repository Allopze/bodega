"use server"

import {
  addQuotation,
  approveRepuestoWithoutQuotation,
  deleteQuotation,
  selectRepuestoQuotation,
} from "@/lib/services/repuestos"
import {
  approveWithoutQuotationSchema,
  quotationUploadSchema,
  selectQuotationSchema,
} from "@/lib/validation/repuestos"
import { createRequestActions } from "@/lib/requests/request-actions"

const actions = createRequestActions({
  permissions: {
    submit:  "repuestos:submit",
    approve: "repuestos:approve",
  },
  routePrefix: "/solicitudes",
  schemas: {
    quotationUpload:  quotationUploadSchema,
    selectQuotation:  selectQuotationSchema,
    approveWithoutQuotation: approveWithoutQuotationSchema,
  },
  services: {
    addQuotation:     addQuotation,
    deleteQuotation:  deleteQuotation,
    selectQuotation:  selectRepuestoQuotation,
    approveWithoutQuotation: approveRepuestoWithoutQuotation,
  },
  logPrefix: "repuestos",
})

export const uploadQuotationAction   = actions.uploadQuotationAction
export const deleteQuotationAction   = actions.deleteQuotationAction
export const selectQuotationAction   = actions.selectQuotationAction
export const approveWithoutQuotationAction = actions.approveWithoutQuotationAction
