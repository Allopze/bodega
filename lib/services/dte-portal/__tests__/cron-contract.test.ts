import { describe, expect, it } from "vitest"
import { cronContractFor } from "../cron-contract"

describe("DTE cron HTTP contract", () => {
  it.each([
    ["success", { statuses: ["success", "success"] }, 200, 0, "healthy"],
    ["disabled", { disabled: true }, 200, 0, "disabled"],
    ["conflict", { conflict: true }, 409, 2, "waiting"],
    ["partial", { statuses: ["success", "partial"] }, 503, 1, "degraded"],
    ["failed", { statuses: ["failed"] }, 503, 1, "critical"],
    ["unauthorized", { unauthorized: true }, 401, 1, "critical"],
  ] as const)("maps %s safely", (_name, input, httpStatus, runnerExitCode, health) => {
    const contract = cronContractFor(input)

    expect(contract.httpStatus).toBe(httpStatus)
    expect(contract.runnerExitCode).toBe(runnerExitCode)
    expect(contract.health).toBe(health)
    expect(contract.code).toMatch(/^DTE_CRON_/)
  })

  // Un lote mixto (un período con corrida activa, otro con las credenciales
  // rechazadas) se reportaba 409/"waiting" y el fallo real quedaba invisible.
  it("reporta el fallo por sobre el conflicto en un lote mixto", () => {
    const contract = cronContractFor({ conflict: true, statuses: ["skipped", "failed"] })

    expect(contract.outcome).toBe("failed")
    expect(contract.httpStatus).toBe(503)
    expect(contract.health).toBe("critical")
  })

  it("reporta una ingesta parcial por sobre el conflicto", () => {
    const contract = cronContractFor({ conflict: true, statuses: ["skipped", "partial"] })

    expect(contract.outcome).toBe("partial")
    expect(contract.httpStatus).toBe(503)
  })
})
