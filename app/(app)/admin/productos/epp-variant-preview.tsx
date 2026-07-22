"use client"

import { X } from "@phosphor-icons/react"
import type { VariantCombo } from "./product-form.types"

// ── Props ─────────────────────────────────────────────────────────────────────

export interface VariantPreviewProps {
  variants: VariantCombo[]
  onRemove: (index: number) => void
  onMarkDirty: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function VariantPreview({ variants, onRemove, onMarkDirty }: VariantPreviewProps) {
  if (variants.length <= 1) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">Vista previa de variantes</p>
        <span className="inline-flex items-center rounded-full bg-[var(--color-primary-tint)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-primary-ink)]">
          {variants.length}
        </span>
      </div>
      <div className="overflow-hidden rounded-(--radius) border border-[var(--color-border)]">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[var(--color-surface-2)]">
                <th className="sticky top-0 z-10 bg-[var(--color-surface-2)] px-3 py-2.5 text-left font-medium text-[var(--color-text-subtle)] w-8">#</th>
                <th className="sticky top-0 z-10 bg-[var(--color-surface-2)] px-3 py-2.5 text-left font-medium text-[var(--color-text-subtle)]">Nombre</th>
                <th className="sticky top-0 z-10 bg-[var(--color-surface-2)] px-3 py-2.5 text-left font-medium text-[var(--color-text-subtle)] w-24">SKU</th>
                {variants[0]!.attributes.map((attr) => (
                  <th key={attr.name} className="sticky top-0 z-10 bg-[var(--color-surface-2)] px-3 py-2.5 text-left font-medium text-[var(--color-text-subtle)]">{attr.name}</th>
                ))}
                <th className="sticky top-0 z-10 bg-[var(--color-surface-2)] px-2 py-2.5 text-center font-medium text-[var(--color-text-subtle)] w-10">Acción</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v, i) => (
                <tr key={i} className="border-t border-[var(--color-border)] even:bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] transition-colors">
                  <td className="px-3 py-2 tabular-nums text-[var(--color-text-muted)]">{i + 1}</td>
                  <td className="px-3 py-2 font-medium text-[var(--color-text)]">{v.name}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-[var(--color-text-subtle)]">
                    {v.sku || <span className="italic text-[var(--color-text-faint)]">por asignar</span>}
                  </td>
                  {v.attributes.map((attr) => (
                    <td key={attr.name} className="px-3 py-2 text-[var(--color-text-muted)]">{attr.value}</td>
                  ))}
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => { onMarkDirty(); onRemove(i) }}
                      className="inline-flex items-center justify-center h-6 w-6 rounded-(--radius-sm) text-[var(--color-text-faint)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-tint)] transition-colors"
                      title={`Eliminar «${v.name}»`}
                      aria-label={`Eliminar variante ${i + 1}: ${v.name}`}
                    >
                      <X size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-[var(--color-text-faint)]">
        Los SKU se asignarán automáticamente al crear. Puedes eliminar variantes que no necesites con el botón <X size={10} className="inline" />.
      </p>
    </div>
  )
}
