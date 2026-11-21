import { getTableName, is, Column, sql, type AnyColumn, type SQL } from "drizzle-orm"
import { fuelVehiclePersonalUsePeriods as periods } from "@/db/schema"
import { todayInChile } from "@/lib/utils"

/**
 * Uso personal de equipos, la regla común en SQL (la de memoria está en
 * `./personal-use.ts`). Todo agregado de gestión que suma plata, litros, km,
 * horas o ralentí por equipo la usa; pagos, conciliaciones, registros y
 * Mantención no.
 *
 * Mismo contrato que `stayWorksiteOnDaySql` (`./stays-sql.ts`):
 * - `vehicleId` es la columna (o expresión) del equipo en la consulta que la usa.
 *   Una columna se emite **siempre calificada**; si pasas una expresión `SQL`,
 *   califícala tú (`qualified(col)`): va dentro de una subconsulta correlacionada.
 * - `day`, `from` y `to` son **texto `YYYY-MM-DD`** del día calendario de Chile.
 *   Para un instante ISO en texto usa `to_char(isoTextDaySql(col), 'YYYY-MM-DD')`;
 *   para un `timestamptz`, `to_char(chileDateSql(col), 'YYYY-MM-DD')`.
 *
 * Un período abierto (`ended_on` nulo) cubre hasta hoy (`today`, el día de Chile
 * al armar la consulta; las pruebas lo fijan). Días futuros no tienen datos, así
 * que el predicado por día no necesita el tope; los conteos y la fracción sí.
 */
export function qualified(column: AnyColumn | SQL): SQL {
  return is(column, Column)
    ? sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`
    : column
}

/**
 * Los períodos se leen con columnas renombradas (`pu_vehicle`, `pu_from`, `pu_to`):
 * así una expresión de la consulta externa sin calificar (`created_at`, `id`,
 * `vehicle_id`…) no puede resolverse en silencio contra una columna del período.
 */
const PERIODS = sql`(select vehicle_id as pu_vehicle, started_on as pu_from, ended_on as pu_to from ${periods})`

/** ¿El equipo estaba en uso personal ese día? */
export function personalUseOnDaySql(vehicleId: AnyColumn | SQL, day: SQL): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from ${PERIODS} pu
    where pu.pu_vehicle = ${qualified(vehicleId)}
      and pu.pu_from <= ${day}
      and (pu.pu_to is null or pu.pu_to >= ${day})
  )`
}

export function notPersonalUseOnDaySql(vehicleId: AnyColumn | SQL, day: SQL): SQL<boolean> {
  return sql<boolean>`not ${personalUseOnDaySql(vehicleId, day)}`
}

/** Días de uso personal del equipo dentro de `from..to` (inclusivos); un período abierto cuenta hasta `today`. */
export function personalUseDaysInSql(vehicleId: AnyColumn | SQL, from: SQL, to: SQL, today: string = todayInChile()): SQL<number> {
  return sql<number>`coalesce((
    select sum(greatest(0,
      least((${to})::date, coalesce(pu.pu_to, ${today})::date)
      - greatest((${from})::date, pu.pu_from::date) + 1
    ))
    from ${PERIODS} pu
    where pu.pu_vehicle = ${qualified(vehicleId)}
  ), 0)::int`
}

/**
 * Fracción de `from..to` que queda fuera del uso personal, en [0, 1]. Para
 * prorratear un registro por período (TCT mensual, consumo con
 * `periodo_desde/hasta`): monto × fracción. Se mide sobre los días transcurridos
 * (`to` topado en `today`): Copec reescribe el registro del mes en curso a la
 * fecha cada día. Sin equipo, con fechas que no son `YYYY-MM-DD` o con un rango
 * vacío o futuro, 1: el registro cuenta entero y la consulta no se cae.
 */
export function keptFractionSql(vehicleId: AnyColumn | SQL, from: SQL, to: SQL, today: string = todayInChile()): SQL<number> {
  // Cast seguro: un texto que no es fecha da null (y la fracción 1) en vez de tumbar la consulta.
  // Postgres pliega constantes al planificar, así que el cast va dentro de su propio CASE.
  const safeDate = (value: SQL) => sql`(case when (${value}) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (${value})::date end)`
  const fromDate = safeDate(from)
  const end = sql`least(${safeDate(to)}, ${today}::date)`
  return sql<number>`(case
    when ${qualified(vehicleId)} is null then 1::numeric
    when ${fromDate} is null or ${end} is null or ${end} < ${fromDate} then 1::numeric
    else greatest(0::numeric, least(1::numeric,
      1 - ${personalUseDaysInSql(vehicleId, sql`to_char(${fromDate}, 'YYYY-MM-DD')`, sql`to_char(${end}, 'YYYY-MM-DD')`, today)}::numeric
        / ((${end} - ${fromDate}) + 1)
    ))
  end)`
}
