"use client"

import * as React from "react"
import { Package, Trash } from "@phosphor-icons/react"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { ProductPicker } from "./product-picker"
import type { ItemRow, ProductOption, SupplierOption, WorkerOption } from "./request-form.types"
import { QUOTATION_TYPES } from "@/lib/request-types"
import { ItemEditorEquipment } from "./item-editor-equipment"
import { ItemEditorSupplier } from "./item-editor-supplier"
import { ItemEditorCotizaciones } from "./item-editor-cotizaciones"
import { VariantQuantityGrid } from "./variant-quantity-grid"
import { ItemEditorAttributes } from "./item-editor-attributes"
import { groupProductVariants } from "@/lib/products/variant-grouping"
import { URGENCY_OPTS } from "./request-form.constants"
import { getWorkerEppStatusAction, type WorkerEppStatusResult } from "./actions"
import { formatDate } from "@/lib/utils"

// ── Props ─────────────────────────────────────────────────────────────────────

interface ItemEditorProps {
  item:            ItemRow
  idx:             number
  products:        ProductOption[]
  suppliers:       SupplierOption[]
  workers?:        WorkerOption[]
  readOnly:        boolean
  requestType?:    string
  maxFileSizeMb:   number
  onUpdate:        (patch: Partial<ItemRow>) => void
  onSelectProduct: (pid: string) => void
  onSelectFreeProduct: (name: string) => void
  onClearProduct:  () => void
  onUpdateAttr:    (i: number, v: string) => void
  onUpdateWorker:  (workerId: string) => void
  onRemove:        () => void
  canRemove:       boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ItemEditor({
  item, idx, products, suppliers, workers, readOnly, requestType, maxFileSizeMb,
  onUpdate, onSelectProduct, onSelectFreeProduct, onClearProduct, onUpdateAttr, onUpdateWorker, onRemove, canRemove,
}: ItemEditorProps) {
  const isQuotationType    = QUOTATION_TYPES.has(requestType ?? "")
  const selectedProduct = item.productId ? products.find((product) => product.id === item.productId) : null
  const variants = selectedProduct
    ? groupProductVariants(products).find((group) => group.variants.some((variant) => variant.id === selectedProduct.id))?.variants ?? []
    : []

  const [statusInfo, setStatusInfo] = React.useState<WorkerEppStatusResult | null>(null)

  React.useEffect(() => {
    let active = true
    if (requestType === "epp" && item.workerId && item.productId) {
      getWorkerEppStatusAction(item.workerId, item.productId).then((res) => {
        if (active) setStatusInfo(res)
      })
    }
    return () => { active = false }
  }, [requestType, item.workerId, item.productId])

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
        <div className="ml-8 space-y-3">
          <VariantQuantityGrid
            variants={variants}
            quantities={item.variantQuantities ?? {}}
            readOnly={readOnly}
            onChange={(variantId, qty) => {
              onUpdate({ variantQuantities: { ...(item.variantQuantities ?? {}), [variantId]: qty } })
              // Also update the aggregated quantity field to match the sum
              const updated = { ...(item.variantQuantities ?? {}), [variantId]: qty }
              const total = Object.values(updated).reduce((s, q) => s + (q || 0), 0)
              if (total > 0) onUpdate({ quantity: String(total) })
            }}
          />
        </div>
      )}

      {/* Worker picker — visible for EPP type requests */}
      {requestType === "epp" && !isQuotationType && workers && workers.length > 0 && (
        <div className="ml-8 max-w-sm">
          <Field label="Trabajador" htmlFor={`worker-${item._key}`} helper="Opcional. Si se asigna, las tallas se sugerirán automáticamente.">
            <Select
              value={item.workerId || "none"}
              onValueChange={(v) => onUpdateWorker(v === "none" ? "" : v)}
              disabled={readOnly}
            >
              <SelectTrigger id={`worker-${item._key}`} className="h-8 text-sm">
                <SelectValue placeholder="Sin asignar..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin asignar</SelectItem>
                {workers.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.firstName} {w.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {item.workerId && item.workerName && (
            <p className="mt-1 text-[11px] text-(--color-text-subtle)">
              Usando tallas registradas para {item.workerName}
            </p>
          )}

          {/* F-6: Advertencia de solicitud duplicada */}
          {statusInfo?.activeRequest && (
            <div className="mt-2 rounded border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-2 text-xs text-[var(--color-warning-ink)] font-medium">
              ⚠️ Ya existe la solicitud <strong>{statusInfo.activeRequest.code}</strong> en trámite para este trabajador.
            </div>
          )}

          {/* F-2: Vigencia / Entrega previa */}
          {statusInfo?.lastDelivery && (
            <div className="mt-1 text-xs">
              <span className="text-[var(--color-text-subtle)]">Última entrega: </span>
              <span className="font-medium text-[var(--color-text)]">{formatDate(statusInfo.lastDelivery.deliveredAt)}</span>
            </div>
          )}
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
