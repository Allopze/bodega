"use client"

import * as React from "react"
import Link from "next/link"
import * as Collapsible from "@radix-ui/react-collapsible"
import { CaretDown } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { NAV_ICONS } from "./nav-icons"
import { isHrefActive, type AreaNode, type NavItem } from "./nav-items"

function CountBadge({ count }: { count: number }) {
  return (
    <span className="ml-auto shrink-0 rounded-full bg-signal-tint px-1.5 py-0.5 font-mono text-2xs font-semibold tabular-nums text-signal-ink">
      {count > 99 ? "99+" : count}
    </span>
  )
}

const rowBase =
  "group relative flex min-h-10 items-center gap-3 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors duration-(--duration-fast) ease-out"

/**
 * Único tratamiento de selección de la navegación: verde suave (`nav-active-*`,
 * definidos en `@theme`) para CUALQUIER ítem activo —área, subítem, Inicio,
 * Soporte, flyout del rail y drawer móvil—. Antes convivían tres (píldora gris
 * pizarra, verde y sólo texto) y el usuario no podía leer "aquí estoy" igual en
 * dos lugares (auditoría UX-09, 2026-11-07).
 *
 * `ancestor` es la fila padre de un hijo activo: sin relleno —el relleno es sólo
 * del destino—, con el texto en tinta plena para marcar el camino.
 */
export function navRowClass(active: boolean, ancestor = false) {
  return cn(
    rowBase,
    active
      ? "bg-nav-active-bg font-semibold text-nav-active-ink"
      : ancestor
        ? "text-(--color-text) hover:bg-nav-hover-bg"
        : "text-(--color-text-muted) hover:bg-nav-hover-bg hover:text-(--color-text)",
  )
}

/** Ícono de una fila de navegación; hereda `group-hover` de `navRowClass`. */
export function navIconClass(active: boolean, ancestor = false) {
  return cn(
    "shrink-0",
    active
      ? "text-(--color-primary)"
      : ancestor
        ? "text-(--color-text)"
        : "text-(--color-text-subtle) group-hover:text-(--color-text)",
  )
}

/** Misma regla para el rail colapsado, donde el ícono es el único rótulo. */
export function navRailClass(active: boolean) {
  return cn(
    "group relative flex items-center justify-center rounded-lg px-1 py-2 transition-colors duration-(--duration-fast) ease-out",
    active
      ? "bg-nav-active-bg text-nav-active-ink"
      : "text-(--color-text-muted) hover:bg-nav-hover-bg hover:text-(--color-text)",
  )
}

/** Hoja (sin submenú). */
function LeafRow({
  item,
  pathname,
  count,
  onNavigate,
}: {
  item:        NavItem
  pathname:    string
  count:       number
  onNavigate?: () => void
}) {
  const active = isHrefActive(item.href, pathname)
  const Icon = NAV_ICONS[item.iconName]
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      data-pressable
      className={navRowClass(active)}
    >
      {Icon && <Icon size={20} weight="regular" className={navIconClass(active)} />}
      <span title={item.label} className="flex-1 truncate">{item.label}</span>
      {count > 0 && <CountBadge count={count} />}
    </Link>
  )
}

