import { chilePeriod, dueCronSlot, previousChilePeriod, type CronSlot } from "./chile-time"

export const DTE_HEALTH_WINDOW_MINUTES = 20
/** A live cron row gets time to finish before freshness becomes an incident. */
export const DTE_RUNNING_GRACE_MINUTES = 10
export const DTE_CRON_SLOTS: readonly CronSlot[] = [
  { label: "07:00", minutesSinceMidnight: 7 * 60 },
  { label: "13:00", minutesSinceMidnight: 13 * 60 },
  { label: "19:00", minutesSinceMidnight: 19 * 60 },
]
export const SALES_CRON_SLOTS: readonly CronSlot[] = [
  { label: "07:30", minutesSinceMidnight: 7 * 60 + 30 },
]

export type DteHealthStatus = "healthy" | "disabled" | "degraded" | "critical"
export type DteHealthDomainStatus = DteHealthStatus | "not_due" | "waiting"

export interface CronRunEvidence {
  period: string | null
  status: "running" | "success" | "partial" | "failed" | "skipped"
  trigger: "manual" | "cron" | "backfill"
  correlationId: string | null
  startedAt: string
}

export interface DteHealthDomain {
  name: "purchases" | "sales"
  status: DteHealthDomainStatus
  code: string
  slot: string | null
  expectedPeriods: string[]
}

export interface DteSyncHealthEvaluation {
  status: DteHealthStatus
  code: string
  checkedAt: string
  domains: DteHealthDomain[]
}

export interface DteSyncHealthInput {
  now?: Date
  dteEnabled: boolean
  dteConfigured: boolean
  salesEnabled: boolean
  salesConfigured: boolean
  dteRuns: readonly CronRunEvidence[]
  salesRuns: readonly CronRunEvidence[]
}

/**
 * Evaluates only automatic runs in the last due 20-minute Chilean window.
 * Manual/backfill history intentionally cannot make automation look healthy.
 */
export function evaluateDteSyncHealth(input: DteSyncHealthInput): DteSyncHealthEvaluation {
  const now = input.now ?? new Date()
  const period = chilePeriod(now)
  const expectedPeriods = [period, previousChilePeriod(period)]
  const dteSlot = dueCronSlot(DTE_CRON_SLOTS, now, DTE_HEALTH_WINDOW_MINUTES)
  const salesSlot = dueCronSlot(SALES_CRON_SLOTS, now, DTE_HEALTH_WINDOW_MINUTES)

  const domains: DteHealthDomain[] = [
    evaluateDomain({
      name: "purchases",
      enabled: input.dteEnabled,
      configured: input.dteConfigured,
      slot: dteSlot,
      expectedPeriods,
      runs: input.dteRuns,
      now,
    }),
    evaluateDomain({
      name: "sales",
      enabled: input.salesEnabled,
      configured: input.salesConfigured,
      slot: salesSlot,
      expectedPeriods,
      runs: input.salesRuns,
      now,
    }),
  ]

  const activeDomains = domains.filter((domain) => domain.status !== "disabled" && domain.status !== "not_due")
  const status: DteHealthStatus = domains.every((domain) => domain.status === "disabled")
    ? "disabled"
    : activeDomains.some((domain) => domain.status === "critical")
      ? "critical"
      : activeDomains.some((domain) => domain.status === "degraded")
        ? "degraded"
        : "healthy"

  return {
    status,
    code: status === "disabled"
      ? "DTE_HEALTH_DISABLED"
      : status === "critical"
        ? "DTE_HEALTH_CRITICAL"
        : status === "degraded"
          ? "DTE_HEALTH_DEGRADED"
          : "DTE_HEALTH_OK",
    checkedAt: now.toISOString(),
    domains,
  }
}

function evaluateDomain(input: {
  name: "purchases" | "sales"
  enabled: boolean
  configured: boolean
  slot: ReturnType<typeof dueCronSlot>
  expectedPeriods: string[]
  runs: readonly CronRunEvidence[]
  now: Date
}): DteHealthDomain {
  if (!input.enabled) {
    return domain(input.name, "disabled", "DTE_HEALTH_INTENTIONALLY_DISABLED", null, input.expectedPeriods)
  }
  if (!input.configured) {
    // Configuration is actionable independently of the next scheduled slot.
    // Waiting until 13:00/19:00 to expose a broken keyring turns a deploy
    // mistake into several hours of silent automation outage.
    return domain(input.name, "critical", "DTE_HEALTH_CONFIGURATION", input.slot?.id ?? null, input.expectedPeriods)
  }
  if (!input.slot) {
    return domain(input.name, "not_due", "DTE_HEALTH_NOT_DUE", null, input.expectedPeriods)
  }

  const windowStartMs = input.now.getTime() - input.slot.elapsedMs
  const relevant = input.runs.filter((run) =>
    run.trigger === "cron" &&
    input.expectedPeriods.includes(run.period ?? "") &&
    Number.isFinite(Date.parse(run.startedAt)) &&
    Date.parse(run.startedAt) >= windowStartMs &&
    Date.parse(run.startedAt) <= input.now.getTime(),
  )

  const batches = new Map<string, Map<string, CronRunEvidence["status"]>>()
  for (const run of relevant) {
    if (!run.correlationId || !run.period) continue
    const batch = batches.get(run.correlationId) ?? new Map<string, CronRunEvidence["status"]>()
    batch.set(run.period, run.status)
    batches.set(run.correlationId, batch)
  }

  for (const batch of batches.values()) {
    if (input.expectedPeriods.every((period) => batch.get(period) === "success")) {
      return domain(input.name, "healthy", "DTE_HEALTH_SUCCESS", input.slot.id, input.expectedPeriods)
    }
  }

  const statuses = relevant.map((run) => run.status)
  if (statuses.includes("failed")) {
    return domain(input.name, "critical", "DTE_HEALTH_RUN_FAILED", input.slot.id, input.expectedPeriods)
  }
  if (statuses.includes("partial")) {
    return domain(input.name, "degraded", "DTE_HEALTH_RUN_PARTIAL", input.slot.id, input.expectedPeriods)
  }
  const graceMs = DTE_RUNNING_GRACE_MINUTES * 60_000
  const hasRecentRunningRun = relevant.some((run) =>
    run.status === "running" && input.now.getTime() - Date.parse(run.startedAt) <= graceMs,
  )
  if (hasRecentRunningRun) {
    // The paired cron may legitimately still be performing its current/prior
    // request. Do not page on the first health probe after a 409/active run;
    // a row that outlives the bounded grace becomes batch-missing below.
    return domain(input.name, "waiting", "DTE_HEALTH_RUN_IN_PROGRESS", input.slot.id, input.expectedPeriods)
  }
  return domain(input.name, "critical", "DTE_HEALTH_BATCH_MISSING", input.slot.id, input.expectedPeriods)
}

function domain(
  name: DteHealthDomain["name"],
  status: DteHealthDomainStatus,
  code: string,
  slot: string | null,
  expectedPeriods: string[],
): DteHealthDomain {
  return { name, status, code, slot, expectedPeriods }
}
