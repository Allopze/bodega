"use client"

import * as React from "react"
import { useActionState, useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Plus, Trash, CaretDown, CaretUp, Warning,
  Package, ArrowLeft,
} from "@phosphor-icons/react"
import { SubmitButton } from "@/components/admin/submit-button"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { saveDraft, submitRequest, cancelRequest } from "./actions"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { ProductPicker } from "./product-picker"
import type { ActionState } from "@/lib/validation/operations"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProductOption {
  id:              string
  sku:             string
  name:            string
  isEpp:           boolean
  unitOfMeasure:   string
  categoryName:    string
  referencePrice:  number | null
  attributes:      { id: string; name: string; type: string; isRequired: boolean; options: string | null }[]
}

export interface WorksiteOption {
  id: string
  name: string
}

export interface SupplierOption {
  id:   string
  name: string
}

export interface EditRequest {
  id:          string
  code:        string
  worksiteId:  string
  requestType: string
  urgency:     string
  requiredDate: string | null
  status:      string
  notes:       string | null
  items:       EditItem[]
}

interface EditItem {
  id:                  string
  productId:           string | null
  productNameFree:     string | null
  quantity:            number
  unitOfMeasure:       string
  urgency:             string
  suggestedSupplierId: string | null
  supplierHint:        string | null
  notes:               string | null
  attributes:          { attributeId: string | null; attributeName: string; value: string }[]
}

// ── Local item state ──────────────────────────────────────────────────────────

interface ItemRow {
  _key:                string   // stable React key
  id?:                 string   // DB id on edit
  productId:           string | null
  productNameFree:     string
  quantity:            string
  unitOfMeasure:       string
  urgency:             string
  suggestedSupplierId: string
  supplierHint:        string
  notes:               string
  attributes:          AttrRow[]
  isEpp:               boolean  // derived from product
  // transient UI
  productName:         string
  showAttrs:           boolean
}

interface AttrRow {
  attributeId:   string | null
  attributeName: string
  value:         string
  isRequired:    boolean
  type:          string
  options:       string[]
}

function blankItem(key = "new-0"): ItemRow {
  return {
    _key:                key,
    productId:           null,
    productNameFree:     "",
    quantity:            "1",
    unitOfMeasure:       "unidad",
    urgency:             "normal",
    suggestedSupplierId: "",
    supplierHint:        "",
    notes:               "",
    attributes:          [],
    isEpp:               false,
    productName:         "",
    showAttrs:           false,
  }
}

function buildAttrsFromProduct(prod: ProductOption): AttrRow[] {
  return prod.attributes.map((a) => ({
    attributeId:   a.id,
    attributeName: a.name,
    value:         "",
    isRequired:    a.isRequired,
    type:          a.type,
    options:       a.options ? (JSON.parse(a.options) as string[]) : [],
  }))
}

// ── Urgency & request-type helpers ────────────────────────────────────────────

const URGENCY_OPTS = [
  { value: "normal",   label: "Normal"   },
  { value: "high",     label: "Alta"     },
  { value: "critical", label: "Crítica"  },
]

const REQUEST_TYPE_OPTS = [
  { value: "epp",        label: "EPP"        },
  { value: "stock",      label: "Stock"      },
  { value: "mantencion", label: "Mantención" },
  { value: "otro",       label: "Otro"       },
]

// ── Main component ────────────────────────────────────────────────────────────

interface RequestFormProps {
  worksites:    WorksiteOption[]
  products:     ProductOption[]
  suppliers:    SupplierOption[]
  editRequest?: EditRequest
}

