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
import { getAdminAreas } from "./admin-nav"
import { AccordionAreas, RailFlyout } from "./desktop-nav-areas"
import { navIconClass, navRailClass, navRowClass } from "./nav-rows"
import { SidebarUserProfile } from "./sidebar-user-profile"

interface DesktopNavProps {
  session:           Session
  badgeCounts?:      Record<string, number>
  collapsed:         boolean
  onCollapsedChange: (collapsed: boolean) => void
  /** Módulos habilitados por feature toggle (opcional). */
  enabledModuleIds?: Set<string>
  disabledSubmoduleHrefs?: Set<string>
}

const DesktopNavInner = React.memo(function DesktopNavInner({ session, badgeCounts, collapsed, onCollapsedChange, enabledModuleIds, disabledSubmoduleHrefs }: DesktopNavProps) {
  const pathname = usePathname()
  const isAdmin = pathname.startsWith("/admin")
  const areas = React.useMemo(
    () => isAdmin ? getAdminAreas(session) : getVisibleAreas(session, enabledModuleIds, disabledSubmoduleHrefs),
    [isAdmin, session, enabledModuleIds, disabledSubmoduleHrefs],
  )
  const routeArea = findActiveArea(areas, pathname)
  const dashActive = isHrefActive(DASHBOARD_ITEM.href, pathname)
  const soporteActive = isHrefActive("/soporte", pathname)
  const DashIcon = NAV_ICONS[DASHBOARD_ITEM.iconName]
  const showPanel = React.useCallback(() => onCollapsedChange(false), [onCollapsedChange])
  const hidePanel = React.useCallback(() => onCollapsedChange(true), [onCollapsedChange])

  if (collapsed) {
    return (      <nav
      aria-label="Áreas"
      className="hidden lg:flex lg:w-[var(--sidebar-rail-width)] lg:shrink-0 lg:flex-col overflow-hidden bg-(--color-chrome) border-r border-(--color-border)"
    >
      <div className="flex items-center justify-center border-b border-(--color-border) py-3 shrink-0">
        <BrandMark variant="light" size={32} hideText />
      </div>

      <div className="flex flex-1 min-h-0 flex-col gap-0.5 overflow-y-auto px-2 py-2">
        <Tooltip content="Inicio" side="right" delayDuration={250}>
          <Link
            href={DASHBOARD_ITEM.href}
            aria-current={dashActive ? "page" : undefined}
            aria-label="Inicio"
            data-pressable
            className={navRailClass(dashActive)}
          >
            <SquaresFour size={21} weight="regular" className={cn("shrink-0", dashActive && "text-(--color-primary)")} />
          </Link>
        </Tooltip>

        <div className="mx-2 my-1 border-t border-(--color-border)" aria-hidden />

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

      <div className="flex flex-col items-center gap-1 border-t border-(--color-border) py-2">
        {areas.filter((a) => a.id === "soporte").length > 0 && (
          <Tooltip content="Soporte" side="right" delayDuration={250}>
            <Link
              href="/soporte"
              aria-label="Soporte"
              aria-current={soporteActive ? "page" : undefined}
              data-pressable
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-(--radius) transition-colors duration-(--duration-fast) ease-out",
                soporteActive
                  ? "bg-nav-active-bg text-nav-active-ink"
                  : "text-(--color-text-muted) hover:bg-nav-hover-bg hover:text-(--color-text)",
              )}
            >
              <Lifebuoy size={19} className={cn(soporteActive && "text-(--color-primary)")} />
            </Link>
          </Tooltip>
        )}
        <Tooltip content="Mostrar panel" side="right" delayDuration={250}>
          <button
            type="button"
            onClick={showPanel}
            aria-label="Mostrar panel"
            className="flex h-8 w-8 items-center justify-center rounded-(--radius) text-(--color-text-muted) transition-[background-color,color] duration-(--duration-fast) ease-out hover:bg-nav-hover-bg hover:text-(--color-text)"
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
      className="hidden lg:flex lg:w-[var(--sidebar-width)] lg:shrink-0 lg:flex-col overflow-hidden bg-(--color-chrome) p-3.5"
    >
      {/* Header de la marca */}
      <div className="mb-4 flex shrink-0 items-center justify-between px-1">
        <BrandMark variant="light" size={36} subtitle titleSize="base" />
        <Tooltip content="Ocultar panel" side="right" delayDuration={250}>
          <button
            type="button"
            onClick={hidePanel}
            aria-label="Ocultar panel"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-(--color-text-muted) transition-colors hover:bg-nav-hover-bg hover:text-(--color-text)"
          >
            <CaretRight size={14} weight="bold" className="rotate-180" />
          </button>
        </Tooltip>
      </div>

      {/* Links Navigation (con scroll independiente) */}
      <div data-nav-scroll className="flex-1 min-h-0 overflow-y-auto space-y-1 py-1 pr-1">
        {/* Rótulo de sección en caja de oración (`text-eyebrow`); el primero del
            panel no lleva aire arriba, el espacio con la fila es de 8 px
            (`pb-1` + el `space-y-1` del contenedor). */}
        <p className="text-eyebrow px-3 pb-1">Plataforma</p>

        <Link
          href={DASHBOARD_ITEM.href}
          aria-current={dashActive ? "page" : undefined}
          data-pressable
          className={cn(navRowClass(dashActive), "mb-1")}
        >
          {DashIcon && <DashIcon size={20} weight="regular" className={navIconClass(dashActive)} />}
          <span>Inicio</span>
        </Link>

        <AccordionAreas areas={areas.filter((a) => a.id !== "soporte")} pathname={pathname} badgeCounts={badgeCounts} routeArea={routeArea} />
      </div>

      {/* Footer fijado al pie (Soporte + Perfil de Usuario) */}
      <div className="mt-auto shrink-0 pt-2 space-y-1 border-t border-(--color-border)">
        {areas.filter((a) => a.id === "soporte").length > 0 && (
          <Link
            href="/soporte"
            aria-current={soporteActive ? "page" : undefined}
            data-pressable
            className={navRowClass(soporteActive)}
          >
            <Lifebuoy size={20} weight="regular" className={navIconClass(soporteActive)} />
            <span>Soporte</span>
          </Link>
        )}
        <SidebarUserProfile session={session} />
      </div>
    </nav>
  )
})

export const DesktopNav = DesktopNavInner
