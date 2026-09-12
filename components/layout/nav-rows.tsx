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
    <span className="ml-auto shrink-0 rounded-full bg-signal-tint px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-signal-ink">
      {count > 99 ? "99+" : count}
    </span>
  )
}

const rowBase =
  "group relative flex h-[40px] items-center gap-3 px-3 rounded-xl text-[15px] font-medium transition-colors duration-(--duration-fast) ease-out"

function itemRowClass(active: boolean) {
  return cn(
    rowBase,
    active
      ? "bg-slate-200/80 font-semibold text-slate-900"
      : "text-slate-600 hover:bg-slate-200/50 hover:text-slate-900",
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
      className={itemRowClass(active)}
    >
      {Icon && (
        <Icon
          size={20}
          weight="regular"
          className={cn("shrink-0", active ? "text-slate-900" : "text-slate-500 group-hover:text-slate-900")}
        />
      )}
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
  // `selfActive` por sí solo no basta: `REGISTERED_NAV_HREFS` (nav-items.ts)
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
      <div className={cn(itemRowClass(active), "w-full", !active && childActive && "text-slate-900")}>
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          data-pressable
          className="flex h-full min-w-0 flex-1 items-center gap-3 text-left"
        >
          {Icon && (
            <Icon
              size={20}
              weight="regular"
              className={cn("shrink-0", active ? "text-slate-900" : childActive ? "text-slate-700" : "text-slate-500 group-hover:text-slate-900")}
            />
          )}
          <span title={item.label} className="flex-1 truncate">{item.label}</span>
          {count > 0 && <CountBadge count={count} />}
        </Link>
        <Collapsible.Trigger asChild>
          <button type="button" aria-label={`Mostrar destinos de ${item.label}`} aria-expanded={open} className="flex h-full shrink-0 items-center px-2 text-text-faint hover:text-(--color-text)">
          <CaretDown size={15} className={cn("shrink-0 text-text-faint transition-transform duration-(--duration-fast)", open && "rotate-180")} />
          </button>
        </Collapsible.Trigger>
      </div>
      <Collapsible.Content className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
        <ul className="my-1 ml-3 space-y-1 border-l border-slate-200/80 pl-2.5 py-0.5">
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
                    "flex min-h-[36px] items-center rounded-xl px-2.5 text-sm font-medium transition-colors duration-(--duration-fast) ease-out",
                    ca
                      ? "bg-slate-200/80 font-semibold text-slate-900"
                      : "text-slate-600 hover:bg-slate-200/50 hover:text-slate-900",
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
              <li className="mt-3 mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-text-faint first:mt-1" aria-hidden="true">
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
