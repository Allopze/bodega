import { and, asc, desc, eq, gte, inArray, or } from "drizzle-orm"
import { db } from "@/db"
import { mantRecords, mantWorkOrderEvents, mantWorkOrderItems, mantWorkOrders, users, worksites } from "@/db/schema"
import type { CatalogWorkOrder } from "@/lib/mantencion/contracts"
import type { OtItemDone, OtItemKind, OtItemOrigin, OtStatus, OtWorkshopKind } from "@/lib/mantencion/work-order-states"
import type { MantViewer } from "../access"

/**
 * Órdenes de trabajo del catálogo de la app: las asignadas a mí (abiertas y las
 * cerradas de los últimos 7 días). El mecánico no toma OT: se las asignan.
 * Cada una trae el resumen del equipo, porque puede ser de una faena cuyo
 * equipo no está en mi catálogo.
 */

const CLOSED_WINDOW_DAYS = 7
const OPEN_FOR_ME = ["asignada", "en_ejecucion", "trabajo_terminado", "recepcionada"] as const

const iso = (value: string) => new Date(value).toISOString()

async function hydrate(viewer: MantViewer, rows: Array<{ ot: typeof mantWorkOrders.$inferSelect; worksiteName: string; assignedToName: string | null }>): Promise<CatalogWorkOrder[]> {
  if (rows.length === 0) return []
  const ids = rows.map((row) => row.ot.id)
  const [items, returns, records] = await Promise.all([
    db.select().from(mantWorkOrderItems).where(inArray(mantWorkOrderItems.workOrderId, ids))
      .orderBy(asc(mantWorkOrderItems.kind), asc(mantWorkOrderItems.sortOrder), asc(mantWorkOrderItems.createdAt)),
    db.select({ workOrderId: mantWorkOrderEvents.workOrderId, type: mantWorkOrderEvents.type, reason: mantWorkOrderEvents.reason, createdAt: mantWorkOrderEvents.createdAt })
      .from(mantWorkOrderEvents)
      .where(and(inArray(mantWorkOrderEvents.workOrderId, ids), inArray(mantWorkOrderEvents.type, ["rejected", "reopened"])))
      .orderBy(desc(mantWorkOrderEvents.createdAt)),
    db.select({ id: mantRecords.id, workOrderId: mantRecords.workOrderId, folio: mantRecords.folio, kind: mantRecords.kind, signedAt: mantRecords.signedAt, receivedAt: mantRecords.receivedAt })
      .from(mantRecords)
      .where(and(inArray(mantRecords.workOrderId, ids), eq(mantRecords.status, "vigente")))
      .orderBy(asc(mantRecords.signedAt)),
  ])
  // Lo recibido «desde el último rechazo» (o reapertura): es lo que habilita terminar de nuevo.
  // Reloj del servidor (`received_at`), el mismo del evento; `signed_at` es del teléfono.
  const lastReturn = new Map<string, { type: string; reason: string | null; createdAt: string }>()
  for (const event of returns) if (!lastReturn.has(event.workOrderId)) lastReturn.set(event.workOrderId, event)

  return rows.map(({ ot, worksiteName, assignedToName }): CatalogWorkOrder => {
    const back = lastReturn.get(ot.id)
    const rejected = back?.type === "rejected" && ot.status === "en_ejecucion" ? back : null
    return {
      id: ot.id,
      folio: ot.folio,
      status: ot.status as OtStatus,
      vehicleId: ot.vehicleId,
      equipmentCode: ot.equipmentSnapshot.code,
      equipmentPlate: ot.equipmentSnapshot.plate,
      equipmentType: ot.equipmentSnapshot.type,
      unit: ot.equipmentSnapshot.unit,
      worksiteId: ot.worksiteId,
      worksiteName,
      outOfWorksite: !viewer.isGlobal && !viewer.worksiteIds.includes(ot.worksiteId),
      repair: ot.repair,
      maintenance: ot.maintenance,
      requestDate: ot.requestDate,
      requesterName: ot.requesterName,
      repairDescription: ot.repairDescription,
      observations: ot.observations,
      assignedToUserId: ot.assignedToUserId,
      assignedToName,
      entry: ot.workshopEntryAt && ot.workshopKind && ot.estimatedDeliveryDate
        ? {
          workshopKind: ot.workshopKind as OtWorkshopKind,
          workshopName: ot.workshopName,
          workshopManagerName: ot.workshopManagerName,
          operatorName: ot.operatorName,
          entryAt: iso(ot.workshopEntryAt),
          odometer: ot.entryOdometer,
          hourmeter: ot.entryHourmeter,
          estimatedDeliveryDate: ot.estimatedDeliveryDate,
        }
        : null,
      exitAt: ot.workshopExitAt ? iso(ot.workshopExitAt) : null,
      items: items.filter((item) => item.workOrderId === ot.id).map((item) => ({
        id: item.id,
        kind: item.kind as OtItemKind,
        origin: item.origin as OtItemOrigin,
        description: item.description,
        done: item.done as OtItemDone | null,
        note: item.note,
      })),
      lastRejection: rejected ? { count: ot.rejectionCount, reason: rejected.reason ?? "", at: iso(rejected.createdAt) } : null,
      linkedRecords: records
        .filter((record) => record.workOrderId === ot.id && (!back || new Date(record.receivedAt).getTime() > new Date(back.createdAt).getTime()))
        .map((record) => ({ id: record.id, folio: record.folio, kind: record.kind as "P" | "C", signedAt: iso(record.signedAt) })),
    }
  })
}

export async function loadCatalogWorkOrders(viewer: MantViewer): Promise<{ workOrders: CatalogWorkOrder[] }> {
  const closedSince = new Date(Date.now() - CLOSED_WINDOW_DAYS * 86_400_000).toISOString()
  const assignee = users
  const mine = await db.select({ ot: mantWorkOrders, worksiteName: worksites.name, assignedToName: assignee.name }).from(mantWorkOrders)
    .innerJoin(worksites, eq(worksites.id, mantWorkOrders.worksiteId))
    .leftJoin(assignee, eq(assignee.id, mantWorkOrders.assignedToUserId))
    .where(and(
      eq(mantWorkOrders.assignedToUserId, viewer.userId),
      or(
        inArray(mantWorkOrders.status, [...OPEN_FOR_ME]),
        and(eq(mantWorkOrders.status, "cerrada"), gte(mantWorkOrders.closedAt, closedSince)),
      ),
    ))
    .orderBy(asc(mantWorkOrders.createdAt), asc(mantWorkOrders.id))
  return { workOrders: await hydrate(viewer, mine) }
}
