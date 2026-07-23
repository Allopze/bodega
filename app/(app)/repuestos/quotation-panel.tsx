"use client"

import * as React from "react"
import { QuotationPanel, type QuotationRow } from "@/components/quotation-panel"
import { uploadQuotationAction, deleteQuotationAction, selectQuotationAction } from "./actions"

export type { QuotationRow }

export function RepuestosQuotationPanel({
  requestId,
  requestStatus,
  quotations,
  canUpload,
  canApprove,
}: {
  requestId:     string
  requestStatus: string
  quotations:    QuotationRow[]
  canUpload:     boolean
  canApprove:    boolean
}) {
  return (
    <QuotationPanel
      requestId={requestId}
      requestStatus={requestStatus}
      quotations={quotations}
      canUpload={canUpload}
      canApprove={canApprove}
      downloadEndpointPrefix="/api/repuestos/quotaciones"
      approvedText="✓ Cotización aprobada. Ítems listos para orden de compra en el módulo de Compras."
      notesPlaceholder="Condiciones de pago, plazo de entrega..."
      uploadQuotationAction={uploadQuotationAction}
      deleteQuotationAction={deleteQuotationAction}
      selectQuotationAction={selectQuotationAction}
    />
  )
}

// Re-export as default or named for backward compatibility
export { RepuestosQuotationPanel as QuotationPanel }
