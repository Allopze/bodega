"use client"

import * as React from "react"
import * as Collapsible from "@radix-ui/react-collapsible"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Tooltip } from "@/components/ui/tooltip"
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

  // Un área con un solo destino no necesita disclosure: el acordeón agrega un
  // nivel de anidamiento por nada y, colapsado, esconde el badge de conteo del
  // ítem. Se renderiza plana, igual que "Inicio" (auditoría UI/UX 2026-07-29,
  // A-26: hizo falta al sacar "Mis pendientes" de Adquisiciones).
  if (area.items.length === 1) {
    return (
      <div className={cn(!first && "mt-4")}>
        <AreaItems area={area} pathname={pathname} badgeCounts={badgeCounts} />
      </div>
    )
  }

  return (
    <Collapsible.Root open={open} onOpenChange={onToggle} className={cn(!first && "mt-4")}>
      <Collapsible.Trigger asChild>
        <button
          type="button"
          aria-expanded={open}
          className="flex w-full items-center gap-3 px-3 py-2 text-left text-base font-semibold text-slate-700 hover:text-slate-900 rounded-xl transition-colors cursor-pointer"
        >
          <Icon
            size={20}
            weight="regular"
            className={cn("shrink-0", open ? "text-slate-900 font-semibold" : "text-slate-500")}
          />
          <span title={area.label} className="flex-1 truncate">{area.label}</span>
          <CaretDown
            size={15}
            className={cn("shrink-0 text-slate-400 transition-transform duration-(--duration-fast)", open && "rotate-180")}
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
      {/* En el rail colapsado el icono es el único rótulo. `aria-label` resuelve
          al lector de pantalla, pero quien navega con vista o con teclado no
          tenía forma de saber el destino sin abrir el panel: el tooltip lo
          revela también con foco. Radix cierra el tooltip en `pointerdown`, así
          que no se solapa con el popover que el mismo botón abre. */}
      <Tooltip content={area.label} side="right" delayDuration={250}>
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
            <Icon size={21} weight="regular" className={cn("shrink-0", inRoute && "text-(--color-primary)")} />
          </button>
        </PopoverTrigger>
      </Tooltip>
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
