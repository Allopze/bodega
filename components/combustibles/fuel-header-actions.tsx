import type * as React from "react"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { FuelGlossaryButton } from "./fuel-glossary"
import { FuelPeriodControl } from "./fuel-period-control"

/**
 * Las acciones de cabecera de cada pantalla de Combustible, en el mismo orden
 * en todas: el período (si la pantalla lo usa), las acciones propias de la
 * pantalla y, al final, «¿Qué significa?». Va en `PageHeader.actions`.
 *
 * «Agregar datos» (`AddFuelDataButton`) sólo lo pasan como `children` las pantallas
 * que lo usan (Panel, Cargas, Fuentes): no se agrega a todas por defecto. En móvil el
 * período ocupa su propia fila y las demás acciones comparten la siguiente (dos filas,
 * no tres) porque «¿Qué significa?» se reduce a su ícono bajo `sm`.
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
    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
      {period ? (
        <div className="max-sm:w-full">
          <FuelPeriodControl resolved={period} granularity={granularity} />
        </div>
      ) : null}
      {children}
      <FuelGlossaryButton />
    </div>
  )
}
