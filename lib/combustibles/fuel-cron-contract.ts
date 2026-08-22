/**
 * Contrato estable para los crons de Combustibles, análogo a
 * `lib/services/dte-portal/cron-contract.ts` (DTE/facturación) pero con
 * prefijo propio — generalizar el existente arrastraría su código a crons
 * ajenos a este módulo; ver decisión en el plan de Control Operacional (T20).
 */

export type FuelCronHealth = "healthy" | "disabled" | "waiting" | "degraded" | "critical"
export type FuelCronOutcome = "success" | "disabled" | "conflict" | "partial" | "failed" | "unauthorized"

export interface FuelCronContract {
  outcome: FuelCronOutcome
  code: `FUEL_CRON_${string}`
  ok: boolean
  httpStatus: 200 | 401 | 409 | 503
  runnerExitCode: 0 | 1 | 2
  health: FuelCronHealth
}

/**
 * `failed`/`total` cuentan unidades de trabajo del cron: para
 * `fuel-anomaly-detection`, una por regla batch activa; para los crons de una
 * sola operación (Copec, notificaciones de cuenta corriente), 0/1 o 1/1. Todas
 * fallidas → `failed` (503); algunas → `partial` (503, degradado pero no
 * ciego); ninguna → `success`.
 */
export function fuelCronContractFor(input: {
  unauthorized?: boolean
  disabled?: boolean
  conflict?: boolean
  failed?: number
  total?: number
}): FuelCronContract {
  if (input.unauthorized) return contract("unauthorized", "FUEL_CRON_UNAUTHORIZED", false, 401, 1, "critical")
  if (input.disabled) return contract("disabled", "FUEL_CRON_DISABLED", true, 200, 0, "disabled")
  const failed = input.failed ?? 0
  const total = input.total ?? 0
  if (total > 0 && failed === total) return contract("failed", "FUEL_CRON_FAILED", false, 503, 1, "critical")
  if (failed > 0) return contract("partial", "FUEL_CRON_PARTIAL", false, 503, 1, "degraded")
  // El conflicto de lock manda sólo cuando no hubo fallas propias que reportar
  // — dos corridas pisándose es una señal distinta de "esta corrida falló".
  if (input.conflict) return contract("conflict", "FUEL_CRON_ACTIVE_RUN", false, 409, 2, "waiting")
  return contract("success", "FUEL_CRON_SUCCESS", true, 200, 0, "healthy")
}

function contract(
  outcome: FuelCronOutcome,
  code: FuelCronContract["code"],
  ok: boolean,
  httpStatus: FuelCronContract["httpStatus"],
  runnerExitCode: FuelCronContract["runnerExitCode"],
  health: FuelCronHealth,
): FuelCronContract {
  return { outcome, code, ok, httpStatus, runnerExitCode, health }
}
