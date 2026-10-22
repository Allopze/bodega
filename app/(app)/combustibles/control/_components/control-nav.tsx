"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"

/** Parámetros que viajan entre vistas del control: el período y la faena son el contexto común. */
const SHARED_PARAMS = ["anio", "meses", "faena", "mandante"] as const

export interface ControlNavItem {
  href: string
  label: string
  /** Contador de pendientes (p. ej. cargas en revisión). Solo se muestra si es > 0. */
  count?: number
}

/**
 * Navegación entre las vistas del control. Son `<Link>` (navegan sin esperar
 * hidratación) y conservan año, meses, faena y mandante: cambiar de vista no
 * obliga a volver a filtrar. Una sola fila con scroll horizontal en móvil.
 */
export function ControlNav({ items }: { items: ControlNavItem[] }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const shared = new URLSearchParams()
  for (const key of SHARED_PARAMS) {
    const value = searchParams.get(key)
    if (value) shared.set(key, value)
  }
  const query = shared.toString()

  return (
    <nav aria-label="Vistas del control de combustible" className="-mx-4 mb-5 overflow-x-auto border-b border-[var(--color-border)] px-4 md:mx-0 md:px-0">
      <ul className="flex min-w-max gap-1">
        {items.map((item) => {
          const active = item.href === "/combustibles/control" ? pathname === item.href : pathname.startsWith(item.href)
          return (
            <li key={item.href}>
              <Link
                href={query ? `${item.href}?${query}` : item.href}
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
