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

/* ── Icon registry ──────────────────────────────────────────────────────── */
const ICONS: Record<string, React.ComponentType<{ size?: number; weight?: IconWeight; className?: string }>> = {
  SquaresFour, ClipboardText, CheckSquare, ShoppingCart, Truck,
  Warehouse, Users, MapPin, Cube, Buildings, ShieldCheck, ArrowSquareOut,
  ChartLineUp, ChartBar,
}

/* ── Permission filter ──────────────────────────────────────────────────── */
function canSeeItem(item: NavItem, session: Session): boolean {
  if (!item.permissions && !item.roles) return true
  const userPerms  = session.user.permissions ?? []
  const userRoles  = session.user.roles       ?? []
  if (item.roles?.some((r) => userRoles.includes(r))) return true
  if (item.permissions?.some((p) => userPerms.includes(p))) return true
  return false
}

/* ── Sidebar ────────────────────────────────────────────────────────────── */
interface SidebarProps {
  session:           Session
  worksiteName?:     string
  badgeCounts?:      Record<string, number>
  isCollapsed?:      boolean
  onToggleCollapse?: () => void
}

export function Sidebar({
  session,
  worksiteName,
  badgeCounts,
  isCollapsed = false,
}: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className={cn(
      "flex flex-col h-full w-full",
      "bg-[var(--color-brand-surface)]",
      "border-r border-[var(--color-brand-border)]",
    )}>
      {/* ── Worksite context (slim, only when there is a name) ── */}
      {worksiteName && (
        <div className={cn(
          "border-b border-[var(--color-brand-border)] py-2",
          isCollapsed ? "px-0 flex justify-center" : "px-4"
        )}>
          <div
            className="flex items-center gap-1.5"
            title={worksiteName}
          >
            <MapPin
              size={isCollapsed ? 16 : 12}
              className="text-[var(--color-brand-text-muted)] shrink-0"
            />
            {!isCollapsed && (
              <span className="text-xs text-[var(--color-brand-text-muted)] truncate">
                {worksiteName}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Nav items ── */}
      <nav
        className={cn("flex-1 overflow-y-auto py-2", isCollapsed ? "px-1" : "px-2")}
        aria-label="Navegación principal"
      >
        {NAV_ITEMS.map((section, index) => {
          const visibleItems = section.items.filter((item) => canSeeItem(item, session))
          if (visibleItems.length === 0) return null
          return (
            <div key={section.section} className="mb-2">
              {isCollapsed ? (
                index > 0 && <hr className="mx-2 my-2 border-[var(--color-brand-border)] opacity-30" />
              ) : (
                <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-brand-text-muted)] opacity-60">
                  {section.section}
                </p>
              )}
              {visibleItems.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  badgeCounts={badgeCounts}
                  isCollapsed={isCollapsed}
                />
              ))}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}

function NavLink({
  item,
  pathname,
  badgeCounts,
  isCollapsed,
}: {
  item:         NavItem
  pathname:     string
  badgeCounts?: Record<string, number>
  isCollapsed?: boolean
}) {
  const Icon    = ICONS[item.iconName]
  const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
  const count   = item.badge === "count" ? (badgeCounts?.[item.href] ?? 0) : 0

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center rounded-[var(--radius)] transition-all duration-[var(--duration-fast)] group relative",
        isCollapsed
          ? "justify-center h-10 w-10 mx-auto text-base"
          : "gap-3 px-3 py-2.5 text-[15px]",
        isActive
          ? "bg-[var(--color-brand-surface-raised)] text-[var(--color-brand-text)]"
          : "text-[var(--color-brand-text-muted)] hover:bg-[var(--color-brand-surface-raised)] hover:text-[var(--color-brand-text)]",
      )}
      aria-current={isActive ? "page" : undefined}
      title={isCollapsed ? item.label : undefined}
    >
      {/* Active state left indicator line */}
      {isActive && (
        <span
          className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-[var(--color-primary)]"
          aria-hidden="true"
        />
      )}

      {Icon && (
        <Icon
          size={isCollapsed ? 20 : 18}
          weight={(isActive ? "fill" : "regular") as IconWeight}
          className={cn(
            "shrink-0 transition-colors duration-[var(--duration-fast)]",
            isActive ? "text-[var(--color-primary)]" : "text-[var(--color-brand-text-muted)] group-hover:text-[var(--color-brand-text)]",
          )}
        />
      )}
      {!isCollapsed && <span className="truncate flex-1 font-medium">{item.label}</span>}
      {/* Never-miss badge — signal orange, only when there are pending items */}
      {count > 0 && (
        isCollapsed ? (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-signal)] px-0.5 text-[8px] font-bold leading-none text-white shadow-sm">
            {count > 9 ? "9+" : count}
          </span>
        ) : (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-signal)] px-1 text-[10px] font-bold leading-none text-white">
            {count > 99 ? "99+" : count}
          </span>
        )
      )}
    </Link>
  )
}
