import { sql, type AnyColumn, type SQL } from "drizzle-orm"
import { fuelEquipmentLoads, fuelOperationRecords, fuelProviderTransactions, fuelVehiclePersonalUsePeriods } from "@/db/schema"
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

/**
 * Detalle de Copec que compone un registro por período (`fuel_consumption_records`):
 * las transacciones aceptadas del equipo en esa cuenta (`tct:diesel`, `tct:bluemax`)
 * y esa patente, con día de Chile en `from..to`. Todo lo que recibe es de la
 * consulta externa y va calificado: esto corre dentro de una subconsulta.
 *
 * Corre una vez por registro, así que es cara de estimar: úsala sólo sobre pocas
 * filas (`loadConsumptionKept`), nunca dentro de un agregado del tablero, donde el
 * plan cruza el umbral del JIT de Postgres (más de 1 s por consulta aunque nadie
 * tenga uso personal). Va por la patente porque es lo que tiene índice, y no
 * repite `accountableProviderTransactionsWhere`, cuyos `not in` se estimaban otra
 * vez por cada registro. Basta con `accepted`: el sync deja una fila corregida en
 * `superseded`.
 */
function providerTxDetailWhereSql(vehicleId: AnyColumn | SQL, plate: AnyColumn | SQL, account: SQL, from: SQL, to: SQL): SQL {
  return sql`${qualified(T.sourcePlate)} = ${qualified(plate)}
    and ${qualified(T.vehicleId)} = ${qualified(vehicleId)}
    and ${qualified(T.sourceAccount)} = ${account}
    and ${qualified(T.granularity)} = 'transaction'
    and ${qualified(T.status)} = 'accepted'
    and ${qualified(T.quantity)} is not null
    and ${providerTxDaySql()} between ${from} and ${to}`
}

/** ¿Copec trae el detalle por transacción de esa cuenta para el equipo y la patente en `from..to`? */
export function providerTxHasDetailSql(vehicleId: AnyColumn | SQL, plate: AnyColumn | SQL, account: SQL, from: SQL, to: SQL): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${T} where ${providerTxDetailWhereSql(vehicleId, plate, account, from, to)})`
}

/**
 * Monto o litros del detalle que cayeron en días de uso personal del equipo. El
 * dueño carga con la tarjeta de Chome: esas cargas están en el detalle con su día,
 * así que un registro por período puede descontarlas exactas en vez de prorratear.
 */
export function providerTxPersonalUseTotalSql(
  column: "amount" | "quantity", vehicleId: AnyColumn | SQL, plate: AnyColumn | SQL, account: SQL, from: SQL, to: SQL,
): SQL<number> {
  const value = column === "amount" ? T.amount : T.quantity
  return sql<number>`coalesce((
    select sum(${qualified(value)}) from ${T}
    where ${providerTxDetailWhereSql(vehicleId, plate, account, from, to)}
      and ${personalUseOnDaySql(T.vehicleId, providerTxDaySql())}
  ), 0)`
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
 * personal: algún día entre la carga anterior CON LECTURA del equipo (o, si no hay
 * ninguna con lectura, la contable anterior) y esta carga,
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
  const previous = (withReading: boolean) => sql`(
    select max((l2.occurred_at at time zone 'America/Santiago')::date)
    from ${fuelEquipmentLoads} l2
    where l2.vehicle_id = ${vehicle}
      and l2.occurred_at < ${occurredAt}
      and l2.voided_at is null
      and l2.duplicate_of_id is null
      and l2.review_status <> 'rejected'
      ${withReading ? sql`and l2.meter_reading is not null` : sql``}
  )`
  // El rendimiento se mide contra la lectura anterior: una carga sin lectura en medio no la tapa.
  // Sin ninguna anterior con lectura (datos sin medidor), la carga contable anterior.
  const previousDay = sql`coalesce(${previous(true)}, ${previous(false)}, ${loadDay})`
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

/**
 * Lo mismo que `performanceTaintedByPersonalUseSql` para la planilla operacional
 * (`fuel_operation_records`, con `fecha` en texto `YYYY-MM-DD` y el rendimiento ya
 * informado): el registro cae en un período, o es el primero después y su
 * rendimiento se midió contra el registro anterior con rendimiento, de antes del
 * período. Sus litros siguen contando; sólo su rendimiento sale de promedios,
 * comparaciones y detectores.
 */
export function operationPerformanceTaintedByPersonalUseSql(): SQL<boolean> {
  const vehicle = qualified(fuelOperationRecords.vehicleId)
  const fecha = qualified(fuelOperationRecords.fecha)
  const previous = sql`(
    select max(r2.fecha) from ${fuelOperationRecords} r2
    where r2.vehicle_id = ${vehicle} and r2.fecha < ${fecha} and r2.rendimiento is not null
  )`
  return sql<boolean>`exists (
    select 1 from (
      select vehicle_id as pu_vehicle, started_on as pu_from, ended_on as pu_to
      from ${fuelVehiclePersonalUsePeriods}
    ) pu
    where pu.pu_vehicle = ${vehicle}
      and pu.pu_from <= ${fecha}
      and coalesce(pu.pu_to, ${fecha}) >= coalesce(${previous}, ${fecha})
  )`
}
