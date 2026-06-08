"use client"

import * as React from "react"
import Link from "next/link"
import { List, CaretLeft, CaretRight, SignOut } from "@phosphor-icons/react"
import type { Session as AuthSession } from "next-auth"
import { cn } from "@/lib/utils"
import { Avatar } from "@/components/ui/avatar"
import { NotificationBell } from "./notification-bell"
import { BrandMark } from "./brand-mark"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"

interface TopBarProps {
  session:             AuthSession
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
              "min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0",
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
            "min-h-[44px] min-w-[44px] rounded-[var(--radius-sm)]",
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
        <NotificationBell />
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] active:scale-[0.97] transition-transform shrink-0 cursor-pointer">
              <Avatar name={session.user.name ?? session.user.email ?? ""} size="sm" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-[var(--color-text)]">{session.user.name}</span>
                <span className="text-xs text-[var(--color-text-subtle)] font-normal truncate max-w-[12rem]">{session.user.email}</span>
                <span className="text-[10px] text-[var(--color-primary-700)] bg-[var(--color-primary-100)] font-bold px-1.5 py-0.5 rounded self-start mt-1.5 capitalize">
                  {session.user.roles?.[0]?.replace("_", " ") ?? "usuario"}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link
                href="/api/auth/signout"
                prefetch={false}
                className="flex items-center gap-2 text-[var(--color-danger)] focus:bg-[var(--color-danger-50)] focus:text-[var(--color-danger-700)] w-full"
              >
                <SignOut size={16} />
                <span>Cerrar sesión</span>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
