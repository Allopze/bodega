"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"

export interface StageTab {
  /** Valor del parámetro de la pestaña (`estado` por defecto); vacío = todas. Admite lista separada por comas. */
  value: string
  label: string
  count?: number
  tone?: "default" | "signal"
  /** Tono de señal sólo en el contador (trabajo pendiente), sin teñir la pestaña activa. */
  countTone?: "signal"
}

/**
 * Tabs por etapa del pipeline, sincronizadas con un parámetro de la URL (`estado` por defecto; `param`).
 *
 * Regla A5: el estado es *una* dimensión, así que se representa una sola vez.
 * Donde hay estas tabs no va además un select de estado en `ServerListFilters`.
 *
 * Son `<Link>` y no botones a propósito: navegan desde el primer pintado, sin
 * esperar hidratación (misma razón que el chip de "Sin factura").
 */
export function StageTabs({
  tabs,
  ariaLabel,
  param = "estado",
  pageParam = "page",
}: {
  tabs: StageTab[]
  ariaLabel: string
  /** Parámetro de la URL que lleva la pestaña activa. */
  param?: string
  /** Parámetro de paginación de la lista: se quita al cambiar de pestaña. */
  pageParam?: string
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const current = searchParams.get(param) ?? ""

  function hrefFor(value: string) {
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    if (value) params.set(param, value)
    else params.delete(param)
    params.delete(pageParam)
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  return (
    <nav
      aria-label={ariaLabel}
      className="-mx-1 flex items-end gap-0 overflow-x-auto border-b border-[var(--color-border)] px-1"
    >
      {tabs.map((tab) => {
        const active = current === tab.value
        return (
          <Link
            key={tab.value || "all"}
            href={hrefFor(tab.value)}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3.5 text-sm font-medium sm:min-h-9",
              "transition-[color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
              active
                ? tab.tone === "signal"
                  ? "border-[var(--color-signal)] text-[var(--color-signal-ink)]"
                  : "border-[var(--color-text)] text-[var(--color-text)]"
                : "border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]",
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={cn(
                "ml-1.5 font-mono text-xs tabular-nums",
                tab.countTone === "signal" && tab.count > 0
                  ? "font-semibold text-[var(--color-signal-ink)]"
                  : active ? "opacity-80" : "text-[var(--color-text-faint)]",
              )}>
                {/* El espacio es del nombre accesible («Por revisar 3»); la separación visual es el margen. */}
                {" "}{tab.count}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
