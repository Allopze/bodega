"use client"

import * as React from "react"
import { useEffect, useState } from "react"
import { ArrowLeft, Info, Plus, Warning } from "@phosphor-icons/react"
import { SubmitButton } from "@/components/ui/submit-button"
import { toast } from "@/lib/toast"
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
import { formatDate, formatDateTime, formatQty } from "@/lib/utils"
import { QUOTATION_TYPES } from "@/lib/request-types"
import type { RequestType } from "@/lib/request-types"
import type { ItemRow, ProductOption, WorksiteOption, SupplierOption, WorkerOption, EquipmentOption, EditRequest, PrefillItem } from "./request-form.types"
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
  /**
   * Códigos de `product_units` (activos, ordenados) para el datalist de unidad.
   * Requerido y no opcional-con-default a propósito: era una constante
   * hardcodeada de 13 valores que el catálogo del admin no alimentaba, así que
   * crear una unidad ahí no aparecía nunca acá. Que el compilador obligue a
   * pasarla evita que vuelva a divergir en silencio.
   */
  units: string[]
  products: ProductOption[]
  suppliers: SupplierOption[]
  workers?: WorkerOption[]
  equipment?: EquipmentOption[]
  editRequest?: EditRequest
  maxFileSizeMb: number
  userRoles?: string[]
  userPermissions?: string[]
  initialRequestType?: RequestType
  initialRequestTypeNotice?: string
  /** Ítems con los que se abre el creador (reposición de EPP o copia). */
  prefillItems?: PrefillItem[]
  /** Explica de dónde salieron los ítems precargados. */
  prefillNotice?: string
  /** Faena con la que se abre el creador, ya validada en el servidor. */
  initialWorksiteId?: string
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
  /**
   * En modo consulta los controles van `disabled`, y `disabled:opacity-50` dejaba
   * los **valores** de la solicitud en 3.53:1 — bajo el mínimo AA de 4.5:1 (medido,
   * auditoría UI/UX 2026-07-29 §5.6). Un dato en una ficha de lectura es contenido,
   * no un control inactivo: la exención de WCAG 1.4.3 no lo cubre. Sigue siendo
   * no interactivo; sólo recupera la opacidad.
   */
  const readOnlyLook = readOnly ? "disabled:opacity-100 disabled:cursor-default" : undefined

  return (
    <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5 space-y-4">
      <h2 className="text-h2 text-[var(--color-text)]">Datos de la solicitud</h2>
      {/* A-22: en modo consulta los textos de ayuda son instrucciones para llenar
          un formulario que ya no se llena ("La jefatura confirma al aprobar"), y
          sumados a los selects deshabilitados hacían leer la ficha como un
          formulario averiado. En lectura sólo quedan las etiquetas y los valores. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Faena" required htmlFor="worksiteId">
          <Select value={worksiteId} onValueChange={onWorksiteChange} disabled={readOnly}>
            <SelectTrigger id="worksiteId" className={readOnlyLook}><SelectValue placeholder="Selecciona una faena" /></SelectTrigger>
            <SelectContent>{worksites.map((w) => (<SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>))}</SelectContent>
          </Select>
        </Field>
        <Field label="Tipo de solicitud" htmlFor="requestType" helper={readOnly ? undefined : "EPP: elementos de protección personal. El tipo clasifica la solicitud para su revisión y compra."}>
          <Select value={requestType} onValueChange={onRequestTypeChange} disabled={readOnly}>
            <SelectTrigger id="requestType" className={readOnlyLook}><SelectValue /></SelectTrigger>
            <SelectContent>{requestTypeOpts.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent>
          </Select>
        </Field>
        {/* A-15: decía "Alta y Crítico destacan los ítems en la cola", pero la
            urgencia del ítem gana sobre la de la solicitud (`COALESCE(item, request)`
            en la cola operacional). El texto ahora dice cuál manda. */}
        <Field label="Urgencia" htmlFor="urgency" helper={readOnly ? undefined : "Valor por defecto de los ítems. Cada ítem puede fijar la suya y esa es la que prioriza en la cola."}>
          <Select value={urgency} onValueChange={onUrgencyChange} disabled={readOnly}>
            <SelectTrigger id="urgency" className={readOnlyLook}><SelectValue /></SelectTrigger>
            <SelectContent>{URGENCY_OPTS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent>
          </Select>
        </Field>
        <Field label="Despacho sugerido" htmlFor="deliveryMode" helper={readOnly ? undefined : "Vía oficina (estándar) o Directo a faena (urgencia/volumen). La jefatura confirma al aprobar."}>
          <Select value={deliveryMode} onValueChange={onDeliveryModeChange} disabled={readOnly}>
            <SelectTrigger id="deliveryMode" className={readOnlyLook}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="via_oficina">Vía oficina (Estándar)</SelectItem>
              <SelectItem value="directo_faena">Directo a faena (Urgencia/Directo)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Fecha requerida" required htmlFor="requiredDate"
          error={requiredDateError}
        >
          <DatePicker id="requiredDate" name="requiredDate" value={requiredDate} onChange={onRequiredDateChange} disabled={readOnly} className={readOnlyLook} />
        </Field>
      </div>
      <Field label="Notas generales" htmlFor="notes">
        <Textarea id="notes" name="notes" placeholder="Observaciones, contexto de la solicitud..." rows={2} disabled={readOnly} className={readOnlyLook} value={notes} onChange={(e) => onNotesChange(e.target.value)} />
      </Field>
    </section>
  )
}

