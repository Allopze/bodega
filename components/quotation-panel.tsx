"use client"

import * as React from "react"
import { useActionState } from "react"
import {
  FilePdf, Trash, CheckCircle, Upload, CurrencyCircleDollar,
} from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { FileInput } from "@/components/ui/file-input"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { toast } from "@/lib/toast"

export interface QuotationRow {
  id:               string
  supplierId:       string | null
  supplierNameFree: string | null
  supplierName?:    string | null
  fileName:         string
  totalAmount:      number
  status:           "pending" | "selected" | "rejected"
  notes:            string | null
  createdAt:        string
}

type ActionState = { ok: boolean; message?: string }

const STATUS_LABELS: Record<string, string> = {
  pending:  "Pendiente",
  selected: "Seleccionada",
  rejected: "No seleccionada",
}

const STATUS_VARIANTS: Record<string, "default" | "success" | "warning"> = {
  pending:  "warning",
  selected: "success",
  rejected: "default",
}

export interface QuotationPanelProps {
  requestId:              string
  requestStatus:          string
  quotations:             QuotationRow[]
  canUpload:              boolean
  canApprove:             boolean
  downloadEndpointPrefix: string
  approvedText?:          string
  notesPlaceholder?:      string
  uploadQuotationAction:  (prev: ActionState, formData: FormData) => Promise<ActionState>
  deleteQuotationAction:  (prev: ActionState, formData: FormData) => Promise<ActionState>
  selectQuotationAction:  (prev: ActionState, formData: FormData) => Promise<ActionState>
}

