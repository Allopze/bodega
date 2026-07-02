/**
 * lib/services/prevention-incidents.ts
 * Accidentes / incidentes / cuasi accidentes / enfermedad profesional.
 *
 * Reglas de negocio clave:
 *   - El cierre del incidente exige que TODAS las acciones estén en estado 'cerrada'
 *     o 'cancelada'. Una acción pendiente bloquea el cierre.
 *   - El scoping por faena se aplica siempre: un usuario sin acceso no puede crear
 *     ni ver incidentes de esa faena.
 */

import { and, desc, eq, inArray, notInArray } from "drizzle-orm"
import { db } from "@/db"
import { preventionIncidentActions, preventionIncidents, workers } from "@/db/schema"
import { nanoid } from "@/lib/id"
import {
  preventionIncidentActionSchema,
  preventionIncidentCreateSchema,
} from "@/lib/validation/prevention"

export type WorksiteScope = string[] | "all"

const TERMINAL_ACTION_STATUSES = ["cerrada", "cancelada"] as const

export function assertWorksiteAccess(worksiteId: string, scope: WorksiteScope): void {
  if (scope === "all") return
  if (!scope.includes(worksiteId)) {
    throw new Error("Incidente no encontrado o sin acceso.")
  }
}

async function assertWorkerBelongsToWorksite(workerId: string, worksiteId: string): Promise<void> {
  const [worker] = await db.select({ worksiteId: workers.worksiteId })
    .from(workers)
    .where(eq(workers.id, workerId))
    .limit(1)
  if (!worker || worker.worksiteId !== worksiteId) {
    throw new Error("El trabajador no pertenece a la faena seleccionada.")
  }
}

/**
 * Crea un incidente nuevo en estado 'open'. El caller debe estar dentro del scope.
 */
