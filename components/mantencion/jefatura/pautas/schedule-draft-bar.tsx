"use client"

import * as React from "react"
import { CaretDown, CaretUp, PencilSimpleLine } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { formatNumber } from "@/lib/mantencion/format"

/** Alto fijo de la barra en escritorio: el encabezado de la matriz se pega justo debajo (`DRAFT_BAR_OFFSET`). */
export const DRAFT_BAR_OFFSET = "top-14"

/** Cuántos cambios hay: la última línea puede ser «y N cambios más». */
export function draftChangeCount(changes: string[]): number {
  const last = changes[changes.length - 1]
  const more = last ? /^y (\d+) cambios más$/.exec(last) : null
  return more ? changes.length - 1 + Number(more[1]) : changes.length
}

/**
 * Barra de borrador: avisa que la pauta tiene cambios sin publicar y los lista.
 * Queda fija arriba del pozo mientras se baja por la matriz. La acción principal
 * («Publicar versión N+1») vive en el encabezado de la página (regla 5); aquí sólo
 * está la secundaria, «Descartar cambios». La lista completa se abre sobre el
 * contenido, así la barra no cambia de alto.
 */
export function ScheduleDraftBar({ version, changes, pending, onDiscard }: {
  version: number
  changes: string[]
  pending: boolean
  onDiscard: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const listId = React.useId()
  const count = draftChangeCount(changes)
  const Caret = open ? CaretUp : CaretDown
  return (
    <section
      aria-label="Cambios sin publicar"
      className="sticky top-0 z-20 -mx-1 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-xl)] border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 md:flex-nowrap"
    >
      <PencilSimpleLine size={18} weight="bold" aria-hidden className="shrink-0 text-[var(--color-warning-ink)]" />
      <p className="min-w-0 flex-1 text-sm text-[var(--color-warning-ink)]">
        <span className="font-semibold">{count === 1 ? "1 cambio sin publicar" : `${formatNumber(count)} cambios sin publicar`}.</span>{" "}
        <span className="hidden sm:inline">El teléfono y los equipos siguen con la versión {formatNumber(version)} hasta que publiques.</span>
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "Ocultar cambios" : "Ver cambios"}
        <Caret size={14} weight="bold" aria-hidden />
      </Button>
      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={onDiscard}>Descartar cambios</Button>
      {open && (
        <ul
          id={listId}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 list-disc overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] py-3 pl-8 pr-4 text-sm text-[var(--color-text)] shadow-md"
        >
          {changes.map((change) => <li key={change} className="py-0.5">{change}</li>)}
        </ul>
      )}
    </section>
  )
}
