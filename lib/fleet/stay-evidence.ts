import { and, eq, inArray, isNotNull, isNull, ne, sql, type AnyColumn, type SQL } from "drizzle-orm"
import type { DB } from "@/db"
import {
  auditLog, fuelEquipmentLoads, fuelLoads, fuelTaeSubmissions, mantRecords, mantWorkOrders,
} from "@/db/schema"
import type { StayEvidence } from "./stay-reconstruction"

/**
 * Evidencia de dónde estuvo físicamente cada equipo, leída de la base para
 * `reconstructStays`. Sólo hay fuentes que ubican al equipo en una faena el día
 * del hecho; todo lo demás se deja fuera a propósito:
 *
 * - NUNCA `fuel_consumption_records` (el proveedor factura por periodo y la faena
 *   la fija quien importa), asignaciones de proveedor ni filas GPS (el GPS sólo
 *   dice dónde estaba la unidad, no a qué faena pertenecía).
 * - Una carga cancelada, un envío TAE rechazado (`voided`), una carga en terreno
 *   anulada o legada (`legacy_tae`), un registro de mantención anulado o hecho
 *   fuera de la faena y una OT anulada no prueban nada y no entran.
 * - La auditoría que escribe el servicio de traslados (al trasladar o anular)
 *   tampoco: está fechada el día del registro y el traslado ya es el dato firme.
 *
 * Los instantes (`timestamptz`) se llevan al día civil de Chile: una carga de las
 * 23:30 chilenas se guarda al día siguiente en UTC, pero es del día en que ocurrió.
 */

const CHILE_DAY_FORMAT = "YYYY-MM-DD"
const PLAIN_DAY = /^\d{4}-\d{2}-\d{2}$/

/** Día civil chileno de un `timestamptz`, como texto `YYYY-MM-DD`. */
function chileDay(column: AnyColumn) {
  return sql<string>`to_char(${column} at time zone 'America/Santiago', ${CHILE_DAY_FORMAT})`
}

function scoped(vehicleIds: string[] | undefined, column: AnyColumn): SQL | undefined {
  return vehicleIds ? inArray(column, vehicleIds) : undefined
}

function pushEvidence(
  map: Map<string, StayEvidence[]>,
  vehicleId: string | null,
  item: StayEvidence,
) {
  if (!vehicleId || !PLAIN_DAY.test(item.day)) return
  const list = map.get(vehicleId)
  if (list) list.push(item)
  else map.set(vehicleId, [item])
}

function parseState(state: string | null): Record<string, unknown> | null {
  if (!state) return null
  try {
    const parsed: unknown = JSON.parse(state)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    // Un estado que no es JSON no es evidencia.
    return null
  }
}

function worksiteIdOf(state: Record<string, unknown> | null): string | null {
  const value = state?.worksiteId
  return typeof value === "string" && value ? value : null
}

/**
 * Lo escribió el servicio de traslados (al trasladar o al anular): el traslado es
 * el registro firme y su auditoría lleva la fecha en que se REGISTRÓ, no la del
 * traslado. Contarla inventaba estadías: un traslado anulado dejaba un día en la
 * faena de destino.
 */
function isTransferAudit(state: Record<string, unknown> | null): boolean {
  return Boolean(state && ("transferId" in state || "voidedTransferId" in state))
}

