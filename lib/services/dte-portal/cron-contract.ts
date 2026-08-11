/** Stable, redacted wire contract shared by DTE and billing cron endpoints. */

export type CronHealth = "healthy" | "disabled" | "waiting" | "degraded" | "critical"
export type CronOutcome = "success" | "disabled" | "conflict" | "partial" | "failed" | "unauthorized"
export type CronSyncStatus = "success" | "partial" | "failed" | "skipped"

export interface CronContract {
  outcome: CronOutcome
  code: `DTE_CRON_${string}`
  ok: boolean
  httpStatus: 200 | 401 | 409 | 503
  runnerExitCode: 0 | 1 | 2
  health: CronHealth
}

export function cronContractFor(input: {
  unauthorized?: boolean
  disabled?: boolean
  conflict?: boolean
  statuses?: readonly CronSyncStatus[]
}): CronContract {
  if (input.unauthorized) return contract("unauthorized", "DTE_CRON_UNAUTHORIZED", false, 401, 1, "critical")
  if (input.disabled) return contract("disabled", "DTE_CRON_DISABLED", true, 200, 0, "disabled")
  if (input.conflict || input.statuses?.some((status) => status === "skipped")) {
    return contract("conflict", "DTE_CRON_ACTIVE_RUN", false, 409, 2, "waiting")
  }
  if (input.statuses?.some((status) => status === "failed")) {
    return contract("failed", "DTE_CRON_FAILED", false, 503, 1, "critical")
  }
  if (input.statuses?.some((status) => status === "partial")) {
    return contract("partial", "DTE_CRON_PARTIAL", false, 503, 1, "degraded")
  }
  return contract("success", "DTE_CRON_SUCCESS", true, 200, 0, "healthy")
}

function contract(
  outcome: CronOutcome,
  code: CronContract["code"],
  ok: boolean,
  httpStatus: CronContract["httpStatus"],
  runnerExitCode: CronContract["runnerExitCode"],
  health: CronHealth,
): CronContract {
  return { outcome, code, ok, httpStatus, runnerExitCode, health }
}
