"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"

export interface StageTab {
  /** Valor del parámetro `estado`; vacío = todas. Admite lista separada por comas. */
  value: string
  label: string
  count?: number
  tone?: "default" | "signal"
}

/**
 * Tabs por etapa del pipeline, sincronizadas con el parámetro `estado` de la URL.
 *
 * Regla A5: el estado es *una* dimensión, así que se representa una sola vez.
 * Donde hay estas tabs no va además un select de estado en `ServerListFilters`.
 *
 * Son `<Link>` y no botones a propósito: navegan desde el primer pintado, sin
 * esperar hidratación (misma razón que el chip de "Sin factura").
 */
export function StageTabs({ tabs, ariaLabel }: { tabs: StageTab[]; ariaLabel: string }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const current = searchParams.get("estado") ?? ""

  function hrefFor(value: string) {
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    if (value) params.set("estado", value)
    else params.delete("estado")
    params.delete("page")
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
              "-mb-px shrink-0 whitespace-nowrap px-3.5 pb-2.5 pt-1 text-sm font-medium",
              "border-b-2 transition-[color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
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
                active ? "opacity-80" : "text-[var(--color-text-faint)]",
              )}>
                {tab.count}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
