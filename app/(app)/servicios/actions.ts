"use server"

import {
  addServiceQuotation,
  deleteServiceQuotation,
  selectServiceQuotation,
} from "@/lib/services/servicios"
import {
  serviceQuotationUploadSchema,
  selectServiceQuotationSchema,
} from "@/lib/validation/servicios"
import { createRequestActions } from "@/lib/requests/request-actions"

const actions = createRequestActions({
  permissions: {
    submit:  "servicios:submit",
    approve: "servicios:approve",
  },
  routePrefix: "/solicitudes",
  schemas: {
    quotationUpload:  serviceQuotationUploadSchema,
    selectQuotation:  selectServiceQuotationSchema,
  },
  services: {
    addQuotation:     addServiceQuotation,
    deleteQuotation:  deleteServiceQuotation,
    selectQuotation:  selectServiceQuotation,
  },
  logPrefix: "servicios",
})

export const uploadQuotationAction   = actions.uploadQuotationAction
export const deleteQuotationAction   = actions.deleteQuotationAction
export const selectQuotationAction   = actions.selectQuotationAction
