"use client"

import * as React from "react"
import { useActionState } from "react"
import { Trash, FilePdf, Warning } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { SubmitButton } from "@/components/admin/submit-button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatCLP, formatDate } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import { addInvoiceAction, deleteInvoiceAction } from "../invoice-actions"

export interface InvoiceRow {
  id: string
  invoiceNumber: string
  amount: number | null
  issueDate: string | null
  fileName: string
  mimeType: string | null
  uploadedAt: string
}

export function InvoicesSection({
  purchaseOrderId,
  invoices,
  totalAmount,
  canManage,
}: {
  purchaseOrderId: string
  invoices: InvoiceRow[]
  totalAmount: number
  canManage: boolean
}) {
  const totalInvoiced = invoices.reduce((sum, inv) => sum + (inv.amount ?? 0), 0)
  const exceeds = totalInvoiced > totalAmount

  return (
    <section className="rounded-(--radius-2xl) bg-(--color-surface) shadow-(--shadow-card) p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-(--color-text)">
          Facturas
          {invoices.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center rounded-full bg-surface-2 text-(--color-text-muted) text-xs font-medium px-2 py-0.5">
              {invoices.length}
            </span>
          )}
        </h2>
      </div>

      {/* Reconciliation summary */}
      {invoices.length > 0 && (
        <div className={`mb-3 rounded-(--radius-lg) px-3 py-2 text-xs ${
          exceeds
            ? "bg-[var(--color-danger-50)] border border-[var(--color-danger-200)] text-[var(--color-danger-700)]"
            : "bg-surface-2 text-(--color-text-muted)"
        }`}>
          <div className="flex items-center justify-between gap-2">
            <span>Total facturado</span>
            <span className="font-mono font-semibold tabular-nums">{formatCLP(totalInvoiced)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-1 pt-1 border-t border-current/10">
            <span>Total OC</span>
            <span className="font-mono tabular-nums">{formatCLP(totalAmount)}</span>
          </div>
          {exceeds && (
            <p className="mt-1.5 flex items-center gap-1 font-medium">
              <Warning size={12} weight="bold" />
              Lo facturado supera el total de la OC
            </p>
          )}
        </div>
      )}

      {/* Invoice list */}
      {invoices.length === 0 ? (
        <p className="text-xs text-text-subtle py-2">Sin facturas adjuntadas.</p>
      ) : (
        <ul className="divide-y divide-(--color-border) mb-3">
          {invoices.map((inv) => (
            <InvoiceItem
              key={inv.id}
              invoice={inv}
              purchaseOrderId={purchaseOrderId}
              canManage={canManage}
            />
          ))}
        </ul>
      )}

      {/* Add invoice form */}
      {canManage && (
        <AddInvoiceForm purchaseOrderId={purchaseOrderId} />
      )}
    </section>
  )
}

/* ── Invoice list item ──────────────────────────────────────────────────────── */

function InvoiceItem({
  invoice,
  purchaseOrderId,
  canManage,
}: {
  invoice: InvoiceRow
  purchaseOrderId: string
  canManage: boolean
}) {
  const [state, action] = useActionState<ActionState, FormData>(deleteInvoiceAction, INITIAL_STATE)
  const [pending, startTransition] = React.useTransition()
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
    } else if (!state.ok && state.message) {
      toast.error(state.message)
    }
  }, [state])

  function handleConfirmDelete() {
    const formData = new FormData()
    formData.set("invoiceId", invoice.id)
    formData.set("purchaseOrderId", purchaseOrderId)
    startTransition(() => {
      action(formData)
    })
    setConfirmOpen(false)
  }

  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="flex items-start gap-2 min-w-0">
        <FilePdf size={16} className="mt-0.5 shrink-0 text-text-subtle" />
        <div className="min-w-0">
          <a
            href={`/api/purchase-orders/invoices/${invoice.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-(--color-text) hover:underline truncate block"
          >
            {invoice.invoiceNumber}
          </a>
          <p className="text-[11px] text-text-subtle mt-0.5">
            {invoice.amount != null ? formatCLP(invoice.amount) : "—"}
            {invoice.issueDate ? ` · ${formatDate(invoice.issueDate)}` : ""}
          </p>
        </div>
      </div>
      {canManage && (
        <>
          <button
            type="button"
            disabled={pending}
            aria-label={`Eliminar factura ${invoice.invoiceNumber}`}
            onClick={() => setConfirmOpen(true)}
            className="shrink-0 p-1 rounded text-text-subtle hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-50)] transition-colors disabled:opacity-40"
          >
            <Trash size={14} />
          </button>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Eliminar factura"
            description={`La factura ${invoice.invoiceNumber} será eliminada permanentemente. Esta acción no se puede deshacer.`}
            confirmLabel="Eliminar"
            variant="destructive"
            loading={pending}
            onConfirm={handleConfirmDelete}
          />
        </>
      )}
    </li>
  )
}

/* ── Add invoice form ───────────────────────────────────────────────────────── */

function AddInvoiceForm({ purchaseOrderId }: { purchaseOrderId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(addInvoiceAction, INITIAL_STATE)
  const formRef = React.useRef<HTMLFormElement>(null)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message)
      formRef.current?.reset()
    } else if (!state.ok && state.message && "fieldErrors" in state) {
      toast.error(state.message)
    }
  }, [state])

  return (
    <form ref={formRef} action={action} className="mt-1 border-t border-(--color-border) pt-3 space-y-2">
      <p className="text-xs font-medium text-(--color-text-muted) mb-2">Agregar factura</p>
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />

      {!state.ok && state.message && !("fieldErrors" in state) && (
        <p className="flex items-center gap-1.5 text-xs text-[var(--color-danger)]">
          <Warning size={12} weight="bold" />
          {state.message}
        </p>
      )}

      <Field
        label="N° de factura"
        htmlFor="invoice-number"
        error={state.fieldErrors?.invoiceNumber?.[0]}
      >
        <Input
          id="invoice-number"
          name="invoiceNumber"
          placeholder="Ej: 000123"
          autoComplete="off"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field
          label="Monto"
          htmlFor="invoice-amount"
          error={state.fieldErrors?.amount?.[0]}
        >
          <Input
            id="invoice-amount"
            name="amount"
            type="number"
            min="0"
            step="1"
            placeholder="0"
          />
        </Field>

        <Field
          label="Fecha de emisión"
          htmlFor="invoice-issue-date"
          error={state.fieldErrors?.issueDate?.[0]}
        >
          <DatePicker
            id="invoice-issue-date"
            name="issueDate"
          />
        </Field>
      </div>

      <Field
        label="Archivo"
        htmlFor="invoice-file"
        helper="PDF, JPG, PNG o XML (DTE)"
      >
        <Input
          id="invoice-file"
          name="file"
          type="file"
          accept="application/pdf,image/jpeg,image/png,application/xml,text/xml"
          required
        />
      </Field>

      <SubmitButton
        label="Adjuntar factura"
        loadingLabel="Adjuntando..."
        size="sm"
        className="w-full"
      />
    </form>
  )
}
