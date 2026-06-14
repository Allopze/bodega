"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { Session } from "next-auth"
import * as Popover from "@radix-ui/react-popover"
import { CaretLeft, CaretRight, MapPin, SquaresFour } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/tooltip"
import { BrandMark } from "./brand-mark"
import { NAV_ICONS } from "./nav-icons"
import { AreaItems } from "./nav-rows"
import { getVisibleAreas, findActiveArea, isHrefActive, type AreaNode } from "./nav-items"

interface DesktopNavProps {
  session:           Session
  worksiteName?:     string
  badgeCounts?:      Record<string, number>
  collapsed:         boolean
  onCollapsedChange: (collapsed: boolean) => void
}

const railCardCls =
  "hidden lg:flex lg:w-[5.25rem] lg:shrink-0 lg:flex-col overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]"
const panelCardCls =
  "hidden lg:flex lg:w-56 lg:shrink-0 lg:flex-col overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]"

export function DesktopNav({ session, worksiteName, badgeCounts, collapsed, onCollapsedChange }: DesktopNavProps) {
  const pathname = usePathname()
  const areas = React.useMemo(() => getVisibleAreas(session), [session])
  const routeArea = findActiveArea(areas, pathname)
  const [selected, setSelected] = React.useState<string | null>(routeArea ?? areas[0]?.id ?? null)
  React.useEffect(() => {
    if (routeArea) setSelected(routeArea)
  }, [routeArea])

  const activeArea = areas.find((a) => a.id === selected) ?? areas[0] ?? null
  const onDashboard = isHrefActive("/dashboard", pathname)

  return (
    <>
      {/* ── RAIL: áreas ── */}
      <nav aria-label="Áreas" className={railCardCls}>
        <div className="flex items-center justify-center py-3">
          <BrandMark variant="light" size={30} hideText />
        </div>

        <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-1">
          <RailItem
            iconName="SquaresFour"
            label="Inicio"
            href="/dashboard"
            active={onDashboard}
          />
          {areas.map((area) =>
            collapsed ? (
              <RailFlyout
                key={area.id}
                area={area}
                pathname={pathname}
                badgeCounts={badgeCounts}
                inRoute={routeArea === area.id}
              />
            ) : (
              <RailItem
                key={area.id}
                iconName={area.iconName}
                label={area.label}
                selected={selected === area.id}
                inRoute={routeArea === area.id}
                onClick={() => setSelected(area.id)}
              />
            ),
          )}
        </div>

        <div className="flex items-center justify-center border-t border-[var(--color-border)] py-2">
          <Tooltip content={collapsed ? "Mostrar panel" : "Ocultar panel"} side="right" delayDuration={250}>
            <button
              type="button"
              onClick={() => onCollapsedChange(!collapsed)}
              aria-pressed={collapsed}
              aria-label={collapsed ? "Mostrar panel" : "Ocultar panel"}
              className="flex h-8 w-8 items-center justify-center rounded-full text-(--color-text-muted) transition-[background-color,color] duration-(--duration-fast) ease-out hover:bg-surface-2 hover:text-(--color-text)"
            >
              {collapsed ? <CaretRight size={16} weight="bold" /> : <CaretLeft size={16} weight="bold" />}
            </button>
          </Tooltip>
        </div>
      </nav>

      {/* ── PANEL: área activa ── */}
      {!collapsed && activeArea && (
        <aside aria-label={activeArea.label} className={panelCardCls}>
          {worksiteName && (
            <div className="border-b border-[var(--color-border)] px-4 py-3">
              <p className="text-eyebrow mb-0.5">Faena activa</p>
              <div className="flex items-center gap-1.5">
                <MapPin size={12} weight="bold" className="shrink-0 text-(--color-primary)" />
                <span className="truncate text-sm font-semibold text-(--color-text)">{worksiteName}</span>
              </div>
            </div>
          )}
          <div className="px-3 pb-3 pt-3">
            <p className="px-3 mb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-(--color-text-muted)">
              {activeArea.label}
            </p>
            <AreaItems area={activeArea} pathname={pathname} badgeCounts={badgeCounts} />
          </div>
        </aside>
      )}
    </>
  )
}

/** Botón/enlace del rail: icono + mini-etiqueta apilada. */
function RailItem({
  iconName,
  label,
  href,
  active,
  selected,
  inRoute,
  onClick,
}: {
  iconName:  string
  label:     string
  href?:     string
  active?:   boolean
  selected?: boolean
  inRoute?:  boolean
  onClick?:  () => void
}) {
  const Icon = NAV_ICONS[iconName] ?? SquaresFour
  const on = active || selected
  const cls = cn(
    "group relative flex flex-col items-center gap-1 rounded-[var(--radius-lg)] px-1 py-2 transition-[background-color,color] duration-(--duration-fast) ease-out",
    on
      ? "bg-[var(--color-primary-tint)] text-(--color-primary-ink)"
      : "text-(--color-text-muted) hover:bg-surface-2 hover:text-(--color-text)",
  )
  const inner = (
    <>
      {inRoute && !on && (
        <span aria-hidden className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-[var(--color-primary)]" />
      )}
      <Icon size={22} weight={on ? "bold" : "regular"} className={cn("shrink-0", on ? "text-(--color-primary)" : "")} />
      <span className="w-full truncate text-center text-[10px] font-semibold leading-tight">{label}</span>
    </>
  )

  if (href) {
    return (
      <Link href={href} data-pressable aria-current={active ? "page" : undefined} className={cls}>
        {inner}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} data-pressable aria-pressed={selected} className={cls}>
      {inner}
    </button>
  )
}

/** En modo colapsado: icono del rail que abre un flyout con los ítems del área. */
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
            "group relative flex flex-col items-center gap-1 rounded-[var(--radius-lg)] px-1 py-2 transition-[background-color,color] duration-(--duration-fast) ease-out",
            inRoute
              ? "bg-[var(--color-primary-tint)] text-(--color-primary-ink)"
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
          className="z-50 w-56 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-lg)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <p className="px-2 pb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-(--color-text-muted)">
            {area.label}
          </p>
          <AreaItems area={area} pathname={pathname} badgeCounts={badgeCounts} onNavigate={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
