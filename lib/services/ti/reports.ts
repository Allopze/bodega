import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  itAccessSystems, itAssets, itChecklistTasks, itLicenseAssignments, itLicenses, itSystemAccess,
  itTickets, itWorkerChecklists, suppliers, users, workers, worksites,
} from "@/db/schema"
import { worksiteScopeSqlFor } from "@/lib/auth/scope"
import {
  IT_ACCESS_STATUS_META, IT_CHECKLIST_KIND_META, IT_LICENSE_PERIODICITY_META,
  IT_TICKET_CATEGORY_META, IT_TICKET_PRIORITY_META, IT_TICKET_STATUS_META,
} from "./constants"
import { licenseScopeCondition } from "./licenses"
import type { TiWorksiteScope } from "./scope"

/**
 * Hojas de los reportes de mesa de ayuda, licencias y accesos. Viven aquí (y no
 * en la acción) para poder probar la forma de las filas y el alcance de faena
 * sin pasar por la sesión. El alcance entra SIEMPRE como argumento: un filtro de
 * faena del formulario se intersecta con él, nunca lo reemplaza.
 */

export interface TiReportSheet {
  worksheetName: string
  headers: string[]
  rows: (string | number)[][]
}

export interface TiReportFilters {
  worksiteId?: string
  /** Fechas civiles YYYY-MM-DD, ambas inclusivas. */
  from?: string
  to?: string
  systemId?: string
}

/**
 * «Dentro / fuera de plazo»: un ticket cerrado se juzga por cuándo se resolvió;
 * uno abierto, por si ya pasó su vencimiento. Sin vencimiento (tickets
 * anteriores al SLA) no se inventa un veredicto.
 */
export function ticketSlaVerdict(
  dueAt: string | null,
  resolvedAt: string | null,
  now: Date = new Date(),
): "Dentro de plazo" | "Fuera de plazo" | "Sin plazo" {
  if (!dueAt) return "Sin plazo"
  const due = new Date(dueAt).getTime()
  const reference = resolvedAt ? new Date(resolvedAt).getTime() : now.getTime()
  return reference <= due ? "Dentro de plazo" : "Fuera de plazo"
}

/** Fecha y hora en Chile, legible en Excel. */
function stamp(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(d)
  return parts
}

const personName = (first: unknown, last: unknown) => `${first ?? ""} ${last ?? ""}`.trim()

export async function ticketsSheet(
  scope: TiWorksiteScope, filters: TiReportFilters = {}, now: Date = new Date(),
): Promise<TiReportSheet> {
  const requester = db.$with("requester").as(db.select({ id: users.id, name: users.name }).from(users))
  const assignee = db.$with("assignee").as(db.select({ id: users.id, name: users.name }).from(users))
  const createdDay = sql`(${itTickets.createdAt} AT TIME ZONE 'America/Santiago')::date`
  const rows = await db
    .with(requester, assignee)
    .select({
      code: itTickets.code,
      subject: itTickets.subject,
      category: itTickets.category,
      priority: itTickets.priority,
      status: itTickets.status,
      worksite: worksites.name,
      requester: requester.name,
      assignee: assignee.name,
      createdAt: itTickets.createdAt,
      dueAt: itTickets.dueAt,
      resolvedAt: itTickets.resolvedAt,
    })
    .from(itTickets)
    .innerJoin(worksites, eq(itTickets.worksiteId, worksites.id))
    .leftJoin(requester, eq(itTickets.requesterUserId, requester.id))
    .leftJoin(assignee, eq(itTickets.assigneeUserId, assignee.id))
    .where(and(
      worksiteScopeSqlFor(scope, itTickets.worksiteId, filters.worksiteId),
      filters.from ? sql`${createdDay} >= ${filters.from}::date` : undefined,
      filters.to ? sql`${createdDay} <= ${filters.to}::date` : undefined,
    ))
    .orderBy(desc(itTickets.createdAt))

  return {
    worksheetName: "Tickets",
    headers: ["Código", "Asunto", "Categoría", "Prioridad", "Estado", "Faena", "Solicitante", "Técnico", "Creado", "Vence", "Resuelto", "Plazo"],
    rows: rows.map((r) => [
      r.code,
      r.subject,
      IT_TICKET_CATEGORY_META[r.category] ?? r.category,
      IT_TICKET_PRIORITY_META[r.priority]?.label ?? r.priority,
      IT_TICKET_STATUS_META[r.status]?.label ?? r.status,
      r.worksite,
      r.requester ?? "",
      r.assignee ?? "",
      stamp(r.createdAt),
      stamp(r.dueAt),
      stamp(r.resolvedAt),
      ticketSlaVerdict(r.dueAt, r.resolvedAt, now),
    ]),
  }
}

