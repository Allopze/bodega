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
})
