"use client"

import * as React from "react"
import { QuotationPanel, type QuotationRow } from "@/components/quotation-panel"
import { uploadQuotationAction, deleteQuotationAction, selectQuotationAction } from "./actions"

export type { QuotationRow as ServiceQuotationRow }

export function ServiceQuotationPanel({
  requestId,
  requestStatus,
  quotations,
  canUpload,
  canApprove,
  requirementHint,
}: {
  requestId:     string
  requestStatus: string
  quotations:    QuotationRow[]
  canUpload:     boolean
  canApprove:    boolean
  /** Lo que la regla de cotizaciones pide hoy a esta solicitud (reemplaza «mínimo 3…»). */
  requirementHint?: string | null
}) {
  return (
    <QuotationPanel
      requestId={requestId}
      requestStatus={requestStatus}
      quotations={quotations}
      canUpload={canUpload}
      canApprove={canApprove}
      downloadEndpointPrefix="/api/servicios/cotizaciones"
      approvedText="✓ Cotización aprobada. Servicios listos para orden de compra en el módulo de Compras."
      notesPlaceholder="Condiciones de pago, plazo de ejecución..."
      requirementHint={requirementHint}
      uploadQuotationAction={uploadQuotationAction}
      deleteQuotationAction={deleteQuotationAction}
      selectQuotationAction={selectQuotationAction}
    />
  )
}
