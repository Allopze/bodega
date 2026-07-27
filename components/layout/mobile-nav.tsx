"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { Session } from "next-auth"
import * as Collapsible from "@radix-ui/react-collapsible"
import { CaretDown, Lifebuoy, MapPin } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { BrandMark } from "./brand-mark"
import { NAV_ICONS } from "./nav-icons"
import { AreaItems } from "./nav-rows"
import { getVisibleAreas, findActiveArea, isHrefActive, DASHBOARD_ITEM, type AreaNode } from "./nav-items"
import { SidebarUserProfile } from "./sidebar-user-profile"

interface MobileNavProps {
  session:           Session
  worksiteName?:     string
  badgeCounts?:      Record<string, number>
  onNavigate?:       () => void
  /** Módulos habilitados por feature toggle (opcional). */
  enabledModuleIds?: Set<string>
}

/** Navegación móvil: columna única en acordeón (área activa expandida). */
const MobileNavInner = React.memo(function MobileNavInner({ session, worksiteName, badgeCounts, onNavigate, enabledModuleIds }: MobileNavProps) {
  const pathname = usePathname()
  const areas = React.useMemo(() => getVisibleAreas(session, enabledModuleIds), [session, enabledModuleIds])
  const routeArea = findActiveArea(areas, pathname)
  const dashActive = isHrefActive(DASHBOARD_ITEM.href, pathname)
  const DashIcon = NAV_ICONS[DASHBOARD_ITEM.iconName]

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-(--color-border) px-4 py-4">
        <BrandMark variant="light" size={30} subtitle titleSize="base" />
      </div>

      {worksiteName && (
        <div className="border-b border-(--color-border) px-4 py-3">
          <p className="text-eyebrow mb-1">Faena activa</p>
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
            "mb-1 flex h-[var(--nav-item-height)] items-center gap-2.5 rounded-md px-3 text-sm transition-[color,background-color] duration-(--duration-fast) ease-out",
            dashActive
              ? "font-semibold text-(--color-primary-ink)"
              : "text-(--color-text-muted) hover:bg-(--color-chrome-hover) hover:text-(--color-text)",
          )}
        >
          {DashIcon && <DashIcon size={17} weight="regular" className={cn("shrink-0", dashActive && "text-(--color-primary)")} />}
          Inicio
        </Link>

        <div>
          {areas.filter((a) => a.id !== "soporte").map((area, i) => (
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

      {/* Soporte: botón fijo al final del drawer móvil */}
      {areas.filter((a) => a.id === "soporte").length > 0 && (
        <div className="border-t border-(--color-border) px-2 py-2">
          <Link
            href="/soporte"
            onClick={onNavigate}
            data-pressable
            className={cn(
              "flex h-[var(--nav-item-height)] items-center gap-2.5 rounded-md px-3 text-sm transition-[color,background-color] duration-(--duration-fast) ease-out",
              isHrefActive("/soporte", pathname)
                ? "font-semibold text-(--color-primary-ink)"
                : "text-(--color-text-muted) hover:bg-(--color-chrome-hover) hover:text-(--color-text)",
            )}
          >
            <Lifebuoy
              size={17}
              weight="regular"
              className={cn("shrink-0", isHrefActive("/soporte", pathname) && "text-(--color-primary)")}
            />
            <span>Soporte</span>
          </Link>
        </div>
      )}

      <SidebarUserProfile session={session} />
    </div>
  )
})

export const MobileNav = MobileNavInner

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
  const [wasDefaultOpen, setWasDefaultOpen] = React.useState(defaultOpen)
  // Auto-expandir cuando la navegación activa esta área, sin pisar un colapso
  // manual del usuario (derivado en render, sin useEffect).
  if (defaultOpen !== wasDefaultOpen) {
    setWasDefaultOpen(defaultOpen)
    if (defaultOpen) setOpen(true)
  }

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className={cn(!first && "mt-4")}>
      <Collapsible.Trigger asChild>
        <button
          type="button"
          aria-expanded={open}
          /* A2: eyebrow aplanado para consistencia con el desktop. */
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-(--color-text-muted) transition-colors duration-(--duration-fast) hover:text-(--color-text)"
        >
          <span title={area.label} className="flex-1 truncate">{area.label}</span>
          <CaretDown size={11} className={cn("shrink-0 text-text-faint transition-transform duration-(--duration-fast)", open && "rotate-180")} />
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

