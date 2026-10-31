"use client"

import { useState, type ReactNode } from "react"

/**
 * Un bloque plegado cuyo contenido se monta recién al abrirlo. Sirve para los
 * gráficos: dentro de un `<details>` cerrado su contenedor mide cero y el gráfico
 * se queja por consola, además de dibujarse sin que nadie lo pida.
 */
export function LazyDetails({ summary, hint, children }: { summary: ReactNode; hint?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)} className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <summary className="min-h-8 cursor-pointer text-sm font-medium text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
        {summary}
      </summary>
      {hint ? <p className="mb-3 mt-2 text-xs text-[var(--color-text-muted)]">{hint}</p> : null}
      {open ? children : null}
    </details>
  )
}
