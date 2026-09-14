import { describe, expect, it } from "vitest"
import { backupCronContractFor } from "./backup-cron-contract"

/**
 * BCK-001: la vigilancia de respaldos respondía 200 con `ok: true` incluso
 * cuando su propio diagnóstico era `critical`. Estas pruebas fijan el contrato
 * que impide que vuelva a pasar.
 */
describe("backupCronContractFor", () => {
  it("reporta éxito cuando la salud es buena", () => {
    expect(backupCronContractFor({ health: "healthy" })).toMatchObject({
      outcome: "success", ok: true, httpStatus: 200, runnerExitCode: 0,
    })
  })

  it("un estado crítico NO puede responder ok ni 200", () => {
    const contract = backupCronContractFor({ health: "critical" })
    expect(contract.ok).toBe(false)
    expect(contract.httpStatus).toBe(503)
    expect(contract.runnerExitCode).toBe(1)
    expect(contract.code).toBe("BACKUP_CRON_CRITICAL")
  })

  it("un estado degradado avisa sin cortar", () => {
    expect(backupCronContractFor({ health: "degraded" })).toMatchObject({
      outcome: "degraded", ok: true, httpStatus: 200, runnerExitCode: 0, health: "degraded",
    })
  })

  it("la falta de secreto se reporta como falla de configuración", () => {
    expect(backupCronContractFor({ misconfigured: true })).toMatchObject({
      outcome: "failed", ok: false, httpStatus: 500, runnerExitCode: 1,
    })
  })

  it("no autorizado responde 401 y salida 1", () => {
    expect(backupCronContractFor({ unauthorized: true })).toMatchObject({
      outcome: "unauthorized", ok: false, httpStatus: 401, runnerExitCode: 1,
    })
  })

  it("la configuración rota manda por sobre cualquier otra señal", () => {
    expect(backupCronContractFor({ misconfigured: true, unauthorized: true, health: "healthy" }))
      .toMatchObject({ code: "BACKUP_CRON_MISCONFIGURED" })
  })
})
