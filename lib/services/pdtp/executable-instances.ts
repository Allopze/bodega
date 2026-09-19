import type { Session } from "next-auth"
import { inArray, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpActivityExecutionConfigs,
  pdtpActivityWorksiteAssignees,
  pdtpActivityWorksiteExclusions,
  pdtpObligations,
  pdtpPrograms,
  pdtpResponsibleCatalog,
  pdtpScheduledInstances,
  users,
  worksites,
} from "@/db/schema"
import { resolveWorksiteScope, type WorksiteScope } from "@/lib/auth/scope"
import { canActOnQueueSource } from "@/lib/services/work-queue-eligibility"
import { getPdtpExecutionConnector, listPdtpExecutionConnectors } from "./connectors"

export type PdtpExecutableInstanceKind = "scheduled" | "obligation"
export type PdtpExecutableInstanceStatus = "pending" | "in_progress" | "submitted" | "overdue" | "reported"
export type PdtpExecutionStatus = PdtpExecutableInstanceStatus
export type PdtpExecutableInstanceDerivedStatus = "pending" | "in_progress" | "overdue" | "completed_late" | "completed"

export type PdtpExecutableInstanceRow = {
  id: string
  kind: PdtpExecutableInstanceKind
  programId: string
  activityId: string
  activityNumber: number
  activityName: string
  activityTitle: string
  worksiteId: string
  worksiteName: string
  connectorKey: string
  connectorLabel: string
  status: PdtpExecutableInstanceStatus
  /** Estado de lectura usado por los paneles; no reemplaza el estado persistido. */
  derivedStatus: PdtpExecutableInstanceDerivedStatus
  statusLabel: string
  dueAt: string | null
  scheduledFor: string | null
  createdAt: string
  responsibleUserId: string | null
  responsibleName: string | null
  assignedToMe: boolean
  instrumentId: string | null
  scheduledInstanceId: string | null
  obligationId: string | null
  href: string
  startHref: string
  ctaLabel: string
}

export type ListPdtpExecutableInstancesFilters = {
  connectorKey?: string
  worksiteIds?: readonly string[]
  from?: string
  to?: string
  statuses?: readonly PdtpExecutableInstanceStatus[]
  status?: PdtpExecutableInstanceStatus
  assignedToMe?: boolean
}
export type PdtpExecutableInstanceFilters = ListPdtpExecutableInstancesFilters

type ExecutableSqlRow = {
  source_id: string
  kind: PdtpExecutableInstanceKind
  program_id: string
  activity_id: string
  activity_number: number | string
  activity_name: string
  worksite_id: string
  worksite_name: string
  connector_key: string
  status: PdtpExecutableInstanceStatus
  status_label: string
  source_due_at: string | null
  created_at: string
  native_assignee_user_id: string | null
  native_assignee_name: string | null
  instrument_id: string | null
  scheduled_instance_id: string | null
  obligation_id: string | null
  href: string
  cta_label: string
}

