"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"

export type BodegaView = "stock" | "kardex" | "documentos"

export interface BodegaViewTab {
  value: BodegaView
  label: string
  count?: number
  /** Ruta propia. Documentos vive en `/bodega/documentos` porque tiene su
   *  paginación y competiría con la del kardex dentro de la misma URL. */
  href?: string
}

/** Filtros que sobreviven al cambio de vista: son los que significan lo mismo
 *  en todas. El resto (tipo, producto, rango, estado del stock) es propio de
 *  una vista y arrastrarlo dejaría la siguiente filtrada por algo que no tiene
 *  control en pantalla. */
const SHARED_PARAMS = ["q", "faena"]

/**
 * Vistas de Bodega sincronizadas con `?vista=`.
 *
 * Son `<Link>` y no botones a propósito: navegan desde el primer pintado, sin
 * esperar hidratación. Y cada vista es un render de servidor con sus propias
 * consultas, así que abrir Stock deja de contar y paginar el kardex — que es lo
 * que hacía la página cuando las dos secciones vivían apiladas en un scroll.
 */
export function BodegaViewTabs({ tabs, current }: { tabs: BodegaViewTab[]; current: BodegaView }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function hrefFor(tab: BodegaViewTab) {
    if (tab.href) {
      const shared = new URLSearchParams()
      for (const key of SHARED_PARAMS) {
        const existing = searchParams.get(key)
        if (existing) shared.set(key, existing)
      }
      const sharedQs = shared.toString()
      return sharedQs ? `${tab.href}?${sharedQs}` : tab.href
    }
    const value = tab.value
    const params = new URLSearchParams()
    for (const key of SHARED_PARAMS) {
      const existing = searchParams.get(key)
      if (existing) params.set(key, existing)
    }
    if (value !== "stock") params.set("vista", value)
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  return (
    <nav
      aria-label="Vistas de bodega"
      className="-mx-1 mb-4 flex items-end gap-0 overflow-x-auto border-b border-[var(--color-border)] px-1"
    >
      {tabs.map((tab) => {
        const active = current === tab.value
        return (
          <Link
            key={tab.value}
            href={hrefFor(tab)}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap px-3.5 pb-2.5 pt-1 text-sm font-medium",
              "border-b-2 transition-[color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              active
                ? "border-[var(--color-text)] text-[var(--color-text)]"
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
