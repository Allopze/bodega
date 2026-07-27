"use client"

import * as React from "react"
import * as Collapsible from "@radix-ui/react-collapsible"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { CaretDown, SquaresFour } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { NAV_ICONS } from "./nav-icons"
import { AreaItems } from "./nav-rows"
import type { AreaNode } from "./nav-items"

export function AccordionAreas({
  areas,
  pathname,
  badgeCounts,
  routeArea,
}: {
  areas:         AreaNode[]
  pathname:      string
  badgeCounts?:  Record<string, number>
  routeArea:     string | null
}) {
  const [openId, setOpenId] = React.useState<string | null>(routeArea)

  // Al navegar a otra área, abrir su sección. Se ajusta durante el render en
  // vez de en un efecto para que el menú no se pinte cerrado un frame.
  const [lastRouteArea, setLastRouteArea] = React.useState(routeArea)
  if (lastRouteArea !== routeArea) {
    setLastRouteArea(routeArea)
    if (routeArea) setOpenId(routeArea)
  }

  const handleToggle = React.useCallback((id: string) => {
    setOpenId((prev) => (prev === id ? null : id))
  }, [])

  return (
    <div>
      {areas.map((area, i) => (
        <AreaSection
          key={area.id}
          area={area}
          pathname={pathname}
          badgeCounts={badgeCounts}
          open={openId === area.id}
          onToggle={() => handleToggle(area.id)}
          first={i === 0}
        />
      ))}
    </div>
  )
}

function AreaSection({
  area,
  pathname,
  badgeCounts,
  open,
  onToggle,
  first,
}: {
  area:         AreaNode
  pathname:     string
  badgeCounts?: Record<string, number>
  open:         boolean
  onToggle:     () => void
  first:        boolean
}) {
  const Icon = NAV_ICONS[area.iconName] ?? SquaresFour

  return (
    <Collapsible.Root open={open} onOpenChange={onToggle} className={cn(!first && "mt-4")}>
      <Collapsible.Trigger asChild>
        <button
          type="button"
          aria-expanded={open}
          /* A2 (PLAN_MIGRACION_VISUAL): eyebrow aplanado — de uppercase + tracking
             ancho + tenue a tipografía normal, más cercano a la referencia.
             Se mantiene el caret para distinguir la jerarquía colapsable. */
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-(--color-text-muted) transition-colors duration-(--duration-fast) hover:text-(--color-text)"
        >
          <Icon
            size={13}
            weight="regular"
            className={cn("shrink-0", open ? "text-(--color-text-muted)" : "text-(--color-text-faint)")}
          />
          <span title={area.label} className="flex-1 truncate">{area.label}</span>
          <CaretDown
            size={11}
            className={cn("shrink-0 text-text-faint transition-transform duration-(--duration-fast)", open && "rotate-180")}
          />
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
        <div className="pb-1 pl-1">
          <AreaItems area={area} pathname={pathname} badgeCounts={badgeCounts} />
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

export function RailFlyout({
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={area.label}
          className={cn(
            "group relative flex items-center justify-center rounded-lg px-1 py-2 transition-[background-color,color] duration-(--duration-fast) ease-out",
            inRoute
              ? "bg-(--color-primary-tint) text-(--color-primary-ink)"
              : "text-(--color-text-muted) hover:bg-(--color-chrome-hover) hover:text-(--color-text)",
          )}
        >
          <Icon size={19} weight="regular" className={cn("shrink-0", inRoute && "text-(--color-primary)")} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={10}
        className="w-56 p-2"
      >
          <p className="px-2 pb-1 text-eyebrow">
            {area.label}
          </p>
          <AreaItems area={area} pathname={pathname} badgeCounts={badgeCounts} onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
