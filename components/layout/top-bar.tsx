"use client"

import * as React from "react"
import { List, MagnifyingGlass } from "@phosphor-icons/react"
import type { Session } from "next-auth"
import { cn } from "@/lib/utils"
import { Avatar } from "@/components/ui/avatar"
import { NotificationBell } from "./notification-bell"

interface TopBarProps {
  session:      Session
  onMenuToggle: () => void
  className?:   string
}

export function TopBar({ session, onMenuToggle, className }: TopBarProps) {
  return (
    <header className={cn(
      "flex items-center h-12 px-4 gap-3",
      "border-b border-[var(--color-border)]",
      "bg-[var(--color-surface)]",
      "sticky top-0 z-30",
      className,
    )}>
      {/* Mobile menu toggle — only visible on mobile */}
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

      {/* Breadcrumb / page context area */}
      <div className="flex-1 min-w-0" />

      {/* Right zone */}
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
