import { getTableName, is, Column, sql, type AnyColumn, type SQL } from "drizzle-orm"
import { fuelVehicleWorksiteIntervals as stays } from "@/db/schema"

/**
 * Faena de un equipo en un día, según su recorrido de estadías
 * (`fuel_vehicle_worksite_intervals`), no según la faena actual del equipo.
 *
 * Subconsulta correlacionada: `vehicleId` es la columna (o expresión) del
 * equipo en la consulta que la usa y `day` debe ser un **texto `YYYY-MM-DD`**
 * (las fechas civiles se guardan como texto, y texto se compara con texto).
 *
 * Una columna se emite **siempre calificada** (`"fuel_vehicles"."id"`): en un
 * `select` de una sola tabla drizzle la escribe sin calificar, y dentro de la
 * subconsulta `id` se resolvería contra la estadía (`i.id`) y devolvería
 * `null` sin error. Si pasas una expresión `SQL`, califícala tú.
 *
 * Para un instante guardado como texto ISO, calcula el día civil chileno con
 * `isoTextDaySql` (`lib/combustibles/control/queries/field-filters.ts`) y
 * pásalo como `to_char(<día>, 'YYYY-MM-DD')`; un viaje de las 23:30 del 14-11
 * hora de Chile (`2026-11-15T02:30:00Z`) es del 14, no del 15.
 *
 * Inicio nulo = «desde siempre» y término nulo = estadía abierta. El día del
 * traslado ya cuenta en la faena nueva (la anterior termina el día previo),
 * así que a lo más una estadía cubre un día. Un equipo sin estadía ese día
 * (no debería pasar: la primera no tiene inicio) da `null`.
 */
export function stayWorksiteOnDaySql(vehicleId: AnyColumn | SQL, day: SQL): SQL<string | null> {
  const vehicle = is(vehicleId, Column)
    ? sql`${sql.identifier(getTableName(vehicleId.table))}.${sql.identifier(vehicleId.name)}`
    : vehicleId
  return sql<string | null>`(
    select i.worksite_id from ${stays} i
    where i.vehicle_id = ${vehicle}
      and (i.started_on is null or i.started_on <= ${day})
      and (i.ended_on is null or i.ended_on >= ${day})
  )`
}
