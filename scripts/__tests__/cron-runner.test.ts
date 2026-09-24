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

  it("accepts the dedicated Fleet GPS contract for OnWay", async () => {
    const success = await runCronJob("fleet-onway-sync", {
      secret: "cron-secret",
      log: vi.fn(),
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, {
        ok: true,
        outcome: "success",
        code: "FLEET_GPS_CRON_SUCCESS",
      })),
    })
    expect(success).toBe(0)
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

/*
 * Cada ruta que llama el runner declara `ok` en sus respuestas. `ti-alerts` y
 * `maintenance-reminders` no lo hacían y el runner daba por fallida cada
 * corrida (DTE_CRON_RUNNER_CONTRACT) aunque el trabajo se hubiera hecho: en el
 * log del scheduler una falla real no se distinguía de una corrida buena.
 */
describe("rutas de cron que llama el runner", () => {
  it("toda respuesta con `outcome` declara también `ok`", async () => {
    const { readFileSync } = await import("node:fs")
    const path = await import("node:path")
    const root = path.resolve(__dirname, "../..")
    const runner = readFileSync(path.join(root, "scripts/cron-runner.mjs"), "utf8")
    const routes = [...runner.matchAll(/url: "http:\/\/app:3000\/api\/cron\/([a-z0-9-]+)"/g)].map((match) => match[1]!)
    expect(routes.length).toBeGreaterThan(10)

    const missing: string[] = []
    for (const route of routes) {
      const source = readFileSync(path.join(root, "app/api/cron", route, "route.ts"), "utf8")
      for (const literal of source.matchAll(/NextResponse\.json\(\s*\{([^}]*)\}/g)) {
        const body = literal[1]!
        if (/\boutcome\s*:/.test(body) && !/\bok\s*:/.test(body)) missing.push(`${route}: {${body.trim().slice(0, 60)}…}`)
      }
    }
    expect(missing).toEqual([])
  })
})
