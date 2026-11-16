import type * as React from "react"
import { BoardScope } from "@/components/dashboard/board-scope"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { FuelGlossaryButton } from "./fuel-glossary"
import { FuelPeriodControl } from "./fuel-period-control"

/**
 * Las acciones de cabecera de cada pantalla de Combustible, en el mismo orden
 * en todas: el período (si la pantalla lo usa), las acciones propias de la
 * pantalla y, al final, «¿Qué significa?». Va en `PageHeader.actions`.
 *
 * El Panel es además uno de los tres tableros de Control operacional y sigue su esqueleto común
 * (crítica 2026-11-15): pasa `worksites` para que la faena vaya **antes** del período, como en el
 * Panel de mantención y en los Indicadores GPS, y `exportButton` para el «Exportar Excel» del
 * tablero, que va después de las acciones propias. Las listas del módulo conservan su faena en la
 * barra de filtros (`ControlFilters`), junto a sus demás filtros.
 *
 * «Agregar datos» (`AddFuelDataButton`) sólo lo pasan como `children` las pantallas
 * que lo usan (Panel, Cargas, Fuentes): no se agrega a todas por defecto. En móvil el
 * período ocupa su propia fila y las demás acciones comparten la siguiente (dos filas,
 * no tres) porque «¿Qué significa?» se reduce a su ícono bajo `sm`.
 */
export function FuelHeaderActions({
  period,
  granularity,
  worksites,
  worksiteId = null,
  exportButton,
  children,
}: {
  period?: ResolvedFuelPeriod
  granularity?: "any" | "month"
  /** Sólo el Panel: faenas visibles, para el selector de faena del tablero. */
  worksites?: ReadonlyArray<{ id: string; name: string }>
  worksiteId?: string | null
  /** Sólo el Panel: «Exportar Excel» del tablero. */
  exportButton?: React.ReactNode
  children?: React.ReactNode
}) {
  const periodControl = period ? <FuelPeriodControl resolved={period} granularity={granularity} /> : null
  return (
    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
      {worksites && periodControl ? (
        <BoardScope worksites={worksites} worksiteId={worksiteId} period={periodControl} />
      ) : periodControl ? (
        <div className="max-sm:w-full">{periodControl}</div>
      ) : null}
      {children}
      {exportButton}
      <FuelGlossaryButton />
    </div>
  )
}
