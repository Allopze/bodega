import { and, eq, inArray } from "drizzle-orm"
import { inventoryMovements, mantRecords } from "@/db/schema"

/**
 * Movimientos de inventario que apuntan a un REGISTRO de mantención (ADR mantención 0001):
 * el uso de un repuesto (`mant_record`, tipo `egreso_mantencion`) y su reverso al anular el
 * registro (`mant_record_void`, tipo `ingreso_anulacion`). El `referenceId` es el id del registro;
 * la OT se llega por `mant_records.work_order_id`.
 *
 * Es la condición de `LEFT JOIN mant_records` que comparten el kárdex, su Excel y la
 * trazabilidad: un solo join en la misma consulta del movimiento, sin consultar de a una fila.
 */
export const MANT_MOVEMENT_REFERENCE_TYPES = ["mant_record", "mant_record_void"] as const

export const mantRecordOfMovement = and(
  inArray(inventoryMovements.referenceType, [...MANT_MOVEMENT_REFERENCE_TYPES]),
  eq(mantRecords.id, inventoryMovements.referenceId),
)
