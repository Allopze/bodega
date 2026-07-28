"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { Session } from "next-auth"
import { CaretRight, Lifebuoy, SquaresFour } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/tooltip"
import { BrandMark } from "./brand-mark"
import { NAV_ICONS } from "./nav-icons"
import { getVisibleAreas, findActiveArea, isHrefActive, DASHBOARD_ITEM } from "./nav-items"
import { AccordionAreas, RailFlyout } from "./desktop-nav-areas"
import { SidebarUserProfile } from "./sidebar-user-profile"

interface DesktopNavProps {
  session:           Session
  badgeCounts?:      Record<string, number>
  collapsed:         boolean
  onCollapsedChange: (collapsed: boolean) => void
  /** Módulos habilitados por feature toggle (opcional). */
  enabledModuleIds?: Set<string>
}

const DesktopNavInner = React.memo(function DesktopNavInner({ session, badgeCounts, collapsed, onCollapsedChange, enabledModuleIds }: DesktopNavProps) {
  const pathname = usePathname()
  const areas = React.useMemo(() => getVisibleAreas(session, enabledModuleIds), [session, enabledModuleIds])
  const routeArea = findActiveArea(areas, pathname)
  const dashActive = isHrefActive(DASHBOARD_ITEM.href, pathname)
  const DashIcon = NAV_ICONS[DASHBOARD_ITEM.iconName]
  const showPanel = React.useCallback(() => onCollapsedChange(false), [onCollapsedChange])
  const hidePanel = React.useCallback(() => onCollapsedChange(true), [onCollapsedChange])

  if (collapsed) {
    return (      <nav
      aria-label="Áreas"
      className="hidden lg:flex lg:w-[var(--sidebar-rail-width)] lg:shrink-0 lg:flex-col overflow-hidden bg-(--color-chrome) border-r border-slate-200/80"
    >
      <div className="flex items-center justify-center border-b border-slate-200/80 py-3 shrink-0">
        <BrandMark variant="light" size={32} hideText />
      </div>

      <div className="flex flex-1 min-h-0 flex-col gap-0.5 overflow-y-auto px-2 py-2">
        <Tooltip content="Inicio" side="right" delayDuration={250}>
          <Link
            href={DASHBOARD_ITEM.href}
            aria-current={dashActive ? "page" : undefined}
            aria-label="Inicio"
            data-pressable
            className={cn(
              "relative flex items-center justify-center rounded-lg px-1 py-2 transition-[background-color,color] duration-(--duration-fast) ease-out",
              dashActive
                ? "bg-(--color-primary-tint) text-(--color-primary-ink)"
                : "text-(--color-text-muted) hover:bg-(--color-chrome-hover) hover:text-(--color-text)",
            )}
          >
            <SquaresFour size={21} weight="regular" className={cn("shrink-0", dashActive && "text-(--color-primary)")} />
          </Link>
        </Tooltip>

        <div className="mx-2 my-1 border-t border-slate-200/80" aria-hidden />

        {areas.filter((a) => a.id !== "soporte").map((area) => (
          <RailFlyout
            key={area.id}
            area={area}
            pathname={pathname}
            badgeCounts={badgeCounts}
            inRoute={routeArea === area.id}
          />
        ))}
      </div>

      <div className="flex flex-col items-center gap-1 border-t border-slate-200/80 py-2">
        {areas.filter((a) => a.id === "soporte").length > 0 && (
          <Tooltip content="Soporte" side="right" delayDuration={250}>
            <Link
              href="/soporte"
              aria-label="Soporte"
              data-pressable
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-(--radius) text-(--color-text-muted) transition-[background-color,color] duration-(--duration-fast) ease-out hover:bg-(--color-chrome-hover) hover:text-(--color-text)",
              )}
            >
              <Lifebuoy size={19} />
            </Link>
          </Tooltip>
        )}
        <Tooltip content="Mostrar panel" side="right" delayDuration={250}>
          <button
            type="button"
            onClick={showPanel}
            aria-label="Mostrar panel"
            className="flex h-8 w-8 items-center justify-center rounded-(--radius) text-(--color-text-muted) transition-[background-color,color] duration-(--duration-fast) ease-out hover:bg-(--color-chrome-hover) hover:text-(--color-text)"
          >
            <CaretRight size={14} weight="bold" />
          </button>
        </Tooltip>
      </div>

      <SidebarUserProfile session={session} collapsed />
    </nav>
    )
  }

  return (
    <nav
      aria-label="Navegación"
      className="hidden lg:flex lg:w-[var(--sidebar-width)] lg:shrink-0 lg:flex-col overflow-hidden bg-[#f3f3f5] p-3.5"
    >
      {/* Header de la marca */}
      <div className="mb-4 flex shrink-0 items-center justify-between px-1">
        <BrandMark variant="light" size={36} subtitle titleSize="base" />
        <Tooltip content="Ocultar panel" side="right" delayDuration={250}>
          <button
            type="button"
            onClick={hidePanel}
            aria-label="Ocultar panel"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200/60 hover:text-slate-900"
          >
            <CaretRight size={14} weight="bold" className="rotate-180" />
          </button>
        </Tooltip>
      </div>

      {/* Links Navigation (con scroll independiente) */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1 py-1 pr-1">
        <p className="px-2 pb-1.5 text-xs font-bold uppercase tracking-wider text-(--color-text-muted)">Plataforma</p>

        <Link
          href={DASHBOARD_ITEM.href}
          aria-current={dashActive ? "page" : undefined}
          data-pressable
          className={cn(
            "relative mb-1 flex h-[40px] items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors",
            dashActive
              ? "bg-slate-200/80 font-semibold text-slate-900"
              : "text-slate-600 hover:bg-slate-200/50 hover:text-slate-900",
          )}
        >
          {DashIcon && (
            <DashIcon
              size={20}
              weight="regular"
              className={cn("shrink-0", dashActive ? "text-slate-900" : "text-slate-500")}
            />
          )}
          <span>Inicio</span>
        </Link>

        <AccordionAreas areas={areas.filter((a) => a.id !== "soporte")} pathname={pathname} badgeCounts={badgeCounts} routeArea={routeArea} />
      </div>

      {/* Footer fijado al pie (Soporte + Perfil de Usuario) */}
      <div className="mt-auto shrink-0 pt-2 space-y-1 border-t border-slate-200/60">
        {areas.filter((a) => a.id === "soporte").length > 0 && (
          <Link
            href="/soporte"
            data-pressable
            className={cn(
              "relative flex h-[40px] items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors",
              isHrefActive("/soporte", pathname)
                ? "bg-slate-200/80 font-semibold text-slate-900"
                : "text-slate-600 hover:bg-slate-200/50 hover:text-slate-900",
            )}
          >
            <Lifebuoy
              size={20}
              weight="regular"
              className={cn("shrink-0", isHrefActive("/soporte", pathname) ? "text-slate-900" : "text-slate-500")}
            />
            <span>Soporte</span>
          </Link>
        )}
        <SidebarUserProfile session={session} />
      </div>
    </nav>
  )
})

export const DesktopNav = DesktopNavInner