export function QuotationPanel({
  requestId,
  requestStatus,
  quotations,
  canUpload,
  canApprove,
  downloadEndpointPrefix,
  approvedText = "✓ Cotización aprobada. Ítems listos para orden de compra en el módulo de Compras.",
  notesPlaceholder = "Condiciones de pago, plazo...",
  uploadQuotationAction,
  deleteQuotationAction,
  selectQuotationAction,
}: QuotationPanelProps) {
  const isEditable = ["draft", "returned"].includes(requestStatus)
  const isPendingReview = ["submitted", "in_review"].includes(requestStatus)
  const isApproved = requestStatus === "approved"

  // Upload form
  const [showUpload, setShowUpload] = React.useState(false)
  const [uploadState, uploadAction, uploadPending] = useActionState(
    async (prev: ActionState, formData: FormData): Promise<ActionState> => {
      const res = await uploadQuotationAction(prev, formData)
      if (res.ok) {
        toast.success(res.message ?? "Cotización agregada")
        setShowUpload(false)
      } else {
        toast.error(res.message ?? "Error al subir cotización")
      }
      return res
    },
    { ok: false },
  )

  // Delete quotation
  const [deleteId, setDeleteId] = React.useState<string | null>(null)
  const deleteFormRef = React.useRef<HTMLFormElement>(null)
  const [, deleteAction, deletePending] = useActionState(
    async (prev: ActionState, formData: FormData): Promise<ActionState> => {
      const res = await deleteQuotationAction(prev, formData)
      if (res.ok) {
        toast.success(res.message ?? "Cotización eliminada")
        setDeleteId(null)
      } else {
        toast.error(res.message ?? "Error al eliminar")
      }
      return res
    },
    { ok: false },
  )

  // Select (approve) quotation
  const [selectId, setSelectId] = React.useState<string | null>(null)
  const [, selectAction, selectPending] = useActionState(
    async (prev: ActionState, formData: FormData): Promise<ActionState> => {
      const res = await selectQuotationAction(prev, formData)
      if (res.ok) {
        toast.success(res.message ?? "Cotización aprobada")
        setSelectId(null)
      } else {
        toast.error(res.message ?? "Error al aprobar")
      }
      return res
    },
    { ok: false },
  )

  const supplierLabel = (q: QuotationRow) =>
    q.supplierName ?? q.supplierNameFree ?? "Proveedor sin nombre"

  return (
    <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Cotizaciones
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
            {isEditable
              ? `${quotations.length}/3 adjuntadas${quotations.length < 3 ? " — se recomienda mínimo 3" : ""}`
              : isPendingReview
              ? "Selecciona la cotización ganadora"
              : ""}
          </p>
        </div>
        {isEditable && canUpload && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setShowUpload(true)}>
            <Upload size={14} />
            Agregar cotización
          </Button>
        )}
      </div>

      {quotations.length === 0 ? (
        <p className="text-sm text-[var(--color-text-subtle)] italic">
          No hay cotizaciones adjuntas.{" "}
          {isEditable && "Agrega al menos una para poder enviar la solicitud."}
        </p>
      ) : (
        <ul className="space-y-3">
          {quotations.map((q) => (
            <li
              key={q.id}
              className={`flex items-start gap-3 rounded-[var(--radius-xl)] border p-4 ${
                q.status === "selected"
                  ? "border-[var(--color-success)] bg-[var(--color-success-tint)]"
                  : q.status === "rejected"
                  ? "border-[var(--color-border)] opacity-60"
                  : "border-[var(--color-border)]"
              }`}
            >
              <FilePdf size={24} className="shrink-0 mt-0.5 text-[var(--color-text-subtle)]" />

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-[var(--color-text)] truncate">
                    {supplierLabel(q)}
                  </span>
                  <Badge variant={STATUS_VARIANTS[q.status] ?? "default"} size="sm">
                    {STATUS_LABELS[q.status] ?? q.status}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-[var(--color-text-muted)]">
                  <span className="flex items-center gap-1">
                    <CurrencyCircleDollar size={12} />
                    {new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(q.totalAmount)}
                  </span>
                  <a
                    href={`${downloadEndpointPrefix}/${q.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-[var(--color-text)] transition-colors"
                  >
                    {q.fileName}
                  </a>
                </div>
                {q.notes && (
                  <p className="text-xs text-[var(--color-text-subtle)]">{q.notes}</p>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {/* Select (approve) button — only for approvers while in review */}
                {isPendingReview && canApprove && q.status === "pending" && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelectId(q.id)}
                    className="text-[var(--color-success-ink)] hover:bg-[var(--color-success-tint)]"
                  >
                    <CheckCircle size={14} />
                    Seleccionar
                  </Button>
                )}

                {/* Delete — only while editable */}
                {isEditable && canUpload && q.status === "pending" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-mobile"
                    onClick={() => setDeleteId(q.id)}
                    className="text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger-ink)]"
                    aria-label="Eliminar cotización"
                  >
                    <Trash size={14} />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {isApproved && (
        <p className="text-xs text-[var(--color-success-ink)] font-medium">
          {approvedText}
        </p>
      )}

      {/* Upload dialog */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Agregar cotización</DialogTitle>
            <DialogDescription>
              Adjunta el PDF o imagen de la cotización con el proveedor y monto total.
            </DialogDescription>
          </DialogHeader>
          <form action={uploadAction} className="space-y-4">
            <input type="hidden" name="requestId" value={requestId} />

            <Field label="Archivo (PDF, JPG o PNG)" required>
              <FileInput name="file" accept=".pdf,.jpg,.jpeg,.png" required />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Proveedor" required helper="Nombre del proveedor que cotizó">
                <Input
                  name="supplierNameFree"
                  placeholder="Nombre del proveedor..."
                  maxLength={150}
                  required
                />
              </Field>

              <Field label="Monto total (CLP)" required>
                <Input
                  type="number"
                  name="totalAmount"
                  placeholder="0"
                  min={0}
                  step="1"
                  required
                />
              </Field>
            </div>

            <Field label="Observaciones">
              <Input
                name="notes"
                placeholder={notesPlaceholder}
                maxLength={300}
              />
            </Field>

            {uploadState.message && !uploadState.ok && (
              <p className="text-sm text-[var(--color-danger)]">{uploadState.message}</p>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary" size="sm">Cancelar</Button>
              </DialogClose>
              <Button type="submit" variant="primary" size="sm" disabled={uploadPending}>
                {uploadPending ? "Subiendo…" : "Agregar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <form ref={deleteFormRef} action={deleteAction} className="hidden">
        <input type="hidden" name="quotationId" value={deleteId ?? ""} />
        <input type="hidden" name="requestId" value={requestId} />
      </form>
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        title="Eliminar cotización"
        description="El archivo será eliminado permanentemente. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        variant="destructive"
        loading={deletePending}
        onConfirm={() => deleteFormRef.current?.requestSubmit()}
      />

      {/* Approve (select) confirm dialog */}
      <Dialog open={!!selectId} onOpenChange={(open) => { if (!open) setSelectId(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Aprobar cotización</DialogTitle>
            <DialogDescription>
              Se seleccionará esta cotización como ganadora. El resto quedará como no seleccionada
              y todos los ítems de la solicitud pasarán al estado &quot;Aprobado&quot; para orden de compra.
            </DialogDescription>
          </DialogHeader>
          <form action={selectAction}>
            <input type="hidden" name="requestId" value={requestId} />
            <input type="hidden" name="quotationId" value={selectId ?? ""} />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary" size="sm">Cancelar</Button>
              </DialogClose>
              <Button type="submit" variant="primary" size="sm" disabled={selectPending}>
                {selectPending ? "Aprobando…" : "Confirmar aprobación"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
