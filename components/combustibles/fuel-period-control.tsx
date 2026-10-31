"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CalendarBlank, CaretDown, CaretLeft, CaretRight } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  FUEL_PERIOD_PARAMS,
  formatFuelPeriodCookie,
  fuelPeriodPresets,
  fuelPeriodSearchParams,
  sameFuelPeriod,
  writeFuelPeriodCookie,
  type FuelPeriod,
  type ResolvedFuelPeriod,
} from "@/lib/combustibles/period"
import { cn, MONTH_LABELS, todayInChile } from "@/lib/utils"

/** Filtros de fecha de antes del rediseño: se limpian al elegir un período. */
const LEGACY_PERIOD_PARAMS = ["anio", "meses", "from", "to", "month", "startDate", "endDate"]
const PAGE_PARAMS = ["page", "pagina", "cargas"]

export interface FuelPeriodControlProps {
  resolved: ResolvedFuelPeriod
  /** Estados de cuenta sólo admiten meses. */
  granularity?: "any" | "month"
  className?: string
}

/**
 * Selector del período de Combustible. Va en `PageHeader.actions` de cada
 * pantalla del módulo (no en las fichas ni en el asistente). Cambia la URL con
 * `router.replace` sin mover el scroll y recuerda el período en una cookie para
 * que también viaje por el menú lateral.
 */
export function FuelPeriodControl({ resolved, granularity = "any", className }: FuelPeriodControlProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const today = todayInChile()
  const [gridYear, setGridYear] = React.useState(() => Number(resolved.from.slice(0, 4)))
  const [range, setRange] = React.useState({ from: resolved.from, to: resolved.to })

  // La URL manda; si el período vino de la URL se recuerda para la próxima pantalla.
  // Si vino de la cookie se escribe en la URL sin volver a pedir la página, para
  // que el enlace se pueda compartir.
  React.useEffect(() => {
    if (resolved.source === "url" || resolved.source === "legacy") {
      writeFuelPeriodCookie(formatFuelPeriodCookie(resolved.period))
    } else if (resolved.source === "cookie") {
      const params = new URLSearchParams(window.location.search)
      for (const [key, value] of Object.entries(fuelPeriodSearchParams(resolved.period))) params.set(key, value)
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`)
    }
  }, [resolved.source, resolved.period])

  function go(period: FuelPeriod) {
    const params = new URLSearchParams(searchParams.toString())
    for (const key of [...FUEL_PERIOD_PARAMS, ...LEGACY_PERIOD_PARAMS, ...PAGE_PARAMS]) params.delete(key)
    for (const [key, value] of Object.entries(fuelPeriodSearchParams(period))) params.set(key, value)
    writeFuelPeriodCookie(formatFuelPeriodCookie(period))
    setOpen(false)
    startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }))
  }

  const presets = fuelPeriodPresets(today).filter((p) => granularity === "any" || p.period.kind === "month")
  const currentYear = Number(today.slice(0, 4))
  const currentMonthKey = today.slice(0, 7)

  return (
    <div className={cn("inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-border-control)] bg-[var(--color-surface)]", className)} role="group" aria-label="Período" aria-busy={pending || undefined}>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Período anterior" disabled={!resolved.prev} onClick={() => resolved.prev && go(resolved.prev)}>
        <CaretLeft aria-hidden="true" />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex h-11 min-w-[10.5rem] items-center justify-center gap-2 border-x border-[var(--color-border)] px-3 text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-2)] sm:h-[34px]">
            <CalendarBlank aria-hidden="true" className="size-4 text-[var(--color-text-muted)]" />
            <span>{resolved.label}</span>
            <CaretDown aria-hidden="true" className="size-3.5 text-[var(--color-text-muted)]" />
            <span className="sr-only">. Cambiar período</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(23rem,calc(100vw-2rem))] space-y-4 p-4">
          <section>
            <h2 className="mb-2 text-sm font-semibold">Accesos rápidos</h2>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((preset) => {
                const active = sameFuelPeriod(preset.period, resolved.period)
                return (
                  <Button key={preset.key} type="button" size="sm" variant={active ? "primary" : "secondary"} aria-pressed={active} onClick={() => go(preset.period)}>
                    {preset.label}
                  </Button>
                )
              })}
            </div>
          </section>
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Un mes</h2>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Año anterior" onClick={() => setGridYear((y) => y - 1)}><CaretLeft aria-hidden="true" /></Button>
                <span className="w-12 text-center font-mono text-sm tabular-nums">{gridYear}</span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Año siguiente" disabled={gridYear >= currentYear} onClick={() => setGridYear((y) => y + 1)}><CaretRight aria-hidden="true" /></Button>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {MONTH_LABELS.map((label, index) => {
                const month = index + 1
                const key = `${gridYear}-${String(month).padStart(2, "0")}`
                const period: FuelPeriod = { kind: "month", year: gridYear, month }
                const active = sameFuelPeriod(period, resolved.period)
                return (
                  <Button key={key} type="button" size="sm" variant={active ? "primary" : "secondary"} aria-pressed={active} disabled={key > currentMonthKey} onClick={() => go(period)}>
                    {label}
                  </Button>
                )
              })}
            </div>
          </section>
          {granularity === "any" ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Rango de fechas</h2>
              <DateRangePicker
                fromValue={range.from}
                toValue={range.to}
                onFromChange={(from) => setRange((r) => ({ ...r, from }))}
                onToChange={(to) => setRange((r) => ({ ...r, to }))}
              />
              <Button type="button" size="sm" className="mt-2" disabled={!range.from || !range.to} onClick={() => go({ kind: "range", from: range.from, to: range.to })}>
                Aplicar rango
              </Button>
            </section>
          ) : null}
          <p className="text-xs text-[var(--color-text-subtle)]">El período vale para todas las pantallas de Combustible y queda en el enlace.</p>
        </PopoverContent>
      </Popover>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Período siguiente" disabled={!resolved.next} onClick={() => resolved.next && go(resolved.next)}>
        <CaretRight aria-hidden="true" />
      </Button>
    </div>
  )
}
