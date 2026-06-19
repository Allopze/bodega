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
  "group relative flex h-9 items-center gap-2.5 text-sm font-medium transition-[color,background-color] duration-(--duration-fast) ease-out"

function itemRowClass(active: boolean) {
  return cn(
    rowBase,
    "rounded-md px-3",
    active
      ? "bg-(--color-primary-tint) font-semibold text-(--color-primary-ink)"
      : "text-(--color-text-muted) hover:bg-surface-2 hover:text-(--color-text)",
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
          size={18}
          weight={active ? "bold" : "regular"}
          className={cn("shrink-0", active ? "text-(--color-primary)" : "text-(--color-text-muted) group-hover:text-(--color-text)")}
        />
      )}
      <span className="flex-1 truncate">{item.label}</span>
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
  const [open, setOpen] = React.useState(selfActive || childActive)
  React.useEffect(() => {
    if (selfActive || childActive) setOpen(true)
  }, [selfActive, childActive])

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger asChild>
        <button type="button" aria-expanded={open} className={cn(itemRowClass(active), "w-full text-left", !active && childActive && "text-(--color-text)")}>
          {Icon && (
            <Icon
              size={18}
              weight={active || childActive ? "bold" : "regular"}
              className={cn("shrink-0", active ? "text-(--color-primary)" : childActive ? "text-(--color-text-muted)" : "text-(--color-text-muted) group-hover:text-(--color-text)")}
            />
          )}
          <span className="flex-1 truncate">{item.label}</span>
          {count > 0 && <CountBadge count={count} />}
          <CaretDown size={13} className={cn("shrink-0 text-text-faint transition-transform duration-(--duration-fast)", open && "rotate-180")} />
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
        <ul className="mb-1 ml-[1.6rem] space-y-0.5 border-l border-(--color-border) pl-2 pt-0.5">
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
                      : "text-text-subtle hover:bg-surface-2 hover:text-(--color-text)",
                  )}
                >
                  <span className="truncate">{child.label}</span>
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
export function AreaItems({
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
      {area.items.map((item) => {
        const count = item.badge === "count" ? (badgeCounts?.[item.href] ?? 0) : 0
        return (
          <li key={item.href}>
            {item.children && item.children.length > 0
              ? <BranchRow item={item} pathname={pathname} count={count} onNavigate={onNavigate} />
              : <LeafRow   item={item} pathname={pathname} count={count} onNavigate={onNavigate} />}
          </li>
        )
      })}
    </ul>
  )
}
