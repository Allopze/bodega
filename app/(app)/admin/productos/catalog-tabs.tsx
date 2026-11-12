import Link from "next/link"
import { cn } from "@/lib/utils"

type CatalogView = "productos" | "familias"

const TABS: ReadonlyArray<{ value: CatalogView; label: string; href: string }> = [
  { value: "productos", label: "Productos", href: "/admin/productos" },
  { value: "familias",  label: "Familias EPP", href: "/admin/productos/familias" },
]

/**
 * Las dos vistas del catálogo de productos. Hasta el 2026-11-12 eran dos ítems
 * del menú («Productos» y «Catálogo de EPP») y no se entendía en qué se
 * diferenciaban: los dos muestran los mismos artículos. Productos es cada SKU
 * (una talla, un color); Familias EPP agrupa las variantes de un mismo EPP y
 * guarda lo que es común a todas: zona del cuerpo, certificación, vida útil.
 *
 * Son rutas propias y no `?vista=`: cada una tiene sus consultas, sus acciones
 * y su propio encabezado. Mismo trazo que las vistas de Bodega.
 */
export function CatalogTabs({ current }: { current: CatalogView }) {
  return (
    <nav
      aria-label="Vistas del catálogo de productos"
      className="-mx-1 mb-4 flex items-end gap-0 overflow-x-auto border-b border-[var(--color-border)] px-1"
    >
      {TABS.map((tab) => {
        const active = tab.value === current
        return (
          <Link
            key={tab.value}
            href={tab.href}
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
          </Link>
        )
      })}
    </nav>
  )
}
