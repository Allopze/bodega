import { describe, expect, it, vi } from "vitest"

const { runCronJob } = await import("../cron-runner.mjs")

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } })
}

describe("cron runner", () => {
  it("maps the shared sync contract to the documented exit codes", async () => {
    const log = vi.fn()
    const conflict = await runCronJob("dte", {
      secret: "cron-secret",
      log,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(409, { ok: false, outcome: "conflict", code: "DTE_CRON_ACTIVE_RUN" })),
    })
    const partial = await runCronJob("sales", {
      secret: "cron-secret",
      log,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(503, { ok: false, outcome: "partial", code: "DTE_CRON_PARTIAL" })),
    })
    expect(conflict).toBe(2)
    expect(partial).toBe(1)
  })

  it("keeps a degraded health result live but rejects a redirect or malformed payload", async () => {
    const log = vi.fn()
    const health = await runCronJob("health", {
      secret: "cron-secret",
      log,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, outcome: "degraded", code: "DTE_HEALTH_DEGRADED", status: "degraded" })),
    })
    const redirect = await runCronJob("dte", {
      secret: "cron-secret",
      log,
      fetchImpl: vi.fn().mockResolvedValue(new Response("redirect", { status: 302 })),
    })
    expect(health).toBe(0)
    expect(redirect).toBe(1)
  })

  it("does not print its bearer token or a raw response", async () => {
    const log = vi.fn()
    const secret = "bearer-token-must-never-appear"
    await runCronJob("dte", {
      secret,
      log,
      fetchImpl: vi.fn().mockResolvedValue(new Response(`bad ${secret}`, { status: 503 })),
    })
    expect(log.mock.calls.flat().join(" ")).not.toContain(secret)
  })

  it("rejects a syntactically JSON response whose outcome and code disagree", async () => {
    const log = vi.fn()

    const exitCode = await runCronJob("dte", {
      secret: "cron-secret",
      log,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, {
        ok: true,
        outcome: "success",
        code: "DTE_CRON_PARTIAL",
      })),
    })

    expect(exitCode).toBe(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining("DTE_CRON_RUNNER_CONTRACT"))
  })

  // CO-029/CO-039: los crons de Combustibles usan su propio prefijo
  // (FUEL_CRON_*) — el runner no debe exigirles fingir ser jobs DTE.
  it("accepts the FUEL_CRON_ prefix for combustibles jobs", async () => {
    const log = vi.fn()
    const success = await runCronJob("fuel-anomaly-detection", {
      secret: "cron-secret",
      log,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, outcome: "success", code: "FUEL_CRON_SUCCESS" })),
    })
    const partial = await runCronJob("fuel-copec-sync", {
      secret: "cron-secret",
      log,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(503, { ok: false, outcome: "partial", code: "FUEL_CRON_PARTIAL" })),
    })
    expect(success).toBe(0)
    expect(partial).toBe(1)
  })

  it("maps a rate-limited response to a failed runner exit without accepting it as provider failure", async () => {
    const exitCode = await runCronJob("fuel-copec-sync", {
      secret: "cron-secret",
      log: vi.fn(),
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(429, { ok: false, outcome: "rate_limited", code: "FUEL_CRON_RATE_LIMITED" })),
    })
    expect(exitCode).toBe(1)
  })

  it("rejects a combustibles job whose payload wears the DTE prefix instead of its own", async () => {
    const log = vi.fn()
    const exitCode = await runCronJob("fuel-statement-notifications", {
      secret: "cron-secret",
      log,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, outcome: "success", code: "DTE_CRON_SUCCESS" })),
    })
    expect(exitCode).toBe(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining("DTE_CRON_RUNNER_CONTRACT"))
  })

  it("accepts the FEEDBACK_CRON_ contract for ticket SLA reminders", async () => {
    const exitCode = await runCronJob("feedback-sla-reminders", {
      secret: "cron-secret",
      log: vi.fn(),
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, {
        ok: true,
        outcome: "success",
        code: "FEEDBACK_CRON_SUCCESS",
      })),
    })

    expect(exitCode).toBe(0)
  })
})
