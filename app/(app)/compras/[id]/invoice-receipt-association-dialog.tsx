"use client"

import * as React from "react"
import { useActionState } from "react"
import { LinkSimple } from "@phosphor-icons/react"
import { INITIAL_STATE } from "@/lib/form-state"
import { SubmitButton } from "@/components/ui/submit-button"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { toast } from "@/lib/toast"
import { formatDateTime } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import { setInvoiceReceiptsAction } from "../invoice-actions"

export interface InvoiceReceiptOption {
  id: string
  code: string
  receivedAt: string
  locationType: string
  dispatchGuideNo: string | null
  items: Array<{ purchaseOrderItemId: string; quantityReceived: number }>
}

export interface InvoiceReceiptSuggestionView {
  receiptIds: string[]
  confidence: "high" | "medium" | "low"
  ambiguous: boolean
  reasons: string[]
}

export function InvoiceReceiptAssociationDialog({
  invoiceId,
  invoiceNumber,
  purchaseOrderId,
  receipts,
  currentReceiptIds,
  suggestion,
}: {
  invoiceId: string
  invoiceNumber: string
  purchaseOrderId: string
  receipts: InvoiceReceiptOption[]
  currentReceiptIds: string[]
  suggestion: InvoiceReceiptSuggestionView
}) {
  const [open, setOpen] = React.useState(false)
  const [selectedIds, setSelectedIds] = React.useState<string[]>(currentReceiptIds)
  const [state, action] = useActionState<ActionState, FormData>(setInvoiceReceiptsAction, INITIAL_STATE)

  React.useEffect(() => {
    if (!open) return
    setSelectedIds(currentReceiptIds)
  }, [currentReceiptIds, open])

  React.useEffect(() => {
    if (!state.message) return
    if (state.ok) {
      toast.success(state.message)
      setOpen(false)
    } else {
      toast.error(state.message)
    }
  }, [state])

  function toggleReceipt(receiptId: string, checked: boolean) {
    setSelectedIds((current) => checked
      ? [...new Set([...current, receiptId])]
      : current.filter((id) => id !== receiptId))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          <LinkSimple size={14} aria-hidden />
          Asociar recepciones
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Asociar recepciones a la factura</DialogTitle>
          <DialogDescription>
            Factura {invoiceNumber}. El vínculo es documental: las cantidades continúan conciliándose acumuladas por línea de la OC.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="space-y-4">
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />

          {!suggestion.ambiguous && suggestion.receiptIds.length > 0 && (
            <div className="rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface-2) p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-(--color-text)">Sugerencia explicable</p>
                <div className="flex items-center gap-2">
                  <MetaBadge meta={{ label: `Confianza ${suggestion.confidence === "high" ? "alta" : suggestion.confidence === "medium" ? "media" : "baja"}`, variant: suggestion.confidence === "high" ? "success" : "info" }} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedIds(suggestion.receiptIds)}>
                    Aplicar sugerencia
                  </Button>
                </div>
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-(--color-text-muted)">
                {suggestion.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            </div>
          )}

          {suggestion.ambiguous && (
            <p className="rounded-(--radius-lg) border border-(--color-warning-line) bg-(--color-warning-tint) p-3 text-xs text-(--color-warning-ink)">
              Hay recepciones con la misma evidencia. La plataforma no eligió ninguna; selecciona manualmente.
            </p>
          )}

          {receipts.length > 0 ? (
            <fieldset className="max-h-72 overflow-y-auto rounded-(--radius-lg) border border-(--color-border) p-3">
              <legend className="px-1 text-sm font-medium text-(--color-text)">Recepciones de esta OC</legend>
              <div className="space-y-2">
                {receipts.map((receipt) => (
                  <Checkbox
                    key={receipt.id}
                    id={`invoice-${invoiceId}-receipt-${receipt.id}`}
                    name="receiptId"
                    value={receipt.id}
                    checked={selectedIds.includes(receipt.id)}
                    onChange={(event) => toggleReceipt(receipt.id, event.target.checked)}
                    label={(
                      <span>
                        <span className="font-medium">{receipt.code}</span>
                        <span className="ml-1 text-xs text-(--color-text-muted)">
                          · {formatDateTime(receipt.receivedAt)}
                          {receipt.dispatchGuideNo ? ` · documento ${receipt.dispatchGuideNo}` : ""}
                        </span>
                      </span>
                    )}
                  />
                ))}
              </div>
            </fieldset>
          ) : (
            <p className="rounded-(--radius-lg) bg-(--color-surface-2) p-3 text-xs text-(--color-text-muted)">
              Esta OC todavía no tiene recepciones. Puedes guardar la factura ahora y asociarlas después.
            </p>
          )}

          {!state.ok && state.message && <p role="alert" className="text-xs text-(--color-danger)">{state.message}</p>}
          <SubmitButton label="Guardar asociaciones" loadingLabel="Guardando…" className="w-full" />
        </form>
      </DialogContent>
    </Dialog>
  )
}
