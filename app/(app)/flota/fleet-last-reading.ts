import type { getFleetOverview } from "@/lib/services/fleet"
import { formatDate, formatQty } from "@/lib/utils"

type FleetReadingRow = Pick<
  Awaited<ReturnType<typeof getFleetOverview>>[number],
  "lastOdometerReading" | "lastHourMeterReading" | "lastReadingAt" | "lastReadingObjection"
>

/**
 * Celda «Última lectura» de la exportación: lo que la columna «Lectura (km u h)» de Flota muestra (odómetro en km y,
 * a falta de él, horómetro en h, con la cifra en es-CL) más el día en que se tomó, y la misma marca de
 * lectura objetada que el aviso de la tabla («Lectura objetada: <regla>»). Un equipo sin lectura queda
 * vacío, no «0 km»: la ausencia de dato no es un valor. Sin fecha (no debería ocurrir) se dice sólo la cifra.
 */
export function formatLastReading(row: FleetReadingRow): string {
  const value = row.lastOdometerReading != null
    ? `${formatQty(row.lastOdometerReading, undefined, { maximumFractionDigits: 1 })} km`
    : row.lastHourMeterReading != null
      ? `${formatQty(row.lastHourMeterReading, undefined, { maximumFractionDigits: 1 })} h`
      : null
  if (value === null) return ""
  const parts = [value]
  if (row.lastReadingAt) parts.push(formatDate(row.lastReadingAt))
  if (row.lastReadingObjection) parts.push(`Lectura objetada: ${row.lastReadingObjection.ruleLabel}`)
  return parts.join(" · ")
}
