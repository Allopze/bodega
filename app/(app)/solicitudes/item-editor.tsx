"use client"

import { Package, Trash, CaretUp, CaretDown } from "@phosphor-icons/react"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { ProductPicker } from "./product-picker"
import type { ItemRow, ProductOption, SupplierOption } from "./request-form.types"
import { QUOTATION_TYPES } from "@/lib/request-types"

// ── Constants ─────────────────────────────────────────────────────────────────

export const URGENCY_OPTS = [
  { value: "normal",   label: "Normal"   },
  { value: "high",     label: "Alta"     },
  { value: "critical", label: "Crítica"  },
]

// ── Props ─────────────────────────────────────────────────────────────────────

interface ItemEditorProps {
  item:            ItemRow
  idx:             number
  products:        ProductOption[]
  suppliers:       SupplierOption[]
  readOnly:        boolean
  requestType?:    string
  onUpdate:        (patch: Partial<ItemRow>) => void
  onSelectProduct: (pid: string) => void
  onSelectFreeProduct: (name: string) => void
  onClearProduct:  () => void
  onUpdateAttr:    (i: number, v: string) => void
  onRemove:        () => void
  canRemove:       boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ItemEditor({
  item, idx, products, suppliers, readOnly, requestType,
  onUpdate, onSelectProduct, onSelectFreeProduct, onClearProduct, onUpdateAttr, onRemove, canRemove,
}: ItemEditorProps) {
  const isQuotationType    = QUOTATION_TYPES.has(requestType ?? "")
  const hasSuppliers       = suppliers.length > 0
  const showSupplierSelect = !item.supplierHint || !!item.suggestedSupplierId

  return (
    <div className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4 space-y-4">
      {/* Row header */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[10px] font-mono text-[var(--color-text-muted)]">
          {idx + 1}
        </span>

        {/* Product picker / Description */}
        <div className="flex-1 space-y-2">
          {isQuotationType ? (
            <Field label="Descripción" required htmlFor={`desc-${item._key}`}>
              <Input
                id={`desc-${item._key}`}
                className="h-8 text-sm"
                placeholder="Describe el ítem requerido..."
                value={item.productNameFree}
                onChange={(e) => onUpdate({ productNameFree: e.target.value, productId: null })}
                disabled={readOnly}
              />
            </Field>
          ) : item.productId ? (
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

      {/* Supplier hint — hidden for quotation types (supplier selected at quotation approval) */}
      {!isQuotationType && (
        <div className="ml-8 grid grid-cols-1 gap-3">
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
      )}

      {/* Notes */}
      <div className="ml-8">
        <Field label="Observación" htmlFor={`notes-${item._key}`}>
          <Input
            id={`notes-${item._key}`}
            className="h-8 text-sm"
            placeholder="Detalle opcional del ítem..."
            value={item.notes}
            onChange={(e) => onUpdate({ notes: e.target.value })}
            disabled={readOnly}
          />
        </Field>
      </div>

      {/* Attributes */}
      {item.attributes.length > 0 && (
        <div className="ml-8 space-y-3">
          {/* For quotation types, attrs are always shown without a toggle button */}
          {!isQuotationType && (
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
          )}

          {(isQuotationType || item.showAttrs) && (
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
