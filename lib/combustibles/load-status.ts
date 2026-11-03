import { and, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm"
import { fuelLoads, fuelProviderTransactions } from "@/db/schema"

/**
 * Estados contabilizables de una carga de combustible.
 *
 * Una carga vive `draft → registered → reconciled`, con `cancelled` como salida.
 * Sólo las dos del medio representan consumo real: `draft` es una carga que
 * todavía se está capturando y `cancelled` es una que se anuló. Antes cada
 * superficie decidía por su cuenta —reportes y ciclo no filtraban nada, Flota
 * tampoco, la tendencia del dashboard excluía sólo las anuladas— así que el
 * mismo mes cerraba con litros distintos según dónde se mirara.
 *
 * Este es el predicado único: todo agregado, saldo o indicador lo usa; los
 * listados que administran cargas (bitácora, facturas, exportación) siguen
 * mostrando los cuatro estados a propósito.
 */
export const ACCOUNTABLE_FUEL_LOAD_STATUSES = ["registered", "reconciled"] as const

export function accountableFuelLoadsWhere(): SQL {
  return inArray(fuelLoads.status, [...ACCOUNTABLE_FUEL_LOAD_STATUSES])
}

/**
 * Transacciones del proveedor (Copec) que cuentan como litros y gasto: el
 * predicado único de `fuel_provider_transactions`, igual que
 * `accountableFuelLoadsWhere` lo es de `fuel_loads`.
 *
 * Tres cuidados, todos contra el doble conteo o contra contar lo que no es
 * consumo:
 * - sólo `accepted` con cantidad: `pending`, `rejected` y `excluded` no son
 *   consumo propio (esta última es una patente fuera de la flota);
 * - una fila reemplazada por otra `accepted` (`supersedes_id`) no cuenta: la
 *   vigente es la nueva;
 * - el agregado mensual TCT (`period_aggregate`) sólo cuenta si no hay
 *   transacciones detalladas de la misma cuenta, patente y mes: el informe TCT
 *   trae los dos niveles del MISMO litro, y sumarlos duplica el mes entero
 *   (en producción los totales de ambos niveles coinciden al peso).
 *
 * Vive aquí para que la conciliación por mandante y Analítica no puedan
 * discrepar: antes la regla estaba en `reconciliation.ts` y Analítica leía
 * `fuel_loads`, que en producción tiene 0 filas (C-9). El alcance de faena y el
 * período los agrega cada consulta.
 */
export function accountableProviderTransactionsWhere(): SQL {
  const t = fuelProviderTransactions
  return and(
    eq(t.status, "accepted"),
    isNotNull(t.quantity),
    // Reemplazada por otra aceptada. `NOT IN` sobre un conjunto sin nulos en vez de
    // `NOT EXISTS` correlacionado: es la misma regla, pero Postgres arma una tabla
    // hash una sola vez en vez de recorrer la tabla por cada fila. En el clon de
    // producción (4.255 filas aceptadas) el mismo conteo pasó de ~0,8–1,2 s a 11 ms,
    // y esta consulta corre 6 veces por vista de Analítica. Mismas 4.255 filas.
    sql`${t.id} not in (select n.supersedes_id from fuel_provider_transactions n where n.supersedes_id is not null and n.status = 'accepted')`,
    // Un agregado mensual sólo cuenta sin detalle de su misma cuenta, patente y mes.
    // La patente nula se compara por separado (`is null` + valor) para conservar el
    // `is not distinct from` de la regla; `occurred_at` nulo no tiene mes que cubrir.
    sql`(${t.granularity} = 'transaction' or ${t.occurredAt} is null or (${t.provider}, ${t.sourceAccount}, ${t.sourcePlate} is null, coalesce(${t.sourcePlate}, ''), left(${t.occurredAt}, 7)) not in (
      select d.provider, d.source_account, d.source_plate is null, coalesce(d.source_plate, ''), left(d.occurred_at, 7)
      from fuel_provider_transactions d
      where d.status = 'accepted' and d.granularity = 'transaction' and d.occurred_at is not null))`,
  ) ?? sql`true`
}

/**
 * Cuántas cargas representa una fila contabilizable: 1 si es una transacción;
 * si es el agregado mensual de una patente, las del `detalle` que el informe
 * TCT adjunta (1 si no lo trae). Sin esto, «N cargas» contaría un agregado como
 * una sola carga.
 */
export function providerLoadCountSql(): SQL<number> {
  const t = fuelProviderTransactions
  return sql<number>`case when ${t.granularity} = 'period_aggregate'
    then coalesce(nullif(jsonb_array_length(case when jsonb_typeof(${t.rawPayload} -> 'detalle') = 'array' then ${t.rawPayload} -> 'detalle' end), 0), 1)
    else 1 end`
}

/**
 * Ciclo de vida de una carga frente a la edición y el borrado.
 *
 * Una conciliada no se toca: su cifra ya cerró contra el documento tributario.
 * Una anulada tampoco se edita —editarla la devolvería al circuito sin pasar
 * por ningún estado— pero sí se puede borrar, porque no arrastra saldo.
 *
 * Los dos conjuntos se repiten en el `WHERE` de la mutación además de
 * comprobarse antes: entre la lectura y la escritura, otra sesión puede haber
 * conciliado la carga o asignarla a un estado de cuenta.
 */
export const EDITABLE_FUEL_LOAD_STATUSES = ["draft", "registered"] as const

/**
 * Estados en los que SÍ se puede corregir la lectura del medidor, aunque la
 * carga esté cerrada para el resto de la edición.
 *
 * Una conciliada no se toca porque su cifra ya cuadró contra el documento
 * tributario — pero el odómetro no es parte de ese documento: no lo declara el
 * DTE, no entra en el cuadre y equivocarse tecleándolo no cambia un peso. Sin
 * esta excepción, un dígito perdido descubierto después de conciliar quedaba
 * congelado para siempre, envenenando el rendimiento y el aviso de mantención
 * del equipo sin forma alguna de arreglarlo.
 *
 * Anulada queda fuera a propósito: no arrastra saldo ni alimenta indicadores,
 * así que corregirle el medidor no arregla nada.
 */
export const METER_CORRECTABLE_FUEL_LOAD_STATUSES = ["draft", "registered", "reconciled"] as const
export const DELETABLE_FUEL_LOAD_STATUSES = ["draft", "registered", "cancelled"] as const

export function fuelLoadStatusBlockMessage(status: string, verb: "editar" | "eliminar"): string {
  if (status === "reconciled") return `No se puede ${verb} una carga conciliada`
  if (status === "cancelled") return `No se puede ${verb} una carga anulada`
  return `No se puede ${verb} una carga en estado ${status}`
}
