/**
 * lib/services/integrations-health.ts — Salud de las integraciones y tareas
 * programadas (TI › Integraciones).
 *
 * Todo sale de `cron_runs`: la última corrida de cada job, la última corrida
 * viva y las fallas de la semana. Son cifras agregadas; el detalle de una
 * corrida es el texto corto que el propio job dejó al terminar.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { cronRuns } from "@/db/schema"
import { findApp } from "@/lib/apps/catalog"
import { getModuleLabel } from "@/lib/module-labels"
import { INTEGRATION_JOBS } from "@/lib/integrations/health-catalog"
import { integrationStatus, type CronJobRow, type IntegrationHealth } from "@/lib/integrations/health"

const DAY_MS = 86_400_000

export interface IntegrationGroup {
  moduleId:    string
  moduleLabel: string
  jobs:        IntegrationHealth[]
}

export interface IntegrationRun {
  jobName:    string
  startedAt:  string
  outcome:    string
  durationMs: number | null
  detail:     string | null
}

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString()
}

async function readCronRows(now: Date): Promise<CronJobRow[]> {
  const jobNames = INTEGRATION_JOBS.map((job) => job.jobName)
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
    failures7d: Number(byJob.get(row.jobName)?.failures7d ?? 0),
  }))
}

/**
 * Estado de cada integración, agrupado por módulo. Los grupos salen en el orden
 * del menú (área, luego registro) y los jobs, en el del catálogo.
 */
export async function getIntegrationsHealth(now: Date = new Date()): Promise<IntegrationGroup[]> {
  const rows = new Map((await readCronRows(now)).map((row) => [row.jobName, row]))
  const groups = new Map<string, IntegrationGroup>()
  for (const job of INTEGRATION_JOBS) {
    const row = rows.get(job.jobName)
    const health: IntegrationHealth = {
      ...job,
      status: integrationStatus(job, row, now),
      lastStartedAt: row?.lastStartedAt ?? null,
      lastAliveAt: row?.lastAliveAt ?? null,
      lastDetail: row?.lastDetail ?? null,
      failures7d: row?.failures7d ?? 0,
    }
    const group = groups.get(job.moduleId) ?? { moduleId: job.moduleId, moduleLabel: getModuleLabel(job.moduleId), jobs: [] }
    group.jobs.push(health)
    groups.set(job.moduleId, group)
  }
  const order = (moduleId: string) => findApp(moduleId)?.areaOrder ?? Number.MAX_SAFE_INTEGER
  return [...groups.values()].sort((left, right) => order(left.moduleId) - order(right.moduleId))
}

/** Últimas corridas de un job (hasta `limit`), la más reciente primero. */
export async function getIntegrationRuns(jobName: string, limit = 10): Promise<IntegrationRun[]> {
  return db.select({
    jobName: cronRuns.jobName,
    startedAt: cronRuns.startedAt,
    outcome: cronRuns.outcome,
    durationMs: cronRuns.durationMs,
    detail: cronRuns.detail,
  })
    .from(cronRuns)
    .where(eq(cronRuns.jobName, jobName))
    .orderBy(desc(cronRuns.startedAt))
    .limit(limit)
}
