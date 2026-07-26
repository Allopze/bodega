/** Eventos verificables del centro operacional. No se reconstruye historia. */
import { and, desc, eq, exists, inArray, or } from "drizzle-orm"
import type { Session } from "next-auth"
import { db, type DB } from "@/db"
import { operationalActivityEvents, purchaseRequestItems, purchaseRequests, users, worksites } from "@/db/schema"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"

type ActivityDb = Pick<DB, "insert">

export interface OperationalActivityInput {
  eventType: string
  module: string
  entityType: string
  entityId: string
  entityCode?: string | null
  worksiteId?: string | null
  actorUserId?: string | null
  actorSnapshot?: string | null
  /** Sólo metadatos seguros de operación, nunca datos de salud o personas. */
  payload?: Record<string, string | number | boolean | null>
}

export async function recordOperationalActivity(input: OperationalActivityInput, client: ActivityDb = db) {
  await client.insert(operationalActivityEvents).values({
    id: nanoid(),
    eventType: input.eventType,
    module: input.module,
    entityType: input.entityType,
    entityId: input.entityId,
    entityCode: input.entityCode ?? null,
    worksiteId: input.worksiteId ?? null,
    actorUserId: input.actorUserId ?? null,
    actorSnapshot: input.actorSnapshot ?? null,
    payload: input.payload ?? {},
  })
}

export interface OperationalActivityEntry {
  id: string
  module: string
  actionLabel: string
  entityCode: string | null
  worksiteName: string
  actorName: string | null
  occurredAt: string
  href: string | null
}

const MODULE_PERMISSIONS: Record<string, string[]> = {
  solicitudes: ["requests:view_all"],
  aprobaciones: ["approvals:approve"],
  compras: ["purchasing:view"],
  recepciones: ["receiving:view"],
  entregas: ["deliveries:view"],
  operaciones: ["operations:view_work"],
  pdtp: ["prevention:pdtp:view"],
  capa: ["prevention:capa:view"],
  inspecciones: ["prevention:inspections:view"],
  documentacion: ["prevention:docs:view"],
  sst: ["sst:view"],
  // Los eventos PPA son genéricos y no contienen antecedentes del trabajador.
  ppa: ["ppa:view"],
}

function canReadEvent(session: Session, module: string) {
  const required = MODULE_PERMISSIONS[module]
  return required ? required.some((permission) => session.user.permissions.includes(permission)) : false
}

function readableModules(session: Session) {
  const modules = Object.keys(MODULE_PERMISSIONS).filter((module) => canReadEvent(session, module))
  if (session.user.permissions.includes("requests:view_own") && !modules.includes("solicitudes")) modules.push("solicitudes")
  return modules
}

function ownRequestActivityFilter(session: Session) {
  return and(
    eq(operationalActivityEvents.module, "solicitudes"),
    or(
      and(
        eq(operationalActivityEvents.entityType, "purchase_request"),
        exists(db.select({ id: purchaseRequests.id })
          .from(purchaseRequests)
          .where(and(
            eq(purchaseRequests.id, operationalActivityEvents.entityId),
            eq(purchaseRequests.requesterId, session.user.id),
          )),
        ),
      ),
      and(
        inArray(operationalActivityEvents.entityType, ["purchase_request_item", "request_item"]),
        exists(db.select({ id: purchaseRequestItems.id })
          .from(purchaseRequestItems)
          .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
          .where(and(
            eq(purchaseRequestItems.id, operationalActivityEvents.entityId),
            eq(purchaseRequests.requesterId, session.user.id),
          )),
        ),
      ),
    ),
  )
}

function eventHref(module: string, entityType: string, entityId: string) {
  if (module === "solicitudes" && entityType === "purchase_request") return `/solicitudes/${entityId}`
  if (module === "aprobaciones") return "/aprobaciones"
  if (module === "compras" && entityType === "purchase_order") return `/compras/${entityId}`
  if (module === "recepciones") return "/recepcion"
  if (module === "entregas") return "/entregas"
  if (module === "operaciones") return "/pendientes"
  if (module === "pdtp") return "/prevencion/pdtp"
  if (module === "capa") return `/prevencion/capa/${entityId}`
  if (module === "inspecciones") return `/prevencion/inspecciones/${entityId}`
  if (module === "documentacion") return `/prevencion/documentacion/${entityId}`
  if (module === "sst") return "/prevencion/evaluaciones"
  if (module === "ppa" && entityType === "ppa") return `/prevencion/ppa/${entityId}`
  return null
}

