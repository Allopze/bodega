"use client"

import * as React from "react"
import { useActionState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { CheckCircle, FileText, Paperclip, Trash, Warning, WarningCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { SubmitButton } from "@/components/admin/submit-button"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { formatCLP, formatDate } from "@/lib/utils"
import {
  deleteInvoiceAttachment,
  uploadInvoiceAttachment,
  reconcileInvoiceAttachment,
  type InvoiceTargetType,
} from "@/lib/actions/invoice-attachments"
import { computeReconciliationDiff, formatDiffPercent } from "@/lib/services/invoice-reconciliation"
import type { ActionState } from "@/lib/validation/masters"

export interface InvoiceAttachmentRow {
  id:                  string
  invoiceNumber:       string
  invoiceDate:         string
  amount:              number
  fileName:            string
  fileSize:            number | null
  mimeType:            string | null
  notes:               string | null
  uploadedAt:          string
  uploaderName:        string | null
  // Reconciliation fields (null on legacy rows created before this feature)
  status:              "registered" | "observed" | "reconciled" | null
  reconciliationNotes: string | null
}

interface InvoiceAttachmentsPanelProps {
  targetType:       InvoiceTargetType
  targetId:         string
  targetLabel:      string
  canManage:        boolean
  attachments:      InvoiceAttachmentRow[]
  /** When set, enables reconciliation comparison (purchase order total) */
  orderTotalAmount?: number
}

export function InvoiceAttachmentsPanel({
  targetType,
  targetId,
  targetLabel,
  canManage,
  attachments,
  orderTotalAmount,
}: InvoiceAttachmentsPanelProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [uploadState, uploadAction] = useActionState<ActionState, FormData>(
    uploadInvoiceAttachment,
    INITIAL_STATE,
  )

  useEffect(() => {
    if (uploadState.ok && uploadState.message) {
      toast.success(uploadState.message)
      formRef.current?.reset()
    } else if (uploadState.ok === false && uploadState.message && uploadState !== INITIAL_STATE) {
      toast.error(uploadState.message)
    }
  }, [uploadState])

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Facturas anexas</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Evidencia asociada a {targetLabel}
          </p>
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] text-[var(--color-text-subtle)]">
          <Paperclip size={16} />
        </div>
      </div>

      <div className="divide-y divide-[var(--color-border)]">
        {attachments.length === 0 ? (
          <div className="px-4 py-5">
            <div className="flex items-start gap-3 rounded-[var(--radius)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3">
              <FileText size={18} className="mt-0.5 shrink-0 text-[var(--color-text-subtle)]" />
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">Sin facturas anexas</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  Adjunta el PDF o imagen de la factura cuando exista respaldo del proveedor.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {attachments.map((attachment) => (
              <InvoiceAttachmentItem
                key={attachment.id}
                attachment={attachment}
                canManage={canManage}
                orderTotalAmount={orderTotalAmount}
              />
            ))}
          </div>
        )}

        {canManage && (
          <form ref={formRef} action={uploadAction} className="space-y-4 px-4 py-4">
            <input type="hidden" name="targetType" value={targetType} />
            <input type="hidden" name="targetId" value={targetId} />

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_150px_150px]">
              <Field
                label="Número de factura"
                htmlFor={`invoice-number-${targetId}`}
                required
                error={uploadState.fieldErrors?.invoiceNumber?.[0]}
              >
                <Input
                  id={`invoice-number-${targetId}`}
                  name="invoiceNumber"
                  placeholder="F-18324"
                  error={!!uploadState.fieldErrors?.invoiceNumber}
                />
              </Field>

              <Field
                label="Fecha"
                htmlFor={`invoice-date-${targetId}`}
                required
                error={uploadState.fieldErrors?.invoiceDate?.[0]}
              >
                <Input
                  id={`invoice-date-${targetId}`}
                  name="invoiceDate"
                  type="date"
                  error={!!uploadState.fieldErrors?.invoiceDate}
                />
              </Field>

              <Field
                label="Monto"
                htmlFor={`invoice-amount-${targetId}`}
                required
                error={uploadState.fieldErrors?.amount?.[0]}
              >
                <Input
                  id={`invoice-amount-${targetId}`}
                  name="amount"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  className="font-mono"
                  error={!!uploadState.fieldErrors?.amount}
                />
              </Field>
            </div>

            <Field
              label="Archivo"
              htmlFor={`invoice-file-${targetId}`}
              required
              helper="PDF, JPG, PNG o WebP. Máximo 10 MB."
              error={uploadState.fieldErrors?.file?.[0]}
            >
              <Input
                id={`invoice-file-${targetId}`}
                name="file"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                error={!!uploadState.fieldErrors?.file}
              />
            </Field>

            <Field label="Nota" htmlFor={`invoice-notes-${targetId}`}>
              <Textarea
                id={`invoice-notes-${targetId}`}
                name="notes"
                rows={2}
                placeholder="Contexto opcional del documento..."
              />
            </Field>

            {uploadState.ok === false && uploadState.message && uploadState !== INITIAL_STATE && (
              <p className="flex items-center gap-1.5 text-sm text-[var(--color-danger)]">
                <Warning size={14} />
                {uploadState.message}
              </p>
            )}

            <div className="flex justify-end">
              <SubmitButton label="Anexar factura" loadingLabel="Anexando..." variant="primary" size="sm" />
            </div>
          </form>
        )}
      </div>
    </section>
  )
}

