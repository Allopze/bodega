"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { List, MapPin, SignOut, ShieldCheck } from "@phosphor-icons/react"
import type { Session as AuthSession } from "next-auth"
import { signOut } from "next-auth/react"
import { cn } from "@/lib/utils"
import { Avatar } from "@/components/ui/avatar"
import { Breadcrumbs } from "@/components/ui/page-header"
import { NotificationBell } from "./notification-bell"
import { BrandMark } from "./brand-mark"
import { NAV_ITEMS } from "./nav-items"
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
  /** When true, slides the pill out of view above the viewport clip. */
  hidden?:       boolean
}

export function TopBar({
  session,
  onMenuToggle,
  className,
  isMenuOpen = false,
  worksiteName,
  hidden = false,
}: TopBarProps) {
  const [isSigningOut, setIsSigningOut] = React.useState(false)
  const pathname = usePathname()

  // Derive active section + label from the nav registry — no extra plumbing needed
  let activeSection: string | null = null
  let activeLabel:   string | null = null
  outer: for (const section of NAV_ITEMS) {
    for (const item of section.items) {
      if (pathname === item.href || pathname.startsWith(item.href + "/")) {
        activeSection = section.section
        activeLabel   = item.label
        break outer
      }
    }
  }

  async function handleSignOut() {
    setIsSigningOut(true)
    await signOut({ redirect: false })
    window.location.href = "/login"
  }

  return (
    <header className={cn(
      "flex items-center h-[3.25rem] px-4 md:px-5 gap-3",
      "bg-[var(--color-surface)] rounded-full",
      "border border-[var(--color-border)] shadow-[var(--shadow-md)]",
      // Auto-hide: slide out above the container's overflow clip, fade to 0.
      "transition-[transform,opacity] duration-(--duration-default) ease-(--ease-out)",
      hidden
        ? "-translate-y-[calc(100%+1rem)] opacity-0 pointer-events-none"
        : "translate-y-0 opacity-100",
      className,
    )}>
      <div className="flex items-center gap-2 lg:hidden">
        <button
          onClick={onMenuToggle}
          className={cn(
            "lg:hidden flex items-center justify-center",
            "min-h-[44px] min-w-[44px] rounded-[var(--radius-lg)]",
            "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            "hover:bg-[var(--color-surface-2)]",
            "transition-[color,background-color] duration-[var(--duration-fast)]",
          )}
          aria-label={isMenuOpen ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={isMenuOpen}
        >
          <List size={18} weight="bold" />
        </button>

        <BrandMark variant="light" size={26} subtitle titleSize="sm" />
      </div>

      {/* Desktop: contexto de página + chip de faena (si aplica) */}
      <div className="flex-1 min-w-0 hidden lg:flex items-center gap-3">
        {activeSection && activeLabel && (
          <Breadcrumbs
            items={[
              { label: activeSection },
              { label: activeLabel },
            ]}
          />
        )}
        {worksiteName && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-(--radius) bg-surface-2 border border-(--color-border)">
            <MapPin size={13} weight="bold" className="text-(--color-primary) shrink-0" />
            <span className="text-xs font-mono text-(--color-text-muted) truncate max-w-[20rem]">
              {worksiteName}
            </span>
          </div>
        )}
      </div>
      {/* Mobile: spacer para empujar campana+avatar a la derecha */}
      <div className="flex-1 lg:hidden" aria-hidden />

      <div className="flex items-center gap-1.5">
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
          <DropdownMenuContent align="end" className="min-w-[13rem]">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-[var(--color-text)]">{session.user.name}</span>
                <span className="text-xs text-[var(--color-text-subtle)] font-normal truncate max-w-[12rem]">{session.user.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {session.user.permissions?.some((p) => p.startsWith("admin:")) && (
              <>
                <DropdownMenuItem asChild>
                  <Link
                    href="/admin"
                    className="flex items-center gap-2 text-sm text-[var(--color-text)] w-full cursor-pointer"
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
                className="flex w-full items-center gap-2 text-[var(--color-danger-ink)] disabled:cursor-wait disabled:opacity-70"
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
