"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { List, MagnifyingGlass, MapPin, X } from "@phosphor-icons/react"
import type { Session as AuthSession } from "next-auth"
import { cn } from "@/lib/utils"
import { Breadcrumbs } from "@/components/ui/page-header"
import { BrandMark } from "./brand-mark"
import { findActiveBreadcrumb } from "./nav-items"
import { useShellHeader } from "./header-context"
import { UserMenu } from "./top-bar-user-menu"

const NotificationBell = React.lazy(() =>
  import("./notification-bell").then((m) => ({ default: m.NotificationBell }))
)

interface TopBarProps {
  session:       AuthSession
  onMenuToggle:  () => void
  className?:    string
  isMenuOpen?:   boolean
  worksiteName?: string
  /** When true, slides the bar out of view above the viewport clip. */
  hidden?:       boolean
}

const ROUTES_WITH_OWN_SEARCH = ["/solicitudes", "/aprobaciones", "/compras", "/recepcion", "/prevencion/ppa"]

const TopBarInner = React.memo(function TopBarInner({
  session,
  onMenuToggle,
  className,
  isMenuOpen = false,
  worksiteName,
  hidden = false,
}: TopBarProps) {
  const pathname = usePathname()
  const { header, searchQuery, setSearchQuery } = useShellHeader()

  // Clear search on navigation
  React.useEffect(() => {
    setSearchQuery("")
  }, [pathname, setSearchQuery])

  // Derive active area + label from the nav tree — no extra plumbing needed
  const activeNav = React.useMemo(() => findActiveBreadcrumb(pathname), [pathname])
  const activeSection = activeNav?.areaLabel ?? null
  const activeLabel   = activeNav?.itemLabel ?? null

  // These routes have their own per-screen search bar (URL-synced,
  // server-side). The top-bar in-memory search is inert there — hide it so
  // users don't see two search inputs with different behaviours.
  const hideSearch = ROUTES_WITH_OWN_SEARCH.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))

  return (
    <header className={cn(
      "flex items-center h-14 px-4 md:px-5 gap-3",
      "bg-(--color-chrome) border-b border-(--color-border)",
      // Auto-hide on mobile: slide out above the sticky clip, fade to 0.
      // Desktop: always visible (lg: overrides hide regardless of scroll).
      "transition-[transform,opacity] duration-(--duration-default) ease-(--ease-out)",
      hidden
        ? "-translate-y-full opacity-0 pointer-events-none lg:translate-y-0 lg:opacity-100 lg:pointer-events-auto"
        : "translate-y-0 opacity-100",
      className,
    )}>
      <div className="flex items-center gap-2 lg:hidden">
        <button
          type="button"
          onClick={onMenuToggle}
          className={cn(
            "lg:hidden flex items-center justify-center",
            "min-h-[44px] min-w-[44px] rounded-(--radius-lg)",
            "text-(--color-text-muted) hover:text-(--color-text)",
            "hover:bg-(--color-chrome-hover)",
            "transition-[color,background-color] duration-(--duration-fast)",
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
        <div className="min-w-0 flex-1">
          {header.breadcrumb ? (
            <div className="mb-0.5">{header.breadcrumb}</div>
          ) : activeSection && activeLabel ? (
            <Breadcrumbs
              items={[
                { label: activeSection },
                { label: activeLabel },
              ]}
            />
          ) : null}
          {header.title && (
            <div className="flex min-w-0 items-baseline gap-2">
              {/* No es h1: el heading semántico vive en PageHeader dentro del contenido */}
              <p className="truncate text-sm font-semibold text-(--color-text)">
                {header.title}
              </p>
              {header.description && (
                <p className="hidden min-w-0 truncate text-xs text-(--color-text-muted) 2xl:block">
                  {header.description}
                </p>
              )}
            </div>
          )}
        </div>
        {worksiteName && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-(--radius) bg-(--color-surface) border border-(--color-border)">
            <MapPin size={13} weight="bold" className="text-(--color-primary) shrink-0" />
            <span className="text-xs font-medium text-(--color-text-muted) truncate max-w-[16rem] 2xl:max-w-[20rem]">
              {worksiteName}
            </span>
          </div>
        )}
        {header.actions && (
          <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
            {header.actions}
          </div>
        )}
      </div>
      {/* Mobile: spacer para empujar campana+avatar a la derecha */}
      <div className="flex-1 lg:hidden" aria-hidden />

      <div className="flex items-center gap-1.5">
        {!hideSearch && (
          <div className="relative hidden sm:flex items-center">
            <MagnifyingGlass size={14} className="absolute left-2.5 text-(--color-text-subtle) pointer-events-none shrink-0" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filtrar en esta página..."
              className={cn(
                "h-7 w-36 lg:w-52 rounded-(--radius-lg) border bg-(--color-surface) pl-8 text-xs text-(--color-text) placeholder:text-(--color-text-subtle) outline-none focus:border-(--color-primary) focus:ring-2 focus:ring-(--color-primary-line) transition-[border-color,box-shadow] duration-(--duration-fast)",
                searchQuery
                  ? "border-(--color-primary-line) pr-7"
                  : "border-(--color-border) pr-3",
              )}
              aria-label="Filtrar en esta página"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-1.5 flex h-4 w-4 items-center justify-center rounded-full text-(--color-text-subtle) hover:bg-surface-3 hover:text-(--color-text) transition-colors duration-(--duration-fast)"
                aria-label="Limpiar filtro"
              >
                <X size={11} weight="bold" />
              </button>
            )}
          </div>
        )}
        <NotificationBell />
        <UserMenu session={session} />
      </div>
    </header>
  )
})

export const TopBar = TopBarInner