export async function loadStayEvidence(db: DB, vehicleIds?: string[]): Promise<Map<string, StayEvidence[]>> {
  const result = new Map<string, StayEvidence[]>()
  if (vehicleIds && vehicleIds.length === 0) return result

  // 1. Cargas facturadas: el día de la carga y la faena registrada.
  const loads = await db
    .select({ id: fuelLoads.id, vehicleId: fuelLoads.vehicleId, day: fuelLoads.loadDate, worksiteId: fuelLoads.worksiteId })
    .from(fuelLoads)
    .where(and(ne(fuelLoads.status, "cancelled"), scoped(vehicleIds, fuelLoads.vehicleId)))
  for (const row of loads) pushEvidence(result, row.vehicleId, { day: row.day, worksiteId: row.worksiteId, kind: "carga", ref: row.id })

  // 2. Cargas en terreno / importadas de operaciones (no las legadas ni las anuladas).
  const fieldLoads = await db
    .select({ id: fuelEquipmentLoads.id, vehicleId: fuelEquipmentLoads.vehicleId, day: chileDay(fuelEquipmentLoads.occurredAt), worksiteId: fuelEquipmentLoads.worksiteId })
    .from(fuelEquipmentLoads)
    .where(and(
      isNull(fuelEquipmentLoads.voidedAt),
      inArray(fuelEquipmentLoads.source, ["field", "operations_import"]),
      scoped(vehicleIds, fuelEquipmentLoads.vehicleId),
    ))
  for (const row of fieldLoads) pushEvidence(result, row.vehicleId, { day: row.day, worksiteId: row.worksiteId, kind: "carga_terreno", ref: row.id })

  // 3. Envíos TAE con equipo identificado y sin rechazar.
  const tae = await db
    .select({ id: fuelTaeSubmissions.id, vehicleId: fuelTaeSubmissions.vehicleId, day: chileDay(fuelTaeSubmissions.loadedAt), worksiteId: fuelTaeSubmissions.worksiteId })
    .from(fuelTaeSubmissions)
    .where(and(
      isNotNull(fuelTaeSubmissions.vehicleId),
      ne(fuelTaeSubmissions.status, "voided"),
      scoped(vehicleIds, fuelTaeSubmissions.vehicleId),
    ))
  for (const row of tae) pushEvidence(result, row.vehicleId, { day: row.day, worksiteId: row.worksiteId, kind: "tae", ref: row.id })

  // 4. Registros de mantención vigentes y hechos en la faena.
  const records = await db
    .select({ id: mantRecords.id, vehicleId: mantRecords.vehicleId, day: mantRecords.workDate, worksiteId: mantRecords.worksiteId })
    .from(mantRecords)
    .where(and(
      eq(mantRecords.status, "vigente"),
      eq(mantRecords.outOfWorksite, false),
      scoped(vehicleIds, mantRecords.vehicleId),
    ))
  for (const row of records) pushEvidence(result, row.vehicleId, { day: row.day, worksiteId: row.worksiteId, kind: "registro_mantencion", ref: row.id })

  // 5. Órdenes de trabajo no anuladas, el día de la solicitud.
  const orders = await db
    .select({ id: mantWorkOrders.id, vehicleId: mantWorkOrders.vehicleId, day: mantWorkOrders.requestDate, worksiteId: mantWorkOrders.worksiteId })
    .from(mantWorkOrders)
    .where(and(ne(mantWorkOrders.status, "anulada"), scoped(vehicleIds, mantWorkOrders.vehicleId)))
  for (const row of orders) pushEvidence(result, row.vehicleId, { day: row.day, worksiteId: row.worksiteId, kind: "ot", ref: row.id })

  // 6. Cambios auditados de faena (flota y mantención): el equipo ya está en la faena
  //    nueva el día del cambio. Se exige faena en ambos estados y que difieran. Las
  //    filas del servicio de traslados no cuentan (ver `isTransferAudit`).
  const audits = await db
    .select({
      id: auditLog.id, vehicleId: auditLog.entityId, day: chileDay(auditLog.createdAt),
      oldState: auditLog.oldState, newState: auditLog.newState,
    })
    .from(auditLog)
    .where(and(
      inArray(auditLog.entityType, ["fuel_vehicle", "mant_equipment"]),
      sql`${auditLog.newState} like '%"worksiteId"%'`,
      scoped(vehicleIds, auditLog.entityId),
    ))
  for (const row of audits) {
    const newState = parseState(row.newState)
    if (isTransferAudit(newState)) continue
    const from = worksiteIdOf(parseState(row.oldState))
    const to = worksiteIdOf(newState)
    if (from && to && from !== to) pushEvidence(result, row.vehicleId, { day: row.day, worksiteId: to, kind: "auditoria", ref: row.id })
  }

  return result
}