function ItemsSection({
  items, requestType, requestTypeLabel: _requestTypeLabel, readOnly, savedId, itemsError,
  products, suppliers, workers, equipment, maxFileSizeMb, units,
  onAdd, onRemove, onUpdate, onSelectProduct, onSelectFreeProduct, onClearProduct, onUpdateAttr, onUpdateWorker,
}: {
  items: ItemRow[]; requestType: string; requestTypeLabel?: string; readOnly: boolean; savedId?: string
  itemsError?: string; products: ProductOption[]; suppliers: SupplierOption[]; workers?: WorkerOption[]
  equipment?: EquipmentOption[]; maxFileSizeMb: number; units: string[]
  onAdd: () => void; onRemove: (key: string) => void; onUpdate: (key: string, patch: Partial<ItemRow>) => void
  onSelectProduct: (key: string, pid: string) => void; onSelectFreeProduct: (key: string, name: string) => void
  onClearProduct: (key: string) => void; onUpdateAttr: (itemKey: string, attrIdx: number, value: string) => void
  onUpdateWorker: (itemKey: string, workerId: string) => void
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
          Los archivos que adjuntes se suben al guardar el borrador.
        </p>
      )}
      {/* Un solo datalist para todos los ítems: estaba dentro de ItemEditor, así
          que con 2+ ítems el DOM quedaba con IDs repetidos (inválido, y axe lo
          marca como duplicate-id). Los inputs lo referencian por ese id. */}
      <datalist id="unit-of-measure-options">
        {units.map((unit) => <option key={unit} value={unit} />)}
      </datalist>
      <div className="space-y-2">
        {items.map((item, idx) => (
          <ItemEditor key={item._key} item={item} idx={idx} products={products} suppliers={suppliers} workers={workers} equipment={equipment}
            readOnly={readOnly} requestType={requestType} maxFileSizeMb={maxFileSizeMb}
            onUpdate={(patch) => onUpdate(item._key, patch)}
            onSelectProduct={(pid) => onSelectProduct(item._key, pid)}
            onSelectFreeProduct={(name) => onSelectFreeProduct(item._key, name)}
            onClearProduct={() => onClearProduct(item._key)}
            onUpdateAttr={(i, v) => onUpdateAttr(item._key, i, v)}
            onUpdateWorker={(workerId) => onUpdateWorker(item._key, workerId)}
            onRemove={() => onRemove(item._key)} canRemove={items.length > 1}
          />
        ))}
      </div>
    </section>
  )
}

