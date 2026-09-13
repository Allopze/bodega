"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowRight, MagnifyingGlass } from "@phosphor-icons/react"
import { NAV_ICONS } from "@/components/layout/nav-icons"
import { useSafeShellHeader } from "@/components/layout/header-context"
import type { AreaNode } from "@/components/layout/nav-items"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { matchesQuery } from "@/lib/utils"

/**
 * Índice de destinos de `/admin`.
 *
 * Existe porque la pantalla de entrada al panel sabía exactamente qué podía
 * hacer la sesión —`getAdminAreas` ya devuelve el árbol filtrado por permiso—
 * y no mostraba nada: pedía "usa el panel lateral", que en móvil está
 * colapsado. Ahí la pantalla era un callejón sin salida.
 *
 * La búsqueda **no** es un input propio: la shell ya renderiza "Filtrar en
 * esta página…" en esta ruta y un segundo campo daría dos búsquedas con
 * comportamientos distintos (regla de layout 1). Este componente sólo lee
 * `searchQuery` del TopBar.
 */

/**
 * Filtra el árbol por texto. Un ítem sobrevive si coincide él mismo (y
 * entonces conserva todos sus hijos) o si coincide alguno de sus hijos (y
 * entonces conserva sólo esos). Un área cuyo propio nombre coincide se
 * conserva entera: quien escribe "personas" busca el área, no un ítem.
 *
 * El plegado de mayúsculas y acentos es el de `matchesQuery` (lib/utils), que
 * ya lo hace en es-CL para el resto de la app.
 */
export function filterAdminAreas(areas: AreaNode[], query: string): AreaNode[] {
  if (!query.trim()) return areas

  const result: AreaNode[] = []
  for (const area of areas) {
    if (matchesQuery(query, [area.label])) {
      result.push(area)
      continue
    }

    const items = area.items.flatMap((item) => {
      if (matchesQuery(query, [item.label])) return [item]
      const children = item.children?.filter((child) => matchesQuery(query, [child.label]))
      return children?.length ? [{ ...item, children }] : []
    })

    if (items.length > 0) result.push({ ...area, items })
  }
  return result
}

function DestinationLink({ href, label, iconName, nested }: {
  href: string
  label: string
  iconName?: string
  nested?: boolean
}) {
  const Icon = (iconName && NAV_ICONS[iconName]) || undefined
  return (
    <Link
      href={href}
      data-pressable
      className="group flex items-center gap-3 rounded-[var(--radius-lg)] px-2 py-2 transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-primary-tint)]"
    >
      {Icon ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-2)] text-[var(--color-text-subtle)] transition-colors duration-[var(--duration-fast)] group-hover:text-[var(--color-primary)]">
          <Icon size={16} />
        </span>
      ) : (
        // Los hijos no declaran icono en `admin-nav`; un guion mantiene la
        // rejilla alineada sin inventarles uno que no les corresponde.
        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--color-text-faint)]">–</span>
      )}
      <span className={nested
        ? "min-w-0 flex-1 truncate text-sm text-[var(--color-text-muted)]"
        : "min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-text)]"}>
        {label}
      </span>
      <ArrowRight size={14} className="shrink-0 text-[var(--color-text-faint)] transition-colors duration-[var(--duration-fast)] group-hover:text-[var(--color-primary)]" />
    </Link>
  )
}

export function AdminAreaIndex({ areas }: { areas: AreaNode[] }) {
  const { searchQuery, setSearchQuery } = useSafeShellHeader()
  const visible = React.useMemo(() => filterAdminAreas(areas, searchQuery), [areas, searchQuery])

  if (visible.length === 0) {
    return (
      <EmptyState
        icon={<MagnifyingGlass size={24} />}
        title="Sin resultados en Administración"
        description={`Ninguna categoría ni pantalla de administración coincide con "${searchQuery.trim()}". Revisa la palabra o limpia el filtro para ver todo lo que puedes administrar.`}
        action={
          <Button variant="secondary" onClick={() => setSearchQuery("")}>
            Limpiar búsqueda
          </Button>
        }
      />
    )
  }

  return (
    // Un solo landmark de navegación, no uno por área: con ocho `<nav>` más los
    // de la shell, la lista de regiones del lector de pantalla deja de servir
    // para orientarse, que es justo para lo que existe. Cada tarjeta es una
    // `section` rotulada por su propio encabezado.
    //
    // Columnas CSS y no `grid`: las áreas van de uno a trece destinos, y en una
    // rejilla la fila entera crece hasta la más alta — "Catálogos" (trece)
    // dejaba media pantalla en blanco al lado de "Prevención" (uno). Con
    // `columns` cada tarjeta ocupa su alto real y la siguiente sube a llenar
    // el hueco.
    <nav aria-label="Índice de administración" className="columns-1 gap-4 sm:columns-2 xl:columns-3">
      {visible.map((area) => {
        const AreaIcon = NAV_ICONS[area.iconName]
        const headingId = `admin-area-${area.id}`
        return (
          <section
            key={area.id}
            aria-labelledby={headingId}
            className="mb-4 break-inside-avoid rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]"
          >
            <div className="mb-2 flex items-center gap-2 px-2">
              {AreaIcon && <AreaIcon size={16} className="shrink-0 text-[var(--color-text-subtle)]" />}
              <h2 id={headingId} className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">
                {area.label}
              </h2>
            </div>
            <ul>
              {area.items.map((item) => (
                <li key={item.href}>
                  <DestinationLink href={item.href} label={item.label} iconName={item.iconName} />
                  {item.children?.length ? (
                    <ul className="ml-4 border-l border-[var(--color-border)] pl-2">
                      {item.children.map((child) => (
                        <li key={child.href}>
                          <DestinationLink href={child.href} label={child.label} nested />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </nav>
  )
}
