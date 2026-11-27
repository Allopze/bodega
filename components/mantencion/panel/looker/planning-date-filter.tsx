"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { PeriodControl, defaultRangePresets, monthRange, shiftDateRange, type DateRange, type PeriodControlPreset } from "@/components/ui/period-control"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { activeDateShortcut, dateFieldHref, dateShortcutHref, DATE_SHORTCUT_DAYS } from "@/lib/services/mantencion/looker/filter-hrefs"
import type { LookerFilters } from "@/lib/services/mantencion/looker/types"
import { addMonths } from "@/lib/utils"

/**
 * Accesos rápidos del rango para fechas que miran hacia adelante (la próxima mantención estimada). Los de la última
 * mantención, que mira hacia atrás, son los del sistema (`defaultRangePresets`).
 */
function upcomingPresets(today: string): PeriodControlPreset<DateRange>[] {
  const month = monthRange(Number(today.slice(0, 4)), Number(today.slice(5, 7)))
  return [
    { key: "mes", label: "Este mes", period: month },
    { key: "mes-siguiente", label: "Mes siguiente", period: shiftDateRange(month, 1) },
    { key: "3m", label: "Próximos 3 meses", period: { from: today, to: addMonths(today, 3) } },
    { key: "12m", label: "Próximos 12 meses", period: { from: today, to: addMonths(today, 12) } },
  ]
}

/**
 * Filtro por fecha de Planificación: qué fecha se mira (la próxima mantención estimada o la última), el rango y los
 * atajos «Próximos N días». Cada gesto es un cambio de URL con `replace` y sin mover el scroll. Los atajos sólo
 * fijan el término —no el inicio— para que las vencidas (cuya fecha estimada ya pasó) sigan dentro; un segundo clic
 * sobre el vigente lo quita. El rango sin un extremo válido llega aquí como `null` y el control pide elegir uno.
 */
export function PlanningDateFilter({ filters, today }: { filters: Pick<LookerFilters, "dateField" | "dateFrom" | "dateTo">; today: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = React.useTransition()
  const current = React.useMemo(() => new URLSearchParams(Array.from(searchParams.entries())), [searchParams])
  const upcoming = filters.dateField === "proxima"
  const activeShortcut = upcoming ? activeDateShortcut(current, today) : null
  const hasRange = !!filters.dateFrom && !!filters.dateTo

  const go = (href: string) => startTransition(() => router.replace(href, { scroll: false }))

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2" data-planning-date-filter="" aria-busy={pending || undefined}>
      <SegmentedControl
        variant="segmented"
        eyebrow="Filtrar por fecha de"
        ariaLabel="Filtrar por fecha de"
        items={[
          { key: "proxima", label: "Próxima mantención (estimada)", active: upcoming, onClick: () => !upcoming && go(dateFieldHref(pathname, current, "proxima")) },
          { key: "ultima", label: "Última mantención", active: !upcoming, onClick: () => upcoming && go(dateFieldHref(pathname, current, "ultima")) },
        ]}
      />
      <div className="space-y-1">
        <p className="text-eyebrow pl-0.5 text-[var(--color-text-faint)]">Entre estas fechas</p>
        <PeriodControl
          mode="range"
          from={hasRange ? filters.dateFrom! : ""}
          to={hasRange ? filters.dateTo! : ""}
          fromParam="fecha_desde"
          toParam="fecha_hasta"
          groupLabel="Rango de fechas"
          today={today}
          presets={upcoming ? upcomingPresets(today) : defaultRangePresets(today)}
        />
      </div>
      {upcoming && (
        <SegmentedControl
          eyebrow="Atajos (incluyen las vencidas)"
          ariaLabel="Atajos (incluyen las vencidas)"
          items={DATE_SHORTCUT_DAYS.map((days) => ({
            key: String(days),
            label: `Próximos ${days} días`,
            active: activeShortcut === days,
            onClick: () => go(dateShortcutHref(pathname, current, today, days)),
          }))}
        />
      )}
    </div>
  )
}
