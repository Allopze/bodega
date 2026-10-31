import type * as React from "react"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { FuelGlossaryButton } from "./fuel-glossary"
import { FuelPeriodControl } from "./fuel-period-control"

/**
 * Las acciones de cabecera de cada pantalla de Combustible, en el mismo orden
 * en todas: el período (si la pantalla lo usa), las acciones propias de la
 * pantalla y, al final, «¿Qué significa?». Va en `PageHeader.actions`.
 */
export function FuelHeaderActions({
  period,
  granularity,
  children,
}: {
  period?: ResolvedFuelPeriod
  granularity?: "any" | "month"
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {period ? <FuelPeriodControl resolved={period} granularity={granularity} /> : null}
      {children}
      <FuelGlossaryButton />
    </div>
  )
}
