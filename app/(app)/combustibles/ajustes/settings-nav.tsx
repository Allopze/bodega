"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowSquareOut } from "@phosphor-icons/react"
import type { AjustesNavItem } from "@/lib/combustibles/section-nav"
import { cn } from "@/lib/utils"

/**
 * Submenú de «Ajustes». A la izquierda en escritorio (una sección por fila, con
 * su pista de una línea) y como una fila desplazable arriba en el móvil. Es un
 * solo `<nav>` para que cada enlace exista una vez en el DOM. `SectionNav` no
 * sirve aquí: sólo sabe de pestañas horizontales y no lleva pista.
 *
 * La lista ya viene filtrada por permiso (`ajustesNavItems`); ocultar una
 * sección no es autorización: cada página conserva su propia puerta.
 */
export function AjustesNav({ items }: { items: AjustesNavItem[] }) {
  const pathname = usePathname()
  if (items.length === 0) return null

  return (
    <nav aria-label="Secciones de ajustes" className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:overflow-visible md:px-0 md:pb-0">
      <ul className="flex min-w-max gap-1 md:min-w-0 md:flex-col">
        {items.map((item) => {
          const active = !item.external && (pathname === item.href || pathname.startsWith(`${item.href}/`))
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 flex-col justify-center rounded-xl px-3 py-1.5 text-sm transition-colors duration-150",
                  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
                  active
                    ? "bg-[var(--color-surface-2)] font-semibold text-[var(--color-text)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
                )}
              >
                <span className="flex items-center gap-1.5 whitespace-nowrap md:whitespace-normal">
                  {item.label}
                  {item.external ? <ArrowSquareOut className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                  {item.external ? <span className="sr-only md:hidden">(abre otro catálogo)</span> : null}
                </span>
                {item.hint ? <span className="hidden truncate text-xs font-normal text-[var(--color-text-subtle)] md:block">{item.hint}</span> : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
