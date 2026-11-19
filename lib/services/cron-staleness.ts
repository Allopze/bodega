/**
 * lib/services/cron-staleness.ts
 *
 * PRV-14 (auditoría de production readiness 2026-09-28): ¿qué job de Prevención
 * dejó de correr? Un job que no corre no falla, así que ningún aviso de falla
 * lo detecta; sólo lo delata la ausencia de corridas exitosas en `cron_runs`.
 *
 * La cadencia esperada sale del crontab (`docker-compose.yml`, servicio
 * `cron`) con margen: un job diario se da por detenido a las 26 h, uno horario
 * a las 3 h, el semanal a los 8 días.
 */
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm"
import { db } from "@/db"
import { cronRuns } from "@/db/schema"
import { PREVENTION_CRON_MAX_AGE_HOURS } from "@/lib/cron-cadence"

export { PREVENTION_CRON_MAX_AGE_HOURS }

export type StaleCronJob = { jobName: string; lastSuccessAt: string | null; maxAgeHours: number }

/** `skipped` cuenta como vivo: se salta porque otra corrida del mismo job tenía el candado. */
export async function findStalePreventionCronJobs(now: Date = new Date()): Promise<StaleCronJob[]> {
  const jobNames = Object.keys(PREVENTION_CRON_MAX_AGE_HOURS)
  const maxWindowHours = Math.max(...Object.values(PREVENTION_CRON_MAX_AGE_HOURS))
  const since = new Date(now.getTime() - 2 * maxWindowHours * 3_600_000).toISOString()
  const rows = await db.selectDistinctOn([cronRuns.jobName], { jobName: cronRuns.jobName, startedAt: cronRuns.startedAt })
    .from(cronRuns)
    .where(and(
      inArray(cronRuns.jobName, jobNames),
      inArray(cronRuns.outcome, ["success", "skipped"]),
      gte(cronRuns.startedAt, since),
    ))
    .orderBy(cronRuns.jobName, desc(cronRuns.startedAt))
  const lastSuccess = new Map(rows.map((row) => [row.jobName, row.startedAt]))

  // Un job que nunca corrió se reporta sólo cuando esta vigilancia lleva más
  // que la cadencia de ese job funcionando: el día que se despliega un job
  // nuevo todavía no le tocó correr, y avisarlo sería ruido.
  const [firstWatch] = await db.select({ startedAt: cronRuns.startedAt }).from(cronRuns)
    .where(eq(cronRuns.jobName, "prevention-cron-staleness"))
    .orderBy(asc(cronRuns.startedAt)).limit(1)
  const watchingForMs = firstWatch ? now.getTime() - new Date(firstWatch.startedAt).getTime() : 0

  return jobNames.flatMap((jobName) => {
    const maxAgeHours = PREVENTION_CRON_MAX_AGE_HOURS[jobName]!
    const maxAgeMs = maxAgeHours * 3_600_000
    const last = lastSuccess.get(jobName) ?? null
    const stale = last
      ? now.getTime() - new Date(last).getTime() > maxAgeMs
      : watchingForMs > maxAgeMs
    return stale ? [{ jobName, lastSuccessAt: last, maxAgeHours }] : []
  })
}
