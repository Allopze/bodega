"use client"

import * as React from "react"
import { PeriodControlCore, type PeriodControlModel } from "@/components/ui/period-control"
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
import { todayInChile } from "@/lib/utils"

/** Filtros de fecha de antes del rediseño: se limpian al elegir un período. */
const LEGACY_PERIOD_PARAMS = ["anio", "meses", "from", "to", "month", "startDate", "endDate"]
const PAGE_PARAMS = ["page", "pagina", "cargas"]
const CLEAR_PARAMS = [...FUEL_PERIOD_PARAMS, ...LEGACY_PERIOD_PARAMS]

/** Combustible tiene semanas, meses, trimestres, años y rangos: el motor genérico sólo necesita saber compararlos y escribirlos en la URL. */
const FUEL_PERIOD_MODEL: PeriodControlModel<FuelPeriod> = {
  same: sameFuelPeriod,
  month: (year, month) => ({ kind: "month", year, month }),
  range: (from, to) => ({ kind: "range", from, to }),
  toParams: fuelPeriodSearchParams,
}

function rememberPeriod(period: FuelPeriod) {
  writeFuelPeriodCookie(formatFuelPeriodCookie(period))
}

export interface FuelPeriodControlProps {
  resolved: ResolvedFuelPeriod
  /** Estados de cuenta sólo admiten meses. */
  granularity?: "any" | "month"
  className?: string
}

/**
 * Selector del período de Combustible. Va en `PageHeader.actions` de cada
 * pantalla del módulo (no en las fichas ni en el asistente). Es `PeriodControl`
 * (`components/ui/period-control.tsx`) con lo propio del módulo: cambia la URL
 * con `router.replace` sin mover el scroll y recuerda el período en una cookie
 * para que también viaje por el menú lateral.
 *
 * La cookie y el `history.replaceState` viven sólo aquí: el motor genérico no
 * los hace (ver su cabecera).
 */
export function FuelPeriodControl({ resolved, granularity = "any", className }: FuelPeriodControlProps) {
  // La URL manda; si el período vino de la URL se recuerda para la próxima pantalla.
  // Si vino de la cookie se escribe en la URL sin volver a pedir la página, para
  // que el enlace se pueda compartir.
  React.useEffect(() => {
    if (resolved.source === "url" || resolved.source === "legacy") {
      rememberPeriod(resolved.period)
    } else if (resolved.source === "cookie") {
      const params = new URLSearchParams(window.location.search)
      for (const [key, value] of Object.entries(fuelPeriodSearchParams(resolved.period))) params.set(key, value)
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`)
    }
  }, [resolved.source, resolved.period])

  const presets = fuelPeriodPresets(todayInChile())
    .filter((p) => granularity === "any" || p.period.kind === "month")
    .map(({ key, label, period }) => ({ key, label, period }))

  return (
    <PeriodControlCore
      model={FUEL_PERIOD_MODEL}
      label={resolved.label}
      value={resolved.period}
      from={resolved.from}
      to={resolved.to}
      prev={resolved.prev}
      next={resolved.next}
      presets={presets}
      allowRange={granularity === "any"}
      clearParams={CLEAR_PARAMS}
      pageParams={PAGE_PARAMS}
      onSelect={rememberPeriod}
      hint="El período vale para todas las pantallas de Combustible y queda en el enlace."
      {...(className ? { className } : {})}
    />
  )
}
