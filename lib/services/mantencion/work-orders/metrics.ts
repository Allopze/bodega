import type { Session } from "next-auth"
import { and, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { mantWorkOrders } from "@/db/schema"
import { worksiteScopeSqlFor, serviceWorksiteScope } from "@/lib/auth/scope"
import { canViewWorkOrders, canViewAllWorkOrders } from "@/lib/operational-control/capabilities"
import { OT_OPEN_STATUSES, type OtStatus } from "@/lib/mantencion/work-order-states"
import { todayInChile } from "@/lib/utils"

/**
 * Cifras de las órdenes de trabajo (OT) para Flota, Control operacional y el
 * Tablero. El costo total de la OT es opcional: si jefatura no lo cargó, el
 * agregado del período queda en `null` (no en 0).
 *
 * Todas las consultas excluyen las OT `anulada` y se acotan por la faena de la
 * OT (`mant_work_orders.worksite_id`). Reciben el alcance ya resuelto (ver
 * `workOrderMetricsScope`) y no la sesión, para que quien consulta pueda
 * probarlas sin una sesión ni la capacidad: la puerta de capacidad la pone el
 * llamador, que es quien sabe si pinta o no la cifra.
 */

/** `"all"` o la lista de faenas visibles; una lista vacía significa «ninguna». */
export type WorkOrderMetricsScope = string[] | "all"

/**
 * Alcance de OT de una sesión, o `null` si no puede ver OT (el llamador no
 * pinta ni consulta). `mant:ot:view_all` ve todas; `mant:ot:view_worksite` ve
 * las de su alcance de faena (un rol global ve todas, como en el resto de la
 * plataforma).
 */
export function workOrderMetricsScope(session: Session): WorkOrderMetricsScope | null {
  if (!canViewWorkOrders(session)) return null
  if (canViewAllWorkOrders(session)) return "all"
  return serviceWorksiteScope(session)
}

export interface WorkOrderPeriod {
  /** YYYY-MM-DD, inclusive. */
  from: string
  /** YYYY-MM-DD, inclusive. */
  to: string
}

export interface VehicleWorkOrderMetrics {
  vehicleId: string
  /** OT abiertas: todo lo que no está cerrado ni anulado. */
  openCount: number
  /** Abiertas sin mecánico asignado. */
  unassignedOpen: number
  /** En ejecución, con ingreso a taller y sin salida: el equipo está en el taller. */
  inWorkshopNow: boolean
  /** OT cerradas (conformidad dada) con `closed_at` dentro del período. */
  closedInPeriod: number
  /**
   * Horas en taller dentro del período: el tramo ingreso → salida (o ahora, si
   * sigue dentro) recortado a [desde, hasta + 1 día) en hora de Chile. Mismo
   * recorte que usaba la detención del módulo retirado.
   */
  workshopHoursInPeriod: number
  /** OT de reparación cerradas en el período, y las horas en taller de ellas (ingreso → salida completos): base del MTTR. */
  repairClosedInPeriod: number
  repairClosedWorkshopHours: number
  /** Suma del costo cargado en las OT cerradas del período; null si ninguna lo trae. */
  maintenanceCostInPeriod: number | null
  /** Última salida de taller registrada (cualquier OT vigente del equipo). */
  lastExitAt: string | null
  /** La OT cerrada más reciente del equipo (por fecha de cierre). */
  lastClosedWorkOrderId: string | null
}

export interface WorkOrderGlobalMetrics {
  openCount: number
  unassignedOpen: number
  /** En ejecución con la fecha estimada de entrega ya pasada. */
  estimateOverdue: number
}

export interface VehicleRecentWorkOrder {
  id: string
  folio: string
  status: OtStatus
  repair: boolean
  maintenance: boolean
  requestDate: string
  workshopEntryAt: string | null
  workshopExitAt: string | null
}

const OPEN_STATUS_LIST = sql.join(OT_OPEN_STATUSES.map((status) => sql`${status}`), sql`, `)
const isOpen = sql`${mantWorkOrders.status} IN (${OPEN_STATUS_LIST})`
const isUnassignedOpen = sql`${isOpen} AND ${mantWorkOrders.assignedToUserId} IS NULL`

function scopeWhere(scope: WorkOrderMetricsScope, worksiteId?: string): SQL | undefined {
  return worksiteScopeSqlFor(scope, mantWorkOrders.worksiteId, worksiteId)
}

/** Una expresión de fecha puede volver como `Date` o como texto según el driver. */
function isoOrNull(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/**
 * Cifras por equipo. Sin `vehicleIds` devuelve todos los equipos del alcance
 * que tengan alguna OT vigente; con ellos, sólo esos (los que no tienen OT no
 * aparecen en el mapa: el llamador usa ceros).
 *
 * `period` es opcional: sin él los campos del período quedan en 0, y la consulta
 * no calcula nada que el llamador no va a pintar (Flota sólo pide las abiertas).
 */
export async function getVehicleWorkOrderMetrics(
  scope: WorkOrderMetricsScope,
  options: { vehicleIds?: readonly string[]; worksiteId?: string; period?: WorkOrderPeriod; now?: Date } = {},
): Promise<Map<string, VehicleWorkOrderMetrics>> {
  if (options.vehicleIds?.length === 0) return new Map()
  const nowIso = (options.now ?? new Date()).toISOString()
  const now = sql`${nowIso}::timestamptz`

  // El período son días civiles chilenos: se acota desde la medianoche de Chile
  // del primer día hasta la medianoche de Chile siguiente al último. Sin la zona
  // explícita `::date` se leería en la de la sesión de Postgres (UTC en
  // producción) y el recorte se movería 3–4 horas según el servidor.
  const period = options.period
  const periodStart = period ? sql`(${period.from}::date)::timestamp AT TIME ZONE 'America/Santiago'` : null
  const periodEnd = period ? sql`((${period.to}::date + 1)::timestamp AT TIME ZONE 'America/Santiago')` : null
  const closedInRange = period
    ? sql`${mantWorkOrders.status} = 'cerrada' AND ${mantWorkOrders.closedAt} >= ${periodStart} AND ${mantWorkOrders.closedAt} < ${periodEnd}`
    : sql`false`
  const hasEntry = sql`${mantWorkOrders.workshopEntryAt} IS NOT NULL`
  const hoursInPeriod = period
    ? sql`COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(${mantWorkOrders.workshopExitAt}, ${now}), ${periodEnd}) - GREATEST(${mantWorkOrders.workshopEntryAt}, ${periodStart}))) / 3600) FILTER (WHERE ${hasEntry} AND ${mantWorkOrders.workshopEntryAt} < ${periodEnd} AND COALESCE(${mantWorkOrders.workshopExitAt}, ${now}) > ${periodStart}), 0)`
    : sql`0`
  const repairClosedHours = period
    ? sql`COALESCE(SUM(EXTRACT(EPOCH FROM (${mantWorkOrders.workshopExitAt} - ${mantWorkOrders.workshopEntryAt})) / 3600) FILTER (WHERE ${closedInRange} AND ${mantWorkOrders.repair} AND ${hasEntry} AND ${mantWorkOrders.workshopExitAt} IS NOT NULL), 0)`
    : sql`0`

  const rows = await db.select({
    vehicleId: mantWorkOrders.vehicleId,
    openCount: sql<number>`(COUNT(*) FILTER (WHERE ${isOpen}))::int`,
    unassignedOpen: sql<number>`(COUNT(*) FILTER (WHERE ${isUnassignedOpen}))::int`,
    inWorkshopNow: sql<number>`(COUNT(*) FILTER (WHERE ${mantWorkOrders.status} = 'en_ejecucion' AND ${hasEntry} AND ${mantWorkOrders.workshopExitAt} IS NULL))::int`,
    closedInPeriod: sql<number>`(COUNT(*) FILTER (WHERE ${closedInRange}))::int`,
    workshopHoursInPeriod: sql<number>`${hoursInPeriod}::float8`,
    repairClosedInPeriod: sql<number>`(COUNT(*) FILTER (WHERE ${closedInRange} AND ${mantWorkOrders.repair}))::int`,
    repairClosedWorkshopHours: sql<number>`${repairClosedHours}::float8`,
    maintenanceCostInPeriod: period
      ? sql<number | null>`SUM(${mantWorkOrders.totalCost}) FILTER (WHERE ${closedInRange})`
      : sql<null>`null`,
    lastExitAt: sql<string | null>`MAX(${mantWorkOrders.workshopExitAt})`,
    lastClosedWorkOrderId: sql<string | null>`(ARRAY_AGG(${mantWorkOrders.id} ORDER BY ${mantWorkOrders.closedAt} DESC) FILTER (WHERE ${mantWorkOrders.status} = 'cerrada'))[1]`,
  })
    .from(mantWorkOrders)
    .where(and(
      ne(mantWorkOrders.status, "anulada"),
      scopeWhere(scope, options.worksiteId),
      options.vehicleIds ? inArray(mantWorkOrders.vehicleId, [...options.vehicleIds]) : undefined,
    ))
    .groupBy(mantWorkOrders.vehicleId)

  return new Map(rows.map((row) => [row.vehicleId, {
    vehicleId: row.vehicleId,
    openCount: Number(row.openCount),
    unassignedOpen: Number(row.unassignedOpen),
    inWorkshopNow: Number(row.inWorkshopNow) > 0,
    closedInPeriod: Number(row.closedInPeriod),
    workshopHoursInPeriod: Number(row.workshopHoursInPeriod),
    repairClosedInPeriod: Number(row.repairClosedInPeriod),
    repairClosedWorkshopHours: Number(row.repairClosedWorkshopHours),
    maintenanceCostInPeriod: row.maintenanceCostInPeriod == null ? null : Number(row.maintenanceCostInPeriod),
    lastExitAt: isoOrNull(row.lastExitAt),
    lastClosedWorkOrderId: row.lastClosedWorkOrderId ?? null,
  }]))
}

/** Cifras globales (sin agrupar por equipo): el tile «OT abiertas» y su detalle. */
export async function getWorkOrderGlobalMetrics(
  scope: WorkOrderMetricsScope,
  options: { worksiteId?: string; today?: string } = {},
): Promise<WorkOrderGlobalMetrics> {
  const today = options.today ?? todayInChile()
  const [row] = await db.select({
    openCount: sql<number>`(COUNT(*) FILTER (WHERE ${isOpen}))::int`,
    unassignedOpen: sql<number>`(COUNT(*) FILTER (WHERE ${isUnassignedOpen}))::int`,
    estimateOverdue: sql<number>`(COUNT(*) FILTER (WHERE ${mantWorkOrders.status} = 'en_ejecucion' AND ${mantWorkOrders.estimatedDeliveryDate} < ${today}))::int`,
  })
    .from(mantWorkOrders)
    .where(and(ne(mantWorkOrders.status, "anulada"), scopeWhere(scope, options.worksiteId)))
  return {
    openCount: Number(row?.openCount ?? 0),
    unassignedOpen: Number(row?.unassignedOpen ?? 0),
    estimateOverdue: Number(row?.estimateOverdue ?? 0),
  }
}

/** Las últimas OT del equipo (más reciente primero), para su ficha. */
export async function listRecentVehicleWorkOrders(
  scope: WorkOrderMetricsScope,
  vehicleId: string,
  limit = 10,
): Promise<VehicleRecentWorkOrder[]> {
  const rows = await db.select({
    id: mantWorkOrders.id,
    folio: mantWorkOrders.folio,
    status: mantWorkOrders.status,
    repair: mantWorkOrders.repair,
    maintenance: mantWorkOrders.maintenance,
    requestDate: mantWorkOrders.requestDate,
    workshopEntryAt: mantWorkOrders.workshopEntryAt,
    workshopExitAt: mantWorkOrders.workshopExitAt,
  })
    .from(mantWorkOrders)
    .where(and(
      eq(mantWorkOrders.vehicleId, vehicleId),
      ne(mantWorkOrders.status, "anulada"),
      scopeWhere(scope),
    ))
    .orderBy(desc(mantWorkOrders.createdAt), desc(mantWorkOrders.id))
    .limit(limit)
  return rows.map((row) => ({ ...row, status: row.status as OtStatus }))
}

/** MTTR en horas: horas en taller de las reparaciones cerradas ÷ cuántas son. `null` si no hay ninguna que medir. */
export function meanTimeToRepairHours(repairClosed: number, repairWorkshopHours: number): number | null {
  return repairClosed > 0 ? repairWorkshopHours / repairClosed : null
}
