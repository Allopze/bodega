"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { Session } from "next-auth"
import * as Collapsible from "@radix-ui/react-collapsible"
import { CaretDown, MapPin } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { BrandMark } from "./brand-mark"
import { NAV_ICONS } from "./nav-icons"
import { AreaItems } from "./nav-rows"
import { getVisibleAreas, findActiveArea, isHrefActive, DASHBOARD_ITEM, type AreaNode } from "./nav-items"

interface MobileNavProps {
  session:       Session
  worksiteName?: string
  badgeCounts?:  Record<string, number>
  onNavigate?:   () => void
}

/** Navegación móvil: columna única en acordeón (área activa expandida). */
export function MobileNav({ session, worksiteName, badgeCounts, onNavigate }: MobileNavProps) {
  const pathname = usePathname()
  const areas = React.useMemo(() => getVisibleAreas(session), [session])
  const routeArea = findActiveArea(areas, pathname)
  const dashActive = isHrefActive(DASHBOARD_ITEM.href, pathname)
  const DashIcon = NAV_ICONS[DASHBOARD_ITEM.iconName]

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pb-3 pt-3">
        <BrandMark variant="light" size={34} subtitle titleSize="base" />
      </div>

      {worksiteName && (
        <div className="border-y border-[var(--color-border)] px-4 py-3">
          <p className="text-eyebrow mb-0.5">Faena activa</p>
          <div className="flex items-center gap-1.5">
            <MapPin size={12} weight="bold" className="shrink-0 text-(--color-primary)" />
            <span className="truncate text-sm font-semibold text-(--color-text)">{worksiteName}</span>
          </div>
        </div>
      )}

      <nav aria-label="Navegación" className="flex-1 overflow-y-auto px-2 py-3">
        <Link
          href={DASHBOARD_ITEM.href}
          onClick={onNavigate}
          aria-current={dashActive ? "page" : undefined}
          className={cn(
            "mb-1 flex h-10 items-center gap-3 rounded-md px-3 text-[14px] transition-[color,background-color] duration-(--duration-fast) ease-out",
            dashActive
              ? "font-semibold text-(--color-primary-ink)"
              : "text-(--color-text-muted) hover:bg-surface-2 hover:text-(--color-text)",
          )}
        >
          {DashIcon && <DashIcon size={19} weight={dashActive ? "bold" : "regular"} className={cn("shrink-0", dashActive && "text-(--color-primary)")} />}
          Inicio
        </Link>

        <div>
          {areas.map((area, i) => (
            <AreaAccordion
              key={area.id}
              area={area}
              pathname={pathname}
              badgeCounts={badgeCounts}
              defaultOpen={routeArea === area.id}
              onNavigate={onNavigate}
              first={i === 0}
            />
          ))}
        </div>
      </nav>
    </div>
  )
}

function AreaAccordion({
  area,
  pathname,
  badgeCounts,
  defaultOpen,
  onNavigate,
  first,
}: {
  area:         AreaNode
  pathname:     string
  badgeCounts?: Record<string, number>
  defaultOpen:  boolean
  onNavigate?:  () => void
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
          <CaretDown size={12} className={cn("shrink-0 text-text-faint transition-transform duration-(--duration-fast)", open && "rotate-180")} />
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
        <div className="pb-1 pl-1">
          <AreaItems area={area} pathname={pathname} badgeCounts={badgeCounts} onNavigate={onNavigate} />
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