export async function createIncident(input: unknown, userId: string, scope: WorksiteScope) {
  const data = preventionIncidentCreateSchema.parse(input)
  assertWorksiteAccess(data.worksiteId, scope)
  if (data.workerId) {
    await assertWorkerBelongsToWorksite(data.workerId, data.worksiteId)
  }

  const now = new Date().toISOString()
  const id = nanoid()
  await db.insert(preventionIncidents).values({
    id,
    worksiteId: data.worksiteId,
    workerId: data.workerId || null,
    type: data.type,
    status: "open",
    severity: data.severity,
    occurredAt: data.occurredAt,
    title: data.title,
    description: data.description,
    immediateCause: data.immediateCause || null,
    rootCause: data.rootCause || null,
    location: data.location || null,
    createdBy: userId,
    closedBy: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  const [row] = await db.select().from(preventionIncidents).where(eq(preventionIncidents.id, id)).limit(1)
  if (!row) throw new Error("No se pudo crear el incidente.")
  return row
}

/**
 * Agrega una acción correctiva a un incidente existente.
 */
export async function addIncidentAction(input: unknown, scope: WorksiteScope) {
  const data = preventionIncidentActionSchema.parse(input)
  const [incident] = await db.select().from(preventionIncidents).where(eq(preventionIncidents.id, data.incidentId)).limit(1)
  if (!incident) throw new Error("Incidente no encontrado.")
  assertWorksiteAccess(incident.worksiteId, scope)

  const now = new Date().toISOString()
  const id = nanoid()
  await db.insert(preventionIncidentActions).values({
    id,
    incidentId: data.incidentId,
    description: data.description,
    responsible: data.responsible,
    dueDate: data.dueDate,
    status: "pendiente",
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  const [row] = await db.select().from(preventionIncidentActions).where(eq(preventionIncidentActions.id, id)).limit(1)
  if (!row) throw new Error("No se pudo crear la accion.")
  return row
}

/**
 * Marca una acción como 'cerrada' o 'cancelada' (estado terminal).
 */
export async function closeIncidentAction(
  actionId: string,
  finalStatus: "cerrada" | "cancelada",
  scope: WorksiteScope,
) {
  const [action] = await db.select().from(preventionIncidentActions).where(eq(preventionIncidentActions.id, actionId)).limit(1)
  if (!action) throw new Error("Accion no encontrada.")
  const [incident] = await db.select().from(preventionIncidents).where(eq(preventionIncidents.id, action.incidentId)).limit(1)
  if (!incident) throw new Error("Incidente no encontrado.")
  assertWorksiteAccess(incident.worksiteId, scope)

  const now = new Date().toISOString()
  const [updated] = await db.update(preventionIncidentActions)
    .set({ status: finalStatus, closedAt: now, updatedAt: now })
    .where(eq(preventionIncidentActions.id, actionId))
    .returning()

  if (!updated) throw new Error("No se pudo cerrar la accion.")
  return updated
}

/**
 * Cierra el incidente. Rechaza si queda alguna acción en estado no terminal.
 */
export async function closeIncident(id: string, userId: string, scope: WorksiteScope) {
  const [incident] = await db.select().from(preventionIncidents).where(eq(preventionIncidents.id, id)).limit(1)
  if (!incident) throw new Error("Incidente no encontrado.")
  assertWorksiteAccess(incident.worksiteId, scope)

  const pending = await db.select({ id: preventionIncidentActions.id })
    .from(preventionIncidentActions)
    .where(and(
      eq(preventionIncidentActions.incidentId, id),
      notInArray(preventionIncidentActions.status, [...TERMINAL_ACTION_STATUSES]),
    ))
    .limit(1)

  if (pending.length > 0) {
    throw new Error("No se puede cerrar el incidente: existen acciones pendientes.")
  }

  const now = new Date().toISOString()
  const [updated] = await db.update(preventionIncidents)
    .set({ status: "closed", closedBy: userId, closedAt: now, updatedAt: now })
    .where(eq(preventionIncidents.id, id))
    .returning()

  if (!updated) throw new Error("No se pudo cerrar el incidente.")
  return updated
}

export async function listIncidents(scope: WorksiteScope) {
  if (scope !== "all" && scope.length === 0) return []
  const where = scope === "all"
    ? undefined
    : inArray(preventionIncidents.worksiteId, scope)
  return db.select().from(preventionIncidents).where(where).orderBy(desc(preventionIncidents.occurredAt))
}

export async function listIncidentActions(incidentId: string, scope: WorksiteScope) {
  const [incident] = await db.select().from(preventionIncidents).where(eq(preventionIncidents.id, incidentId)).limit(1)
  if (!incident) return []
  assertWorksiteAccess(incident.worksiteId, scope)
  return db.select().from(preventionIncidentActions)
    .where(eq(preventionIncidentActions.incidentId, incidentId))
    .orderBy(preventionIncidentActions.createdAt)
}

/**
 * Construye un XLSX con incidentes y un resumen de acciones.
 *   - Hoja "Incidentes": una fila por incidente.
 *   - Hoja "Acciones": una fila por acción correctiva.
 */
export async function buildIncidentExport(scope: WorksiteScope): Promise<{
  filenameBase: string
  worksheetName: string
  headers: string[]
  rows: Array<Array<string | number>>
  sheets?: Array<{ worksheetName: string; headers: string[]; rows: Array<Array<string | number>> }>
}> {
  if (scope !== "all" && scope.length === 0) {
    return { filenameBase: "incidentes", worksheetName: "Incidentes", headers: [], rows: [] }
  }
  const where = scope === "all" ? undefined : inArray(preventionIncidents.worksiteId, scope)
  const incidents = await db.select().from(preventionIncidents).where(where).orderBy(desc(preventionIncidents.occurredAt))
  const ids = incidents.map((i) => i.id)
  const allActions = ids.length === 0
    ? []
    : await db.select().from(preventionIncidentActions).where(inArray(preventionIncidentActions.incidentId, ids))

  const TITLE_BY_INCIDENT = new Map(incidents.map((i) => [i.id, i.title]))
  const TYPE_LABEL: Record<string, string> = {
    accidente: "Accidente",
    incidente: "Incidente",
    cuasi_accidente: "Cuasi accidente",
    enfermedad_profesional: "Enfermedad profesional",
  }
  const STATUS_LABEL: Record<string, string> = {
    open: "Abierto",
    investigating: "En investigación",
    closed: "Cerrado",
  }

  const incidentRows = incidents.map((i) => [
    i.occurredAt.slice(0, 10),
    TYPE_LABEL[i.type] ?? i.type,
    i.title,
    i.severity,
    STATUS_LABEL[i.status] ?? i.status,
    i.location ?? "",
    i.immediateCause ?? "",
    i.rootCause ?? "",
  ] as Array<string | number>)

  const actionRows = allActions.map((a) => [
    TITLE_BY_INCIDENT.get(a.incidentId) ?? "",
    a.description,
    a.responsible,
    a.dueDate,
    a.status,
    a.closedAt ?? "",
  ] as Array<string | number>)

  return {
    filenameBase: `incidentes_${new Date().toISOString().slice(0, 10)}`,
    worksheetName: "Incidentes",
    headers: [
      "Fecha", "Tipo", "Título", "Gravedad", "Estado",
      "Lugar", "Causa inmediata", "Causa raíz",
    ],
    rows: incidentRows,
    sheets: [
      { worksheetName: "Incidentes", headers: [
        "Fecha", "Tipo", "Título", "Gravedad", "Estado",
        "Lugar", "Causa inmediata", "Causa raíz",
      ], rows: incidentRows },
      { worksheetName: "Acciones", headers: [
        "Incidente", "Descripción", "Responsable", "Plazo", "Estado", "Cerrada",
      ], rows: actionRows },
    ],
  }
}
