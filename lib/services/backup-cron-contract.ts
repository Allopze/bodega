/**
 * Contrato estable para el cron de salud de respaldos.
 *
 * Mismo patrón que `lib/combustibles/fuel-cron-contract.ts` y
 * `lib/services/operational-integrity/cron-contract.ts`: el desenlace decide el
 * estado HTTP y el código de salida del runner, en vez de responder siempre 200.
 *
 * BCK-001 (auditoría 2026-09-14): la ruta calculaba bien el diagnóstico
 * —`critical` cuando el último respaldo falló, superó la antigüedad máxima o no
 * hay ninguno— y luego respondía `{ ok: true }` con HTTP 200 en todos los casos.
 * El único rastro era un `logger.warn`, así que `scripts/cron-runner.mjs`, que
 * decide por código de salida, nunca se enteraba de que la plataforma se había
 * quedado sin respaldos verificables.
 */

export type BackupCronHealth = "healthy" | "degraded" | "critical"
export type BackupCronOutcome = "success" | "degraded" | "failed" | "unauthorized"

export interface BackupCronContract {
  outcome: BackupCronOutcome
  code: `BACKUP_CRON_${string}`
  ok: boolean
  httpStatus: 200 | 401 | 500 | 503
  runnerExitCode: 0 | 1
  health: BackupCronHealth
}

/**
 * Un estado degradado (por ejemplo, varios respaldos aparentemente colgados) es
 * un aviso, no una falla: responde 200 para no despertar a nadie de madrugada,
 * pero lo declara en `health` y en `outcome`. Sólo `critical` corta.
 */
export function backupCronContractFor(input: {
  unauthorized?: boolean
  misconfigured?: boolean
  health?: BackupCronHealth
}): BackupCronContract {
  if (input.misconfigured) {
    return contract("failed", "BACKUP_CRON_MISCONFIGURED", false, 500, 1, "critical")
  }
  if (input.unauthorized) {
    return contract("unauthorized", "BACKUP_CRON_UNAUTHORIZED", false, 401, 1, "critical")
  }
  if (input.health === "critical") {
    return contract("failed", "BACKUP_CRON_CRITICAL", false, 503, 1, "critical")
  }
  if (input.health === "degraded") {
    return contract("degraded", "BACKUP_CRON_DEGRADED", true, 200, 0, "degraded")
  }
  return contract("success", "BACKUP_CRON_SUCCESS", true, 200, 0, "healthy")
}

function contract(
  outcome: BackupCronOutcome,
  code: BackupCronContract["code"],
  ok: boolean,
  httpStatus: BackupCronContract["httpStatus"],
  runnerExitCode: BackupCronContract["runnerExitCode"],
  health: BackupCronHealth,
): BackupCronContract {
  return { outcome, code, ok, httpStatus, runnerExitCode, health }
}
