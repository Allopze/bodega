"use client"

import * as React from "react"
import { List, MagnifyingGlass, CaretLeft, CaretRight } from "@phosphor-icons/react"
import type { Session } from "next-auth"
import { cn } from "@/lib/utils"
import { Avatar } from "@/components/ui/avatar"
import { NotificationBell } from "./notification-bell"
import { BrandMark } from "./brand-mark"

interface TopBarProps {
  session:             Session
  onMenuToggle:        () => void
  isCollapsed?:        boolean
  onToggleCollapse?:   () => void
  worksiteName?:       string
  className?:          string
}

export function TopBar({
  session,
  onMenuToggle,
  isCollapsed = false,
  onToggleCollapse,
  className,
}: TopBarProps) {
  return (
    <header className={cn(
      "flex items-center h-14 px-4 gap-3",
      "border-b border-[var(--color-border)]",
      "bg-[var(--color-surface)]",
      "shrink-0 z-30",
      className,
    )}>
      {/* ── Left zone ── */}
      <div className="flex items-center gap-2">
        {/* Collapse toggle — desktop only */}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className={cn(
              "hidden lg:flex items-center justify-center",
              "h-8 w-8 rounded-[var(--radius-sm)]",
              "text-[var(--color-text-muted)] hover:text-[var(--color-primary)]",
              "hover:bg-[var(--color-primary-50)]",
              "transition-all duration-[var(--duration-fast)]",
              "active:scale-[0.95]",
            )}
            title={isCollapsed ? "Expandir menú" : "Colapsar menú"}
            aria-label={isCollapsed ? "Expandir menú" : "Colapsar menú"}
          >
            {isCollapsed
              ? <CaretRight size={14} weight="bold" />
              : <CaretLeft  size={14} weight="bold" />
            }
          </button>
        )}

        {/* Mobile hamburger */}
        <button
          onClick={onMenuToggle}
          className={cn(
            "lg:hidden flex items-center justify-center",
            "h-8 w-8 rounded-[var(--radius-sm)]",
            "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            "hover:bg-[var(--color-surface-2)]",
            "transition-colors duration-[var(--duration-fast)]",
            "active:scale-[0.95]",
          )}
          aria-label="Abrir menú"
        >
          <List size={18} weight="bold" />
        </button>

        {/* Brand mark */}
        <BrandMark variant="light" size={28} subtitle titleSize="sm" />
      </div>

      {/* Spacer */}
      <div className="flex-1 min-w-0" />

      {/* ── Right zone ── */}
      <div className="flex items-center gap-1">
        <button
          className={cn(
            "flex items-center justify-center h-8 w-8 rounded-[var(--radius-sm)]",
            "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            "hover:bg-[var(--color-surface-2)]",
            "transition-colors duration-[var(--duration-fast)]",
            "active:scale-[0.95]",
          )}
          aria-label="Buscar"
          title="Buscar (próximamente)"
        >
          <MagnifyingGlass size={16} />
        </button>
        <NotificationBell />
        <div className="ml-1">
          <Avatar name={session.user.name ?? session.user.email ?? ""} size="sm" />
        </div>
      </div>
    </header>
  )
}
