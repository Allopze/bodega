"use client"

import { useState } from "react"
import { X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { pluralize } from "@/lib/utils"
import { MIPER_BULK_LIMIT } from "@/lib/validation/prevention-module/miper"
import { BulkAddControlDialog, BulkControlledDialog, BulkControlPatchDialog } from "./bulk-dialogs"
import type { BulkContext } from "./bulk-shared"

type Open = "add" | "controlled" | "patch" | null

/**
 * Barra de acciones sobre los riesgos seleccionados (Fase D, spec §9). Mismo
 * patrón que `aprobaciones/bulk-approve-bar.tsx`: aparece sólo con selección y
 * es `sticky` al pie del pozo del shell (no `fixed`, que se metería bajo el
 * sidebar). Cada acción abre su diálogo; al terminar bien, la selección se vacía.
 * Sobre el tope de una operación avisa cuántos quitar y no deja aplicar.
 */
export function BulkBar({ selected, context, onClear }: { selected: readonly MiperEntrySnapshot[]; context: BulkContext; onClear: () => void }) {
  const [open, setOpen] = useState<Open>(null)
  if (selected.length === 0) return null
  const over = selected.length - MIPER_BULK_LIMIT
  const props = { entries: selected, context, onOpenChange: (next: boolean) => { if (!next) setOpen(null) }, onDone: () => { setOpen(null); onClear() } }
  return (
    <div role="region" aria-label="Acciones sobre la selección"
      className="sticky bottom-0 z-30 -mx-4 mt-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-lg)] md:-mx-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-[var(--color-text)]">
          <p><span className="font-mono font-semibold tabular-nums">{selected.length}</span> {pluralize(selected.length, "riesgo seleccionado", "riesgos seleccionados")}</p>
          {over > 0 && <p role="status" className="text-[var(--color-warning-ink)]">Se pueden cambiar hasta {MIPER_BULK_LIMIT} riesgos a la vez: quita {over} de la selección.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClear}><X size={14} />Quitar selección</Button>
          <Button type="button" variant="secondary" size="sm" disabled={over > 0} onClick={() => setOpen("controlled")}>Cambiar ¿controlado?</Button>
          <Button type="button" variant="secondary" size="sm" disabled={over > 0} onClick={() => setOpen("patch")}>Asignar responsable / plazo</Button>
          <Button type="button" size="sm" disabled={over > 0} onClick={() => setOpen("add")}>Agregar medida a {selected.length}</Button>
        </div>
      </div>
      {open === "add" && <BulkAddControlDialog {...props} />}
      {open === "controlled" && <BulkControlledDialog {...props} />}
      {open === "patch" && <BulkControlPatchDialog {...props} />}
    </div>
  )
}
