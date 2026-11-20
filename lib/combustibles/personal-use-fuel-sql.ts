import { sql, type SQL } from "drizzle-orm"
import { fuelEquipmentLoads, fuelProviderTransactions, fuelVehiclePersonalUsePeriods } from "@/db/schema"
import { isoTextDaySql } from "@/lib/combustibles/control/queries/field-filters"
import { keptFractionSql, notPersonalUseOnDaySql, personalUseOnDaySql, qualified } from "@/lib/fleet/personal-use-sql"

/**
 * Uso personal sobre las tablas de combustible: lo que cada agregado de GESTIÓN
 * usa para que los días de uso personal no sumen plata ni litros. La cuadratura,
 * los pagos y las conciliaciones NO lo usan (ver
 * `lib/__tests__/personal-use-coverage.test.ts`).
 */

const T = fuelProviderTransactions

/** Día calendario de Chile de una transacción de proveedor, `YYYY-MM-DD`. */
function providerTxDaySql(): SQL {
  return sql`to_char(${isoTextDaySql(T.occurredAt)}, 'YYYY-MM-DD')`
}

/** Primer y último día del mes de un agregado mensual (`occurred_at` = `YYYY-MM-01`). */
function providerTxMonthBoundsSql(): { from: SQL; to: SQL } {
  const first = sql`(left(${qualified(T.occurredAt)}, 7) || '-01')`
  return {
    from: first,
    to: sql`to_char((${first})::date + interval '1 month' - interval '1 day', 'YYYY-MM-DD')`,
  }
}

/**
 * Transacción que cuenta en gestión: no cae en un día de uso personal de su
 * equipo. El TCT mensual (`period_aggregate`) siempre pasa: no se excluye, se
 * prorratea con `providerTxKeptAmountSql` / `providerTxKeptQuantitySql`.
 */
export function providerTxKeptWhereSql(): SQL<boolean> {
  return sql<boolean>`(${qualified(T.granularity)} = 'period_aggregate' or ${notPersonalUseOnDaySql(T.vehicleId, providerTxDaySql())})`
}

function keptOf(column: SQL): SQL<number> {
  const { from, to } = providerTxMonthBoundsSql()
  return sql<number>`(case
    when ${qualified(T.granularity)} = 'period_aggregate' then ${column} * ${keptFractionSql(T.vehicleId, from, to)}
    else ${column}
  end)`
}

/** Monto de la transacción para gestión: el TCT mensual × la fracción de días fuera del uso personal. */
export function providerTxKeptAmountSql(): SQL<number> {
  return keptOf(qualified(T.amount))
}

/** Litros de la transacción para gestión, con la misma regla que el monto. */
export function providerTxKeptQuantitySql(): SQL<number> {
  return keptOf(qualified(T.quantity))
}

/** Día calendario de Chile de una carga en terreno, `YYYY-MM-DD`. */
export function loadDaySql(): SQL {
  return sql`to_char((${qualified(fuelEquipmentLoads.occurredAt)} at time zone 'America/Santiago')::date, 'YYYY-MM-DD')`
}

/** La carga en terreno cae en un día de uso personal de su equipo. */
export function loadInPersonalUseSql(): SQL<boolean> {
  return personalUseOnDaySql(fuelEquipmentLoads.vehicleId, loadDaySql())
}

export function loadNotInPersonalUseSql(): SQL<boolean> {
  return notPersonalUseOnDaySql(fuelEquipmentLoads.vehicleId, loadDaySql())
}

/**
 * El rendimiento de la carga (`performance_value`) está contaminado por el uso
 * personal: algún día entre la carga contable anterior del equipo y esta carga,
 * ambos inclusivos, cae en un período. Cubre las cargas DENTRO del período y la
 * PRIMERA DESPUÉS, cuyo valor se calculó contra una lectura de antes y por eso
 * incluye los km del uso personal. Sus litros sí cuentan en el consumo.
 *
 * "Contable" repite `countableLoadSql` (`control/filters.ts`) sobre el alias de
 * la subconsulta; si esa regla cambia, cambia aquí también.
 */
export function performanceTaintedByPersonalUseSql(): SQL<boolean> {
  const vehicle = qualified(fuelEquipmentLoads.vehicleId)
  const occurredAt = qualified(fuelEquipmentLoads.occurredAt)
  const loadDay = sql`(${occurredAt} at time zone 'America/Santiago')::date`
  const previousDay = sql`coalesce((
    select max((l2.occurred_at at time zone 'America/Santiago')::date)
    from ${fuelEquipmentLoads} l2
    where l2.vehicle_id = ${vehicle}
      and l2.occurred_at < ${occurredAt}
      and l2.voided_at is null
      and l2.duplicate_of_id is null
      and l2.review_status <> 'rejected'
  ), ${loadDay})`
  return sql<boolean>`exists (
    select 1 from (
      select vehicle_id as pu_vehicle, started_on as pu_from, ended_on as pu_to
      from ${fuelVehiclePersonalUsePeriods}
    ) pu
    where pu.pu_vehicle = ${vehicle}
      and pu.pu_from::date <= ${loadDay}
      and coalesce(pu.pu_to::date, ${loadDay}) >= ${previousDay}
  )`
}
