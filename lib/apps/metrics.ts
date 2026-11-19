/**
 * lib/apps/metrics.ts — Agregación pura de los indicadores de cada app.
 *
 * Recibe filas ya consultadas (por `entity_type`, por job) y las junta por app
 * con el catálogo de `lib/apps/catalog.ts`. Sin base de datos, para poder
 * probar el reparto y el estado de las integraciones con datos armados a mano.
 */
import { APPS, APP_CRON_JOBS, appForEntityType, type AppCronJob, type AppDef } from "./catalog"

/** Semanas de la línea de tendencia. */
export const TREND_WEEKS = 12
/** Ventana de «movimientos» y «usuarios activos». */
export const ACTIVITY_WINDOW_DAYS = 30
/** Una app sin movimientos en este plazo se marca «sin uso». */
export const IDLE_AFTER_DAYS = 30

export interface EntityActivityRow {
  entityType: string
  /** Inicio de la semana (lunes), `YYYY-MM-DD`. */
  weekStart:  string
  /** Movimientos de esa semana. */
  weekCount:  number
  /** Movimientos de esa semana que caen dentro de la ventana de 30 días. */
  windowCount: number
}

export interface EntityUserRow { entityType: string; userId: string }
export interface EntityLastRow { entityType: string; lastAt: string }
export interface ModuleAccessRow { moduleId: string; users: number }
/** Visitas de la ventana por app (`app_visits`). */
export interface AppVisitRow { moduleId: string; visits: number; lastVisitAt: string | null }
/** Pares persona–app con al menos una visita en la ventana. */
export interface AppVisitorRow { moduleId: string; userId: string }

export interface CronJobRow {
  jobName:       string
  lastStartedAt: string
  lastOutcome:   string
  lastDetail:    string | null
  /** Última corrida `success` o `skipped` (un salto por candado es un job vivo). */
  lastAliveAt:   string | null
  /** Corridas fallidas en los últimos 7 días. */
  failures7d:    number
}

export type IntegrationStatus = "ok" | "failing" | "stale" | "never"

export interface IntegrationHealth extends AppCronJob {
  status:        IntegrationStatus
  lastStartedAt: string | null
  lastAliveAt:   string | null
  lastDetail:    string | null
  failures7d:    number
}

export interface AppOverview extends AppDef {
  enabled:          boolean
  usersWithAccess:  number
  /** Personas que abrieron la app o registraron algo en ella en la ventana. */
  activeUsers:      number
  /** Personas con movimientos (altas o cambios) en la ventana. */
  movementUsers:    number
  movements:        number
  /** Entradas a la app en la ventana (ver `lib/services/app-visits.ts`). */
  visits:           number
  /** Movimientos por semana, de la más antigua a la actual (`TREND_WEEKS` puntos). */
  trend:            number[]
  /** Lo más reciente entre el último movimiento y la última visita. */
  lastActivityAt:   string | null
  lastMovementAt:   string | null
  idle:             boolean
  integrations:     IntegrationHealth[]
  /** Peor estado de sus integraciones; `none` si no tiene. */
  integrationStatus: IntegrationStatus | "none"
}

export interface AppsOverview {
  apps: AppOverview[]
  /** Movimientos de la ventana cuyo `entity_type` no tiene app asignada. */
  unassigned: { movements: number; entityTypes: string[] }
  /** Personas distintas que abrieron alguna app o registraron algo en la ventana. */
  totalActiveUsers: number
  /** Primer día con visitas registradas; null si todavía no hay ninguna. */
  visitsTrackedSince: string | null
  generatedAt: string
}

const STATUS_RANK: Record<IntegrationStatus, number> = { failing: 3, stale: 2, never: 1, ok: 0 }

/**
 * Estado de un job. Falla manda sobre atraso: la última corrida fallida es lo
 * que hay que mirar primero. `never` no es una alerta: en un ambiente donde el
 * cron no está desplegado (dev) todos los jobs estarían «detenidos».
 */
export function integrationStatus(job: AppCronJob, row: CronJobRow | undefined, now: Date): IntegrationStatus {
  if (!row) return "never"
  if (row.lastOutcome === "failed") return "failing"
  const aliveAt = row.lastAliveAt ? new Date(row.lastAliveAt).getTime() : null
  if (aliveAt === null || now.getTime() - aliveAt > job.maxAgeHours * 3_600_000) return "stale"
  return "ok"
}

export function worstStatus(statuses: IntegrationStatus[]): IntegrationStatus | "none" {
  if (statuses.length === 0) return "none"
  return statuses.reduce((worst, status) => (STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst))
}

/** Lunes de la semana de `date`, en `YYYY-MM-DD` (calendario UTC del instante dado). */
export function weekStartOf(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const offset = (day.getUTCDay() + 6) % 7
  day.setUTCDate(day.getUTCDate() - offset)
  return day.toISOString().slice(0, 10)
}

/** Los `TREND_WEEKS` lunes que terminan en la semana de `currentWeekStart`. */
export function trendWeeks(currentWeekStart: string): string[] {
  const base = new Date(`${currentWeekStart}T00:00:00Z`)
  return Array.from({ length: TREND_WEEKS }, (_, index) => {
    const week = new Date(base)
    week.setUTCDate(week.getUTCDate() - 7 * (TREND_WEEKS - 1 - index))
    return week.toISOString().slice(0, 10)
  })
}

