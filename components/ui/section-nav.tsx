"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"

export interface SectionNavItem {
  /** Identificador estable de la pestaña; la página dice cuál es la suya con `activeKey`. */
  key: string
  /** Destino. Puede traer su propia query (`/combustibles?vista=analisis`). */
  href: string
  label: string
  /** Contador de pendientes. Solo se muestra si es > 0. */
  count?: number
}

/**
 * Pestañas entre las pantallas de una misma sección del menú («Consumo y
 * rendimiento», «Revisión», «TAE y sellos»…). Cada pestaña es otra ruta, así que
 * son `<Link>` —navegan desde el primer pintado, sin esperar hidratación— y la
 * página declara cuál es la activa con `activeKey`: el servidor ya sabe en qué
 * vista está, y deducirlo de la URL obligaba a reglas por prefijo y por query.
 *
 * `carryParams` conserva el contexto común al cambiar de pestaña (faena,
 * período): cambiar de vista no obliga a volver a filtrar. Un parámetro que ya
 * trae el `href` de la pestaña manda sobre el que se arrastra.
 *
 * Generaliza la barra propia que tenía `/combustibles/control` (retirada el 2026-10-22).
 */
export function SectionNav({
  items,
  activeKey,
  ariaLabel,
  carryParams = [],
}: {
  items: SectionNavItem[]
  activeKey: string
  ariaLabel: string
  carryParams?: readonly string[]
}) {
  const searchParams = useSearchParams()

  function hrefFor(href: string) {
    if (carryParams.length === 0) return href
    const [path = href, query = ""] = href.split("?", 2)
    const params = new URLSearchParams(query)
    for (const key of carryParams) {
      const value = searchParams.get(key)
      if (value && !params.has(key)) params.set(key, value)
    }
    const qs = params.toString()
    return qs ? `${path}?${qs}` : path
  }

  if (items.length <= 1) return null

  return (
    <nav aria-label={ariaLabel} className="-mx-4 mb-5 overflow-x-auto border-b border-[var(--color-border)] px-4 md:mx-0 md:px-0">
      <ul className="flex min-w-max gap-1">
        {items.map((item) => {
          const active = item.key === activeKey
          return (
            <li key={item.key}>
              <Link
                href={hrefFor(item.href)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap transition-colors duration-150",
                  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
                  active
                    ? "border-[var(--color-primary)] font-semibold text-[var(--color-text)]"
                    : "border-transparent text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]",
                )}
              >
                {item.label}
                {item.count ? (
                  <span className="rounded-full bg-[var(--color-signal-tint)] px-1.5 text-xs font-semibold tabular-nums text-[var(--color-signal-ink)]">
                    {item.count}
                  </span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
