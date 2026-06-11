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

  return (
    <aside className="flex flex-col h-full w-full bg-[var(--color-surface)] text-text">
      {/* Worksite context */}
      {worksiteName && (
        <div className="px-3 py-3 border-b border-[var(--color-border)]">
          <p className="text-eyebrow mb-0.5">Faena activa</p>
          <div className="flex items-center gap-1.5">
            <MapPin size={12} weight="bold" className="text-[var(--color-primary)] shrink-0" />
            <span className="text-sm font-semibold text-[var(--color-text)] truncate">{worksiteName}</span>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav
        className="flex-1 overflow-y-auto p-2"
        aria-label="Navegación principal"
      >
        {NAV_ITEMS.map((section) => {
          const visibleItems = section.items.filter((item) => canSeeItem(item, session))
          if (visibleItems.length === 0) return null
          return (
            <div key={section.section} className="mb-4">
              <p className="px-3 mb-1 text-eyebrow">{section.section}</p>
              <ul className="space-y-0.5">
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

      <div className="px-3 py-3 border-t border-[var(--color-border)]">
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
        "group flex items-center gap-2.5 px-3 h-9 text-[13px] rounded-[var(--radius-lg)]",
        "transition-[background-color,color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        isActive
          ? "bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)] font-semibold"
          : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
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
            isActive ? "text-[var(--color-primary)]" : "text-[var(--color-text-subtle)] group-hover:text-[var(--color-text)]",
          )}
        />
      )}
      <span className="truncate flex-1">{item.label}</span>
      {count > 0 && (
        <span className="font-mono text-[10px] font-semibold text-[var(--color-signal-ink)] bg-[var(--color-signal-tint)] px-1.5 py-0.5 rounded-[var(--radius-full)] tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  )
}