/** Condición de faena de una asignación de licencia (propia, del trabajador o del activo). */
function licenseAssignmentScope(scope: TiWorksiteScope): SQL | undefined {
  if (scope === "all") return undefined
  if (scope.length === 0) return sql`false`
  return or(
    inArray(itLicenseAssignments.worksiteId, scope),
    inArray(workers.worksiteId, scope),
    inArray(itAssets.worksiteId, scope),
  )
}

export async function licenseSheets(scope: TiWorksiteScope): Promise<TiReportSheet[]> {
  const licenseRows = await db
    .select({
      id: itLicenses.id,
      name: itLicenses.name,
      type: itLicenses.type,
      supplier: suppliers.name,
      purchased: itLicenses.purchasedQuantity,
      cost: itLicenses.cost,
      periodicity: itLicenses.periodicity,
      renewalDate: itLicenses.renewalDate,
      responsible: users.name,
      isActive: itLicenses.isActive,
    })
    .from(itLicenses)
    .leftJoin(suppliers, eq(itLicenses.supplierId, suppliers.id))
    .leftJoin(users, eq(itLicenses.responsibleUserId, users.id))
    .where(licenseScopeCondition(scope))
    .orderBy(asc(itLicenses.name))

  const assignmentRows = licenseRows.length === 0 ? [] : await db
    .select({
      licenseId: itLicenseAssignments.licenseId,
      license: itLicenses.name,
      workerFirst: workers.firstName,
      workerLast: workers.lastName,
      asset: itAssets.code,
      area: itLicenseAssignments.area,
      worksite: worksites.name,
      assignedAt: itLicenseAssignments.assignedAt,
      revokedAt: itLicenseAssignments.revokedAt,
      notes: itLicenseAssignments.notes,
    })
    .from(itLicenseAssignments)
    .innerJoin(itLicenses, eq(itLicenseAssignments.licenseId, itLicenses.id))
    .leftJoin(workers, eq(itLicenseAssignments.workerId, workers.id))
    .leftJoin(itAssets, eq(itLicenseAssignments.assetId, itAssets.id))
    .leftJoin(worksites, eq(sql`coalesce(${itLicenseAssignments.worksiteId}, ${workers.worksiteId}, ${itAssets.worksiteId})`, worksites.id))
    .where(and(inArray(itLicenseAssignments.licenseId, licenseRows.map((l) => l.id)), licenseAssignmentScope(scope)))
    .orderBy(asc(itLicenses.name), asc(itLicenseAssignments.assignedAt))

  // «Asignados» cuenta lo que el usuario puede ver (mismo criterio que el listado).
  const assigned = new Map<string, number>()
  for (const a of assignmentRows) {
    if (!a.revokedAt) assigned.set(a.licenseId, (assigned.get(a.licenseId) ?? 0) + 1)
  }

  return [
    {
      worksheetName: "Licencias",
      headers: ["Licencia", "Tipo", "Proveedor", "Cupos comprados", "Cupos asignados", "Cupos libres", "Costo", "Periodicidad", "Renovación", "Responsable", "Estado"],
      rows: licenseRows.map((l) => {
        const used = assigned.get(l.id) ?? 0
        return [
          l.name, l.type ?? "", l.supplier ?? "", l.purchased, used, Math.max(l.purchased - used, 0),
          l.cost != null ? Number(l.cost) : "",
          IT_LICENSE_PERIODICITY_META[l.periodicity] ?? l.periodicity,
          l.renewalDate ?? "", l.responsible ?? "", l.isActive ? "Vigente" : "Inactiva",
        ]
      }),
    },
    {
      worksheetName: "Asignaciones de licencias",
      headers: ["Licencia", "Asignada a", "Equipo", "Área", "Faena", "Desde", "Revocada", "Notas"],
      rows: assignmentRows.map((a) => [
        a.license,
        personName(a.workerFirst, a.workerLast),
        a.asset ?? "",
        a.area ?? "",
        a.worksite ?? "",
        stamp(a.assignedAt),
        stamp(a.revokedAt),
        a.notes ?? "",
      ]),
    },
  ]
}

