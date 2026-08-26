"use client"

import { X } from "@phosphor-icons/react"
import type { VariantCombo } from "./product-form.types"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"

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
          <TableRoot className="rounded-none border-0">
          <Table className="text-xs">
            <caption className="sr-only">Vista previa de variantes EPP</caption>
            <TableHeader>
              <TableRow className="bg-[var(--color-surface-2)]">
                <TableHead>#</TableHead><TableHead>Nombre</TableHead><TableHead className="w-24">SKU</TableHead>
                {variants[0]!.attributes.map((attr) => (
                  <TableHead key={attr.name}>{attr.name}</TableHead>
                ))}
                <TableHead className="w-10 text-center">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {variants.map((v, i) => (
                <TableRow key={v.sku || v.name} className="border-t border-[var(--color-border)] even:bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] transition-colors">
                  <TableCell className="tabular-nums text-[var(--color-text-muted)]">{i + 1}</TableCell>
                  <TableCell className="font-medium text-[var(--color-text)]">{v.name}</TableCell>
                  <TableCell className="font-mono text-[11px] text-[var(--color-text-subtle)]">
                    {v.sku || <span className="italic text-[var(--color-text-faint)]">por asignar</span>}
                  </TableCell>
                  {v.attributes.map((attr) => (
                    <TableCell key={attr.name} className="text-[var(--color-text-muted)]">{attr.value}</TableCell>
                  ))}
                  <TableCell className="text-center">
                    <button
                      type="button"
                      onClick={() => { onMarkDirty(); onRemove(i) }}
                      className="inline-flex items-center justify-center h-6 w-6 rounded-(--radius-sm) text-[var(--color-text-faint)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-tint)] transition-colors"
                      title={`Eliminar «${v.name}»`}
                      aria-label={`Eliminar variante ${i + 1}: ${v.name}`}
                    >
                      <X size={12} />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </TableRoot>
        </div>
      </div>
      <p className="text-[11px] text-[var(--color-text-faint)]">
        Los SKU se asignarán automáticamente al crear. Puedes eliminar variantes que no necesites con el botón <X size={10} className="inline" />.
      </p>
    </div>
  )
}