function latest(left: string | null, right: string | null): string | null {
  if (!left) return right
  if (!right) return left
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right
}

export function buildAppsOverview(input: {
  activity:        EntityActivityRow[]
  users:           EntityUserRow[]
  last:            EntityLastRow[]
  access:          ModuleAccessRow[]
  cron:            CronJobRow[]
  visits?:         AppVisitRow[]
  visitors?:       AppVisitorRow[]
  visitsTrackedSince?: string | null
  enabledModuleIds: Set<string>
  /** Lunes de la semana en curso, en la zona del negocio. */
  currentWeekStart: string
  now:             Date
}): AppsOverview {
  const weeks = trendWeeks(input.currentWeekStart)
  const weekIndex = new Map(weeks.map((week, index) => [week, index]))

  const movements = new Map<string, number>()
  const trend = new Map<string, number[]>()
  const unassignedTypes = new Set<string>()
  let unassignedMovements = 0

  for (const row of input.activity) {
    const appId = appForEntityType(row.entityType)
    if (!appId) {
      if (row.windowCount > 0) {
        unassignedMovements += row.windowCount
        unassignedTypes.add(row.entityType)
      }
      continue
    }
    movements.set(appId, (movements.get(appId) ?? 0) + row.windowCount)
    const index = weekIndex.get(row.weekStart)
    if (index !== undefined) {
      const series = trend.get(appId) ?? Array<number>(TREND_WEEKS).fill(0)
      series[index] = (series[index] ?? 0) + row.weekCount
      trend.set(appId, series)
    }
  }

  const activeUsers = new Map<string, Set<string>>()
  const everyActiveUser = new Set<string>()
  for (const row of input.users) {
    everyActiveUser.add(row.userId)
    const appId = appForEntityType(row.entityType)
    if (!appId) continue
    const set = activeUsers.get(appId) ?? new Set<string>()
    set.add(row.userId)
    activeUsers.set(appId, set)
  }

  const movementUsers = new Map([...activeUsers].map(([appId, set]) => [appId, set.size]))
  for (const row of input.visitors ?? []) {
    everyActiveUser.add(row.userId)
    const set = activeUsers.get(row.moduleId) ?? new Set<string>()
    set.add(row.userId)
    activeUsers.set(row.moduleId, set)
  }
  const visitsByApp = new Map((input.visits ?? []).map((row) => [row.moduleId, row]))
  const trackedSince = input.visitsTrackedSince ?? null

  const lastActivity = new Map<string, string>()
  for (const row of input.last) {
    const appId = appForEntityType(row.entityType)
    if (!appId) continue
    const current = lastActivity.get(appId)
    if (!current || new Date(row.lastAt).getTime() > new Date(current).getTime()) lastActivity.set(appId, row.lastAt)
  }

  const access = new Map(input.access.map((row) => [row.moduleId, row.users]))
  const cronByJob = new Map(input.cron.map((row) => [row.jobName, row]))
  const idleBefore = input.now.getTime() - IDLE_AFTER_DAYS * 86_400_000

  const apps = APPS.map((app): AppOverview => {
    const integrations = APP_CRON_JOBS.filter((job) => job.appId === app.id).map((job): IntegrationHealth => {
      const row = cronByJob.get(job.jobName)
      return {
        ...job,
        status: integrationStatus(job, row, input.now),
        lastStartedAt: row?.lastStartedAt ?? null,
        lastAliveAt: row?.lastAliveAt ?? null,
        lastDetail: row?.lastDetail ?? null,
        failures7d: row?.failures7d ?? 0,
      }
    })
    const lastMovementAt = lastActivity.get(app.id) ?? null
    const visit = visitsByApp.get(app.id)
    const lastActivityAt = latest(lastMovementAt, visit?.lastVisitAt ?? null)
    const recentlyUsed = lastActivityAt !== null && new Date(lastActivityAt).getTime() >= idleBefore
    // Sin movimientos ni visitas en 30 días. Una app de sólo lectura sólo puede
    // estar «sin uso» cuando las visitas llevan 30 días registrándose: antes, su
    // cero no significa nada.
    const visitsCoverWindow = trackedSince !== null && new Date(`${trackedSince}T00:00:00Z`).getTime() <= idleBefore
    const idle = !recentlyUsed && (!app.activityNote || visitsCoverWindow)
    return {
      ...app,
      enabled: input.enabledModuleIds.has(app.id),
      usersWithAccess: access.get(app.id) ?? 0,
      activeUsers: activeUsers.get(app.id)?.size ?? 0,
      movementUsers: movementUsers.get(app.id) ?? 0,
      movements: movements.get(app.id) ?? 0,
      visits: visit?.visits ?? 0,
      trend: trend.get(app.id) ?? Array<number>(TREND_WEEKS).fill(0),
      lastActivityAt,
      lastMovementAt,
      idle,
      integrations,
      integrationStatus: worstStatus(integrations.map((integration) => integration.status)),
    }
  })

  return {
    apps,
    unassigned: { movements: unassignedMovements, entityTypes: [...unassignedTypes].sort() },
    totalActiveUsers: everyActiveUser.size,
    visitsTrackedSince: trackedSince,
    generatedAt: input.now.toISOString(),
  }
}
