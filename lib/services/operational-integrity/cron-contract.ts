/**
 * Contrato estable para el cron del ledger de integridad, análogo a
 * `lib/combustibles/fuel-cron-contract.ts` y al de DTE pero con prefijo propio:
 * `scripts/cron-runner.mjs` valida que el `code` empiece por el prefijo del job
 * justamente para que un cron no pueda fingir ser otro.
 */

export type IntegrityCronHealth = "healthy" | "disabled" | "waiting" | "degraded" | "critical"
export type IntegrityCronOutcome = "success" | "disabled" | "conflict" | "failed" | "unauthorized"

export interface IntegrityCronContract {
  outcome: IntegrityCronOutcome
  code: `INTEGRITY_CRON_${string}`
  ok: boolean
  httpStatus: 200 | 401 | 409 | 500 | 503
  runnerExitCode: 0 | 1 | 2
  health: IntegrityCronHealth
}

/**
 * Este cron sólo observa: no hay «parcial» que reportar, porque un escaneo o
 * completa su transacción o no deja nada. `found`/`recorded` viajan aparte,
 * como datos, y no alteran la salud: detectar problemas es que el cron
 * funciona, no que falle.
 */
export function integrityCronContractFor(input: {
  unauthorized?: boolean
  misconfigured?: boolean
  disabled?: boolean
  conflict?: boolean
  failed?: boolean
}): IntegrityCronContract {
  if (input.misconfigured) return contract("failed", "INTEGRITY_CRON_MISCONFIGURED", false, 500, 1, "critical")
  if (input.unauthorized) return contract("unauthorized", "INTEGRITY_CRON_UNAUTHORIZED", false, 401, 1, "critical")
  if (input.disabled) return contract("disabled", "INTEGRITY_CRON_DISABLED", true, 200, 0, "disabled")
  if (input.failed) return contract("failed", "INTEGRITY_CRON_FAILED", false, 503, 1, "critical")
  // Dos corridas pisándose no es una falla: la segunda cede y la primera sigue.
  if (input.conflict) return contract("conflict", "INTEGRITY_CRON_ACTIVE_RUN", false, 409, 2, "waiting")
  return contract("success", "INTEGRITY_CRON_SUCCESS", true, 200, 0, "healthy")
}

function contract(
  outcome: IntegrityCronOutcome,
  code: IntegrityCronContract["code"],
  ok: boolean,
  httpStatus: IntegrityCronContract["httpStatus"],
  runnerExitCode: IntegrityCronContract["runnerExitCode"],
  health: IntegrityCronHealth,
): IntegrityCronContract {
  return { outcome, code, ok, httpStatus, runnerExitCode, health }
}