function SummarySidebar({
  isDraft, readOnly: _readOnly, isQuotation, worksiteLabel, requestTypeLabel, urgencyLabel, requiredDate,
  statusLabel, items, missingItems,
}: {
  isDraft: boolean; readOnly?: boolean; isQuotation: boolean; worksiteLabel: string; requestTypeLabel: string
  urgencyLabel: string; requiredDate: string; statusLabel: string; items: ItemRow[]
  missingItems: string[]
}) {
  return (
    <aside className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4 lg:sticky lg:top-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Resumen</h2>
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
            {!isDraft ? "Consulta el estado y los datos registrados."
              : isQuotation ? "Guarda el borrador, adjunta cotizaciones y envía a revisión."
              : "Al crearla, la solicitud entra directo a aprobación."}
          </p>
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
          {isDraft ? (missingItems.length === 0 ? (isQuotation ? "Listo para enviar" : "Listo para crear") : "Pendientes") : statusLabel}
        </p>
        {!isDraft ? (
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">Esta solicitud ya fue enviada y se muestra en modo consulta.</p>
        ) : missingItems.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
            Los campos requeridos y los ítems tienen la información mínima.
            {!isQuotation && " Quien aprueba podrá ajustar cantidades o rechazar ítems sueltos."}
          </p>
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

export function RequestForm({
  worksites,
  products,
  units,
  suppliers,
  workers,
  equipment,
  editRequest,
  maxFileSizeMb,
  userPermissions = [],
  initialRequestType,
  initialRequestTypeNotice,
  prefillItems,
  prefillNotice,
  initialWorksiteId,
}: RequestFormProps) {
  const form = useRequestForm({
    worksites,
    products,
    suppliers,
    workers,
    editRequest,
    maxFileSizeMb,
    userPermissions,
    initialRequestType,
    prefillItems,
    initialWorksiteId,
  })
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const stockWarning = form.stockWarning

  /**
   * El HTML que manda el servidor ya se ve y se deja escribir antes de que
   * React hidrate. En un equipo o una red lentos alcanzas a llenar el primer
   * ítem en esa ventana, pero ese texto vive sólo en el DOM —el estado del
   * formulario nunca lo vio—, así que el primer re-render lo repone en blanco:
   * llenabas el ítem, pulsabas "Agregar ítem" y parecía que se borraba solo.
   *
   * `inert` cierra la ventana: hasta que el cliente monta, el formulario no
   * acepta foco ni tecleo. No hay nada que perder porque tampoco se podía
   * enviar (los ítems se serializan en el cliente).
   */
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])

  return (
    <div className="grid gap-6 pb-16 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start" aria-busy={!hydrated}>
      <div className="min-w-0 space-y-8">
        <form
          inert={!hydrated}
          onSubmit={(e) => {
            e.preventDefault()
            if (form.isQuotation) {
              // Guardar borrador sí acepta datos incompletos: es el punto del borrador.
              form.startSaveTransition(() => form.draftAction(form.buildDraftFormData()))
              return
            }
            // El panel lateral ya listaba estos problemas, pero el envío no los
            // miraba: una cantidad vacía se enviaba igual (y llegaba al servidor
            // como 1). El envío es un acto único para EPP/otro, así que se corta acá.
            if (form.missingItems.length > 0) {
              toast.error(form.missingItems[0]!)
              return
            }
            // EPP/otro: un solo acto. Antes de crear, el servidor revisa el
            // stock vigente de la faena y puede pedir una decisión explícita.
            form.submitDirectRequest()
          }}
          className="space-y-6"
        >
          {initialRequestTypeNotice && !form.readOnly && (
            <div role="alert" className="rounded-[var(--radius)] border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-4 py-3 text-sm text-[var(--color-warning-ink)]">
              {initialRequestTypeNotice}
            </div>
          )}
          {prefillNotice && !form.readOnly && (
            <div className="flex items-start gap-2.5 rounded-[var(--radius)] border border-[var(--color-info-line)] bg-[var(--color-info-tint)] px-4 py-3">
              <Info size={14} weight="fill" className="mt-0.5 shrink-0 text-[var(--color-info-ink)]" />
              <p className="text-xs text-[var(--color-info-ink)]">{prefillNotice}</p>
            </div>
          )}
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
            products={products} suppliers={suppliers} workers={workers} equipment={equipment} maxFileSizeMb={maxFileSizeMb}
            units={units}
            onAdd={form.addItem} onRemove={form.removeItem} onUpdate={form.updateItem}
            onSelectProduct={form.selectProduct} onSelectFreeProduct={form.selectFreeProduct}
            onClearProduct={form.clearProduct} onUpdateAttr={form.updateAttr}
            onUpdateWorker={form.updateItemWorker}
          />
          {form.isDraft && (
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-[var(--color-border)]">
              <Button type="button" variant="ghost" size="sm" onClick={() => {
                if (form.dirty) setLeaveConfirmOpen(true)
                else form.silentNavBack()
              }}>
                <ArrowLeft size={14} /> Volver
              </Button>
              {form.isQuotation ? (
                <div className="flex items-center gap-3">
                  <span aria-live="polite" className="text-[11px] text-[var(--color-text-subtle)]">
                    {(form.isSaving || form.isSubmitting || form.draftPending) ? "Guardando..."
                      : form.dirty ? "Cambios sin guardar"
                      : form.lastSavedAt ? `Guardado ${formatDateTime(form.lastSavedAt).slice(11, 16)}`
                      : null}
                  </span>
                  <SubmitButton
                    label="Guardar borrador" loadingLabel="Guardando..." variant="secondary" size="sm"
                    loading={form.isSaving || form.draftPending} disabled={form.isSaving || form.draftPending}
                  />
                </div>
              ) : (
                <div className="flex flex-col items-end gap-2">
                  {form.submitMessage && !form.submitOk && (
                    <p className="text-xs text-[var(--color-danger)] flex items-center gap-1.5"><Warning size={14} />{form.submitMessage}</p>
                  )}
                  <SubmitButton
                    label="Crear y enviar a aprobación" loadingLabel="Enviando..." variant="primary"
                    loading={form.isSubmitting} disabled={form.isSubmitting}
                  />
                </div>
              )}
            </div>
          )}
        </form>

        <Dialog
          open={stockWarning !== null}
          onOpenChange={(open) => {
            if (!open && !form.isSubmitting) form.dismissStockWarning()
          }}
        >
          {stockWarning && (
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Hay EPP disponible en bodega</DialogTitle>
                <DialogDescription>
                  Antes de crear la solicitud, revisa el stock físico disponible en {stockWarning.worksiteName}.
                  Puedes cancelar para utilizarlo o continuar de forma explícita con la solicitud de compra.
                </DialogDescription>
              </DialogHeader>
              <ul className="max-h-72 space-y-2 overflow-y-auto" aria-label="EPP con stock disponible">
                {stockWarning.items.map((item) => (
                  <li key={item.productId} className="rounded-[var(--radius)] border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-[var(--color-text)]">{item.productName}</p>
                        <p className="mt-0.5 text-xs text-[var(--color-warning-ink)]">Ubicación: {item.locationName || stockWarning.worksiteName}</p>
                      </div>
                      <span className="rounded-full border border-[var(--color-warning-line)] bg-[var(--color-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-warning-ink)]">
                        {item.coverage === "total" ? "Cobertura total" : "Cobertura parcial"}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
                      <span>Solicitado: {formatQty(item.requestedQuantity)}</span>
                      <span>Disponible: {formatQty(item.availableQuantity)}</span>
                    </div>
                  </li>
                ))}
              </ul>
              {form.submitMessage && !form.submitOk && (
                <p role="alert" className="flex items-center gap-1.5 text-xs text-[var(--color-danger)]">
                  <Warning size={14} />{form.submitMessage}
                </p>
              )}
              <DialogFooter className="flex-col items-stretch sm:flex-row sm:items-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full sm:w-auto"
                  disabled={form.isSubmitting}
                  onClick={form.dismissStockWarning}
                >
                  Cancelar y volver al formulario
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="w-full sm:w-auto"
                  loading={form.isSubmitting}
                  disabled={form.isSubmitting}
                  onClick={() => form.submitDirectRequest(stockWarning.confirmationToken)}
                >
                  Continuar con la solicitud
                </Button>
              </DialogFooter>
            </DialogContent>
          )}
        </Dialog>

        {form.isDraft && form.isQuotation && (
          <form onSubmit={(e) => {
            e.preventDefault()
            if (form.missingItems.length > 0) {
              toast.error(form.missingItems[0]!)
              return
            }
            const fd = form.buildDraftFormData()
            fd.set("requestId", form.savedId ?? "")
            form.startSubmitTransition(() => form.submitAction(fd))
          }}
          /* M-7: el contenedor padre aplica `space-y-8` (32px), que dejaba
             "Enviar a aprobación" flotando lejos de "Volver / Guardar borrador"
             y visualmente fuera de la tarjeta. `-mt-6` cancela casi todo ese
             hueco para que las dos filas se lean como una sola barra de acciones.
             Siguen siendo dos <form> porque `SubmitButton` lee `useFormStatus`,
             que sólo funciona dentro del form que envía. */
          className="-mt-6">
            {form.submitMessage && !form.submitOk && (
              <p className="mb-3 text-xs text-[var(--color-danger)] flex items-center gap-1.5"><Warning size={14} />{form.submitMessage}</p>
            )}
            <div className="flex items-center justify-end gap-3">
              {form.isEdit && (
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
              <SubmitButton
                label="Enviar a aprobación" loadingLabel="Enviando..." variant="primary"
                loading={form.isSubmitting} disabled={form.isSubmitting}
              />
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
          // El mismo diálogo cubre las dos salidas: el botón "Volver" y un clic
          // en cualquier enlace interno (rail, breadcrumb, TopBar), que antes
          // descartaba el formulario sin preguntar.
          <ConfirmDialog
            open={leaveConfirmOpen || form.pendingHref !== null}
            onOpenChange={(open) => {
              if (open) return
              setLeaveConfirmOpen(false)
              form.setPendingHref(null)
            }}
            title="¿Salir sin guardar?"
            description={form.isQuotation
              ? "Tienes cambios sin guardar. Si sales ahora, se perderán. Guarda el borrador antes de salir si quieres conservarlos."
              : "Lo que escribiste se perderá: esta solicitud todavía no existe, se crea al enviarla a aprobación."}
            confirmLabel="Salir sin guardar"
            variant="warning"
            onConfirm={() => {
              if (form.pendingHref !== null) {
                form.confirmLeave()
                return
              }
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
        isDraft={form.isDraft} readOnly={form.readOnly} isQuotation={form.isQuotation}
        worksiteLabel={form.worksiteLabel} requestTypeLabel={form.requestTypeLabel}
        urgencyLabel={form.urgencyLabel} requiredDate={form.requiredDate}
        statusLabel={form.statusLabel} items={form.items} missingItems={form.missingItems}
      />
    </div>
  )
}
