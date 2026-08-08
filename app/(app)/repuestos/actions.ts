"use server"

import {
  addQuotation,
  deleteQuotation,
  selectRepuestoQuotation,
} from "@/lib/services/repuestos"
import {
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
  },
  services: {
    addQuotation:     addQuotation,
    deleteQuotation:  deleteQuotation,
    selectQuotation:  selectRepuestoQuotation,
  },
  logPrefix: "repuestos",
})

export const uploadQuotationAction   = actions.uploadQuotationAction
export const deleteQuotationAction   = actions.deleteQuotationAction
export const selectQuotationAction   = actions.selectQuotationAction
