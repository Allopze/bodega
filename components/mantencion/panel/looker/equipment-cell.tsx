"use client"

import Link from "next/link"
import { Funnel } from "@phosphor-icons/react"
import type { CrossFilterAction } from "@/lib/services/mantencion/looker/filter-hrefs"
import { cn } from "@/lib/utils"
import { FilterToggle } from "./filter-toggle"

/**
 * Celda «Equipo» de las tablas del Panel: la patente es un enlace (al historial del equipo o, en Preventivo, a su
 * ficha) y el embudo de al lado filtra el panel por ese equipo (`x_equipo`). Son dos controles distintos a
 * propósito: un mismo elemento no navega y filtra a la vez. Debajo, el código y la faena o el tipo.
 *
 * El clic del mouse en el resto de la fila sigue filtrando (`CrossFilterRow`); el enlace y el embudo detienen la
 * propagación para no disparar también el de la fila.
 */
export function EquipmentCell({
  plate,
  code,
  sub,
  href,
  filterAction,
  linkTitle,
  scroll,
}: {
  plate: string
  code: string
  /** Segunda línea: «KCH-134 · BIODIVERSA». */
  sub?: string | null
  /** A dónde lleva la patente. Sin `href` la patente es texto. */
  href?: string | null
  /** Filtro del embudo. Sin acción no hay embudo. */
  filterAction?: CrossFilterAction
  linkTitle?: string
  /** `false` para un enlace que se queda en la misma pantalla (la ficha). */
  scroll?: boolean
}) {
  const name = plate || code || "Equipo"
  return (
    <span className="flex min-w-0 items-start gap-1">
      <span className="min-w-0">
        {href ? (
          <Link
            href={href}
            title={linkTitle}
            scroll={scroll}
            onClick={(event) => event.stopPropagation()}
            className={cn(
              "inline-flex min-h-8 items-center rounded-[var(--radius-xs)] font-mono text-xs font-semibold text-[var(--color-primary-ink)]",
              "underline decoration-[var(--color-primary-line)] underline-offset-2 hover:decoration-[var(--color-primary)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
            )}
          >
            {name}
          </Link>
        ) : (
          <span className="inline-flex min-h-8 items-center font-mono text-xs font-semibold">{name}</span>
        )}
        {sub && <span className="block truncate text-2xs text-[var(--color-text-muted)]">{sub}</span>}
      </span>
      {filterAction && (
        <FilterToggle
          action={filterAction}
          aria-label={`Filtrar el panel por ${name}`}
          className="min-h-11 min-w-11 shrink-0 justify-center text-[var(--color-text-muted)] sm:min-h-8 sm:min-w-8"
        >
          <Funnel size={14} weight="bold" aria-hidden />
        </FilterToggle>
      )}
    </span>
  )
}
