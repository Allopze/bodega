/**
 * lib/services/apps-overview.ts — Indicadores de uso y salud de cada app (TI › Apps).
 *
 * Todo sale de datos que la plataforma ya registra:
 *
 * - `audit_log`: movimientos (altas, cambios, cambios de estado) y quién los hizo.
 *   No registra visitas, así que una app de sólo lectura no muestra actividad;
 *   el catálogo lo dice con `activityNote` en vez de pintarla como abandonada.
 * - Permisos efectivos (roles + permisos directos): cuántas personas pueden
 *   entrar a cada app.
 * - `cron_runs`: el estado de las integraciones y tareas programadas de la app.
 *
 * Son cifras agregadas: ninguna consulta devuelve el contenido de un registro.
 */
import { and, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm"
import { db } from "@/db"
import { auditLog, cronRuns, permissions, rolePermissions, userPermissions, userRoles, users, worksites } from "@/db/schema"
import { getNavigationToggleState } from "@/lib/services/module-toggles"
import { todayInChile } from "@/lib/utils"
import { APP_CRON_JOBS, appForEntityType, cronJobsForApp } from "@/lib/apps/catalog"
import {
  ACTIVITY_WINDOW_DAYS,
  TREND_WEEKS,
  buildAppsOverview,
  weekStartOf,
  type AppsOverview,
  type CronJobRow,
} from "@/lib/apps/metrics"

const DAY_MS = 86_400_000
/** «Última actividad» mira hasta un año atrás; más antiguo se muestra como «Más de un año». */
const LAST_ACTIVITY_LOOKBACK_DAYS = 365

const chileWeek = sql<string>`to_char(date_trunc('week', ${auditLog.createdAt} AT TIME ZONE 'America/Santiago'), 'YYYY-MM-DD')`

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString()
}

async function readCronRows(now: Date): Promise<CronJobRow[]> {
  const jobNames = APP_CRON_JOBS.map((job) => job.jobName)
  const since = isoDaysAgo(now, 30)
  const failuresSince = isoDaysAgo(now, 7)
  const [latest, aggregates] = await Promise.all([
    db.selectDistinctOn([cronRuns.jobName], {
      jobName: cronRuns.jobName,
      startedAt: cronRuns.startedAt,
      outcome: cronRuns.outcome,
      detail: cronRuns.detail,
    })
      .from(cronRuns)
      .where(and(inArray(cronRuns.jobName, jobNames), gte(cronRuns.startedAt, since)))
      .orderBy(cronRuns.jobName, desc(cronRuns.startedAt)),
    db.select({
      jobName: cronRuns.jobName,
      lastAliveAt: sql<string | null>`max(${cronRuns.startedAt}) filter (where ${cronRuns.outcome} in ('success', 'skipped'))`,
      failures7d: sql<number>`(count(*) filter (where ${cronRuns.outcome} = 'failed' and ${cronRuns.startedAt} >= ${failuresSince}))::int`,
    })
      .from(cronRuns)
      .where(and(inArray(cronRuns.jobName, jobNames), gte(cronRuns.startedAt, since)))
      .groupBy(cronRuns.jobName),
  ])
  const byJob = new Map(aggregates.map((row) => [row.jobName, row]))
  return latest.map((row) => ({
    jobName: row.jobName,
    lastStartedAt: row.startedAt,
    lastOutcome: row.outcome,
    lastDetail: row.detail,
    lastAliveAt: byJob.get(row.jobName)?.lastAliveAt ?? null,
    failures7d: byJob.get(row.jobName)?.failures7d ?? 0,
  }))
}

/**
 * Personas activas con al menos un permiso del módulo, por rol o directo. Una
 * cuenta temporal vencida (o sin fecha de término) no cuenta, igual que en
 * `lib/auth/temporary-account.ts`.
 */
