import type * as React from "react"
import Link from "next/link"
import { CaretDown, CaretRight } from "@phosphor-icons/react/dist/ssr"

/**
 * Bloque plegable cuyo estado vive en la URL (`?seccion=…`). Sirve para lo que
 * pesa: los análisis de tarjetas y de la planilla recorren miles de filas y no
 * tiene sentido consultarlos para dejarlos cerrados. Cerrado es una fila con su
 * enlace «Ver»; abierto carga los datos en el servidor y trae «Ocultar». Un
 * enlace de una vista compartida puede llegar ya abierto (`?seccion=tarjetas`).
 *
 * Server-safe: son enlaces (`scroll={false}`), sin estado de cliente.
 */
export function UrlFold({
  id,
  title,
  description,
  open,
  openHref,
  closeHref,
  children,
}: {
  id: string
  title: string
  description: string
  open: boolean
  openHref: string
  closeHref: string
  children?: React.ReactNode
}) {
  const Icon = open ? CaretDown : CaretRight
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon size={14} weight="bold" aria-hidden className="mt-1 shrink-0 text-[var(--color-text-muted)]" />
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-sm font-semibold text-[var(--color-text)]">{title}</h2>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{description}</p>
          </div>
        </div>
        <Link
          href={open ? closeHref : openHref}
          scroll={false}
          aria-controls={id}
          className="inline-flex min-h-9 items-center text-sm font-medium text-[var(--color-primary-ink)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
        >
          {open ? "Ocultar" : "Ver"}
          <span className="sr-only"> {title}</span>
        </Link>
      </div>
      {open ? <div className="border-t border-[var(--color-border)] px-4 py-5">{children}</div> : null}
    </section>
  )
}
