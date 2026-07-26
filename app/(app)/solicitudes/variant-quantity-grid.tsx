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
  // Extract Color and Size attributes for 2D matrix grouping
  const matrixData = React.useMemo(() => {
    if (variants.length <= 1) return null

    const sizes = new Set<string>()
    const colors = new Set<string>()
    const grid = new Map<string, ProductOption>()

    for (const v of variants) {
      let color = ""
      let size = ""
      for (const attr of v.attributes) {
        const name = attr.name.toLowerCase()
        if (name.includes("talla") || name.includes("size")) size = attr.options || ""
        if (name.includes("color")) colors.add(attr.options || "Único")
        if (name.includes("color")) color = attr.options || "Único"
      }
      if (size) sizes.add(size)
      if (color && size) {
        grid.set(`${color}:${size}`, v)
      }
    }

    if (sizes.size > 1 && colors.size > 0) {
      return {
        sizes: Array.from(sizes).sort(),
        colors: Array.from(colors).sort(),
        grid,
      }
    }
    return null
  }, [variants])

  if (variants.length <= 1) return null

  const totalQty = Object.values(quantities).reduce((sum, q) => sum + (q || 0), 0)

  // 2D Matrix Rendering (Color x Size)
  if (matrixData) {
    const { sizes, colors, grid } = matrixData
    return (
      <div className="ml-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
        <p className="mb-3 text-xs font-medium text-[var(--color-text-muted)]">
          Matriz de cantidad por variante (total: <span className="tabular-nums font-semibold text-[var(--color-text)]">{totalQty}</span>)
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th scope="col" className="py-1.5 px-2 th-type">Color \ Talla</th>
                {sizes.map((s) => (
                  <th scope="col" key={s} className="py-1.5 px-2 text-center text-[var(--color-text)] font-semibold">{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {colors.map((c) => (
                <tr key={c} className="border-b border-[var(--color-border)] last:border-none">
                  <td className="py-1.5 px-2 font-medium text-[var(--color-text)]">{c}</td>
                  {sizes.map((s) => {
                    const variant = grid.get(`${c}:${s}`)
                    if (!variant) {
                      return <td key={s} className="py-1.5 px-2 text-center text-[var(--color-text-subtle)]">—</td>
                    }
                    const qty = quantities[variant.id] ?? 0
                    return (
                      <td key={s} className="py-1.5 px-2 text-center">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          className="h-7 w-14 text-xs tabular-nums text-center mx-auto"
                          value={qty > 0 ? String(qty) : ""}
                          onChange={(e) => {
                            const v = e.target.value === "" ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0)
                            onChange(variant.id, v)
                          }}
                          disabled={readOnly}
                          placeholder="0"
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // Fallback 1D Grid list
  return (
    <div className="ml-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <p className="mb-3 text-xs font-medium text-[var(--color-text-muted)]">
        Cantidad por variante (total: <span className="tabular-nums font-semibold text-[var(--color-text)]">{totalQty}</span>)
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {variants.map((variant) => {
          const sku = variant.sku
          const displayLabel = formatProductVariant(variant.attributes, variant.sku)
          const qty = quantities[variant.id] ?? 0

          return (
            <div
              key={variant.id}
              className="flex items-center gap-2 rounded-md bg-[var(--color-surface)] px-3 py-2"
            >
              <span className="flex-1 min-w-0 truncate text-sm leading-tight text-[var(--color-text)]">
                <span className="text-[var(--color-text-subtle)] font-mono text-[11px] mr-1.5">
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