function InvoiceAttachmentItem({
  attachment,
  canManage,
  orderTotalAmount,
}: {
  attachment:       InvoiceAttachmentRow
  canManage:        boolean
  orderTotalAmount?: number
}) {
  const [deleteState,    deleteAction]    = useActionState<ActionState, FormData>(deleteInvoiceAttachment,    INITIAL_STATE)
  const [reconcileState, reconcileAction] = useActionState<ActionState, FormData>(reconcileInvoiceAttachment, INITIAL_STATE)

  const [showReconcileForm, setShowReconcileForm] = React.useState(false)

  useEffect(() => {
    if (deleteState.ok && deleteState.message)              toast.success(deleteState.message)
    else if (deleteState.ok === false && deleteState.message && deleteState !== INITIAL_STATE) toast.error(deleteState.message)
  }, [deleteState])

  useEffect(() => {
    if (reconcileState.ok && reconcileState.message) {
      toast.success(reconcileState.message)
    } else if (reconcileState.ok === false && reconcileState.message && reconcileState !== INITIAL_STATE) {
      toast.error(reconcileState.message)
    }
  }, [reconcileState])

  // Compute diff when we have the order total
  const diff = orderTotalAmount !== undefined
    ? computeReconciliationDiff(attachment.amount, orderTotalAmount)
    : null

  const status         = attachment.status ?? "registered"
  const statusConfig   = RECONCILIATION_STATUS[status]
  const shouldShowReconcileForm = showReconcileForm && !reconcileState.ok

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      {/* Main row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] text-[var(--color-text-subtle)]">
            <FileText size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`/api/invoice-attachments/${attachment.id}`}
                className="truncate text-sm font-medium text-[var(--color-text)] transition-colors duration-[var(--duration-fast)] hover:text-[var(--color-primary)]"
              >
                {attachment.invoiceNumber} · {attachment.fileName}
              </a>
              {/* Reconciliation status badge */}
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusConfig.className}`}>
                {statusConfig.icon}
                {statusConfig.label}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
              <span>{formatDate(attachment.invoiceDate)}</span>
              <span className="font-mono">{formatCLP(attachment.amount)}</span>
              {attachment.fileSize !== null && <span>{formatFileSize(attachment.fileSize)}</span>}
              {attachment.uploaderName && <span>Subida por {attachment.uploaderName}</span>}
            </div>
            {attachment.notes && (
              <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{attachment.notes}</p>
            )}
            {/* Show reconciliation notes if present */}
            {attachment.reconciliationNotes && (
              <p className="mt-1 text-xs italic text-[var(--color-text-muted)]">
                Conciliación: {attachment.reconciliationNotes}
              </p>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 sm:self-start">
          {canManage && diff !== null && (
            <Button
              type="button" variant="ghost" size="sm"
              onClick={() => setShowReconcileForm((v) => !v)}
              className={diff.hasDiff ? "text-[var(--color-warning)] hover:text-[var(--color-warning)]" : ""}
            >
              {diff.hasDiff ? <WarningCircle size={14} /> : <CheckCircle size={14} />}
              Conciliar
            </Button>
          )}
          {canManage && (
            <form action={deleteAction} className="inline">
              <input type="hidden" name="id" value={attachment.id} />
              <Button type="submit" variant="ghost" size="sm" className="text-[var(--color-danger)] hover:text-[var(--color-danger)]">
                <Trash size={14} />
                Eliminar
              </Button>
            </form>
          )}
        </div>
      </div>

      {/* Diff summary (always visible when we have orderTotalAmount) */}
      {diff !== null && (
        <div className={`rounded-[var(--radius)] px-3 py-2 text-xs flex flex-wrap gap-x-4 gap-y-1 ${diff.hasDiff ? "bg-[var(--color-warning-50)] border border-[var(--color-warning-100)]" : "bg-[var(--color-success-50)] border border-[var(--color-success-100)]"}`}>
          <span className="text-[var(--color-text-muted)]">
            OC: <span className="font-mono font-medium text-[var(--color-text)]">{formatCLP(diff.orderAmount)}</span>
          </span>
          <span className="text-[var(--color-text-muted)]">
            Factura: <span className="font-mono font-medium text-[var(--color-text)]">{formatCLP(diff.invoiceAmount)}</span>
          </span>
          {diff.hasDiff ? (
            <span className="font-medium text-[var(--color-warning)]">
              Diferencia: {formatCLP(Math.abs(diff.absoluteDiff))}
              {formatDiffPercent(diff) && ` (${formatDiffPercent(diff)})`}
              {diff.absoluteDiff > 0 ? " — factura mayor" : " — factura menor"}
            </span>
          ) : (
            <span className="font-medium text-[var(--color-success)]">Montos coinciden</span>
          )}
        </div>
      )}

      {/* Reconciliation form */}
      {shouldShowReconcileForm && canManage && (
        <form action={reconcileAction} className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 space-y-3">
          <input type="hidden" name="id" value={attachment.id} />
          <p className="text-xs font-semibold text-[var(--color-text)]">Registrar resultado de conciliación</p>

          <div className="flex flex-wrap gap-2">
            {(["reconciled", "observed", "registered"] as const).map((s) => {
              const cfg = RECONCILIATION_STATUS[s]
              return (
                <label key={s} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio" name="status" value={s}
                    defaultChecked={status === s}
                    className="accent-[var(--color-primary)]"
                  />
                  <span className={`text-xs font-medium ${cfg.textClass}`}>{cfg.label}</span>
                </label>
              )
            })}
          </div>

          <Textarea
            name="reconciliationNotes"
            rows={2}
            placeholder="Motivo de la observación o detalle de la conciliación..."
            defaultValue={attachment.reconciliationNotes ?? ""}
          />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowReconcileForm(false)}>
              Cancelar
            </Button>
            <SubmitButton label="Guardar" loadingLabel="Guardando..." size="sm" />
          </div>
        </form>
      )}
    </div>
  )
}

const RECONCILIATION_STATUS = {
  registered: {
    label:     "Registrada",
    className: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
    textClass: "text-[var(--color-text-muted)]",
    icon:      null,
  },
  observed: {
    label:     "Observada",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400",
    textClass: "text-amber-700 dark:text-amber-400",
    icon:      <WarningCircle size={11} className="shrink-0" />,
  },
  reconciled: {
    label:     "Conciliada",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-400",
    textClass: "text-emerald-700 dark:text-emerald-400",
    icon:      <CheckCircle size={11} className="shrink-0" />,
  },
} as const

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
