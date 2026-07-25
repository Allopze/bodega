"use client"

import * as React from "react"
import { useState } from "react"
import { ArrowLeft, Info, Plus, Warning } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { DatePicker } from "@/components/ui/date-picker"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ItemEditor } from "./item-editor"
import { URGENCY_OPTS } from "./request-form.constants"
import { formatDate, formatDateTime } from "@/lib/utils"
import { QUOTATION_TYPES } from "@/lib/request-types"
import type { ItemRow, ProductOption, WorksiteOption, SupplierOption, WorkerOption, EditRequest } from "./request-form.types"
import { useRequestForm } from "./use-request-form"

function SummaryLine({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-xs text-[var(--color-text-subtle)]">{label}</dt>
      <dd className={muted ? "text-right text-xs text-[var(--color-text-subtle)]" : "text-right text-xs font-medium text-[var(--color-text)]"}>
        {value}
      </dd>
    </div>
  )
}

interface RequestFormProps {
  worksites: WorksiteOption[]
  products: ProductOption[]
  suppliers: SupplierOption[]
  workers?: WorkerOption[]
  editRequest?: EditRequest
  maxFileSizeMb: number
  userRoles?: string[]
  userPermissions?: string[]
}

function RequestFormHeader({
  worksiteId, requestType, urgency, deliveryMode, requiredDate, notes, readOnly,
  worksites, requestTypeOpts, requiredDateError,
  onWorksiteChange, onRequestTypeChange, onUrgencyChange, onDeliveryModeChange, onRequiredDateChange, onNotesChange,
}: {
  worksiteId: string; requestType: string; urgency: string; deliveryMode: string; requiredDate: string; notes: string; readOnly: boolean
  worksites: WorksiteOption[]; requestTypeOpts: { value: string; label: string }[]
  requiredDateError?: string
  onWorksiteChange: (v: string) => void; onRequestTypeChange: (v: string) => void
  onUrgencyChange: (v: string) => void; onDeliveryModeChange: (v: string) => void; onRequiredDateChange: (v: string) => void; onNotesChange: (v: string) => void
}) {
  return (
    <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5 space-y-4">
      <h2 className="text-h2 text-[var(--color-text)]">Datos de la solicitud</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Faena" required htmlFor="worksiteId">
          <Select value={worksiteId} onValueChange={onWorksiteChange} disabled={readOnly}>
            <SelectTrigger id="worksiteId"><SelectValue placeholder="Selecciona una faena" /></SelectTrigger>
            <SelectContent>{worksites.map((w) => (<SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>))}</SelectContent>
          </Select>
        </Field>
        <Field label="Tipo de solicitud" htmlFor="requestType" helper="EPP: elementos de protección personal. El tipo clasifica la solicitud para su revisión y compra.">
          <Select value={requestType} onValueChange={onRequestTypeChange} disabled={readOnly}>
            <SelectTrigger id="requestType"><SelectValue /></SelectTrigger>
            <SelectContent>{requestTypeOpts.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent>
          </Select>
        </Field>
        <Field label="Urgencia" htmlFor="urgency" helper="Alta y Crítico destacan los ítems en la cola de aprobación.">
          <Select value={urgency} onValueChange={onUrgencyChange} disabled={readOnly}>
            <SelectTrigger id="urgency"><SelectValue /></SelectTrigger>
            <SelectContent>{URGENCY_OPTS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent>
          </Select>
        </Field>
        <Field label="Despacho sugerido" htmlFor="deliveryMode" helper="Vía oficina (estándar) o Directo a faena (urgencia/volumen). La jefatura confirma al aprobar.">
          <Select value={deliveryMode} onValueChange={onDeliveryModeChange} disabled={readOnly}>
            <SelectTrigger id="deliveryMode"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="via_oficina">Vía oficina (Estándar)</SelectItem>
              <SelectItem value="directo_faena">Directo a faena (Urgencia/Directo)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Fecha requerida" required htmlFor="requiredDate"
          error={requiredDateError}
        >
          <DatePicker id="requiredDate" name="requiredDate" value={requiredDate} onChange={onRequiredDateChange} disabled={readOnly} />
        </Field>
      </div>
      <Field label="Notas generales" htmlFor="notes">
        <Textarea id="notes" name="notes" placeholder="Observaciones, contexto de la solicitud..." rows={2} disabled={readOnly} value={notes} onChange={(e) => onNotesChange(e.target.value)} />
      </Field>
    </section>
  )
}

function ItemsSection({
  items, requestType, requestTypeLabel: _requestTypeLabel, readOnly, savedId, itemsError,
  products, suppliers, workers, maxFileSizeMb,
  onAdd, onRemove, onUpdate, onSelectProduct, onSelectFreeProduct, onClearProduct, onUpdateAttr, onUpdateWorker,
  resubmitAction, resubmitPending,
}: {
  items: ItemRow[]; requestType: string; requestTypeLabel?: string; readOnly: boolean; savedId?: string
  itemsError?: string; products: ProductOption[]; suppliers: SupplierOption[]; workers?: WorkerOption[]; maxFileSizeMb: number
  onAdd: () => void; onRemove: (key: string) => void; onUpdate: (key: string, patch: Partial<ItemRow>) => void
  onSelectProduct: (key: string, pid: string) => void; onSelectFreeProduct: (key: string, name: string) => void
  onClearProduct: (key: string) => void; onUpdateAttr: (itemKey: string, attrIdx: number, value: string) => void
  onUpdateWorker: (itemKey: string, workerId: string) => void
  resubmitAction: (payload: FormData) => void; resubmitPending: boolean
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-h2 text-[var(--color-text)]">
          Ítems solicitados
          <span className="ml-2 text-xs font-normal text-[var(--color-text-subtle)]">{items.length} {items.length === 1 ? "ítem" : "ítems"}</span>
        </h2>
        {!readOnly && (<Button type="button" variant="ghost" size="sm" onClick={onAdd}><Plus weight="bold" size={13} /> Agregar ítem</Button>)}
      </div>
      {itemsError && <p className="text-xs text-[var(--color-danger)]">{itemsError}</p>}
      {QUOTATION_TYPES.has(requestType) && !savedId && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-signal-ink)] rounded-[var(--radius)] border border-[var(--color-signal-line)] bg-[var(--color-signal-tint)] px-3 py-2.5">
          <Warning size={14} weight="fill" className="shrink-0" />
          Guarda el borrador primero — la cotización se adjunta por ítem después de guardar.
        </p>
      )}
      <div className="space-y-2">
        {items.map((item, idx) => (
          <div key={item._key}>
            <ItemEditor item={item} idx={idx} products={products} suppliers={suppliers} workers={workers}
              readOnly={readOnly} requestType={requestType} maxFileSizeMb={maxFileSizeMb}
              onUpdate={(patch) => onUpdate(item._key, patch)}
              onSelectProduct={(pid) => onSelectProduct(item._key, pid)}
              onSelectFreeProduct={(name) => onSelectFreeProduct(item._key, name)}
              onClearProduct={() => onClearProduct(item._key)}
              onUpdateAttr={(i, v) => onUpdateAttr(item._key, i, v)}
              onUpdateWorker={(workerId) => onUpdateWorker(item._key, workerId)}
              onRemove={() => onRemove(item._key)} canRemove={items.length > 1}
            />
            {readOnly && item.status === "returned" && item.id && (
              <div className="mt-1 flex justify-end">
                <form action={resubmitAction}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <button type="submit" disabled={resubmitPending} className="text-xs font-medium text-(--color-primary) hover:underline disabled:opacity-40 px-2 py-1">
                    {resubmitPending ? "Re-enviando..." : "Re-enviar a aprobación →"}
                  </button>
                </form>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function SummarySidebar({
  isDraft, readOnly: _readOnly, worksiteLabel, requestTypeLabel, urgencyLabel, requiredDate,
  statusLabel, items, missingItems,
}: {
  isDraft: boolean; readOnly?: boolean; worksiteLabel: string; requestTypeLabel: string
  urgencyLabel: string; requiredDate: string; statusLabel: string; items: ItemRow[]
  missingItems: string[]
}) {
  return (
    <aside className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4 lg:sticky lg:top-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Resumen</h2>
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{isDraft ? "Revisa la solicitud antes de enviarla." : "Consulta el estado y los datos registrados."}</p>
        </div>
        <span className="rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] px-2 py-1 text-xs font-medium text-[var(--color-text-muted)]">
          {items.length} {items.length === 1 ? "ítem" : "ítems"}
        </span>
      </div>
      <dl className="mt-4 divide-y divide-[var(--color-border)] text-sm">
        <SummaryLine label="Faena" value={worksiteLabel} />
        <SummaryLine label="Tipo" value={requestTypeLabel} />
        <SummaryLine label="Urgencia" value={urgencyLabel} />
        <SummaryLine label="Fecha requerida" value={requiredDate ? formatDate(requiredDate) : "Pendiente"} muted={!requiredDate} />
        {!isDraft && <SummaryLine label="Estado" value={statusLabel} />}
      </dl>
      <div className="mt-4 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
        <p className="text-xs font-medium text-[var(--color-text)]">
          {isDraft ? (missingItems.length === 0 ? "Listo para enviar" : "Pendientes") : statusLabel}
        </p>
        {!isDraft ? (
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">Esta solicitud ya fue enviada y se muestra en modo consulta.</p>
        ) : missingItems.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">Los campos requeridos y los ítems tienen la información mínima.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs text-[var(--color-text-muted)]">
            {missingItems.map((issue) => (
              <li key={issue} className="flex gap-2">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--color-warning)]" />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

export function RequestForm({ worksites, products, suppliers, workers, editRequest, maxFileSizeMb, userPermissions = [] }: RequestFormProps) {
  const form = useRequestForm({ worksites, products, suppliers, workers, editRequest, maxFileSizeMb, userPermissions })
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)

  return (
    <div className="grid gap-6 pb-16 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="min-w-0 space-y-8">
        <form onSubmit={(e) => { e.preventDefault(); form.startSaveTransition(() => form.draftAction(form.buildDraftFormData())) }} className="space-y-6">
          <RequestFormHeader
            worksiteId={form.worksiteId} requestType={form.requestType} urgency={form.urgency}
            deliveryMode={form.deliveryMode} requiredDate={form.requiredDate} notes={form.notes} readOnly={form.readOnly}
            worksites={worksites} requestTypeOpts={form.requestTypeOpts}
            onWorksiteChange={form.setWorksiteId} onRequestTypeChange={form.setRequestType}
            onUrgencyChange={form.setUrgency} onDeliveryModeChange={form.setDeliveryMode} onRequiredDateChange={form.setRequiredDate}
            onNotesChange={form.setNotes}
            requiredDateError={form.requiredDateError}
          />
          {QUOTATION_TYPES.has(form.requestType) && !form.readOnly && (
            <div className="flex items-start gap-2.5 rounded-[var(--radius)] border border-[var(--color-signal-line)] bg-[var(--color-signal-tint)] px-4 py-3">
              <Info size={14} weight="fill" className="mt-0.5 shrink-0 text-[var(--color-signal-ink)]" />
              <div>
                <p className="text-xs font-medium text-[var(--color-signal-ink)]">Flujo para {form.requestTypeLabel}</p>
                <p className="mt-0.5 text-xs text-[var(--color-signal-ink)] opacity-80">Agrega los ítems → Guarda el borrador → Adjunta cotización por ítem → Envía a revisión.</p>
              </div>
            </div>
          )}
          <ItemsSection
            items={form.items} requestType={form.requestType} requestTypeLabel={form.requestTypeLabel}
            readOnly={form.readOnly} savedId={form.savedId} itemsError={form.itemsError}
            products={products} suppliers={suppliers} workers={workers} maxFileSizeMb={maxFileSizeMb}
            onAdd={form.addItem} onRemove={form.removeItem} onUpdate={form.updateItem}
            onSelectProduct={form.selectProduct} onSelectFreeProduct={form.selectFreeProduct}
            onClearProduct={form.clearProduct} onUpdateAttr={form.updateAttr}
            onUpdateWorker={form.updateItemWorker}
            resubmitAction={form.resubmitAction} resubmitPending={form.resubmitPending}
          />
          {form.isDraft && (
            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
              <Button type="button" variant="ghost" size="sm" onClick={() => {
                if (form.dirty) setLeaveConfirmOpen(true)
                else form.silentNavBack()
              }}>
                <ArrowLeft size={14} /> Volver
              </Button>
              <div className="flex items-center gap-3">
                <span aria-live="polite" className="text-[11px] text-[var(--color-text-subtle)]">
                  {(form.isSaving || form.isSubmitting || form.draftPending) ? "Guardando..."
                    : form.dirty ? "Cambios sin guardar"
                    : form.lastSavedAt ? `Guardado ${formatDateTime(form.lastSavedAt).slice(11, 16)}`
                    : null}
                </span>
                <SubmitButton label="Guardar borrador" loadingLabel="Guardando..." variant="secondary" size="sm" />
              </div>
            </div>
          )}
        </form>

        {form.isDraft && (
          <form onSubmit={(e) => {
            e.preventDefault()
            const fd = form.buildDraftFormData()
            fd.set("requestId", form.savedId ?? "")
            form.startSubmitTransition(() => form.submitAction(fd))
          }} className="pt-0">
            {form.submitMessage && !form.submitOk && (
              <p className="mb-3 text-xs text-[var(--color-danger)] flex items-center gap-1.5"><Warning size={14} />{form.submitMessage}</p>
            )}
            <div className="flex items-center justify-end gap-3">
              {(form.isEdit as boolean) && (
                <Dialog>
                  <DialogTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="text-[var(--color-danger)] hover:text-[var(--color-danger)]">Cancelar solicitud</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>¿Cancelar esta solicitud?</DialogTitle>
                      <DialogDescription>La solicitud {editRequest!.code} saldrá del flujo de aprobación y tendrás que crearla de nuevo si la necesitas. Esta acción no se puede deshacer.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <DialogClose asChild><Button type="button" variant="ghost" size="sm">Volver</Button></DialogClose>
                      <form action={form.cancelAction}>
                        <input type="hidden" name="requestId" value={editRequest!.id} />
                        <SubmitButton label="Cancelar solicitud" loadingLabel="Cancelando..." variant="destructive" size="sm" />
                      </form>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
              <SubmitButton label="Enviar a aprobación" loadingLabel="Enviando..." variant="primary" />
            </div>
          </form>
        )}

        {form.readOnly && (
          <div className="flex items-center justify-between gap-3 pt-2">
            <p className="text-xs text-text-subtle">Esta solicitud está en estado <strong>{form.statusLabel}</strong> y no puede modificarse.</p>
            {form.canCancelRequest && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="text-[var(--color-danger)] hover:text-[var(--color-danger)]">
                    Cancelar solicitud
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>¿Cancelar esta solicitud?</DialogTitle>
                    <DialogDescription>Indica el motivo para sacar la solicitud {editRequest!.code} del flujo. Solo se permite si aún no tiene ítems en compra, recepción o entrega.</DialogDescription>
                  </DialogHeader>
                  <form action={form.cancelAction} className="space-y-4">
                    <input type="hidden" name="requestId" value={editRequest!.id} />
                    <Field label="Motivo" required htmlFor="cancelReason">
                      <Textarea id="cancelReason" name="reason" rows={3} placeholder="Ej: la necesidad fue anulada por la faena" required />
                    </Field>
                    <DialogFooter>
                      <DialogClose asChild><Button type="button" variant="ghost" size="sm">Volver</Button></DialogClose>
                      <SubmitButton label="Cancelar solicitud" loadingLabel="Cancelando..." variant="destructive" size="sm" />
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        )}

        {form.isDraft && (
          <ConfirmDialog
            open={leaveConfirmOpen}
            onOpenChange={setLeaveConfirmOpen}
            title="¿Salir sin guardar?"
            description="Tienes cambios sin guardar. Si sales ahora, se perderán. Guarda el borrador antes de salir si quieres conservarlos."
            confirmLabel="Salir sin guardar"
            variant="warning"
            onConfirm={() => {
              setLeaveConfirmOpen(false)
              form.silentNavBack()
            }}
          />
        )}

        {form.isEdit && form.canDeleteRequest && (
          <ConfirmDialog
            open={form.deleteConfirmOpen}
            onOpenChange={form.setDeleteConfirmOpen}
            title="¿Eliminar solicitud?"
            description={`La solicitud ${editRequest!.code} será eliminada permanentemente junto con todos sus ítems y archivos adjuntos. Esta acción no se puede deshacer.`}
            confirmLabel="Eliminar" variant="destructive" loading={form.isDeleting}
            onConfirm={() => {
              const fd = new FormData()
              fd.set("requestId", editRequest!.id)
              form.startDeleteTransition(() => form.deleteAction(fd))
              form.setDeleteConfirmOpen(false)
            }}
          />
        )}
      </div>
      <SummarySidebar
        isDraft={form.isDraft} readOnly={form.readOnly}
        worksiteLabel={form.worksiteLabel} requestTypeLabel={form.requestTypeLabel}
        urgencyLabel={form.urgencyLabel} requiredDate={form.requiredDate}
        statusLabel={form.statusLabel} items={form.items} missingItems={form.missingItems}
      />
    </div>
  )
}