const OPEN_STATUSES: readonly PdtpExecutableInstanceStatus[] = ["pending", "in_progress", "submitted", "overdue", "reported"]
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function scopeCondition(scope: WorksiteScope, column: AnyPgColumn): SQL {
  if (scope.mode === "all") return sql`true`
  if (scope.mode === "none" || scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
}

function emptyExecutableSource(): SQL {
  return sql`
    SELECT NULL::text AS source_type, NULL::text AS source_id, NULL::text AS action_key, NULL::text AS module,
      NULL::text AS code, NULL::text AS title, NULL::text AS subtitle, NULL::text AS worksite_id,
      NULL::text AS worksite_name, NULL::text AS status, NULL::text AS status_label, NULL::text AS priority,
      false AS blocked, NULL::text AS created_at, NULL::text AS source_due_at,
      NULL::text AS native_assignee_user_id, NULL::text AS native_assignee_name,
      NULL::text AS href, NULL::text AS cta_label, NULL::text AS kind, NULL::text AS program_id,
      NULL::text AS activity_id, NULL::int AS activity_number, NULL::text AS activity_name,
      NULL::text AS connector_key, NULL::text AS instrument_id, NULL::text AS scheduled_instance_id,
      NULL::text AS obligation_id
    WHERE false
  `
}

/**
 * El destino se deriva del registro, igual para la cola transversal y para los
 * paneles de cada submódulo. Agregar un conector no exige mantener un segundo
 * CASE en la UI.
 */
function connectorHrefSql(kind: PdtpExecutableInstanceKind): SQL {
  const branches = listPdtpExecutionConnectors().map((connector) => sql`
    WHEN ${connector.key}::text THEN CONCAT(
      ${connector.moduleHref}::text,
      '?faena=', ${kind === "scheduled" ? pdtpScheduledInstances.worksiteId : pdtpObligations.worksiteId},
      '&programa=', ${kind === "scheduled" ? pdtpScheduledInstances.programId : pdtpObligations.programId},
      '&actividad=', ${kind === "scheduled" ? pdtpScheduledInstances.activityId : pdtpObligations.activityId},
      ${kind === "scheduled" ? sql`'&instancia='` : sql`'&obligacion='`},
      ${kind === "scheduled" ? pdtpScheduledInstances.id : pdtpObligations.id},
      CASE
        WHEN ${pdtpActivityExecutionConfigs.accreditationBindingId} IS NULL THEN ''
        ELSE CONCAT('&instrumento=', ${pdtpActivityExecutionConfigs.accreditationBindingId})
      END
    )
  `)
  return sql`CASE ${pdtpActivityExecutionConfigs.destinationConnectorKey}
    ${sql.join(branches, sql` `)}
    ELSE '/prevencion/pdtp/obligaciones'
  END`
}

/**
 * Proyección canónica de trabajo ejecutable PDTP. La consume también
 * `/pendientes`: permisos, faena, asignación y estados no se reimplementan en
 * cada uno de los 14 conectores.
 */
export function pdtpExecutableInstancesSourceSql(
  session: Session,
  scope: WorksiteScope,
  options: { forQueue?: boolean } = {},
): SQL {
  const connectorKeys = listPdtpExecutionConnectors()
    .filter((connector) => session.user.permissions.includes(connector.executePermission))
    .map((connector) => connector.key)
  if (
    connectorKeys.length === 0
    || session.user.roles.length === 0
    || (options.forQueue && !canActOnQueueSource(session.user.permissions, "pdtp"))
    || scope.mode === "none"
  ) return emptyExecutableSource()

  const roleCondition = sql`EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(${pdtpActivities.responsibleSlugs}) AS slug
    WHERE slug.value IN (
      SELECT ${pdtpResponsibleCatalog.slug} FROM ${pdtpResponsibleCatalog}
      WHERE ${pdtpResponsibleCatalog.isActive}
        AND (
          ${inArray(pdtpResponsibleCatalog.roleName, session.user.roles)}
          OR ${inArray(pdtpResponsibleCatalog.operatedByRoleName, session.user.roles)}
        )
    )
  )`
  const chileToday = sql`(now() AT TIME ZONE 'America/Santiago')::date`
  const obligationEffectiveDate = sql`COALESCE(
    (${pdtpObligations.dueAt} AT TIME ZONE 'America/Santiago')::date,
    (${pdtpObligations.sourceOccurredAt} AT TIME ZONE 'America/Santiago')::date,
    (${pdtpObligations.createdAt} AT TIME ZONE 'America/Santiago')::date,
    ${chileToday}
  )`

  return sql`
    SELECT 'pdtp_scheduled_instance'::text AS source_type,
      ${pdtpScheduledInstances.id} AS source_id, 'execute'::text AS action_key, 'pdtp'::text AS module,
      CONCAT('N°', ${pdtpActivities.n}) AS code, LEFT(${pdtpActivities.activity}, 120) AS title,
      CONCAT(${pdtpActivities.responsibleDisplay}, ' · ', ${pdtpActivityExecutionConfigs.destinationConnectorKey}) AS subtitle,
      ${pdtpScheduledInstances.worksiteId} AS worksite_id, ${worksites.name} AS worksite_name,
      CASE WHEN ${pdtpScheduledInstances.scheduledFor} < ${chileToday} THEN 'overdue' ELSE ${pdtpScheduledInstances.status} END AS status,
      CASE
        WHEN ${pdtpScheduledInstances.scheduledFor} < ${chileToday} THEN 'Vencida'
        WHEN ${pdtpScheduledInstances.status} = 'in_progress' THEN 'En curso'
        WHEN ${pdtpScheduledInstances.status} = 'submitted' THEN 'Enviada a validación'
        ELSE 'Pendiente'
      END AS status_label,
      CASE WHEN ${pdtpScheduledInstances.scheduledFor} < ${chileToday} THEN 'high' ELSE 'normal' END AS priority,
      (${pdtpScheduledInstances.status} = 'submitted' AND ${pdtpActivityExecutionConfigs.completionPolicy} = 'source_approved') AS blocked,
      ${pdtpScheduledInstances.createdAt}::text AS created_at,
      ${pdtpScheduledInstances.scheduledFor}::text AS source_due_at,
      COALESCE(${pdtpScheduledInstances.responsibleUserId}, scheduled_assigned_to_me.user_id) AS native_assignee_user_id,
      COALESCE(responsible_user.name, scheduled_assigned_to_me.user_name) AS native_assignee_name,
      ${connectorHrefSql("scheduled")} AS href, 'Abrir actividad programada'::text AS cta_label,
      'scheduled'::text AS kind, ${pdtpScheduledInstances.programId} AS program_id,
      ${pdtpScheduledInstances.activityId} AS activity_id, ${pdtpActivities.n} AS activity_number,
      ${pdtpActivities.activity} AS activity_name,
      ${pdtpActivityExecutionConfigs.destinationConnectorKey} AS connector_key,
      ${pdtpActivityExecutionConfigs.accreditationBindingId} AS instrument_id,
      ${pdtpScheduledInstances.id} AS scheduled_instance_id, NULL::text AS obligation_id
    FROM ${pdtpScheduledInstances}
    INNER JOIN ${pdtpActivities} ON ${pdtpActivities.id} = ${pdtpScheduledInstances.activityId}
    INNER JOIN ${pdtpPrograms} ON ${pdtpPrograms.id} = ${pdtpScheduledInstances.programId}
    INNER JOIN ${pdtpActivityExecutionConfigs} ON ${pdtpActivityExecutionConfigs.activityId} = ${pdtpActivities.id}
    INNER JOIN ${worksites} ON ${worksites.id} = ${pdtpScheduledInstances.worksiteId} AND ${worksites.isActive}
    LEFT JOIN ${users} AS responsible_user ON responsible_user.id = ${pdtpScheduledInstances.responsibleUserId}
    LEFT JOIN LATERAL (
      SELECT ${pdtpActivityWorksiteAssignees.userId} AS user_id, scheduled_assignee.name AS user_name
      FROM ${pdtpActivityWorksiteAssignees}
      INNER JOIN ${users} AS scheduled_assignee ON scheduled_assignee.id = ${pdtpActivityWorksiteAssignees.userId}
      WHERE ${pdtpActivityWorksiteAssignees.activityId} = ${pdtpActivities.id}
        AND ${pdtpActivityWorksiteAssignees.worksiteId} = ${pdtpScheduledInstances.worksiteId}
        AND ${pdtpActivityWorksiteAssignees.userId} = ${session.user.id}
        AND ${pdtpActivityWorksiteAssignees.validFrom} <= ${pdtpScheduledInstances.scheduledFor}
        AND (${pdtpActivityWorksiteAssignees.validUntil} IS NULL OR ${pdtpActivityWorksiteAssignees.validUntil} >= ${pdtpScheduledInstances.scheduledFor})
      ORDER BY ${pdtpActivityWorksiteAssignees.validFrom} DESC
      LIMIT 1
    ) scheduled_assigned_to_me ON TRUE
    WHERE ${scopeCondition(scope, pdtpScheduledInstances.worksiteId)}
      AND ${pdtpPrograms.status} = 'active'
      AND ${pdtpActivities.status} = 'active'
      AND jsonb_extract_path_text(${pdtpActivities.scheduleDefinition}, 'kind') <> 'legacy_grid'
      AND (${pdtpPrograms.activatedAt} IS NULL OR ${pdtpScheduledInstances.scheduledFor} >= (${pdtpPrograms.activatedAt} AT TIME ZONE 'America/Santiago')::date)
      AND ${pdtpScheduledInstances.status} IN ('pending', 'in_progress', 'submitted')
      AND ${inArray(pdtpActivityExecutionConfigs.destinationConnectorKey, connectorKeys)}
      AND NOT EXISTS (
        SELECT 1 FROM ${pdtpActivityWorksiteExclusions}
        WHERE ${pdtpActivityWorksiteExclusions.activityId} = ${pdtpActivities.id}
          AND ${pdtpActivityWorksiteExclusions.worksiteId} = ${pdtpScheduledInstances.worksiteId}
      )
      AND ${roleCondition}
      AND (
        ${pdtpScheduledInstances.responsibleUserId} = ${session.user.id}
        OR (
          ${pdtpScheduledInstances.responsibleUserId} IS NULL
          AND (
            scheduled_assigned_to_me.user_id IS NOT NULL
            OR NOT EXISTS (
              SELECT 1 FROM ${pdtpActivityWorksiteAssignees}
              WHERE ${pdtpActivityWorksiteAssignees.activityId} = ${pdtpActivities.id}
                AND ${pdtpActivityWorksiteAssignees.worksiteId} = ${pdtpScheduledInstances.worksiteId}
                AND ${pdtpActivityWorksiteAssignees.validFrom} <= ${pdtpScheduledInstances.scheduledFor}
                AND (${pdtpActivityWorksiteAssignees.validUntil} IS NULL OR ${pdtpActivityWorksiteAssignees.validUntil} >= ${pdtpScheduledInstances.scheduledFor})
            )
          )
        )
      )

    UNION ALL

    SELECT 'pdtp_obligation'::text AS source_type,
      ${pdtpObligations.id} AS source_id, 'execute'::text AS action_key, 'pdtp'::text AS module,
      CONCAT('N°', ${pdtpActivities.n}) AS code, LEFT(${pdtpActivities.activity}, 120) AS title,
      CONCAT(${pdtpActivities.responsibleDisplay}, ' · ', ${pdtpActivityExecutionConfigs.destinationConnectorKey}) AS subtitle,
      ${pdtpObligations.worksiteId} AS worksite_id, ${worksites.name} AS worksite_name,
      CASE
        WHEN ${pdtpObligations.status} = 'pending' AND ${pdtpObligations.dueAt} < now() THEN 'overdue'
        ELSE ${pdtpObligations.status}
      END AS status,
      CASE
        WHEN ${pdtpObligations.status} = 'reported' THEN 'Enviada a validación'
        WHEN ${pdtpObligations.status} = 'overdue' OR (${pdtpObligations.status} = 'pending' AND ${pdtpObligations.dueAt} < now()) THEN 'Vencida'
        ELSE 'Pendiente'
      END AS status_label,
      CASE WHEN ${pdtpObligations.status} = 'overdue' OR (${pdtpObligations.status} = 'pending' AND ${pdtpObligations.dueAt} < now()) THEN 'high' ELSE 'normal' END AS priority,
      (${pdtpObligations.status} = 'reported') AS blocked,
      ${pdtpObligations.createdAt}::text AS created_at,
      LEFT(${pdtpObligations.dueAt}::text, 10) AS source_due_at,
      assigned_to_me.user_id AS native_assignee_user_id, assigned_to_me.user_name AS native_assignee_name,
      ${connectorHrefSql("obligation")} AS href, 'Atender obligación'::text AS cta_label,
      'obligation'::text AS kind, ${pdtpObligations.programId} AS program_id,
      ${pdtpObligations.activityId} AS activity_id, ${pdtpActivities.n} AS activity_number,
      ${pdtpActivities.activity} AS activity_name,
      ${pdtpActivityExecutionConfigs.destinationConnectorKey} AS connector_key,
      ${pdtpActivityExecutionConfigs.accreditationBindingId} AS instrument_id,
      NULL::text AS scheduled_instance_id, ${pdtpObligations.id} AS obligation_id
    FROM ${pdtpObligations}
    INNER JOIN ${pdtpActivities} ON ${pdtpActivities.id} = ${pdtpObligations.activityId}
    INNER JOIN ${pdtpPrograms} ON ${pdtpPrograms.id} = ${pdtpObligations.programId}
    INNER JOIN ${pdtpActivityExecutionConfigs} ON ${pdtpActivityExecutionConfigs.activityId} = ${pdtpActivities.id}
    INNER JOIN ${worksites} ON ${worksites.id} = ${pdtpObligations.worksiteId} AND ${worksites.isActive}
    LEFT JOIN LATERAL (
      SELECT ${pdtpActivityWorksiteAssignees.userId} AS user_id, obligation_user.name AS user_name
      FROM ${pdtpActivityWorksiteAssignees}
      INNER JOIN ${users} AS obligation_user ON obligation_user.id = ${pdtpActivityWorksiteAssignees.userId}
      WHERE ${pdtpActivityWorksiteAssignees.activityId} = ${pdtpActivities.id}
        AND ${pdtpActivityWorksiteAssignees.worksiteId} = ${pdtpObligations.worksiteId}
        AND ${pdtpActivityWorksiteAssignees.userId} = ${session.user.id}
        AND ${pdtpActivityWorksiteAssignees.validFrom} <= ${obligationEffectiveDate}
        AND (${pdtpActivityWorksiteAssignees.validUntil} IS NULL OR ${pdtpActivityWorksiteAssignees.validUntil} >= ${obligationEffectiveDate})
      ORDER BY ${pdtpActivityWorksiteAssignees.validFrom} DESC
      LIMIT 1
    ) assigned_to_me ON TRUE
    WHERE ${scopeCondition(scope, pdtpObligations.worksiteId)}
      AND ${pdtpPrograms.status} = 'active'
      AND ${pdtpActivities.status} = 'active'
      AND ${pdtpObligations.status} IN ('pending', 'overdue', 'reported')
      AND ${inArray(pdtpActivityExecutionConfigs.destinationConnectorKey, connectorKeys)}
      AND NOT EXISTS (
        SELECT 1 FROM ${pdtpActivityWorksiteExclusions}
        WHERE ${pdtpActivityWorksiteExclusions.activityId} = ${pdtpActivities.id}
          AND ${pdtpActivityWorksiteExclusions.worksiteId} = ${pdtpObligations.worksiteId}
      )
      AND ${roleCondition}
      AND (
        assigned_to_me.user_id IS NOT NULL
        OR NOT EXISTS (
          SELECT 1 FROM ${pdtpActivityWorksiteAssignees}
          WHERE ${pdtpActivityWorksiteAssignees.activityId} = ${pdtpActivities.id}
            AND ${pdtpActivityWorksiteAssignees.worksiteId} = ${pdtpObligations.worksiteId}
            AND ${pdtpActivityWorksiteAssignees.validFrom} <= ${obligationEffectiveDate}
            AND (${pdtpActivityWorksiteAssignees.validUntil} IS NULL OR ${pdtpActivityWorksiteAssignees.validUntil} >= ${obligationEffectiveDate})
        )
      )
  `
}

/** Proyección de la misma fuente con el contrato de columnas de la cola. */
export function pdtpExecutableInstancesQueueSql(session: Session, scope: WorksiteScope): SQL {
  const source = pdtpExecutableInstancesSourceSql(session, scope, { forQueue: true })
  return sql`
    SELECT source_type, source_id, action_key, module, code, title, subtitle,
      worksite_id, worksite_name, status, status_label, priority, blocked,
      created_at, source_due_at, native_assignee_user_id, native_assignee_name,
      href, cta_label
    FROM (${source}) AS pdtp_executable_source
    WHERE kind = 'obligation'
      OR source_due_at <= TO_CHAR(${sql`(now() AT TIME ZONE 'America/Santiago')::date`} + 30, 'YYYY-MM-DD')
  `
}

function validateFilters(filters: ListPdtpExecutableInstancesFilters) {
  for (const [label, value] of [["desde", filters.from], ["hasta", filters.to]] as const) {
    if (value && !DATE_PATTERN.test(value)) throw new Error(`La fecha ${label} no es válida.`)
  }
  if (filters.from && filters.to && filters.from > filters.to) throw new Error("El período de actividades PDTP no es válido.")
  const statuses = filters.statuses ?? (filters.status ? [filters.status] : undefined)
  if (statuses?.some((status) => !OPEN_STATUSES.includes(status))) throw new Error("El estado solicitado no es ejecutable.")
}

/** Lista instancias y obligaciones autorizadas en una sola consulta, sin N+1. */
export async function listPdtpExecutableInstances(
  session: Session,
  filters: ListPdtpExecutableInstancesFilters = {},
): Promise<PdtpExecutableInstanceRow[]> {
  validateFilters(filters)
  const connector = filters.connectorKey ? getPdtpExecutionConnector(filters.connectorKey) : undefined
  if (filters.connectorKey && (!connector || !session.user.permissions.includes(connector.executePermission))) return []

  const scope = resolveWorksiteScope(session)
  if (scope.mode === "none") return []
  const source = pdtpExecutableInstancesSourceSql(session, scope)
  const conditions: SQL[] = [sql`true`]
  if (filters.connectorKey) conditions.push(sql`connector_key = ${filters.connectorKey}`)
  if (filters.worksiteIds?.length) conditions.push(sql`worksite_id IN (${sql.join(filters.worksiteIds.map((id) => sql`${id}`), sql`, `)})`)
  if (filters.from) conditions.push(sql`source_due_at >= ${filters.from}`)
  if (filters.to) conditions.push(sql`source_due_at <= ${filters.to}`)
  const statuses = filters.statuses ?? (filters.status ? [filters.status] : undefined)
  if (statuses?.length) conditions.push(sql`status IN (${sql.join(statuses.map((status) => sql`${status}`), sql`, `)})`)
  if (filters.assignedToMe) conditions.push(sql`native_assignee_user_id = ${session.user.id}`)

  const result = await db.execute(sql`
    SELECT * FROM (${source}) AS pdtp_executable_source
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY source_due_at ASC NULLS LAST, activity_number ASC, source_id ASC
  `)
  const rows = ((result as unknown as { rows?: ExecutableSqlRow[] }).rows ?? result) as unknown as ExecutableSqlRow[]
  return rows.map((row) => ({
    id: row.source_id,
    kind: row.kind,
    programId: row.program_id,
    activityId: row.activity_id,
    activityNumber: Number(row.activity_number),
    activityName: row.activity_name,
    activityTitle: row.activity_name,
    worksiteId: row.worksite_id,
    worksiteName: row.worksite_name,
    connectorKey: row.connector_key,
    connectorLabel: getPdtpExecutionConnector(row.connector_key)?.label ?? row.connector_key,
    status: row.status,
    derivedStatus: row.status === "overdue"
      ? "overdue"
      : row.status === "in_progress"
        ? "in_progress"
        : row.status === "submitted" || row.status === "reported"
          ? "in_progress"
          : "pending",
    statusLabel: row.status_label,
    dueAt: row.source_due_at,
    scheduledFor: row.kind === "scheduled" ? row.source_due_at : null,
    createdAt: row.created_at,
    responsibleUserId: row.native_assignee_user_id,
    responsibleName: row.native_assignee_name,
    assignedToMe: row.native_assignee_user_id === session.user.id,
    instrumentId: row.instrument_id,
    scheduledInstanceId: row.scheduled_instance_id,
    obligationId: row.obligation_id,
    href: row.href,
    startHref: row.href,
    ctaLabel: row.cta_label,
  }))
}
