"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  SquaresFour, ClipboardText, CheckSquare, ShoppingCart, Truck, Package,
  Warehouse, Receipt, ChartBar, Users, MapPin, Cube, Buildings, ShieldCheck,
  SignOut, CaretRight,
} from "@phosphor-icons/react"
import type { IconWeight } from "@phosphor-icons/react"
import type { Session } from "next-auth"
import { cn } from "@/lib/utils"
import { Avatar } from "@/components/ui/avatar"
import { NAV_ITEMS, type NavItem } from "./nav-items"

/* ── Icon registry ──────────────────────────────────────────────────────── */
const ICONS: Record<string, React.ComponentType<{ size?: number; weight?: IconWeight; className?: string }>> = {
  SquaresFour, ClipboardText, CheckSquare, ShoppingCart, Truck, Package,
  Warehouse, Receipt, ChartBar, Users, MapPin, Cube, Buildings, ShieldCheck,
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
  session:     Session
  worksiteName?: string
}

export function Sidebar({ session, worksiteName }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className={cn(
      "flex flex-col h-full w-full",
      "bg-[var(--color-brand-surface)]",
      "border-r border-[var(--color-brand-border)]",
    )}>
      {/* ── Brand header ── */}
      <div className="px-4 pt-5 pb-4 border-b border-[var(--color-brand-border)]">
        <div className="flex items-center gap-2.5">
          <div className={cn(
            "h-8 w-8 rounded-[var(--radius-sm)] flex items-center justify-center",
            "bg-[var(--color-primary)]",
          )}>
            <span className="font-display font-bold text-white text-sm tracking-tight">SF</span>
          </div>
          <div>
            <p className="font-display font-bold text-[var(--color-brand-text)] text-sm leading-tight tracking-tight">
              StockFlow
            </p>
            <p className="text-[10px] text-[var(--color-brand-text-muted)] leading-tight">
              Chome
            </p>
          </div>
        </div>
        {worksiteName && (
          <div className="mt-3 flex items-center gap-1.5">
            <MapPin size={12} className="text-[var(--color-brand-text-muted)] shrink-0" />
            <span className="text-xs text-[var(--color-brand-text-muted)] truncate">{worksiteName}</span>
          </div>
        )}
      </div>

      {/* ── Nav items ── */}
      <nav className="flex-1 overflow-y-auto py-2 px-2" aria-label="Navegación principal">
        {NAV_ITEMS.map((section) => {
          const visibleItems = section.items.filter((item) => canSeeItem(item, session))
          if (visibleItems.length === 0) return null
          return (
            <div key={section.section} className="mb-1">
              <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-brand-text-muted)]">
                {section.section}
              </p>
              {visibleItems.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          )
        })}
      </nav>

      {/* ── User footer ── */}
      <div className="border-t border-[var(--color-brand-border)] p-3">
        <div className="flex items-center gap-2.5 rounded-[var(--radius)] px-2 py-2">
          <Avatar name={session.user.name ?? session.user.email ?? ""} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-[var(--color-brand-text)] truncate leading-tight">
              {session.user.name}
            </p>
            <p className="text-[10px] text-[var(--color-brand-text-muted)] truncate capitalize">
              {session.user.roles?.[0]?.replace("_", " ") ?? "usuario"}
            </p>
          </div>
          <Link
            href="/api/auth/signout"
            className="text-[var(--color-brand-text-muted)] hover:text-[var(--color-brand-text)] transition-colors duration-[var(--duration-fast)]"
            title="Cerrar sesión"
          >
            <SignOut size={15} />
          </Link>
        </div>
      </div>
    </aside>
  )
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = ICONS[item.iconName]
  const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2.5 px-2 py-2 rounded-[var(--radius)] text-sm",
        "transition-colors duration-[var(--duration-fast)]",
        "group",
        isActive
          ? "bg-[var(--color-brand-surface-raised)] text-[var(--color-brand-text)]"
          : "text-[var(--color-brand-text-muted)] hover:bg-[var(--color-brand-surface-raised)] hover:text-[var(--color-brand-text)]",
      )}
      aria-current={isActive ? "page" : undefined}
    >
      {Icon && (
        <Icon
          size={16}
          weight={(isActive ? "fill" : "regular") as IconWeight}
          className={cn(
            "shrink-0 transition-colors duration-[var(--duration-fast)]",
            isActive ? "text-[var(--color-primary)]" : "text-[var(--color-brand-text-muted)] group-hover:text-[var(--color-brand-text)]",
          )}
        />
      )}
      <span className="truncate">{item.label}</span>
      {isActive && (
        <CaretRight size={12} className="ml-auto text-[var(--color-primary)] shrink-0" weight="bold" />
      )}
    </Link>
  )
}
