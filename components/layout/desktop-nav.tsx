"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { Session } from "next-auth"
import * as Collapsible from "@radix-ui/react-collapsible"
import * as Popover from "@radix-ui/react-popover"
import { CaretDown, CaretRight, MapPin, SquaresFour } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/tooltip"
import { BrandMark } from "./brand-mark"
import { NAV_ICONS } from "./nav-icons"
import { AreaItems } from "./nav-rows"
import { getVisibleAreas, findActiveArea, isHrefActive, DASHBOARD_ITEM, type AreaNode } from "./nav-items"

interface DesktopNavProps {
  session:           Session
  worksiteName?:     string
  badgeCounts?:      Record<string, number>
  collapsed:         boolean
  onCollapsedChange: (collapsed: boolean) => void
}

export function DesktopNav({ session, worksiteName, badgeCounts, collapsed, onCollapsedChange }: DesktopNavProps) {
  const pathname = usePathname()
  const areas = React.useMemo(() => getVisibleAreas(session), [session])
  const routeArea = findActiveArea(areas, pathname)
  const dashActive = isHrefActive(DASHBOARD_ITEM.href, pathname)
  const DashIcon = NAV_ICONS[DASHBOARD_ITEM.iconName]

  if (collapsed) {
    return (
      <nav
        aria-label="Áreas"
        className="hidden lg:flex lg:w-16 lg:shrink-0 lg:flex-col overflow-hidden rounded-full border border-(--color-border) bg-surface shadow-(--shadow-card)"
      >
        <div className="flex items-center justify-center py-3">
          <BrandMark variant="light" size={30} hideText />
        </div>

        <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-1">
          <Tooltip content="Inicio" side="right" delayDuration={250}>
            <Link
              href={DASHBOARD_ITEM.href}
              aria-current={dashActive ? "page" : undefined}
              data-pressable
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg px-1 py-2 transition-[background-color,color] duration-(--duration-fast) ease-out",
                dashActive
                  ? "bg-(--color-primary-tint) text-(--color-primary-ink)"
                  : "text-(--color-text-muted) hover:bg-surface-2 hover:text-(--color-text)",
              )}
            >
              <SquaresFour size={22} weight={dashActive ? "bold" : "regular"} className={cn("shrink-0", dashActive && "text-(--color-primary)")} />
              <span className="w-full truncate text-center text-[10px] font-semibold leading-tight">Inicio</span>
            </Link>
          </Tooltip>

          {areas.map((area) => (
            <RailFlyout
              key={area.id}
              area={area}
              pathname={pathname}
              badgeCounts={badgeCounts}
              inRoute={routeArea === area.id}
            />
          ))}
        </div>

        <div className="flex items-center justify-center border-t border-(--color-border) py-2">
          <Tooltip content="Mostrar panel" side="right" delayDuration={250}>
            <button
              type="button"
              onClick={() => onCollapsedChange(false)}
              aria-label="Mostrar panel"
              className="flex h-8 w-8 items-center justify-center rounded-full text-(--color-text-muted) transition-[background-color,color] duration-(--duration-fast) ease-out hover:bg-surface-2 hover:text-(--color-text)"
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
      className="hidden lg:flex lg:w-60 lg:shrink-0 lg:flex-col overflow-hidden rounded-(--radius-2xl) border border-(--color-border) bg-surface shadow-(--shadow-card)"
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <BrandMark variant="light" size={36} subtitle titleSize="sm" />
        <Tooltip content="Ocultar panel" side="right" delayDuration={250}>
          <button
            type="button"
            onClick={() => onCollapsedChange(true)}
            aria-label="Ocultar panel"
            className="flex h-7 w-7 items-center justify-center rounded-full text-(--color-text-muted) transition-[background-color,color] duration-(--duration-fast) ease-out hover:bg-surface-2 hover:text-(--color-text)"
          >
            <CaretRight size={14} weight="bold" className="rotate-180" />
          </button>
        </Tooltip>
      </div>

      {worksiteName && (
        <div className="border-y border-(--color-border) px-4 py-3">
          <p className="text-eyebrow mb-0.5">Faena activa</p>
          <div className="flex items-center gap-1.5">
            <MapPin size={12} weight="bold" className="shrink-0 text-(--color-primary)" />
            <span className="truncate text-sm font-semibold text-(--color-text)">{worksiteName}</span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <Link
          href={DASHBOARD_ITEM.href}
          aria-current={dashActive ? "page" : undefined}
          data-pressable
          className={cn(
            "mb-1 flex h-10 items-center gap-3 rounded-md px-3 text-[14px] transition-[color,background-color] duration-(--duration-fast) ease-out",
            dashActive
              ? "bg-(--color-primary-tint) font-semibold text-(--color-primary-ink)"
              : "text-(--color-text-muted) hover:bg-surface-2 hover:text-(--color-text)",
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

        <div>
          {areas.map((area, i) => (
            <AreaSection
              key={area.id}
              area={area}
              pathname={pathname}
              badgeCounts={badgeCounts}
              defaultOpen={routeArea === area.id}
              first={i === 0}
            />
          ))}
        </div>
      </div>
    </nav>
  )
}

function AreaSection({
  area,
  pathname,
  badgeCounts,
  defaultOpen,
  first,
}: {
  area:         AreaNode
  pathname:     string
  badgeCounts?: Record<string, number>
  defaultOpen:  boolean
  first:        boolean
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  React.useEffect(() => {
    if (defaultOpen) setOpen(true)
  }, [defaultOpen])

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className={cn(!first && "mt-4")}>
      <Collapsible.Trigger asChild>
        <button
          type="button"
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-eyebrow transition-colors duration-(--duration-fast) hover:text-(--color-text-muted)"
        >
          <span className="flex-1 truncate">{area.label}</span>
          <CaretDown
            size={12}
            className={cn("shrink-0 text-text-faint transition-transform duration-(--duration-fast)", open && "rotate-180")}
          />
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1">
        <div className="pb-1 pl-1">
          <AreaItems area={area} pathname={pathname} badgeCounts={badgeCounts} />
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

function RailFlyout({
  area,
  pathname,
  badgeCounts,
  inRoute,
}: {
  area:         AreaNode
  pathname:     string
  badgeCounts?: Record<string, number>
  inRoute:      boolean
}) {
  const [open, setOpen] = React.useState(false)
  const Icon = NAV_ICONS[area.iconName] ?? SquaresFour
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={area.label}
          className={cn(
            "group relative flex flex-col items-center gap-1 rounded-lg px-1 py-2 transition-[background-color,color] duration-(--duration-fast) ease-out",
            inRoute
              ? "bg-(--color-primary-tint) text-(--color-primary-ink)"
              : "text-(--color-text-muted) hover:bg-surface-2 hover:text-(--color-text)",
          )}
        >
          <Icon size={22} weight={inRoute ? "bold" : "regular"} className={cn("shrink-0", inRoute && "text-(--color-primary)")} />
          <span className="w-full truncate text-center text-[10px] font-semibold leading-tight">{area.label}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={10}
          className="z-50 w-56 rounded-lg border border-(--color-border) bg-surface p-2 shadow-(--shadow-lg) data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <p className="px-2 pb-1 text-eyebrow">
            {area.label}
          </p>
          <AreaItems area={area} pathname={pathname} badgeCounts={badgeCounts} onNavigate={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
