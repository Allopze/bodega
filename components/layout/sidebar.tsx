"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  SquaresFour, ClipboardText, CheckSquare, ShoppingCart, Truck,
  Warehouse, Users, MapPin, Cube, Buildings, ShieldCheck,
  ArrowSquareOut, ChartLineUp, ChartBar, CaretLeft, CaretRight,
  Package, Path, User,
} from "@phosphor-icons/react"
import type { IconWeight } from "@phosphor-icons/react"
import type { Session } from "next-auth"
import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/tooltip"
import { BrandMark } from "./brand-mark"
import { NAV_ITEMS, type NavItem } from "./nav-items"

const ICONS: Record<string, React.ComponentType<{ size?: number; weight?: IconWeight; className?: string }>> = {
  SquaresFour, ClipboardText, CheckSquare, ShoppingCart, Truck,
  Warehouse, Users, MapPin, Cube, Buildings, ShieldCheck, ArrowSquareOut,
  ChartLineUp, ChartBar,
  // Módulos nuevos
  Package, Path, User,
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
  session:            Session
  worksiteName?:      string
  badgeCounts?:       Record<string, number>
  collapsed?:         boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

export function Sidebar({
  session,
  worksiteName,
  badgeCounts,
  collapsed = false,
  onCollapsedChange,
}: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="flex flex-col h-full w-full bg-[var(--color-surface)] text-text">
      <div className={cn(
        "px-3 pb-3 pt-3",
        collapsed ? "flex flex-col items-center gap-2" : "flex items-center justify-between gap-2",
      )}>
        <BrandMark
          variant="light"
          size={collapsed ? 28 : 30}
          subtitle
          titleSize="sm"
          hideText={collapsed}
        />
        {onCollapsedChange && (
          <Tooltip content={collapsed ? "Expandir sidebar" : "Colapsar sidebar"} side="right" delayDuration={250}>
            <button
              type="button"
              onClick={() => onCollapsedChange(!collapsed)}
              className={cn(
                "hidden lg:flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-lg)]",
                "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
                "transition-[background-color,color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              )}
              aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
              aria-pressed={collapsed}
            >
              {collapsed ? <CaretRight size={16} weight="bold" /> : <CaretLeft size={16} weight="bold" />}
            </button>
          </Tooltip>
        )}
      </div>

      {/* Worksite context */}
      {worksiteName && (
        <div className={cn("px-4 pb-4", collapsed && "px-2 pb-3")}>
          <p className={cn("text-eyebrow mb-0.5", collapsed && "sr-only")}>Faena activa</p>
          <div
            className={cn(
              "flex items-center gap-1.5",
              collapsed && "justify-center",
            )}
            title={collapsed ? worksiteName : undefined}
          >
            <MapPin size={12} weight="bold" className="text-[var(--color-primary)] shrink-0" />
            <span className={cn(
              "text-sm font-semibold text-[var(--color-text)] truncate",
              collapsed && "sr-only",
            )}>{worksiteName}</span>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav
        className={cn("flex-1 overflow-y-auto p-2", collapsed && "px-2")}
        aria-label="Navegación principal"
      >
        {NAV_ITEMS.map((section) => {
          const visibleItems = section.items.filter((item) => canSeeItem(item, session))
          if (visibleItems.length === 0) return null
          return (
            <div key={section.section} className="mb-4">
              <p className={cn("px-3 mb-1 text-eyebrow", collapsed && "sr-only")}>{section.section}</p>
              <ul className="space-y-0.5">
                {visibleItems.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      item={item}
                      pathname={pathname}
                      badgeCounts={badgeCounts}
                      collapsed={collapsed}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </nav>

      <div className={cn("px-3 pt-2 pb-4", collapsed && "px-2")}>
        <p className={cn(
          "text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)]",
          collapsed && "sr-only",
        )}>
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
  collapsed,
}: {
  item:         NavItem
  pathname:     string
  badgeCounts?: Record<string, number>
  collapsed?:   boolean
}) {
  const Icon     = ICONS[item.iconName]
  const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href + "/")) || pathname.startsWith(item.href + "/")
  const count    = item.badge === "count" ? (badgeCounts?.[item.href] ?? 0) : 0
  const titleText = count > 0
    ? `${item.label}: ${count} pendiente${count === 1 ? "" : "s"}`
    : item.label

  const link = (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative flex h-9 items-center rounded-[var(--radius-lg)] text-[13px]",
        "transition-[background-color,color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        collapsed ? "justify-center px-0" : "gap-2.5 px-3",
        isActive
          ? "bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)] font-semibold"
          : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
      )}
      aria-label={collapsed || count > 0 ? titleText : undefined}
      title={!collapsed && count > 0 ? titleText : undefined}
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
      <span className={cn("truncate flex-1", collapsed && "sr-only")}>{item.label}</span>
      {count > 0 && (
        <span className={cn(
          "font-mono text-[10px] font-semibold text-[var(--color-signal-ink)] bg-[var(--color-signal-tint)] rounded-[var(--radius-full)] tabular-nums",
          collapsed ? "absolute right-1 top-1 min-w-3 px-1 text-[9px] leading-3" : "px-1.5 py-0.5",
        )}>
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  )

  if (!collapsed) return link

  return (
    <Tooltip content={titleText} side="right" delayDuration={250}>
      {link}
    </Tooltip>
  )
}
