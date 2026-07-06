"use client"

import { Badge } from "@/components/ui/badge"
import { formatCLP } from "@/lib/utils"
import type { OcItemRow } from "./oc-form.types"

interface OcFormSummaryProps {
  includedItems:       OcItemRow[]
  worksiteId:          string
  supplierId:          string
  supplierGroupCount:  number
  totals:              { netAmount: number; taxAmount: number; totalAmount: number }
}

export function OcFormSummary({
  includedItems, worksiteId, supplierId, supplierGroupCount, totals,
}: OcFormSummaryProps) {
  return (
    <aside className="h-fit rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-card)] xl:sticky xl:top-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-subtle)]">Resumen OC</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {includedItems.length} ítem{includedItems.length === 1 ? "" : "s"} seleccionado{includedItems.length === 1 ? "" : "s"}
          </p>
        </div>
        {supplierGroupCount > 1 && (
          <Badge variant="info" size="sm">
            {supplierGroupCount} OC
          </Badge>
        )}
      </div>

      <div className="mt-5 space-y-2 border-b border-[var(--color-border)] pb-4">
        <div className="flex justify-between text-sm text-[var(--color-text-muted)]">
          <span>Neto</span>
          <span className="tabular-nums">{formatCLP(totals.netAmount)}</span>
        </div>
        <div className="flex justify-between text-sm text-[var(--color-text-muted)]">
          <span>IVA (19%)</span>
          <span className="tabular-nums">{formatCLP(totals.taxAmount)}</span>
        </div>
        <div className="flex justify-between text-base font-semibold text-[var(--color-text)] pt-2 border-t border-[var(--color-border)]">
          <span>Total</span>
          <span className="tabular-nums">{formatCLP(totals.totalAmount)}</span>
        </div>
      </div>

      <div className="mt-4 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[var(--color-text-muted)]">Faena</span>
          <span className={worksiteId ? "text-[var(--color-success-ink)]" : "text-[var(--color-warning-ink)]"}>
            {worksiteId ? "Lista" : "Falta"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[var(--color-text-muted)]">Proveedor</span>
          <span className={(supplierId || includedItems.every((i) => i.targetSupplierId)) ? "text-[var(--color-success-ink)]" : "text-[var(--color-warning-ink)]"}>
            {supplierId || includedItems.every((i) => i.targetSupplierId) ? "Listo" : "Falta"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[var(--color-text-muted)]">Ítems</span>
          <span className={includedItems.length > 0 ? "text-[var(--color-success-ink)]" : "text-[var(--color-warning-ink)]"}>
            {includedItems.length > 0 ? "Listos" : "Faltan"}
          </span>
        </div>
      </div>

      {supplierGroupCount > 1 && (
        <p className="mt-4 rounded-[var(--radius)] bg-[var(--color-warning-tint)] px-3 py-2 text-xs leading-relaxed text-[var(--color-warning-ink)]">
          Los ítems se dividirán por proveedor al crear la orden.
        </p>
      )}
    </aside>
  )
}
