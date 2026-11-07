/**
 * Contrato estable para los crons de Combustibles, análogo a
 * `lib/services/dte-portal/cron-contract.ts` (DTE/facturación) pero con
 * prefijo propio — generalizar el existente arrastraría su código a crons
 * ajenos a este módulo; ver decisión en el plan de Control Operacional (T20).
 */

export type FuelCronHealth = "healthy" | "disabled" | "waiting" | "degraded" | "critical"
export type FuelCronOutcome = "success" | "disabled" | "conflict" | "partial" | "failed" | "unauthorized" | "rate_limited"

export interface FuelCronContract {
  outcome: FuelCronOutcome
  code: `FUEL_CRON_${string}`
  ok: boolean
  httpStatus: 200 | 401 | 409 | 429 | 503
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
  rateLimited?: boolean
  failed?: number
  total?: number
  /**
   * La corrida se completó pero con la fuente degradada (Copec no entregó parte
   * de los informes, o el presupuesto de tiempo cortó el barrido). No es lo
   * mismo que «todas las unidades fallaron»: se reporta `partial`/`degraded`
   * para que el scheduler vea que hay trabajo sin hacer (C6 / 4.6).
   */
  degraded?: boolean
}): FuelCronContract {
  if (input.unauthorized) return contract("unauthorized", "FUEL_CRON_UNAUTHORIZED", false, 401, 1, "critical")
  if (input.rateLimited) return contract("rate_limited", "FUEL_CRON_RATE_LIMITED", false, 429, 1, "degraded")
  if (input.disabled) return contract("disabled", "FUEL_CRON_DISABLED", true, 200, 0, "disabled")
  const failed = input.failed ?? 0
  const total = input.total ?? 0
  if (total > 0 && failed === total) return contract("failed", "FUEL_CRON_FAILED", false, 503, 1, "critical")
  if (failed > 0) return contract("partial", "FUEL_CRON_PARTIAL", false, 503, 1, "degraded")
  // El conflicto de lock manda sólo cuando no hubo fallas propias que reportar
  // — dos corridas pisándose es una señal distinta de "esta corrida falló".
  if (input.conflict) return contract("conflict", "FUEL_CRON_ACTIVE_RUN", false, 409, 2, "waiting")
  if (input.degraded) return contract("partial", "FUEL_CRON_PARTIAL", false, 503, 1, "degraded")
  return contract("success", "FUEL_CRON_SUCCESS", true, 200, 0, "healthy")
}

/**
 * Si el resultado de un barrido de Copec deja el contrato del cron en
 * `partial`/`degraded` en vez de `healthy`.
 *
 * C6 / 4.6: la ruta respondía `success` siempre y descartaba lo que la corrida
 * sabía —productos que Copec no entregó y meses que el presupuesto no alcanzó
 * a recorrer—, así que el scheduler la veía sana mientras el barrido era
 * parcial. Es una función y no una condición en la ruta para poder probarla.
 */
export function isCopecSweepDegraded(outcome: { unavailable?: readonly string[]; sourceFailures?: number; budgetExhausted?: boolean }): boolean {
  const sourceFailures = outcome.sourceFailures ?? outcome.unavailable?.length ?? 0
  return sourceFailures > 0 || outcome.budgetExhausted === true
}

/**
 * Una corrida batch de anomalías no puede reportarse sana si el tope de escaneo
 * dejó filas fuera o si algún caso no se pudo crear. Antes ambos casos volvían
 * `completed` con `created: 0` y el cron respondía 200 (CO-062).
 */
export function isAnomalyBatchDegraded(results: ReadonlyArray<{ truncated?: boolean; failed?: number }>): boolean {
  return results.some((result) => result.truncated === true || (result.failed ?? 0) > 0)
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
