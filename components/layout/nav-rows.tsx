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
  "group relative flex h-[var(--nav-item-height)] items-center gap-[9px] px-[10px] rounded-[var(--radius)] text-xs font-medium transition-[color,background-color] duration-(--duration-fast) ease-out"

function itemRowClass(active: boolean) {
  return cn(
    rowBase,
    active
      ? "bg-(--color-surface-3) font-semibold text-(--color-text)"
      : "text-(--color-text-muted) hover:bg-(--color-surface-2) hover:text-(--color-text)",
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
          size={16}
          /* A4 (PLAN_MIGRACION_VISUAL): peso uniforme para un look más sereno,
             alineado con la referencia. El activo se distingue por fondo +
             font-semibold + color del ícono, no por weight. */
          weight="regular"
          className={cn("shrink-0", active ? "text-(--color-primary)" : "text-(--color-text-muted) group-hover:text-(--color-text)")}
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
  // El padre sólo toma el tint si él mismo es la ruta activa; si solo un hijo
  // está activo, se mantiene en text para no eclipsar al hijo resaltado.
  const active = selfActive
  const shouldOpen = selfActive || childActive
  const [open, setOpen] = React.useState(shouldOpen)
  const [wasShouldOpen, setWasShouldOpen] = React.useState(shouldOpen)
  // Auto-expandir cuando la navegación mete la ruta activa dentro de esta rama,
  // sin pisar un colapso manual (derivado en render, sin useEffect).
  if (shouldOpen !== wasShouldOpen) {
    setWasShouldOpen(shouldOpen)
    if (shouldOpen) setOpen(true)
  }

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <div className={cn(itemRowClass(active), "w-full", !active && childActive && "text-(--color-text)")}>
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          data-pressable
          className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          {Icon && (
            <Icon
              size={16}
              /* A4: peso uniforme. El padre activo se distingue por fondo +
                 font-semibold + color del ícono. */
              weight="regular"
              className={cn("shrink-0", active ? "text-(--color-primary)" : childActive ? "text-(--color-text-muted)" : "text-(--color-text-muted) group-hover:text-(--color-text)")}
            />
          )}
          <span title={item.label} className="flex-1 truncate">{item.label}</span>
          {count > 0 && <CountBadge count={count} />}
        </Link>
        <Collapsible.Trigger asChild>
          <button type="button" aria-label={`Mostrar destinos de ${item.label}`} aria-expanded={open} className="flex h-full shrink-0 items-center px-2 text-text-faint hover:text-(--color-text)">
          <CaretDown size={13} className={cn("shrink-0 text-text-faint transition-transform duration-(--duration-fast)", open && "rotate-180")} />
          </button>
        </Collapsible.Trigger>
      </div>
      <Collapsible.Content className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
        <ul className="mb-1 ml-[1.5rem] space-y-0.5 border-l border-(--color-border) pl-2 pt-0.5">
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
                    "flex h-8 items-center rounded-md px-2.5 text-xs transition-[color,background-color] duration-(--duration-fast) ease-out",
                    ca
                      ? "font-medium text-(--color-primary-ink)"
                      : "text-text-subtle hover:bg-(--color-chrome-hover) hover:text-(--color-text)",
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
  return (
    <ul className="space-y-0.5">
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
