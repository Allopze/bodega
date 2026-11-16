"use client"

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { ListChecks } from "@phosphor-icons/react"
import { markRecordsReviewedAction } from "@/app/(app)/mantencion/registros/[id]/actions"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { MAX_REVIEW_BATCH, isReviewableRecord, summarizeRecordSelection } from "@/lib/mantencion/record-review-batch"
import { plural } from "@/lib/mantencion/format"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"

/**
 * Elegir registros de la página para marcarlos como revisados de una vez. La lista
 * (`RecordsTable`) es un componente de servidor y dibuja la tabla y las tarjetas a la vez, así
 * que la selección vive aquí, en un contexto: cada casilla de cualquiera de los dos árboles lee
 * y escribe el mismo conjunto, y la barra y «Seleccionar todos» viven una sola vez sobre la lista.
 *
 * Sin proveedor (quien no revisa) las casillas no se dibujan. La lógica de qué se puede elegir
 * y el tope son de `lib/mantencion/record-review-batch.ts`; el servidor vuelve a exigirlo todo.
 */

interface SelectableRow {
  id: string
  status: string
  review: string
}

interface SelectionContextValue {
  /** Registros de la página que admiten revisión. */
  reviewable: SelectableRow[]
  selected: ReadonlySet<string>
  toggle: (id: string, on: boolean) => void
  setAll: (on: boolean) => void
  clear: () => void
}

const SelectionContext = createContext<SelectionContextValue | null>(null)

export function RecordSelectionProvider({ rows, children }: { rows: SelectableRow[]; children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const reviewable = useMemo(() => rows.filter(isReviewableRecord), [rows])
  // Lo que ya no está en la página, o ya no admite revisión (se revisó, cambió de pestaña), sale solo de la selección.
  const effective = useMemo(() => new Set(summarizeRecordSelection(reviewable, selected).ids), [reviewable, selected])

  const value = useMemo<SelectionContextValue>(() => ({
    reviewable,
    selected: effective,
    toggle: (id, on) => setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(id); else next.delete(id)
      return next
    }),
    setAll: (on) => setSelected(on ? new Set(reviewable.map((row) => row.id)) : new Set()),
    clear: () => setSelected(new Set()),
  }), [reviewable, effective])

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

/** La casilla de una fila. No se dibuja sin proveedor ni para un registro que no admite revisión. */
export function RecordSelectCheckbox({ row, folio }: { row: SelectableRow; folio: string }) {
  const selection = useContext(SelectionContext)
  if (!selection || !isReviewableRecord(row)) return null
  return (
    <Checkbox
      label={`Elegir el registro ${folio}`}
      labelHidden
      checked={selection.selected.has(row.id)}
      onChange={(event) => selection.toggle(row.id, event.target.checked)}
    />
  )
}

/** «Seleccionar todos los de esta página»: sólo los que admiten revisión. */
export function RecordsSelectAll() {
  const selection = useContext(SelectionContext)
  const ref = useRef<HTMLInputElement>(null)
  const total = selection?.reviewable.length ?? 0
  const count = selection?.selected.size ?? 0
  const all = total > 0 && count === total
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && !all
  }, [count, all])
  if (!selection || total < 2) return null
  return (
    <div className="mb-2 px-1">
      <Checkbox
        ref={ref}
        label="Seleccionar todos los de esta página"
        checked={all}
        onChange={(event) => selection.setAll(event.target.checked)}
      />
    </div>
  )
}

/**
 * La barra del lote. Sin diálogo de confirmación: marcar como revisado no es destructivo (decisión
 * del usuario: sólo se confirma lo destructivo). Al terminar avisa con un toast —cuántos se marcaron
 * y cuántos se saltaron— y refresca la lista. Observar y anular siguen siendo caso por caso.
 */
export function RecordsBulkBar() {
  const selection = useContext(SelectionContext)
  const router = useRouter()
  const { pending, message, run } = useOperation()
  if (!selection || selection.selected.size === 0) return null

  const ids = summarizeRecordSelection(selection.reviewable, selection.selected)
  const count = ids.count

  function submit() {
    if (!selection || ids.tooMany) return
    run(
      () => markRecordsReviewedAction({ recordIds: ids.ids }),
      (result) => {
        const marked = (result.data as { marked?: number } | undefined)?.marked ?? 0
        const text = result.message ?? "Registros revisados"
        if (marked > 0) toast.success(text)
        else toast.info(text)
        selection.clear()
        router.refresh()
      },
    )
  }

  return (
    <div role="region" aria-label="Registros elegidos" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-xl)] border border-[var(--color-success-line)] bg-[var(--color-success-tint)] px-4 py-3">
      <ListChecks size={18} className="shrink-0 text-[var(--color-success-ink)]" aria-hidden />
      <p className="text-sm font-semibold text-[var(--color-success-ink)]">{plural(count, "registro elegido", "registros elegidos")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="primary" onClick={submit} loading={pending} disabled={pending || ids.tooMany}>
          {count === 1 ? "Marcar 1 como revisado" : `Marcar ${count} como revisados`}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={selection.clear} disabled={pending}>Quitar selección</Button>
      </div>
      {ids.tooMany ? <p className="basis-full text-xs text-[var(--color-success-ink)]">Elige hasta {MAX_REVIEW_BATCH} registros por vez.</p> : null}
      {message ? <p role="alert" className="basis-full text-sm text-[var(--color-danger-ink)]">{message}</p> : null}
    </div>
  )
}
