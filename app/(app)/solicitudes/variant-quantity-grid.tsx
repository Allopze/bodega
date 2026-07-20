"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import type { ProductOption } from "./request-form.types"
import { formatProductVariant } from "@/lib/products/variant-grouping"

interface Props {
  variants: ProductOption[]
  quantities: Record<string, number>
  readOnly: boolean
  onChange: (variantId: string, qty: number) => void
}

export function VariantQuantityGrid({ variants, quantities, readOnly, onChange }: Props) {
  if (variants.length <= 1) return null

  const totalQty = Object.values(quantities).reduce((sum, q) => sum + (q || 0), 0)

  return (
    <div className="ml-8 rounded-lg border border-(--color-border) bg-(--color-surface-2) p-3">
      <p className="mb-3 text-xs font-medium text-(--color-text-muted)">
        Cantidad por variante (total: <span className="tabular-nums font-semibold text-(--color-text)">{totalQty}</span>)
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {variants.map((variant) => {
          const sku = variant.sku
          const displayLabel = formatProductVariant(variant.attributes, variant.sku)
          const qty = quantities[variant.id] ?? 0

          return (
            <div
              key={variant.id}
              className="flex items-center gap-2 rounded-md bg-(--color-surface) px-3 py-2"
            >
              <span className="flex-1 min-w-0 truncate text-sm leading-tight text-(--color-text)">
                <span className="text-(--color-text-subtle) font-mono text-[11px] mr-1.5">
                  {sku}
                </span>
                {displayLabel}
              </span>
              <Input
                type="number"
                min="0"
                step="1"
                className="h-7 w-16 text-sm tabular-nums text-right shrink-0"
                value={qty > 0 ? String(qty) : ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0)
                  onChange(variant.id, v)
                }}
                disabled={readOnly}
                placeholder="0"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
