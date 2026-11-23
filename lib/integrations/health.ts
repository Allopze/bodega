/**
 * lib/integrations/health.ts — Estado de las integraciones y tareas programadas.
 *
 * Recibe la última corrida de cada job (ya consultada) y decide si está al día,
 * con falla, detenido o sin corridas. Sin base de datos, para probarlo con
 * filas armadas a mano.
 */
import type { IntegrationJob } from "./health-catalog"

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

export interface IntegrationHealth extends IntegrationJob {
  status:        IntegrationStatus
  lastStartedAt: string | null
  lastAliveAt:   string | null
  lastDetail:    string | null
  failures7d:    number
}

const STATUS_RANK: Record<IntegrationStatus, number> = { failing: 3, stale: 2, never: 1, ok: 0 }

/**
 * Estado de un job. Falla manda sobre atraso: la última corrida fallida es lo
 * que hay que mirar primero. `never` no es una alerta: en un ambiente donde el
 * cron no está desplegado (dev) todos los jobs estarían «detenidos».
 */
export function integrationStatus(job: IntegrationJob, row: CronJobRow | undefined, now: Date): IntegrationStatus {
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