export async function accessSheet(scope: TiWorksiteScope, filters: TiReportFilters = {}): Promise<TiReportSheet> {
  const responsible = db.$with("responsible").as(db.select({ id: users.id, name: users.name }).from(users))
  const rows = await db
    .with(responsible)
    .select({
      workerFirst: workers.firstName,
      workerLast: workers.lastName,
      workerActive: workers.isActive,
      worksite: worksites.name,
      system: itAccessSystems.name,
      status: itSystemAccess.status,
      responsible: responsible.name,
      grantedAt: itSystemAccess.grantedAt,
      revokedAt: itSystemAccess.revokedAt,
      notes: itSystemAccess.notes,
    })
    .from(itSystemAccess)
    .innerJoin(workers, eq(itSystemAccess.workerId, workers.id))
    .innerJoin(worksites, eq(workers.worksiteId, worksites.id))
    .innerJoin(itAccessSystems, eq(itSystemAccess.systemId, itAccessSystems.id))
    .leftJoin(responsible, eq(itSystemAccess.responsibleUserId, responsible.id))
    .where(and(
      worksiteScopeSqlFor(scope, workers.worksiteId, filters.worksiteId),
      filters.systemId ? eq(itSystemAccess.systemId, filters.systemId) : undefined,
    ))
    .orderBy(asc(workers.firstName), asc(workers.lastName), asc(itAccessSystems.name))

  return {
    worksheetName: "Accesos",
    headers: ["Trabajador", "Situación", "Faena", "Sistema", "Estado", "Responsable", "Otorgado", "Revocado", "Notas"],
    rows: rows.map((r) => [
      personName(r.workerFirst, r.workerLast),
      r.workerActive ? "Activo" : "Inactivo",
      r.worksite,
      r.system,
      IT_ACCESS_STATUS_META[r.status]?.label ?? r.status,
      r.responsible ?? "",
      stamp(r.grantedAt),
      stamp(r.revokedAt),
      r.notes ?? "",
    ]),
  }
}

export async function checklistSheet(scope: TiWorksiteScope, filters: TiReportFilters = {}): Promise<TiReportSheet> {
  const creator = db.$with("creator").as(db.select({ id: users.id, name: users.name }).from(users))
  const rows = await db
    .with(creator)
    .select({
      workerFirst: workers.firstName,
      workerLast: workers.lastName,
      worksite: worksites.name,
      kind: itWorkerChecklists.kind,
      startedAt: itWorkerChecklists.startedAt,
      completedAt: itWorkerChecklists.completedAt,
      creator: creator.name,
      total: sql<number>`(SELECT count(*)::int FROM ${itChecklistTasks} t WHERE t.checklist_id = ${itWorkerChecklists.id})`,
      done: sql<number>`(SELECT count(*) filter (where t.done)::int FROM ${itChecklistTasks} t WHERE t.checklist_id = ${itWorkerChecklists.id})`,
    })
    .from(itWorkerChecklists)
    .innerJoin(workers, eq(itWorkerChecklists.workerId, workers.id))
    .innerJoin(worksites, eq(workers.worksiteId, worksites.id))
    .leftJoin(creator, eq(itWorkerChecklists.createdByUserId, creator.id))
    .where(worksiteScopeSqlFor(scope, workers.worksiteId, filters.worksiteId))
    .orderBy(desc(itWorkerChecklists.startedAt))

  return {
    worksheetName: "Ingresos y egresos",
    headers: ["Trabajador", "Faena", "Tipo", "Avance", "Tareas pendientes", "Creado por", "Iniciado", "Completado"],
    rows: rows.map((r) => [
      personName(r.workerFirst, r.workerLast),
      r.worksite,
      IT_CHECKLIST_KIND_META[r.kind] ?? r.kind,
      `${r.done} de ${r.total}`,
      Math.max(r.total - r.done, 0),
      r.creator ?? "",
      stamp(r.startedAt),
      stamp(r.completedAt),
    ]),
  }
}