function eventLabel(eventType: string, module: string) {
  const action = eventType.replace(/^audit\./, "")
  const labels: Record<string, string> = {
    create: "Registro creado", update: "Registro actualizado", status_change: "Estado actualizado", cancel: "Registro cancelado", delete: "Registro eliminado",
    "work.assigned": "Pendiente asignado", "work.reassigned": "Pendiente reasignado", "work.unassigned": "Pendiente sin responsable",
    "purchase_order.issued": "Orden de compra emitida",
    "purchase_order.created": "Orden de compra creada",
    "purchase_order.sent": "Orden de compra enviada al proveedor",
    "purchase_order.confirmed": "Orden de compra confirmada por proveedor",
    "purchase_order.cancelled": "Orden de compra cancelada",
    "request_item.approved": "Ítem de solicitud aprobado",
    "request_item.rejected": "Ítem de solicitud rechazado",
    "request_item.returned": "Ítem de solicitud devuelto para corrección",
    "purchase_request.submitted": "Solicitud enviada",
    "purchase_request.cancelled": "Solicitud cancelada",
    "receipt.registered": "Recepción registrada",
    "delivery.registered": "Entrega registrada",
    "ppa.evaluated": "Evaluación PPA registrada",
    "pdtp.obligation_reported": "Obligación PDTP reportada",
    "pdtp.obligation_cancelled": "Obligación PDTP cancelada",
    "pdtp.action_created": "Acción PDTP creada",
    "pdtp.action_updated": "Acción PDTP actualizada",
    "pdtp.action_cancelled": "Acción PDTP cancelada",
    "pdtp.execution_submitted": "Ejecución PDTP enviada a revisión",
    "pdtp.execution_resubmitted": "Ejecución PDTP reenviada",
    "pdtp.execution_approved": "Ejecución PDTP aprobada",
    "pdtp.execution_rejected": "Ejecución PDTP devuelta para corrección",
    "capa.created": "Acción CAPA creada",
    "capa.updated": "Acción CAPA actualizada",
    "capa.transitioned": "Acción CAPA actualizada",
    "inspection.completed": "Inspección completada",
    "inspection.reviewed": "Inspección revisada",
    "document.workflow_updated": "Documento actualizado",
    "sst.followup_completed": "Seguimiento SST registrado",
  }
  return labels[eventType] ?? labels[action] ?? `Actividad en ${module}`
}

/** Actividad verificable sólo desde esta capacidad; nunca deriva estados. */
export async function listOperationalActivity(session: Session, limit = 7): Promise<OperationalActivityEntry[]> {
  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") return []
  const allowedModules = readableModules(session)
  if (allowedModules.length === 0) return []
  const scopeFilter = scope.mode === "all" ? undefined : inArray(operationalActivityEvents.worksiteId, scope.ids)
  const canViewAllRequests = session.user.permissions.includes("requests:view_all")
  const canViewOwnRequests = session.user.permissions.includes("requests:view_own")
  const nonRequestModules = allowedModules.filter((module) => module !== "solicitudes")
  const eventPermissionFilter = or(
    nonRequestModules.length > 0 ? inArray(operationalActivityEvents.module, nonRequestModules) : undefined,
    canViewAllRequests
      ? eq(operationalActivityEvents.module, "solicitudes")
      : canViewOwnRequests
        ? ownRequestActivityFilter(session)
        : undefined,
  )
  const rows = await db.select({
    id: operationalActivityEvents.id,
    module: operationalActivityEvents.module,
    eventType: operationalActivityEvents.eventType,
    entityType: operationalActivityEvents.entityType,
    entityId: operationalActivityEvents.entityId,
    entityCode: operationalActivityEvents.entityCode,
    worksiteName: worksites.name,
    actorName: users.name,
    actorSnapshot: operationalActivityEvents.actorSnapshot,
    occurredAt: operationalActivityEvents.occurredAt,
  })
    .from(operationalActivityEvents)
    .innerJoin(worksites, eq(operationalActivityEvents.worksiteId, worksites.id))
    .leftJoin(users, eq(operationalActivityEvents.actorUserId, users.id))
    .where(and(
      scopeFilter,
      eventPermissionFilter,
    ))
    .orderBy(desc(operationalActivityEvents.occurredAt))
    .limit(Math.max(1, Math.min(limit, 80)))

  return rows.map((row) => ({
    id: row.id,
    module: row.module,
    actionLabel: eventLabel(row.eventType, row.module),
    entityCode: row.entityCode,
    worksiteName: row.worksiteName,
    actorName: row.actorName ?? row.actorSnapshot,
    occurredAt: row.occurredAt,
    href: eventHref(row.module, row.entityType, row.entityId),
  }))
}
