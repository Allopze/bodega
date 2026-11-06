"use client"

import { X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { pluralize } from "@/lib/utils"

/**
 * Barra de acciones de la selección en «Sin cargo». Mismo patrón que
 * `aprobaciones/bulk-approve-bar.tsx` y `prevencion/miper/[id]/bulk-bar.tsx`:
 * aparece sólo con selección y es `sticky` al pie del pozo del shell (el scroll
 * container es `[data-shell-scroll]`), no `fixed`, que se metería bajo el
 * sidebar. Los `-mx` cancelan el padding de `PageContainer` para que la barra
 * llegue de borde a borde del pozo.
 */
export function BulkAssignBar({
  count,
  onAssign,
  onClear,
}: {
  count: number
  onAssign: () => void
  onClear: () => void
}) {
  const countLabel = `${count} ${pluralize(count, "trabajador seleccionado", "trabajadores seleccionados")}`

  return (
    <>
      {/* La región con el conteo se desmonta al vaciar la selección, y un
          `aria-live` recién montado no se anuncia: el aviso vive en un nodo que
          permanece y sólo cambia de texto. */}
      <p className="sr-only" role="status" aria-live="polite">{count > 0 ? countLabel : ""}</p>
      {count > 0 && (
        <div
          role="region"
          aria-label="Acciones sobre la selección"
          className="sticky bottom-0 z-30 -mx-4 mt-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-lg)] animate-in fade-in duration-[var(--duration-default)] md:-mx-8 md:px-8"
        >
          <div className="mx-auto flex max-w-440 flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--color-text)]">
              <span className="font-mono font-semibold tabular-nums">{count}</span>
              {" "}{pluralize(count, "seleccionado", "seleccionados")}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClear}>
                <X size={14} />
                Limpiar selección
              </Button>
              <Button type="button" variant="primary" size="sm" onClick={onAssign}>
                Asignar cargo
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
