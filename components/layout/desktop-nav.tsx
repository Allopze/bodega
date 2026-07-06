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

interface DesktopNavProps {
  session:           Session
  badgeCounts?:      Record<string, number>
  collapsed:         boolean
  onCollapsedChange: (collapsed: boolean) => void
}

export function DesktopNav({ session, badgeCounts, collapsed, onCollapsedChange }: DesktopNavProps) {
  const pathname = usePathname()
  const areas = React.useMemo(() => getVisibleAreas(session), [session])
  const routeArea = findActiveArea(areas, pathname)
  const dashActive = isHrefActive(DASHBOARD_ITEM.href, pathname)
  const DashIcon = NAV_ICONS[DASHBOARD_ITEM.iconName]

  if (collapsed) {
    return (
      <nav
        aria-label="Áreas"
        className="hidden lg:flex lg:w-16 lg:shrink-0 lg:flex-col overflow-hidden bg-(--color-chrome) border-r border-(--color-border)"
      >
        <div className="flex items-center justify-center py-3">
          <BrandMark variant="light" size={30} hideText />
        </div>

        <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-1">
          <Tooltip content="Inicio" side="right" delayDuration={250}>
            <Link
              href={DASHBOARD_ITEM.href}
              aria-current={dashActive ? "page" : undefined}
              aria-label="Inicio"
              data-pressable
              className={cn(
                "flex items-center justify-center rounded-lg px-1 py-2 transition-[background-color,color] duration-(--duration-fast) ease-out",
                dashActive
                  ? "bg-(--color-primary-tint) text-(--color-primary-ink)"
                  : "text-(--color-text-muted) hover:bg-(--color-chrome-hover) hover:text-(--color-text)",
              )}
            >
              <SquaresFour size={19} weight={dashActive ? "bold" : "regular"} className={cn("shrink-0", dashActive && "text-(--color-primary)")} />
            </Link>
          </Tooltip>

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
                data-pressable
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-(--radius) text-(--color-text-muted) transition-[background-color,color] duration-(--duration-fast) ease-out hover:bg-(--color-chrome-hover) hover:text-(--color-text)",
                )}
              >
                <Lifebuoy size={17} />
              </Link>
            </Tooltip>
          )}
          <Tooltip content="Mostrar panel" side="right" delayDuration={250}>
            <button
              type="button"
              onClick={() => onCollapsedChange(false)}
              aria-label="Mostrar panel"
              className="flex h-8 w-8 items-center justify-center rounded-(--radius) text-(--color-text-muted) transition-[background-color,color] duration-(--duration-fast) ease-out hover:bg-(--color-chrome-hover) hover:text-(--color-text)"
            >
              <CaretRight size={16} weight="bold" />
            </button>
          </Tooltip>
        </div>
      </nav>
    )
  }

  return (
    <nav
      aria-label="Navegación"
      className="hidden lg:flex lg:w-60 lg:shrink-0 lg:flex-col overflow-hidden bg-(--color-chrome) border-r border-(--color-border)"
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <BrandMark variant="light" size={36} subtitle titleSize="sm" />
        <Tooltip content="Ocultar panel" side="right" delayDuration={250}>
          <button
            type="button"
            onClick={() => onCollapsedChange(true)}
            aria-label="Ocultar panel"
            className="flex h-7 w-7 items-center justify-center rounded-(--radius) text-(--color-text-muted) transition-[background-color,color] duration-(--duration-fast) ease-out hover:bg-(--color-chrome-hover) hover:text-(--color-text)"
          >
            <CaretRight size={14} weight="bold" className="rotate-180" />
          </button>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <Link
          href={DASHBOARD_ITEM.href}
          aria-current={dashActive ? "page" : undefined}
          data-pressable
          className={cn(
            "mb-1 flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-[color,background-color] duration-(--duration-fast) ease-out",
            dashActive
              ? "bg-(--color-primary-tint) font-semibold text-(--color-primary-ink)"
              : "text-(--color-text-muted) hover:bg-(--color-chrome-hover) hover:text-(--color-text)",
          )}
        >
          {DashIcon && (
            <DashIcon
              size={19}
              weight={dashActive ? "bold" : "regular"}
              className={cn("shrink-0", dashActive ? "text-(--color-primary)" : "text-(--color-text-muted)")}
            />
          )}
          <span>Inicio</span>
        </Link>

        <AccordionAreas areas={areas.filter((a) => a.id !== "soporte")} pathname={pathname} badgeCounts={badgeCounts} routeArea={routeArea} />
      </div>

      {/* Soporte: botón fijo al final del panel, justo sobre el toggle de colapso */}
      {areas.filter((a) => a.id === "soporte").length > 0 && (
        <div className="border-t border-(--color-border) px-2 pt-2 pb-1">
          <Link
            href="/soporte"
            data-pressable
            className={cn(
              "flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-[color,background-color] duration-(--duration-fast) ease-out",
              isHrefActive("/soporte", pathname)
                ? "bg-(--color-primary-tint) font-semibold text-(--color-primary-ink)"
                : "text-(--color-text-muted) hover:bg-(--color-chrome-hover) hover:text-(--color-text)",
            )}
          >
            <Lifebuoy
              size={19}
              weight={isHrefActive("/soporte", pathname) ? "bold" : "regular"}
              className={cn("shrink-0", isHrefActive("/soporte", pathname) && "text-(--color-primary)")}
            />
            <span>Soporte</span>
          </Link>
        </div>
      )}
    </nav>
  )
}


