import { getTableName, is, Column, sql, type AnyColumn, type SQL } from "drizzle-orm"
import { fuelVehiclePersonalUsePeriods as periods } from "@/db/schema"

/**
 * Uso personal de equipos, la regla común en SQL (la de memoria está en
 * `./personal-use.ts`). Todo agregado de gestión que suma plata, litros, km,
 * horas o ralentí por equipo la usa; pagos, conciliaciones, registros y
 * Mantención no.
 *
 * Mismo contrato que `stayWorksiteOnDaySql` (`./stays-sql.ts`):
 * - `vehicleId` es la columna (o expresión) del equipo en la consulta que la usa.
 *   Una columna se emite **siempre calificada**; si pasas una expresión `SQL`,
 *   califícala tú.
 * - `day`, `from` y `to` son **texto `YYYY-MM-DD`** del día calendario de Chile.
 *   Para un instante ISO en texto usa `to_char(isoTextDaySql(col), 'YYYY-MM-DD')`;
 *   para un `timestamptz`, `to_char(chileDateSql(col), 'YYYY-MM-DD')`.
 *
 * Un período abierto (`ended_on` nulo) cubre hasta el final del rango consultado.
 */
function qualified(vehicleId: AnyColumn | SQL): SQL {
  return is(vehicleId, Column)
    ? sql`${sql.identifier(getTableName(vehicleId.table))}.${sql.identifier(vehicleId.name)}`
    : vehicleId
}

/** ¿El equipo estaba en uso personal ese día? */
export function personalUseOnDaySql(vehicleId: AnyColumn | SQL, day: SQL): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from ${periods} pu
    where pu.vehicle_id = ${qualified(vehicleId)}
      and pu.started_on <= ${day}
      and (pu.ended_on is null or pu.ended_on >= ${day})
  )`
}

export function notPersonalUseOnDaySql(vehicleId: AnyColumn | SQL, day: SQL): SQL<boolean> {
  return sql<boolean>`not ${personalUseOnDaySql(vehicleId, day)}`
}

/** Días de uso personal del equipo dentro de `from..to` (inclusivos). */
export function personalUseDaysInSql(vehicleId: AnyColumn | SQL, from: SQL, to: SQL): SQL<number> {
  return sql<number>`coalesce((
    select sum(greatest(0,
      least((${to})::date, coalesce(pu.ended_on, ${to})::date)
      - greatest((${from})::date, pu.started_on::date) + 1
    ))
    from ${periods} pu
    where pu.vehicle_id = ${qualified(vehicleId)}
  ), 0)::int`
}

/**
 * Fracción de `from..to` que queda fuera del uso personal, en [0, 1]. Para
 * prorratear un registro por período (TCT mensual, consumo con
 * `periodo_desde/hasta`): monto × fracción. Sin equipo, 1.
 */
export function keptFractionSql(vehicleId: AnyColumn | SQL, from: SQL, to: SQL): SQL<number> {
  return sql<number>`(case
    when ${qualified(vehicleId)} is null then 1::numeric
    else greatest(0::numeric, least(1::numeric,
      1 - ${personalUseDaysInSql(vehicleId, from, to)}::numeric / (((${to})::date - (${from})::date) + 1)
    ))
  end)`
}
