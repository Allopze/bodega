"use client"

import * as React from "react"
import { useActionState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { FileText, Paperclip, Trash, Warning } from "@phosphor-icons/react"
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
  type InvoiceTargetType,
} from "@/lib/actions/invoice-attachments"
import type { ActionState } from "@/lib/validation/masters"

export interface InvoiceAttachmentRow {
  id:            string
  invoiceNumber: string
  invoiceDate:   string
  amount:        number
  fileName:      string
  fileSize:      number | null
  mimeType:      string | null
  notes:         string | null
  uploadedAt:    string
  uploaderName:  string | null
}

interface InvoiceAttachmentsPanelProps {
  targetType:  InvoiceTargetType
  targetId:    string
  targetLabel: string
  canManage:   boolean
  attachments: InvoiceAttachmentRow[]
}

export function InvoiceAttachmentsPanel({
  targetType,
  targetId,
  targetLabel,
  canManage,
  attachments,
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
}: {
  attachment: InvoiceAttachmentRow
  canManage: boolean
}) {
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteInvoiceAttachment,
    INITIAL_STATE,
  )

  useEffect(() => {
    if (deleteState.ok && deleteState.message) {
      toast.success(deleteState.message)
    } else if (deleteState.ok === false && deleteState.message && deleteState !== INITIAL_STATE) {
      toast.error(deleteState.message)
    }
  }, [deleteState])

  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] text-[var(--color-text-subtle)]">
          <FileText size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <a
            href={`/api/invoice-attachments/${attachment.id}`}
            className="block truncate text-sm font-medium text-[var(--color-text)] transition-colors duration-[var(--duration-fast)] hover:text-[var(--color-primary)]"
          >
            {attachment.invoiceNumber} · {attachment.fileName}
          </a>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
            <span>{formatDate(attachment.invoiceDate)}</span>
            <span className="font-mono">{formatCLP(attachment.amount)}</span>
            {attachment.fileSize !== null && <span>{formatFileSize(attachment.fileSize)}</span>}
            {attachment.uploaderName && <span>Subida por {attachment.uploaderName}</span>}
          </div>
          {attachment.notes && (
            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{attachment.notes}</p>
          )}
        </div>
      </div>

      {canManage && (
        <form action={deleteAction} className="sm:self-start">
          <input type="hidden" name="id" value={attachment.id} />
          <Button type="submit" variant="ghost" size="sm" className="text-[var(--color-danger)] hover:text-[var(--color-danger)]">
            <Trash size={14} />
            Eliminar
          </Button>
        </form>
      )}
    </div>
  )
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
