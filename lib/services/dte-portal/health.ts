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
export const CHIPAX_CRON_SLOTS: readonly CronSlot[] = [
  { label: "09:00", minutesSinceMidnight: 9 * 60 },
]

export type DteHealthStatus = "healthy" | "disabled" | "degraded" | "critical"
export type DteHealthDomainStatus = DteHealthStatus | "not_due" | "waiting"

export interface CronRunEvidence {
  period: string | null
  status: "running" | "success" | "partial" | "failed" | "skipped"
  trigger: "manual" | "cron" | "backfill"
  correlationId: string | null
  startedAt: string
  scope?: "sales_invoices" | "purchase_invoices" | "bank_transactions"
  reconciliationStatus?: "not_run" | "success" | "partial" | "failed"
}

export interface DteHealthDomain {
  name: "purchases" | "sales" | "chipax_sales" | "chipax_bank"
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
  chipaxEnabled?: boolean
  chipaxConfigured?: boolean
  chipaxSalesRuns?: readonly CronRunEvidence[]
  chipaxBankRuns?: readonly CronRunEvidence[]
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
  const chipaxSlot = dueCronSlot(CHIPAX_CRON_SLOTS, now, DTE_HEALTH_WINDOW_MINUTES)

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
      name: "chipax_sales",
      enabled: input.chipaxEnabled ?? false,
      configured: input.chipaxConfigured ?? false,
      slot: chipaxSlot,
      expectedPeriods,
      runs: input.chipaxSalesRuns ?? [],
      scope: "sales_invoices",
      now,
    }),
    evaluateDomain({
      name: "chipax_bank",
      enabled: input.chipaxEnabled ?? false,
      configured: input.chipaxConfigured ?? false,
      slot: chipaxSlot,
      expectedPeriods: [period],
      runs: input.chipaxBankRuns ?? [],
      scope: "bank_transactions",
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
  name: DteHealthDomain["name"]
  enabled: boolean
  configured: boolean
  slot: ReturnType<typeof dueCronSlot>
  expectedPeriods: string[]
  runs: readonly CronRunEvidence[]
  scope?: "sales_invoices" | "bank_transactions"
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
  const expectedPeriods = new Set(input.expectedPeriods)
  const relevant = input.runs.filter((run) =>
    run.trigger === "cron" &&
    expectedPeriods.has(run.period ?? "") &&
    (!input.scope || run.scope === input.scope) &&
    Number.isFinite(Date.parse(run.startedAt)) &&
    Date.parse(run.startedAt) >= windowStartMs &&
    Date.parse(run.startedAt) <= input.now.getTime(),
  )

  const batches = new Map<string, Map<string, CronRunEvidence>>()
  for (const run of relevant) {
    if (!run.correlationId || !run.period) continue
    const batch = batches.get(run.correlationId) ?? new Map<string, CronRunEvidence>()
    batch.set(run.period, run)
    batches.set(run.correlationId, batch)
  }

  // Evaluate the newest batch attempt, not merely the newest complete batch.
  // Otherwise a successful batch from 09:00 could keep health green after a
  // newer 09:10 attempt became partial. An older failure is allowed to fall out
  // of the way when a newer complete batch succeeds.
  const latestBatch = [...batches.values()].sort((left, right) => latestBatchTime(right) - latestBatchTime(left))[0]
  if (latestBatch) {
    const latestRuns = [...latestBatch.values()]
    const complete = input.expectedPeriods.every((period) => latestBatch.get(period)?.status === "success")
    if (complete && latestRuns.some((run) => run.reconciliationStatus === "failed")) {
      return domain(input.name, "critical", "DTE_HEALTH_RUN_FAILED", input.slot.id, input.expectedPeriods)
    }
    if (complete && latestRuns.some((run) => run.reconciliationStatus === "partial")) {
      return domain(input.name, "degraded", "DTE_HEALTH_RECONCILIATION_PENDING", input.slot.id, input.expectedPeriods)
    }
    if (complete) return domain(input.name, "healthy", "DTE_HEALTH_SUCCESS", input.slot.id, input.expectedPeriods)

    if (latestRuns.some((run) => run.reconciliationStatus === "failed" || run.status === "failed")) {
      return domain(input.name, "critical", "DTE_HEALTH_RUN_FAILED", input.slot.id, input.expectedPeriods)
    }
    // La ingesta parcial se declara ANTES que la conciliación pendiente: al
    // libro de compras le faltan documentos, que es un incidente real, mientras
    // que conciliaciones pendientes son el estado normal de trabajo. Con un solo
    // código ambos llegaban al operador como la misma frase.
    if (latestRuns.some((run) => run.status === "partial")) {
      return domain(input.name, "degraded", "DTE_HEALTH_INGEST_PARTIAL", input.slot.id, input.expectedPeriods)
    }
    if (latestRuns.some((run) => run.reconciliationStatus === "partial")) {
      return domain(input.name, "degraded", "DTE_HEALTH_RECONCILIATION_PENDING", input.slot.id, input.expectedPeriods)
    }
    const graceMs = DTE_RUNNING_GRACE_MINUTES * 60_000
    const latestStartedAt = latestBatchTime(latestBatch)
    if (latestRuns.some((run) => run.status === "running") && input.now.getTime() - latestStartedAt <= graceMs) {
      return domain(input.name, "waiting", "DTE_HEALTH_RUN_IN_PROGRESS", input.slot.id, input.expectedPeriods)
    }
    return domain(input.name, "critical", "DTE_HEALTH_BATCH_MISSING", input.slot.id, input.expectedPeriods)
  }

  const statuses = relevant.map((run) => run.status)
  if (statuses.includes("failed") || relevant.some((run) => run.reconciliationStatus === "failed")) {
    return domain(input.name, "critical", "DTE_HEALTH_RUN_FAILED", input.slot.id, input.expectedPeriods)
  }
  if (statuses.includes("partial")) {
    return domain(input.name, "degraded", "DTE_HEALTH_INGEST_PARTIAL", input.slot.id, input.expectedPeriods)
  }
  if (relevant.some((run) => run.reconciliationStatus === "partial")) {
    return domain(input.name, "degraded", "DTE_HEALTH_RECONCILIATION_PENDING", input.slot.id, input.expectedPeriods)
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

function latestBatchTime(batch: Map<string, CronRunEvidence>): number {
  let latest = 0
  for (const run of batch.values()) {
    const startedAt = Date.parse(run.startedAt)
    if (Number.isFinite(startedAt) && startedAt > latest) latest = startedAt
  }
  return latest
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
