"use client"

import * as React from "react"
import { Package, Trash } from "@phosphor-icons/react"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { ProductPicker } from "./product-picker"
import type { ItemRow, ProductOption, SupplierOption } from "./request-form.types"
import { QUOTATION_TYPES } from "@/lib/request-types"
import { ItemEditorEquipment } from "./item-editor-equipment"
import { ItemEditorSupplier } from "./item-editor-supplier"
import { ItemEditorCotizaciones } from "./item-editor-cotizaciones"
import { ItemEditorAttributes } from "./item-editor-attributes"
import { formatProductVariant, groupProductVariants } from "@/lib/products/variant-grouping"
import { URGENCY_OPTS } from "./request-form.constants"

// ── Props ─────────────────────────────────────────────────────────────────────

interface ItemEditorProps {
  item:            ItemRow
  idx:             number
  products:        ProductOption[]
  suppliers:       SupplierOption[]
  readOnly:        boolean
  requestType?:    string
  maxFileSizeMb:   number
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
  item, idx, products, suppliers, readOnly, requestType, maxFileSizeMb,
  onUpdate, onSelectProduct, onSelectFreeProduct, onClearProduct, onUpdateAttr, onRemove, canRemove,
}: ItemEditorProps) {
  const isQuotationType    = QUOTATION_TYPES.has(requestType ?? "")
  const selectedProduct = item.productId ? products.find((product) => product.id === item.productId) : null
  const variants = selectedProduct
    ? groupProductVariants(products).find((group) => group.variants.some((variant) => variant.id === selectedProduct.id))?.variants ?? []
    : []

  return (
    <div className="rounded-(--radius-2xl) bg-(--color-surface) shadow-(--shadow-card) p-4 space-y-4">
      {/* Row header */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-(--color-surface-2) text-[10px] font-mono text-(--color-text-muted)">
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
              <Package size={14} className="text-(--color-text-subtle) shrink-0" />
              <span className="flex-1 text-sm font-medium text-(--color-text)">{item.productName}</span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={onClearProduct}
                  className="text-(--color-text-subtle) hover:text-(--color-danger) text-xs transition-colors duration-(--duration-fast)"
                >
                  Cambiar
                </button>
              )}
            </div>
          ) : item.productNameFree ? (
            <div className="flex items-center gap-2 rounded-(--radius) border border-(--color-warning-line) bg-(--color-warning-tint) px-3 py-2">
              <Package size={14} className="text-(--color-text-subtle) shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-(--color-text)">{item.productNameFree}</p>
                <p className="text-[11px] text-(--color-text-subtle)">Ítem histórico sin catálogo</p>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onUpdate({ productNameFree: "" })}
                  className="shrink-0 text-xs text-(--color-primary) transition-colors duration-(--duration-fast) hover:text-(--color-primary-ink)"
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
            className="mt-0.5 p-1 rounded text-(--color-text-subtle) hover:text-(--color-danger) hover:bg-(--color-surface-2) transition-colors duration-(--duration-fast)"
            aria-label="Eliminar ítem"
          >
            <Trash size={14} />
          </button>
        )}
      </div>

      {selectedProduct && variants.length > 1 && (
        <div className="ml-8 max-w-sm">
          <Field label="Características" htmlFor={`variant-${item._key}`}>
            <Select value={selectedProduct.id} onValueChange={onSelectProduct} disabled={readOnly}>
              <SelectTrigger id={`variant-${item._key}`} className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {variants.map((variant) => (
                  <SelectItem key={variant.id} value={variant.id}>
                    {formatProductVariant(variant.attributes, variant.sku)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}

      {/* Quantity + unit + (urgency for catalog types only) */}
      <div className={`ml-8 grid gap-3 ${isQuotationType ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}>
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

        {!isQuotationType && (
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
        )}
      </div>

      {/* Equipment data — quotation types (repuestos/servicios) */}
      {isQuotationType && (
        <ItemEditorEquipment
          item={item}
          requestType={requestType ?? ""}
          readOnly={readOnly}
          onUpdate={onUpdate}
        />
      )}

      {/* Supplier hint — hidden for quotation types */}
      {!isQuotationType && (
        <ItemEditorSupplier
          item={item}
          suppliers={suppliers}
          readOnly={readOnly}
          onUpdate={onUpdate}
        />
      )}

      {/* Notes — hidden for quotation types */}
      {!isQuotationType && (
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
      )}

      {/* Cotizaciones upload — for quotation types */}
      {isQuotationType && (
        <ItemEditorCotizaciones
          item={item}
          requestType={requestType ?? ""}
          maxFileSizeMb={maxFileSizeMb}
          readOnly={readOnly}
          onUpdate={onUpdate}
        />
      )}

      {/* Attributes — for non-quotation types only */}
      {!isQuotationType && (
        <ItemEditorAttributes
          item={item}
          readOnly={readOnly}
          onUpdate={onUpdate}
          onUpdateAttr={onUpdateAttr}
        />
      )}
    </div>
  )
}