/** Ítem con submenú (acordeón inline, auto-expandido si el route activo está dentro). */
function BranchRow({
  item,
  pathname,
  count,
  onNavigate,
}: {
  item:        NavItem
  pathname:    string
  count:       number
  onNavigate?: () => void
}) {
  const Icon = NAV_ICONS[item.iconName]
  const selfActive  = isHrefActive(item.href, pathname)
  const childActive = (item.children ?? []).some((c) => isHrefActive(c.href, pathname))
  // `selfActive` por sí solo no basta: `NAV_PREFIX_OWNERS` (nav-items.ts)
  // solo conoce los hrefs del árbol de negocio, así que para ramas fuera de
  // ese árbol (p.ej. admin) `isHrefActive(item.href, ...)` da true incluso
  // viendo un hijo. `!childActive` evita marcar padre e hijo activos a la vez.
  const active = selfActive && !childActive
  const shouldOpen = selfActive || childActive
  const [open, setOpen] = React.useState(shouldOpen)
  const [wasShouldOpen, setWasShouldOpen] = React.useState(shouldOpen)
  if (shouldOpen !== wasShouldOpen) {
    setWasShouldOpen(shouldOpen)
    if (shouldOpen) setOpen(true)
  }

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      {/* `py-0`: la fila se estira por sus dos hijos (enlace y caret), que
          aportan el alto mínimo y su propio padding vertical; así el caret
          conserva un blanco de toque del alto completo de la fila. */}
      <div className={cn(navRowClass(active, childActive), "w-full py-0")}>
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          data-pressable
          className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-1.5 text-left"
        >
          {Icon && <Icon size={20} weight="regular" className={navIconClass(active, childActive)} />}
          <span title={item.label} className="flex-1 truncate">{item.label}</span>
          {count > 0 && <CountBadge count={count} />}
        </Link>
        <Collapsible.Trigger asChild>
          <button type="button" aria-label={`Mostrar destinos de ${item.label}`} aria-expanded={open} className="flex shrink-0 items-center self-stretch px-2 text-text-faint hover:text-(--color-text)">
          <CaretDown size={15} className={cn("shrink-0 text-text-faint transition-transform duration-(--duration-fast)", open && "rotate-180")} />
          </button>
        </Collapsible.Trigger>
      </div>
      <Collapsible.Content className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
        <ul className="my-1 ml-3 space-y-1 border-l border-(--color-border) pl-2.5 py-0.5">
          {(item.children ?? []).map((child) => {
            const ca = isHrefActive(child.href, pathname)
            return (
              <li key={child.href}>
                <Link
                  href={child.href}
                  onClick={onNavigate}
                  aria-current={ca ? "page" : undefined}
                  data-pressable
                  className={cn(
                    "flex min-h-9 items-center rounded-xl px-2.5 text-sm font-medium transition-colors duration-(--duration-fast) ease-out",
                    ca
                      ? "bg-nav-active-bg font-semibold text-nav-active-ink"
                      : "text-(--color-text-muted) hover:bg-nav-hover-bg hover:text-(--color-text)",
                  )}
                >
                  <span title={child.label} className="truncate">{child.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

/**
 * Lista de ítems de un área (con acordeón para submenús). Reutilizada por el
 * panel desktop, el flyout del rail colapsado y el drawer móvil.
 */
const AreaItemsInner = React.memo(function AreaItemsInner({
  area,
  pathname,
  badgeCounts,
  onNavigate,
}: {
  area:         AreaNode
  pathname:     string
  badgeCounts?: Record<string, number>
  onNavigate?:  () => void
}) {
  const listRef = React.useRef<HTMLUListElement>(null)

  // El sidebar tiene su propio scroll. Al entrar a un detalle profundo se
  // centra la fila activa dentro de ese panel, sin desplazar el lienzo de la
  // pantalla ni obligar a recordar dónde quedó el módulo padre.
  React.useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>("[aria-current='page']")
    const scrollPanel = list?.closest<HTMLElement>("[data-nav-scroll]")
    if (!active || !scrollPanel) return

    const panel = scrollPanel.getBoundingClientRect()
    const target = active.getBoundingClientRect()
    const margin = 12
    if (target.top < panel.top + margin) {
      scrollPanel.scrollTop += target.top - panel.top - margin
    } else if (target.bottom > panel.bottom - margin) {
      scrollPanel.scrollTop += target.bottom - panel.bottom + margin
    }
  }, [pathname])

  return (
    <ul ref={listRef} className="space-y-0.5">
      {area.items.map((item, index) => {
        const count = item.badge === "count" ? (badgeCounts?.[item.href] ?? 0) : 0
        const showGroupHeader = item.group && item.group !== area.items[index - 1]?.group
        return (
          <React.Fragment key={item.href}>
            {showGroupHeader && (
              <li className="text-eyebrow mt-6 mb-2 px-3 first:mt-1" aria-hidden="true">
                {item.group}
              </li>
            )}
            <li>
              {item.children && item.children.length > 0
                ? <BranchRow item={item} pathname={pathname} count={count} onNavigate={onNavigate} />
                : <LeafRow   item={item} pathname={pathname} count={count} onNavigate={onNavigate} />}
            </li>
          </React.Fragment>
        )
      })}
    </ul>
  )
})

export const AreaItems = AreaItemsInner