export function RequestForm({ worksites, products, suppliers, editRequest }: RequestFormProps) {
  const router = useRouter()
  const isEdit  = !!editRequest
  const isDraft = !isEdit || ["draft", "returned"].includes(editRequest.status)

  // ── Form action state
  const [draftState,  draftAction]  = useActionState<ActionState, FormData>(saveDraft,    INITIAL_STATE)
  const [submitState, submitAction] = useActionState<ActionState, FormData>(submitRequest, INITIAL_STATE)
  const [cancelState, cancelAction] = useActionState<ActionState, FormData>(cancelRequest, INITIAL_STATE)

  // ── Header fields
  const [worksiteId,  setWorksiteId]  = useState(editRequest?.worksiteId  ?? (worksites[0]?.id ?? ""))
  const [requestType, setRequestType] = useState(editRequest?.requestType ?? "epp")
  const [urgency,     setUrgency]     = useState(editRequest?.urgency     ?? "normal")
  const [requiredDate, setRequiredDate] = useState(editRequest?.requiredDate ?? "")
  const [notes,       setNotes]       = useState(editRequest?.notes       ?? "")

  // ── Items
  const [items, setItems] = useState<ItemRow[]>(() => {
    if (editRequest && editRequest.items.length > 0) {
      return editRequest.items.map((item) => {
        const prod = item.productId ? products.find((p) => p.id === item.productId) : null
        return {
          _key:                item.id ?? `edit-${item.productId ?? item.productNameFree ?? "item"}`,
          id:                  item.id,
          productId:           item.productId,
          productNameFree:     item.productNameFree ?? "",
          quantity:            String(item.quantity),
          unitOfMeasure:       item.unitOfMeasure,
          urgency:             item.urgency,
          suggestedSupplierId: item.suggestedSupplierId ?? "",
          supplierHint:        item.supplierHint ?? "",
          notes:               item.notes ?? "",
          isEpp:               prod?.isEpp ?? false,
          productName:         prod?.name ?? item.productNameFree ?? "",
          showAttrs:           item.attributes.length > 0,
          attributes:          item.attributes.map((a) => {
            const prodAttr = prod?.attributes.find((pa) => pa.id === a.attributeId)
            return {
              attributeId:   a.attributeId,
              attributeName: a.attributeName,
              value:         a.value,
              isRequired:    prodAttr?.isRequired ?? false,
              type:          prodAttr?.type ?? "text",
              options:       prodAttr?.options ? (JSON.parse(prodAttr.options) as string[]) : [],
            }
          }),
        }
      })
    }
    return [blankItem()]
  })

  // ── Toast on draft save
  useEffect(() => {
    if (draftState.ok) toast.success(draftState.message ?? "Borrador guardado")
    else if (draftState.message && !draftState.ok && draftState.message !== "Sin permisos para crear solicitudes") {
      toast.error(draftState.message)
    }
  }, [draftState])

  useEffect(() => {
    if (submitState.message && !submitState.ok) toast.error(submitState.message)
  }, [submitState])

  useEffect(() => {
    if (cancelState.message && !cancelState.ok) toast.error(cancelState.message)
  }, [cancelState])

  // ── Item mutations
  const addItem = useCallback(() => setItems((prev) => [...prev, blankItem(crypto.randomUUID())]), [])

  const removeItem = useCallback((key: string) => {
    setItems((prev) => prev.length > 1 ? prev.filter((i) => i._key !== key) : prev)
  }, [])

  const updateItem = useCallback((key: string, patch: Partial<ItemRow>) => {
    setItems((prev) => prev.map((i) => i._key === key ? { ...i, ...patch } : i))
  }, [])

  const selectProduct = useCallback((key: string, prodId: string) => {
    const prod = products.find((p) => p.id === prodId)
    if (!prod) return
    setItems((prev) => prev.map((i) => {
      if (i._key !== key) return i
      const attrs = buildAttrsFromProduct(prod)
      return {
        ...i,
        productId:       prod.id,
        productNameFree: "",
        productName:     prod.name,
        unitOfMeasure:   prod.unitOfMeasure,
        isEpp:           prod.isEpp,
        attributes:      attrs,
        showAttrs:       attrs.length > 0,
      }
    }))
  }, [products])

  const selectFreeProduct = useCallback((key: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setItems((prev) => prev.map((i) =>
      i._key !== key ? i : {
        ...i,
        productId:       null,
        productNameFree: trimmed,
        productName:     trimmed,
        isEpp:           false,
        unitOfMeasure:   i.unitOfMeasure || "unidad",
        attributes:      [],
        showAttrs:       false,
      },
    ))
  }, [])

  const clearProduct = useCallback((key: string) => {
    setItems((prev) => prev.map((i) =>
      i._key !== key ? i : { ...i, productId: null, productNameFree: "", productName: "", isEpp: false, attributes: [], showAttrs: false }
    ))
  }, [])

  const updateAttr = useCallback((itemKey: string, attrIdx: number, value: string) => {
    setItems((prev) => prev.map((i) => {
      if (i._key !== itemKey) return i
      const attrs = i.attributes.map((a, idx) => idx === attrIdx ? { ...a, value } : a)
      return { ...i, attributes: attrs }
    }))
  }, [])

  // Serialised payload for hidden inputs
  const itemsJson = JSON.stringify(items.map((item) => ({
    id:                  item.id,
    productId:           item.productId,
    productNameFree:     item.productNameFree || null,
    quantity:            Number(item.quantity) || 1,
    unitOfMeasure:       item.unitOfMeasure,
    urgency:             item.urgency,
    requiredDate:        requiredDate || null,
    suggestedSupplierId: item.suggestedSupplierId || null,
    supplierHint:        item.supplierHint || null,
    notes:               item.notes || null,
    attributes:          item.attributes.map((a) => ({
      attributeId:   a.attributeId,
      attributeName: a.attributeName,
      value:         a.value,
    })),
  })))

  const readOnly = !isDraft
  const itemsError = draftState.fieldErrors?.items?.[0] ?? submitState.fieldErrors?.items?.[0]
  const requestTypeLabel = REQUEST_TYPE_OPTS.find((option) => option.value === requestType)?.label ?? requestType
  const urgencyLabel = URGENCY_OPTS.find((option) => option.value === urgency)?.label ?? urgency
  const worksiteLabel = worksites.find((worksite) => worksite.id === worksiteId)?.name ?? "Sin faena"
  const missingItems = buildRequestSummaryIssues({ worksiteId, requiredDate, items })

  return (
    <div className="grid gap-6 pb-16 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="min-w-0 space-y-8">
      {/* ── Draft/Submit form ─────────────────────────────────────────────── */}
      <form action={draftAction} className="space-y-6">
        {/* Hidden fields */}
        {isEdit && <input type="hidden" name="id" value={editRequest.id} />}
        <input type="hidden" name="itemsJson"    value={itemsJson} />
        <input type="hidden" name="worksiteId"   value={worksiteId} />
        <input type="hidden" name="requestType"  value={requestType} />
        <input type="hidden" name="urgency"      value={urgency} />

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <section className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-5 space-y-4">
          <h2 className="text-h2 text-[var(--color-text)]">
            Datos de la solicitud
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Faena" required htmlFor="worksiteId">
              <Select
                value={worksiteId}
                onValueChange={setWorksiteId}
                disabled={readOnly}
              >
                <SelectTrigger id="worksiteId">
                  <SelectValue placeholder="Selecciona una faena" />
                </SelectTrigger>
                <SelectContent>
                  {worksites.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Tipo de solicitud" htmlFor="requestType">
              <Select value={requestType} onValueChange={setRequestType} disabled={readOnly}>
                <SelectTrigger id="requestType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REQUEST_TYPE_OPTS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Urgencia" htmlFor="urgency">
              <Select value={urgency} onValueChange={setUrgency} disabled={readOnly}>
                <SelectTrigger id="urgency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {URGENCY_OPTS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Fecha requerida"
              required
              htmlFor="requiredDate"
              error={draftState.fieldErrors?.requiredDate?.[0] ?? submitState.fieldErrors?.requiredDate?.[0]}
            >
              <Input
                id="requiredDate"
                type="date"
                name="requiredDate"
                value={requiredDate}
                onChange={(event) => setRequiredDate(event.target.value)}
                required
                disabled={readOnly}
              />
            </Field>
          </div>

          <Field label="Notas generales" htmlFor="notes">
            <Textarea
              id="notes"
              name="notes"
              placeholder="Observaciones, contexto de la solicitud..."
              rows={2}
              disabled={readOnly}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
        </section>

        {/* ── Items ──────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-h2 text-[var(--color-text)]">
              Ítems solicitados
              <span className="ml-2 text-xs font-normal text-[var(--color-text-subtle)]">
                {items.length} {items.length === 1 ? "ítem" : "ítems"}
              </span>
            </h2>
            {!readOnly && (
              <Button type="button" variant="ghost" size="sm" onClick={addItem}>
                <Plus weight="bold" size={13} />
                Agregar ítem
              </Button>
            )}
          </div>

          {itemsError && (
            <p className="text-xs text-[var(--color-danger)]">
              {itemsError}
            </p>
          )}

          <div className="space-y-2">
            {items.map((item, idx) => (
              <ItemEditor
                key={item._key}
                item={item}
                idx={idx}
                products={products}
                suppliers={suppliers}
                readOnly={readOnly}
                onUpdate={(patch) => updateItem(item._key, patch)}
                onSelectProduct={(pid) => selectProduct(item._key, pid)}
                onSelectFreeProduct={(name) => selectFreeProduct(item._key, name)}
                onClearProduct={() => clearProduct(item._key)}
                onUpdateAttr={(i, v) => updateAttr(item._key, i, v)}
                onRemove={() => removeItem(item._key)}
                canRemove={items.length > 1}
              />
            ))}
          </div>
        </section>

        {/* ── Save draft button ───────────────────────────────────────────── */}
        {isDraft && (
          <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
            >
              <ArrowLeft size={14} />
              Volver
            </Button>
            <SubmitButton label="Guardar borrador" loadingLabel="Guardando..." variant="secondary" size="sm" />
          </div>
        )}
      </form>

      {/* ── Submit form (separate to distinguish the action) ─────────────── */}
      {isDraft && (
        <form action={submitAction} className="pt-0">
          <input type="hidden" name="requestId"   value={editRequest?.id ?? ""} />
          <input type="hidden" name="itemsJson"   value={itemsJson} />
          <input type="hidden" name="worksiteId"  value={worksiteId} />
          <input type="hidden" name="requestType" value={requestType} />
          <input type="hidden" name="urgency"     value={urgency} />
          <input type="hidden" name="requiredDate" value={requiredDate} />
          <input type="hidden" name="notes"       value={notes} />
          {submitState.message && !submitState.ok && (
            <p className="mb-3 text-xs text-[var(--color-danger)] flex items-center gap-1.5">
              <Warning size={14} />
              {submitState.message}
            </p>
          )}
          <div className="flex items-center justify-end gap-3">
            {isEdit && (
              <Button
                type="submit"
                formAction={cancelAction}
                variant="ghost"
                size="sm"
                className="text-[var(--color-danger)] hover:text-[var(--color-danger)]"
              >
                Cancelar solicitud
              </Button>
            )}
            <SubmitButton label="Enviar a aprobación" loadingLabel="Enviando..." variant="primary" />
          </div>
        </form>
      )}

      {/* ── Read-only notice ──────────────────────────────────────────────── */}
      {readOnly && (
        <p className="text-xs text-[var(--color-text-subtle)] pt-2">
          Esta solicitud está en estado <strong>{editRequest?.status}</strong> y no puede modificarse.
        </p>
      )}
      </div>

      <aside className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4 lg:sticky lg:top-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Resumen</h2>
            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
              Revisa la solicitud antes de enviarla.
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
          <SummaryLine label="Fecha requerida" value={requiredDate || "Pendiente"} muted={!requiredDate} />
        </dl>

        <div className="mt-4 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          <p className="text-xs font-medium text-[var(--color-text)]">
            {missingItems.length === 0 ? "Listo para enviar" : "Pendientes"}
          </p>
          {missingItems.length === 0 ? (
            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
              Los campos requeridos y los ítems tienen la información mínima.
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
    </div>
  )
}

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

function buildRequestSummaryIssues({
  worksiteId,
  requiredDate,
  items,
}: {
  worksiteId: string
  requiredDate: string
  items: ItemRow[]
}): string[] {
  const issues: string[] = []
  if (!worksiteId) issues.push("Selecciona una faena.")
  if (!requiredDate) issues.push("Indica la fecha requerida.")

  items.forEach((item, index) => {
    const label = `Ítem ${index + 1}`
    if (!item.productId && !item.productNameFree.trim()) {
      issues.push(`${label}: selecciona o describe un producto.`)
    }
    if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) {
      issues.push(`${label}: ingresa una cantidad válida.`)
    }
    const missingAttrs = item.attributes.filter((attr) => attr.isRequired && !attr.value.trim())
    if (missingAttrs.length > 0) {
      issues.push(`${label}: completa ${missingAttrs.map((attr) => attr.attributeName).join(", ")}.`)
    }
  })

  return issues
}

// ── Item editor sub-component ─────────────────────────────────────────────────

interface ItemEditorProps {
  item:            ItemRow
  idx:             number
  products:        ProductOption[]
  suppliers:       SupplierOption[]
  readOnly:        boolean
  onUpdate:        (patch: Partial<ItemRow>) => void
  onSelectProduct: (pid: string) => void
  onSelectFreeProduct: (name: string) => void
  onClearProduct:  () => void
  onUpdateAttr:    (i: number, v: string) => void
  onRemove:        () => void
  canRemove:       boolean
}

function ItemEditor({
  item, idx, products, suppliers, readOnly,
  onUpdate, onSelectProduct, onSelectFreeProduct, onClearProduct, onUpdateAttr, onRemove, canRemove,
}: ItemEditorProps) {
  const hasSuppliers       = suppliers.length > 0
  const showSupplierSelect = !item.supplierHint || !!item.suggestedSupplierId

  return (
    <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4 space-y-4">
      {/* Row header */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[10px] font-mono text-[var(--color-text-muted)]">
          {idx + 1}
        </span>

        {/* Product picker */}
        <div className="flex-1 space-y-2">
          {item.productId ? (
            /* Product selected */
            <div className="flex items-center gap-2">
              <Package size={14} className="text-[var(--color-text-subtle)] shrink-0" />
              <span className="flex-1 text-sm font-medium text-[var(--color-text)]">{item.productName}</span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={onClearProduct}
                  className="text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] text-xs transition-colors duration-[var(--duration-fast)]"
                >
                  Cambiar
                </button>
              )}
            </div>
          ) : item.productNameFree ? (
            <div className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2">
              <Package size={14} className="text-[var(--color-text-subtle)] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--color-text)]">{item.productNameFree}</p>
                <p className="text-[11px] text-[var(--color-text-subtle)]">Ítem histórico sin catálogo</p>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onUpdate({ productNameFree: "" })}
                  className="shrink-0 text-xs text-[var(--color-primary)] transition-colors duration-[var(--duration-fast)] hover:text-[var(--color-primary-ink)] active:scale-[0.97]"
                >
                  Elegir catálogo
                </button>
              )}
            </div>
          ) : (
            /* Picker */
            !readOnly && (
              <ProductPicker
                products={products}
                onSelectProduct={(pid) => onSelectProduct(pid)}
                onSelectFreeText={(name) => onSelectFreeProduct(name)}
              />
            )
          )}
        </div>

        {/* Remove button */}
        {!readOnly && canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="mt-0.5 p-1 rounded text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)] active:scale-95"
            aria-label="Eliminar ítem"
          >
            <Trash size={14} />
          </button>
        )}
      </div>

      {/* Quantity + unit + urgency */}
      <div className="ml-8 grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Cantidad" required htmlFor={`qty-${item._key}`}>
          <Input
            id={`qty-${item._key}`}
            type="number"
            min="0.01"
            step="any"
            className="h-8 text-sm tabular-nums"
            value={item.quantity}
            onChange={(e) => onUpdate({ quantity: e.target.value })}
            disabled={readOnly}
          />
        </Field>

        <Field label="Unidad" htmlFor={`uom-${item._key}`}>
          <Input
            id={`uom-${item._key}`}
            className="h-8 text-sm"
            value={item.unitOfMeasure}
            onChange={(e) => onUpdate({ unitOfMeasure: e.target.value })}
            disabled={readOnly}
          />
        </Field>

        <Field label="Urgencia" htmlFor={`urg-${item._key}`}>
          <Select
            value={item.urgency}
            onValueChange={(v) => onUpdate({ urgency: v })}
            disabled={readOnly}
          >
            <SelectTrigger id={`urg-${item._key}`} className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {URGENCY_OPTS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {/* Supplier hint */}
      <div className="ml-8 grid grid-cols-1 gap-3">
        {/* Proveedor sugerido */}
        <Field label="Proveedor sugerido" htmlFor={`sup-${item._key}`}>
          {readOnly ? (
            <p className="text-sm text-[var(--color-text)]">
              {item.suggestedSupplierId
                ? (suppliers.find((s) => s.id === item.suggestedSupplierId)?.name ?? "—")
                : (item.supplierHint || "—")}
            </p>
          ) : hasSuppliers && showSupplierSelect ? (
            <Select
              value={item.suggestedSupplierId || "__free__"}
              onValueChange={(v) => {
                if (v === "__free__") {
                  onUpdate({ suggestedSupplierId: "", supplierHint: "" })
                } else {
                  onUpdate({ suggestedSupplierId: v, supplierHint: "" })
                }
              }}
            >
              <SelectTrigger id={`sup-${item._key}`} className="h-8 text-sm">
                <SelectValue placeholder="Seleccionar proveedor..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__free__">Escribir nombre...</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={`sup-${item._key}`}
              className="h-8 text-sm"
              placeholder="ej: treck, apro..."
              value={item.supplierHint}
              onChange={(e) => onUpdate({ supplierHint: e.target.value, suggestedSupplierId: "" })}
              disabled={readOnly}
            />
          )}
        </Field>

      </div>

      {/* Notes */}
      <div className="ml-8">
        <Input
          className="h-8 text-sm"
          placeholder="Observación del ítem (opcional)..."
          value={item.notes}
          onChange={(e) => onUpdate({ notes: e.target.value })}
          disabled={readOnly}
        />
      </div>

      {/* Attributes */}
      {item.attributes.length > 0 && (
        <div className="ml-8 space-y-3">
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors duration-[var(--duration-fast)]"
            onClick={() => onUpdate({ showAttrs: !item.showAttrs })}
          >
            {item.showAttrs ? <CaretUp size={12} /> : <CaretDown size={12} />}
            {item.showAttrs ? "Ocultar" : "Mostrar"} atributos
            <span className="ml-1 text-[var(--color-danger)]">
              {item.attributes.filter((a) => a.isRequired).length > 0 && "(requeridos)"}
            </span>
          </button>

          {item.showAttrs && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {item.attributes.map((attr, i) => (
                <Field
                  key={i}
                  label={attr.attributeName}
                  required={attr.isRequired}
                  htmlFor={`attr-${item._key}-${i}`}
                >
                  {attr.type === "select" && attr.options.length > 0 ? (
                    <Select
                      value={attr.value}
                      onValueChange={(v) => onUpdateAttr(i, v)}
                      disabled={readOnly}
                    >
                      <SelectTrigger id={`attr-${item._key}-${i}`} className="h-8 text-sm">
                        <SelectValue placeholder="Seleccionar..." />
                      </SelectTrigger>
                      <SelectContent>
                        {attr.options.map((opt) => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={`attr-${item._key}-${i}`}
                      className="h-8 text-sm"
                      placeholder={`${attr.attributeName}...`}
                      value={attr.value}
                      onChange={(e) => onUpdateAttr(i, e.target.value)}
                      disabled={readOnly}
                    />
                  )}
                </Field>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
