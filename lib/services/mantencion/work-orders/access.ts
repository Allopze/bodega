import { eq, inArray, or, sql, type SQL } from "drizzle-orm"
import { mantWorkOrders } from "@/db/schema"
import {
  canTransitionFrom, isOtStatus, OT_EXECUTION_EDITABLE, OT_PERMISSIONS, OT_REQUEST_EDITABLE, OT_STATUS_LABELS, OT_TRANSITIONS,
  type OtPermission, type OtTransition,
} from "@/lib/mantencion/work-order-states"
import type { MantViewer } from "../access"

/** Lo que estas reglas leen del usuario: el `MantViewer` sin el correo (el actor de una acción no lo trae). */
export type AccessViewer = Pick<MantViewer, "userId" | "permissions" | "worksiteIds" | "isGlobal">

const hasMantPermission = (viewer: AccessViewer, permission: string) => viewer.permissions.includes(permission)

/**
 * Alcance de las órdenes de trabajo, resuelto SIEMPRE en el servidor.
 *
 * Quién ve qué (se suman):
 * - `mant:ot:view_all` → todas;
 * - `mant:ot:view_worksite` (o `manage`) con rol global → todas; sin rol global,
 *   las de sus faenas asignadas;
 * - lo propio: las que creó y las que tiene asignadas;
 * - quien ejecuta (`mant:ot:execute`) ve además las «por asignar» de cualquier
 *   faena, porque puede tomarlas.
 *
 * Quién actúa: `canActOnWorkOrder` aplica `OT_TRANSITIONS` (permiso + regla de
 * actor) más el alcance de faena que corresponde. Ejecutar, tomar y ser el
 * asignado NO se acotan por faena: cualquier mecánico trabaja en cualquier
 * faena. Ocultar un botón no es control de acceso: las acciones y los servicios
 * llaman a esto.
 */

export type WorkOrderVisibility =
  | { kind: "all" }
  | { kind: "scoped"; worksiteIds: string[]; userId: string | null; takeable: boolean }

const hasAnyOtPermission = (viewer: AccessViewer) => Object.values(OT_PERMISSIONS).some((permission) => hasMantPermission(viewer, permission))

export function workOrderVisibility(viewer: AccessViewer): WorkOrderVisibility {
  if (hasMantPermission(viewer, OT_PERMISSIONS.viewAll)) return { kind: "all" }
  const wideRead = hasMantPermission(viewer, OT_PERMISSIONS.viewWorksite) || hasMantPermission(viewer, OT_PERMISSIONS.manage)
  if (wideRead && viewer.isGlobal) return { kind: "all" }
  return {
    kind: "scoped",
    worksiteIds: wideRead ? [...viewer.worksiteIds] : [],
    userId: hasAnyOtPermission(viewer) ? viewer.userId : null,
    takeable: hasMantPermission(viewer, OT_PERMISSIONS.execute),
  }
}

/** Predicado SQL sobre `mant_work_orders`. Sin ningún permiso de OT: `false`. */
export function workOrderVisibilitySql(visibility: WorkOrderVisibility): SQL {
  if (visibility.kind === "all") return sql`true`
  const parts: SQL[] = []
  if (visibility.worksiteIds.length) parts.push(inArray(mantWorkOrders.worksiteId, visibility.worksiteIds))
  if (visibility.userId) {
    parts.push(eq(mantWorkOrders.requestedByUserId, visibility.userId))
    parts.push(eq(mantWorkOrders.assignedToUserId, visibility.userId))
  }
  if (visibility.takeable) parts.push(eq(mantWorkOrders.status, "solicitada"))
  return parts.length ? or(...parts)! : sql`false`
}

/** Forma mínima de una OT para decidir acceso y acciones. */
export interface WorkOrderAccessFacts {
  /** Un `OtStatus`; llega como `string` desde las filas de la base. */
  status: string
  worksiteId: string
  requestedByUserId: string
  assignedToUserId: string | null
}

export function canSeeWorkOrder(visibility: WorkOrderVisibility, ot: WorkOrderAccessFacts): boolean {
  if (visibility.kind === "all") return true
  if (visibility.worksiteIds.includes(ot.worksiteId)) return true
  if (visibility.userId && (ot.requestedByUserId === visibility.userId || ot.assignedToUserId === visibility.userId)) return true
  return visibility.takeable && ot.status === "solicitada"
}

/** La faena de la OT está en el alcance del usuario (un rol global las tiene todas). */
export function inWorksiteScope(viewer: AccessViewer, worksiteId: string): boolean {
  return viewer.isGlobal || viewer.worksiteIds.includes(worksiteId)
}

