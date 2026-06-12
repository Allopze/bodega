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

  // Pre-filter to visible sections so we can use the index for numbering
  // and reliably detect the last section for mt-auto pinning.
  const visibleSections = NAV_ITEMS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canSeeItem(item, session)),
    }))
    .filter((section) => section.items.length > 0)

  return (
    <aside className="flex flex-col h-full w-full bg-surface text-text">
      {/* Brand + collapse toggle */}
      <div className={cn(
        "px-3 pb-3 pt-3",
        collapsed ? "flex flex-col items-center gap-2" : "flex items-center justify-between gap-2",
      )}>
        <BrandMark
          variant="light"
          size={collapsed ? 32 : 38}
          subtitle
          titleSize="lg"
          hideText={collapsed}
        />
        {onCollapsedChange && (
          <Tooltip content={collapsed ? "Expandir sidebar" : "Colapsar sidebar"} side="right" delayDuration={250}>
            <button
              type="button"
              onClick={() => onCollapsedChange(!collapsed)}
              className={cn(
                "hidden lg:flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                "text-(--color-text-muted) hover:bg-surface-2 hover:text-(--color-text)",
                "transition-[background-color,color] duration-(--duration-fast) ease-out",
              )}
              aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
              aria-pressed={collapsed}
            >
              {collapsed ? <CaretRight size={16} weight="bold" /> : <CaretLeft size={16} weight="bold" />}
            </button>
          </Tooltip>
        )}
      </div>

      {/* Faena activa */}
      {worksiteName && (
        <div className={cn("px-4 pb-4", collapsed && "px-2 pb-3")}>
          <p className={cn("text-eyebrow mb-0.5", collapsed && "sr-only")}>Faena activa</p>
          <div
            className={cn("flex items-center gap-1.5", collapsed && "justify-center")}
            title={collapsed ? worksiteName : undefined}
          >
            <MapPin size={12} weight="bold" className="text-(--color-primary) shrink-0" />
            <span className={cn(
              "text-sm font-semibold text-(--color-text) truncate",
              collapsed && "sr-only",
            )}>
              {worksiteName}
            </span>
          </div>
        </div>
      )}

      {/*
        Nav rail
        — Expanded: px-0 so the left border of active items sits flush at the card edge.
        — Collapsed: px-2 for centered icon spacing.
        — flex-col enables mt-auto on the last section (Reportes pinned to bottom).
      */}
      <nav
        className={cn(
          "flex-1 overflow-y-auto flex flex-col py-2",
          collapsed ? "px-2" : "px-0",
        )}
        aria-label="Navegación principal"
      >
        {visibleSections.map((section, idx) => {
          const isLast = idx === visibleSections.length - 1
          return (
            <div
              key={section.section}
              className={cn("mb-4", isLast && "mt-auto mb-0")}
            >
              <p className={cn("px-3 mb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-(--color-text-muted)", collapsed && "sr-only")}>
                {/* Editorial section numbering — hidden from assistive technology */}
                <span aria-hidden="true">{String(idx + 1).padStart(2, "0")} · </span>
                {section.section}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
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

      {/* Footer wordmark */}
      <div className={cn("px-3 pt-3 pb-4", collapsed && "px-2")}>
        <p className={cn(
          "text-[10px] font-mono uppercase tracking-wider text-text-faint",
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
  const Icon = ICONS[item.iconName]

  // Bug fix: the third clause was an unguarded duplicate of the second,
  // which negated the "/dashboard" guard on any sub-path.
  const isActive =
    pathname === item.href ||
    (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"))

  const count     = item.badge === "count" ? (badgeCounts?.[item.href] ?? 0) : 0
  const titleText = count > 0
    ? `${item.label}: ${count} pendiente${count === 1 ? "" : "s"}`
    : item.label

  const link = (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative flex h-11 items-center text-[15px]",
        "transition-[color,background-color] duration-(--duration-fast) ease-out",
        // ── Collapsed mode: icon only, no left rule.
        collapsed && cn(
          "justify-center px-0 rounded-lg",
          isActive
            ? "text-(--color-primary-ink) font-semibold"
            : "text-(--color-text-muted) hover:bg-surface-2 hover:text-(--color-text)",
        ),
        // ── Expanded mode.
        // Active: 2px left rule + compensated padding so text sits at the same x-position
        //         as inactive items (2px border + 10px padding = 12px, same as px-3).
        //         No background fill — "bordes no relleno".
        // Inactive: no border, full px-3, right-rounded hover fill only.
        !collapsed && cn(
          "gap-3",
          isActive
            ? "border-l-2 border-(--color-text) pl-[10px] pr-3 text-(--color-primary-ink) font-semibold"
            : "px-3 rounded-r-md text-(--color-text-muted) hover:bg-surface-2 hover:text-(--color-text)",
        ),
      )}
      aria-label={collapsed || count > 0 ? titleText : undefined}
      title={!collapsed && count > 0 ? titleText : undefined}
    >
      {Icon && (
        <Icon
          size={20}
          weight={isActive ? "bold" : "regular"}
          className={cn(
            "shrink-0",
            // Inactive: raised from text-subtle → text-muted so the icon reads as
            // navigable, not disabled.
            isActive
              ? "text-(--color-primary)"
              : "text-(--color-text-muted) group-hover:text-(--color-text)",
          )}
        />
      )}
      <span className={cn("truncate flex-1", collapsed && "sr-only")}>{item.label}</span>
      {count > 0 && (
        <span className={cn(
          "font-mono text-[10px] font-semibold text-signal-ink bg-signal-tint rounded-full tabular-nums",
          collapsed
            ? "absolute right-1 top-1 min-w-3 px-1 text-[9px] leading-3"
            : "px-1.5 py-0.5",
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
