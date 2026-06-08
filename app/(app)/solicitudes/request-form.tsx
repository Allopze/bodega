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
  unitOfMeasure:   string
  categoryName:    string
  referencePrice:  number | null
  attributes:      { id: string; name: string; type: string; isRequired: boolean; options: string | null }[]
}

export interface WorksiteOption {
  id: string
  name: string
  costCenters: { id: string; name: string }[]
}

export interface EditRequest {
  id:           string
  code:         string
  worksiteId:   string
  costCenterId: string | null
  urgency:      string
  status:       string
  notes:        string | null
  items: EditItem[]
}

interface EditItem {
  id:              string
  productId:       string | null
  productNameFree: string | null
  quantity:        number
  unitOfMeasure:   string
  urgency:         string
  requiredDate:    string | null
  notes:           string | null
  attributes:      { attributeId: string | null; attributeName: string; value: string }[]
}

// ── Local item state ──────────────────────────────────────────────────────────

interface ItemRow {
  _key:            string   // stable React key
  id?:             string   // DB id on edit
  productId:       string | null
  productNameFree: string
  quantity:        string
  unitOfMeasure:   string
  urgency:         string
  requiredDate:    string
  notes:           string
  attributes:      AttrRow[]
  // transient UI
  productName:     string
  showAttrs:       boolean
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
    _key:            key,
    productId:       null,
    productNameFree: "",
    quantity:        "1",
    unitOfMeasure:   "unidad",
    urgency:         "normal",
    requiredDate:    "",
    notes:           "",
    attributes:      [],
    productName:     "",
    showAttrs:       false,
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

// ── Urgency helpers ───────────────────────────────────────────────────────────

const URGENCY_OPTS = [
  { value: "normal",   label: "Normal"   },
  { value: "high",     label: "Alta"     },
  { value: "critical", label: "Crítica"  },
]

// ── Main component ────────────────────────────────────────────────────────────

interface RequestFormProps {
  worksites:   WorksiteOption[]
  products:    ProductOption[]
  editRequest?: EditRequest
}

export function RequestForm({ worksites, products, editRequest }: RequestFormProps) {
  const router = useRouter()
  const isEdit  = !!editRequest
  const isDraft = !isEdit || ["draft", "returned"].includes(editRequest.status)

  // ── Form action state
  const [draftState,  draftAction]  = useActionState<ActionState, FormData>(saveDraft,       INITIAL_STATE)
  const [submitState, submitAction] = useActionState<ActionState, FormData>(submitRequest,    INITIAL_STATE)
  const [cancelState, cancelAction] = useActionState<ActionState, FormData>(cancelRequest,    INITIAL_STATE)

  // ── Header fields
  const [worksiteId,   setWorksiteId]   = useState(editRequest?.worksiteId   ?? (worksites[0]?.id ?? ""))
  const [costCenterId, setCostCenterId] = useState(editRequest?.costCenterId ?? "")
  const [urgency,      setUrgency]      = useState(editRequest?.urgency      ?? "normal")
  const [notes,        setNotes]        = useState(editRequest?.notes        ?? "")

  // ── Items
  const [items, setItems] = useState<ItemRow[]>(() => {
    if (editRequest && editRequest.items.length > 0) {
      return editRequest.items.map((item) => {
        const prod = item.productId ? products.find((p) => p.id === item.productId) : null
        return {
          _key:            item.id ?? `edit-${item.productId ?? item.productNameFree ?? "item"}`,
          id:              item.id,
          productId:       item.productId,
          productNameFree: item.productNameFree ?? "",
          quantity:        String(item.quantity),
          unitOfMeasure:   item.unitOfMeasure,
          urgency:         item.urgency,
          requiredDate:    item.requiredDate ?? "",
          notes:           item.notes ?? "",
          productName:     prod?.name ?? item.productNameFree ?? "",
          showAttrs:       item.attributes.length > 0,
          attributes:      item.attributes.map((a) => {
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

  // Available cost centers for selected worksite
  const activeCcs = worksites.find((w) => w.id === worksiteId)?.costCenters ?? []

  // ── Toast on draft save
  useEffect(() => {
    if (draftState.ok) toast.success(draftState.message ?? "Borrador guardado")
    else if (draftState.message && !draftState.ok && draftState.message !== "Sin permisos para crear solicitudes") {
      toast.error(draftState.message)
    }
  }, [draftState])

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
        productId: null,
        productNameFree: trimmed,
        productName: trimmed,
        unitOfMeasure: i.unitOfMeasure || "unidad",
        attributes: [],
        showAttrs: false,
      },
    ))
  }, [])

  const clearProduct = useCallback((key: string) => {
    setItems((prev) => prev.map((i) =>
      i._key !== key ? i : { ...i, productId: null, productNameFree: "", productName: "", attributes: [], showAttrs: false }
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
    id:              item.id,
    productId:       item.productId,
    productNameFree: item.productNameFree || null,
    quantity:        Number(item.quantity) || 1,
    unitOfMeasure:   item.unitOfMeasure,
    urgency:         item.urgency,
    requiredDate:    item.requiredDate || null,
    notes:           item.notes || null,
    attributes:      item.attributes.map((a) => ({
      attributeId:   a.attributeId,
      attributeName: a.attributeName,
      value:         a.value,
    })),
  })))

  const readOnly = !isDraft

  return (
    <div className="space-y-8 pb-16">
      {/* ── Draft/Submit form ─────────────────────────────────────────────── */}
      <form action={draftAction} className="space-y-6">
        {/* Hidden fields */}
        {isEdit && <input type="hidden" name="id" value={editRequest.id} />}
        <input type="hidden" name="itemsJson" value={itemsJson} />
        <input type="hidden" name="worksiteId" value={worksiteId} />
        <input type="hidden" name="costCenterId" value={costCenterId} />
        <input type="hidden" name="urgency" value={urgency} />

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <section className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-4">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Datos de la solicitud
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Faena" required htmlFor="worksiteId">
              <Select
                value={worksiteId}
                onValueChange={(v) => { setWorksiteId(v); setCostCenterId("") }}
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

            <Field label="Centro de costo" htmlFor="costCenterId">
              <Select
                value={costCenterId || "__none__"}
                onValueChange={(value) => setCostCenterId(value === "__none__" ? "" : value)}
                disabled={readOnly || activeCcs.length === 0}
              >
                <SelectTrigger id="costCenterId">
                  <SelectValue placeholder={activeCcs.length === 0 ? "Sin centros de costo" : "Opcional"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin centro de costo</SelectItem>
                  {activeCcs.map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>{cc.name}</SelectItem>
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

            <Field label="Fecha requerida" htmlFor="requiredDate">
              <Input
                id="requiredDate"
                type="date"
                name="requiredDate"
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
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
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

          {draftState.fieldErrors?.items && (
            <p className="text-xs text-[var(--color-danger)]">
              {draftState.fieldErrors.items[0]}
            </p>
          )}

          <div className="space-y-2">
            {items.map((item, idx) => (
              <ItemEditor
                key={item._key}
                item={item}
                idx={idx}
                products={products}
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
          <input type="hidden" name="requestId" value={editRequest?.id ?? ""} />
          <input type="hidden" name="itemsJson" value={itemsJson} />
          <input type="hidden" name="worksiteId" value={worksiteId} />
          <input type="hidden" name="costCenterId" value={costCenterId} />
          <input type="hidden" name="urgency" value={urgency} />
          <input type="hidden" name="notes" value={notes} />
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
  )
}

// ── Item editor sub-component ─────────────────────────────────────────────────

interface ItemEditorProps {
  item:            ItemRow
  idx:             number
  products:        ProductOption[]
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
  item, idx, products, readOnly,
  onUpdate, onSelectProduct, onSelectFreeProduct, onClearProduct, onUpdateAttr, onRemove, canRemove,
}: ItemEditorProps) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
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
            <div className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-warning-100)] bg-[var(--color-warning-50)] px-3 py-2">
              <Package size={14} className="text-[var(--color-text-subtle)] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--color-text)]">{item.productNameFree}</p>
                <p className="text-[11px] text-[var(--color-text-subtle)]">Ítem histórico sin catálogo</p>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onUpdate({ productNameFree: "" })}
                  className="shrink-0 text-xs text-[var(--color-primary)] transition-colors duration-[var(--duration-fast)] hover:text-[var(--color-primary-700)] active:scale-[0.97]"
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

      {/* Quantity + unit */}
      <div className="ml-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
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

        <Field label="Fecha requerida" htmlFor={`rd-${item._key}`}>
          <Input
            id={`rd-${item._key}`}
            type="date"
            className="h-8 text-sm"
            value={item.requiredDate}
            onChange={(e) => onUpdate({ requiredDate: e.target.value })}
            disabled={readOnly}
          />
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