async function readModuleAccess(): Promise<Array<{ moduleId: string; users: number }>> {
  const activeUser = and(
    eq(users.isActive, true),
    or(eq(users.isTemporary, false), and(isNotNull(users.validUntil), sql`${users.validUntil} > now()`)),
  )
  const [byRole, direct] = await Promise.all([
    db.selectDistinct({ moduleId: permissions.module, userId: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(activeUser),
    db.selectDistinct({ moduleId: permissions.module, userId: users.id })
      .from(users)
      .innerJoin(userPermissions, eq(userPermissions.userId, users.id))
      .innerJoin(permissions, eq(permissions.id, userPermissions.permissionId))
      .where(activeUser),
  ])
  const byModule = new Map<string, Set<string>>()
  for (const row of [...byRole, ...direct]) {
    const set = byModule.get(row.moduleId) ?? new Set<string>()
    set.add(row.userId)
    byModule.set(row.moduleId, set)
  }
  return [...byModule].map(([moduleId, set]) => ({ moduleId, users: set.size }))
}

export async function getAppsOverview(now: Date = new Date()): Promise<AppsOverview> {
  const currentWeekStart = weekStartOf(new Date(`${todayInChile(now)}T00:00:00Z`))
  // Una semana de holgura: el primer lunes de la serie puede caer antes de
  // `now - 12 semanas` según el día de la semana en que se mire.
  const trendSince = isoDaysAgo(now, (TREND_WEEKS + 1) * 7)
  const windowStart = isoDaysAgo(now, ACTIVITY_WINDOW_DAYS)

  const [activity, userRows, last, access, cron, toggles] = await Promise.all([
    db.select({
      entityType: auditLog.entityType,
      weekStart: chileWeek,
      weekCount: sql<number>`count(*)::int`,
      windowCount: sql<number>`(count(*) filter (where ${auditLog.createdAt} >= ${windowStart}))::int`,
    })
      .from(auditLog)
      .where(gte(auditLog.createdAt, trendSince))
      .groupBy(auditLog.entityType, chileWeek),
    db.selectDistinct({ entityType: auditLog.entityType, userId: sql<string>`${auditLog.userId}` })
      .from(auditLog)
      .where(and(gte(auditLog.createdAt, windowStart), isNotNull(auditLog.userId))),
    db.select({ entityType: auditLog.entityType, lastAt: sql<string>`max(${auditLog.createdAt})` })
      .from(auditLog)
      .where(gte(auditLog.createdAt, isoDaysAgo(now, LAST_ACTIVITY_LOOKBACK_DAYS)))
      .groupBy(auditLog.entityType),
    readModuleAccess(),
    readCronRows(now),
    getNavigationToggleState(),
  ])

  return buildAppsOverview({
    activity: activity.map((row) => ({ ...row, weekCount: Number(row.weekCount), windowCount: Number(row.windowCount) })),
    users: userRows,
    last,
    access,
    cron,
    enabledModuleIds: toggles.enabledModuleIds,
    currentWeekStart,
    now,
  })
}

// ── Detalle de una app ───────────────────────────────────────────────────────

export interface AppWorksiteUsage { worksiteId: string | null; worksiteName: string; movements: number }
export interface AppCronRun { jobName: string; startedAt: string; outcome: string; durationMs: number | null; detail: string | null }

/**
 * Movimientos de la app en la ventana, por faena. `scope` es el alcance de
 * faenas de quien mira (`serviceWorksiteScope`): un usuario acotado ve sólo sus
 * faenas, y los movimientos sin faena (una OC, un usuario) sólo los ve quien
 * tiene alcance global.
 */
export async function getAppWorksiteUsage(appId: string, scope: string[] | "all", now: Date = new Date()): Promise<AppWorksiteUsage[]> {
  if (scope !== "all" && scope.length === 0) return []
  const rows = await db.select({
    entityType: auditLog.entityType,
    worksiteId: auditLog.worksiteId,
    worksiteName: worksites.name,
    movements: sql<number>`count(*)::int`,
  })
    .from(auditLog)
    .leftJoin(worksites, eq(worksites.id, auditLog.worksiteId))
    .where(and(
      gte(auditLog.createdAt, isoDaysAgo(now, ACTIVITY_WINDOW_DAYS)),
      scope === "all" ? undefined : inArray(auditLog.worksiteId, scope),
    ))
    .groupBy(auditLog.entityType, auditLog.worksiteId, worksites.name)

  const byWorksite = new Map<string, AppWorksiteUsage>()
  for (const row of rows) {
    if (appForEntityType(row.entityType) !== appId) continue
    const key = row.worksiteId ?? "none"
    const entry = byWorksite.get(key) ?? {
      worksiteId: row.worksiteId,
      worksiteName: row.worksiteName ?? "Sin faena",
      movements: 0,
    }
    entry.movements += Number(row.movements)
    byWorksite.set(key, entry)
  }
  return [...byWorksite.values()].sort((left, right) => right.movements - left.movements)
}

/** Últimas corridas de cada job de la app (hasta `perJob` por job), la más reciente primero. */
export async function getAppCronRuns(appId: string, perJob = 10): Promise<AppCronRun[]> {
  const jobNames = cronJobsForApp(appId).map((job) => job.jobName)
  const perJobRuns = await Promise.all(jobNames.map((jobName) => db.select({
    jobName: cronRuns.jobName,
    startedAt: cronRuns.startedAt,
    outcome: cronRuns.outcome,
    durationMs: cronRuns.durationMs,
    detail: cronRuns.detail,
  })
    .from(cronRuns)
    .where(eq(cronRuns.jobName, jobName))
    .orderBy(desc(cronRuns.startedAt))
    .limit(perJob)))
  return perJobRuns.flat().sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())
}
