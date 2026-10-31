"use client"

import * as React from "react"
import { CaretRight } from "@phosphor-icons/react"

/**
 * Bloque plegado de un detalle técnico o de apoyo («Ver datos estadísticos»,
 * «Día a día de un equipo»…). `<details>` nativo —teclado y lector de pantalla
 * ya resueltos por el navegador— que monta su contenido sólo cuando se abre:
 * un gráfico de Recharts dentro de un bloque cerrado mide 0 × 0 y avisa en la
 * consola, y una tabla que nadie abrió no necesita el DOM.
 *
 * Para lo que además es caro de consultar, ver `UrlFold`: el servidor sólo
 * carga los datos cuando la URL lo pide.
 */
export function Disclosure({
  title,
  description,
  defaultOpen = false,
  actions,
  children,
  className,
}: {
  title: string
  description?: string
  defaultOpen?: boolean
  /** Controles de la sección (selector de equipo, exportar): visibles con el bloque abierto. */
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <details
      open={defaultOpen}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className={`group rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] ${className ?? ""}`}
    >
      <summary className="flex cursor-pointer list-none items-start gap-2.5 rounded-[var(--radius-lg)] px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)] [&::-webkit-details-marker]:hidden">
        <CaretRight size={14} weight="bold" aria-hidden className="mt-1 shrink-0 text-[var(--color-text-muted)] transition-transform duration-150 group-open:rotate-90" />
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-[var(--color-text)]">{title}</span>
          {description ? <span className="mt-0.5 block text-sm text-[var(--color-text-muted)]">{description}</span> : null}
        </span>
      </summary>
      {open ? (
        <div className="border-t border-[var(--color-border)] px-4 py-4">
          {actions ? <div className="mb-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
          {children}
        </div>
      ) : null}
    </details>
  )
}
