import { inArray, type SQL } from "drizzle-orm"
import { fuelLoads } from "@/db/schema"

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
export const DELETABLE_FUEL_LOAD_STATUSES = ["draft", "registered", "cancelled"] as const

export function fuelLoadStatusBlockMessage(status: string, verb: "editar" | "eliminar"): string {
  if (status === "reconciled") return `No se puede ${verb} una carga conciliada`
  if (status === "cancelled") return `No se puede ${verb} una carga anulada`
  return `No se puede ${verb} una carga en estado ${status}`
}
