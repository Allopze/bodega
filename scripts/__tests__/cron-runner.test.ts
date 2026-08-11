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
})
