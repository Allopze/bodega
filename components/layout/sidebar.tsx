"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  SquaresFour, ClipboardText, CheckSquare, ShoppingCart, Truck,
  Warehouse, Users, MapPin, Cube, Buildings, ShieldCheck,
  ArrowSquareOut, ChartLineUp, ChartBar,
} from "@phosphor-icons/react"
import type { IconWeight } from "@phosphor-icons/react"
import type { Session } from "next-auth"
import { cn } from "@/lib/utils"
import { NAV_ITEMS, type NavItem } from "./nav-items"

const ICONS: Record<string, React.ComponentType<{ size?: number; weight?: IconWeight; className?: string }>> = {
  SquaresFour, ClipboardText, CheckSquare, ShoppingCart, Truck,
  Warehouse, Users, MapPin, Cube, Buildings, ShieldCheck, ArrowSquareOut,
  ChartLineUp, ChartBar,
}

function canSeeItem(item: NavItem, session: Session): boolean {
  if (!item.permissions && !item.roles) return true
  const userPerms = session.user.permissions ?? []
  const userRoles = session.user.roles ?? []
  if (item.roles?.some((r) => userRoles.includes(r))) return true
  if (item.permissions?.some((p) => userPerms.includes(p))) return true
  return false
}

interface SidebarProps {
  session:       Session
  worksiteName?: string
  badgeCounts?:  Record<string, number>
}

export function Sidebar({ session, worksiteName, badgeCounts }: SidebarProps) {
  const pathname = usePathname()
  const [now, setNow] = React.useState<string>("")

  React.useEffect(() => {
    const f = new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "2-digit", month: "long" })
    setNow(f.format(new Date()))
  }, [])

  return (
    <aside className="flex flex-col h-full w-full bg-surface text-text">
      {/* Worksite context — flat, table-like */}
      {worksiteName && (
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <p className="text-eyebrow">Faena</p>
          <div className="mt-1 flex items-center gap-1.5">
            <MapPin size={12} weight="bold" className="text-[var(--color-text-muted)] shrink-0" />
            <span className="text-sm font-medium truncate">{worksiteName}</span>
          </div>
        </div>
      )}

      <div className="px-4 py-2 border-b border-[var(--color-border)]">
        <p className="text-eyebrow">Sesión</p>
        <p className="mt-0.5 text-[11px] font-mono uppercase tracking-wide text-[var(--color-text-muted)] truncate">
          {now}
        </p>
      </div>

      {/* Nav — sequential, numbered, with hairline dividers */}
      <nav
        className="flex-1 overflow-y-auto py-1"
        aria-label="Navegación principal"
      >
        {NAV_ITEMS.map((section, index) => {
          const visibleItems = section.items.filter((item) => canSeeItem(item, session))
          if (visibleItems.length === 0) return null
          return (
            <div key={section.section} className="border-b border-[var(--color-border)] last:border-b-0">
              <p className="px-4 pt-3 pb-1.5 text-eyebrow">
                {String(index + 1).padStart(2, "0")} · {section.section}
              </p>
              <ul>
                {visibleItems.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      item={item}
                      pathname={pathname}
                      badgeCounts={badgeCounts}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </nav>

      <div className="px-4 py-3 border-t border-[var(--color-border)]">
        <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)]">
          chome / solicitudes-y-bodega
        </p>
      </div>
    </aside>
  )
}

function NavLink({
  item,
  pathname,
  badgeCounts,
}: {
  item:         NavItem
  pathname:     string
  badgeCounts?: Record<string, number>
}) {
  const Icon     = ICONS[item.iconName]
  const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href + "/")) || pathname.startsWith(item.href + "/")
  const count    = item.badge === "count" ? (badgeCounts?.[item.href] ?? 0) : 0
  const titleText = count > 0
    ? `${item.label}: ${count} pendiente${count === 1 ? "" : "s"}`
    : item.label

  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group flex items-center gap-2.5 pl-4 pr-3 h-9 text-[13px]",
        "border-l-2 transition-colors duration-[var(--duration-fast)]",
        isActive
          ? "border-l-[var(--color-text)] bg-[var(--color-surface-2)] text-[var(--color-text)] font-medium"
          : "border-l-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
      )}
      aria-label={count > 0 ? titleText : undefined}
      title={count > 0 ? titleText : undefined}
    >
      {Icon && (
        <Icon
          size={15}
          weight={isActive ? "bold" : "regular"}
          className={cn(
            "shrink-0",
            isActive ? "text-[var(--color-text)]" : "text-[var(--color-text-subtle)] group-hover:text-[var(--color-text)]",
          )}
        />
      )}
      <span className="truncate flex-1">{item.label}</span>
      {count > 0 && (
        <span className="font-mono text-[10px] font-semibold text-[var(--color-signal-ink)] tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  )
}