export type AccessCheck = { ok: true } | { ok: false; code: "forbidden" | "conflict"; message: string }

const statusLabel = (status: string) => (isOtStatus(status) ? OT_STATUS_LABELS[status] : status)

const allow: AccessCheck = { ok: true }
const forbidden = (message: string): AccessCheck => ({ ok: false, code: "forbidden", message })

/** Permisos cuya acción exige además que la faena de la OT sea del usuario. */
const WORKSITE_SCOPED: ReadonlySet<OtPermission> = new Set([OT_PERMISSIONS.receive, OT_PERMISSIONS.conform])

/**
 * ¿Puede este usuario ejecutar la transición sobre esta OT, ahora?
 * Aplica el estado de origen, el permiso, la regla de actor y el alcance de faena.
 */
export function canActOnWorkOrder(viewer: AccessViewer, ot: WorkOrderAccessFacts, transition: OtTransition): AccessCheck {
  const rule = OT_TRANSITIONS[transition]
  if (!isOtStatus(ot.status) || !canTransitionFrom(transition, ot.status)) {
    return { ok: false, code: "conflict", message: `La OT está «${statusLabel(ot.status)}»: ya no admite esta acción.` }
  }
  const manage = hasMantPermission(viewer, OT_PERMISSIONS.manage)
  const holds = hasMantPermission(viewer, rule.permission)

  if (rule.actor === "creator_or_manage") {
    const creator = ot.status === "solicitada" && ot.requestedByUserId === viewer.userId && hasMantPermission(viewer, OT_PERMISSIONS.create)
    if (!manage && !creator) return forbidden("Sólo la jefatura de mantención puede anular una OT (quien la creó, mientras siga por asignar).")
    return allow
  }
  if (rule.actor === "assignee_or_manage") {
    const assignee = ot.assignedToUserId === viewer.userId && hasMantPermission(viewer, OT_PERMISSIONS.execute)
    if (!manage && !assignee) return forbidden("Sólo el mecánico asignado o la jefatura de mantención pueden hacer esto.")
    return allow
  }
  if (!holds) return forbidden("No tienes permiso para esta acción.")
  if (WORKSITE_SCOPED.has(rule.permission) && !inWorksiteScope(viewer, ot.worksiteId)) {
    return forbidden("El equipo de esta OT es de otra faena: no es de tu alcance.")
  }
  return allow
}

/** Editar el ingreso, la fecha estimada y los ítems mientras está en taller: el asignado o la jefatura. */
export function canEditExecution(viewer: AccessViewer, ot: WorkOrderAccessFacts): AccessCheck {
  if (!isOtStatus(ot.status) || !OT_EXECUTION_EDITABLE.includes(ot.status)) {
    return { ok: false, code: "conflict", message: `La OT está «${statusLabel(ot.status)}»: el ingreso y los ítems sólo se editan mientras está en taller.` }
  }
  const assignee = ot.assignedToUserId === viewer.userId && hasMantPermission(viewer, OT_PERMISSIONS.execute)
  if (!assignee && !hasMantPermission(viewer, OT_PERMISSIONS.manage)) return forbidden("Sólo el mecánico asignado o la jefatura de mantención pueden hacer esto.")
  return allow
}

/** Editar la solicitud: la jefatura, o quien la creó (con permiso de crear y su faena en alcance), mientras no está en taller. */
export function canEditRequest(viewer: AccessViewer, ot: WorkOrderAccessFacts): AccessCheck {
  if (!isOtStatus(ot.status) || !OT_REQUEST_EDITABLE.includes(ot.status)) {
    return { ok: false, code: "conflict", message: `La OT está «${statusLabel(ot.status)}»: la solicitud ya no se puede editar.` }
  }
  if (hasMantPermission(viewer, OT_PERMISSIONS.manage)) return allow
  const creator = ot.requestedByUserId === viewer.userId
    && hasMantPermission(viewer, OT_PERMISSIONS.create)
    && inWorksiteScope(viewer, ot.worksiteId)
  return creator ? allow : forbidden("Sólo la jefatura de mantención o quien creó la OT pueden editar la solicitud.")
}

/** Todas las transiciones que el usuario podría ejecutar ahora (lo que la UI refleja). */
export function allowedTransitions(viewer: AccessViewer, ot: WorkOrderAccessFacts): OtTransition[] {
  return (Object.keys(OT_TRANSITIONS) as OtTransition[]).filter((transition) => canActOnWorkOrder(viewer, ot, transition).ok)
}
