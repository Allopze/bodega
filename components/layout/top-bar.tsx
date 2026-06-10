"use client"

import * as React from "react"
import Link from "next/link"
import { List, SignOut, ShieldCheck } from "@phosphor-icons/react"
import type { Session as AuthSession } from "next-auth"
import { signOut } from "next-auth/react"
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
  session:       AuthSession
  onMenuToggle:  () => void
  className?:    string
  isMenuOpen?:   boolean
  worksiteName?: string
}

export function TopBar({
  session,
  onMenuToggle,
  className,
  isMenuOpen = false,
}: TopBarProps) {
  const [isSigningOut, setIsSigningOut] = React.useState(false)

  async function handleSignOut() {
    setIsSigningOut(true)
    await signOut({ redirectTo: "/login" })
  }

  return (
    <header className={cn(
      "flex items-center h-[3.25rem] px-4 md:px-6 gap-3",
      "border-b border-[var(--color-border)]",
      "bg-[var(--color-brand-surface)]",
      "sticky top-0 shrink-0 z-30",
      className,
    )}>
      <div className="flex items-center gap-2">
        <button
          onClick={onMenuToggle}
          className={cn(
            "lg:hidden flex items-center justify-center",
            "min-h-[44px] min-w-[44px] rounded-[var(--radius-sm)]",
            "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            "hover:bg-[var(--color-surface-2)]",
            "transition-colors duration-[var(--duration-fast)]",
          )}
          aria-label={isMenuOpen ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={isMenuOpen}
        >
          <List size={18} weight="bold" />
        </button>

        <BrandMark variant="light" size={26} subtitle titleSize="sm" />
      </div>

      <div className="flex-1 min-w-0" />

      <div className="flex items-center gap-1">
        <NotificationBell />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="ml-1 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] shrink-0 cursor-pointer"
              aria-label="Abrir menú de usuario"
            >
              <Avatar name={session.user.name ?? session.user.email ?? ""} size="sm" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-[var(--color-text)]">{session.user.name}</span>
                <span className="text-xs text-[var(--color-text-subtle)] font-normal truncate max-w-[12rem]">{session.user.email}</span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-muted)] mt-1.5">
                  {session.user.roles?.[0]?.replace("_", " ") ?? "usuario"}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {session.user.permissions?.some((p) => p.startsWith("admin:")) && (
              <>
                <DropdownMenuItem asChild>
                  <Link
                    href="/admin"
                    className="flex items-center gap-2 text-sm text-[var(--color-text)] w-full cursor-pointer focus:bg-[var(--color-surface-2)]"
                  >
                    <ShieldCheck size={16} className="text-[var(--color-text-subtle)]" />
                    <span>Administración</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem asChild>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="flex w-full items-center gap-2 text-[var(--color-danger-ink)] focus:bg-[var(--color-danger-tint)] disabled:cursor-wait disabled:opacity-70"
              >
                <SignOut size={16} />
                <span>{isSigningOut ? "Cerrando..." : "Cerrar sesión"}</span>
              </button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
