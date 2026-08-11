import { describe, expect, it } from "vitest"
import { chileClock, dueCronSlot } from "../chile-time"
import { decideDteHealthAlert } from "../health-alerts"
import { evaluateDteSyncHealth } from "../health"

const atSlot = new Date("2026-08-11T11:10:00.000Z") // 07:10 America/Santiago
const expectedPeriods = ["2026-08", "2026-07"]

function run(period: string, status: "running" | "success" | "partial" | "failed", correlationId = "batch-1", startedAt = "2026-08-11T11:02:00.000Z") {
  return { period, status, trigger: "cron" as const, correlationId, startedAt }
}

describe("DTE cron health evaluator", () => {
  it("uses America/Santiago for periods and slots", () => {
    expect(chileClock(atSlot)).toMatchObject({ date: "2026-08-11", period: "2026-08", minutesSinceMidnight: 430 })
    expect(dueCronSlot([{ label: "07:00", minutesSinceMidnight: 420 }], atSlot)?.id).toBe("2026-08-11T07:00")
  })

  it("requires both periods under the same cron batch", () => {
    const result = evaluateDteSyncHealth({
      now: atSlot,
      dteEnabled: true,
      dteConfigured: true,
      salesEnabled: false,
      salesConfigured: false,
      dteRuns: [run(expectedPeriods[0]!, "success", "batch-current"), run(expectedPeriods[1]!, "success", "batch-prior")],
      salesRuns: [],
    })
    expect(result.status).toBe("critical")
    expect(result.domains[0]!).toMatchObject({ status: "critical", code: "DTE_HEALTH_BATCH_MISSING" })
  })

  it("is healthy only after paired current and prior successful cron runs", () => {
    const result = evaluateDteSyncHealth({
      now: atSlot,
      dteEnabled: true,
      dteConfigured: true,
      salesEnabled: false,
      salesConfigured: false,
      dteRuns: expectedPeriods.map((period) => run(period!, "success")),
      salesRuns: [],
    })
    expect(result.status).toBe("healthy")
    expect(result.domains[0]!).toMatchObject({ status: "healthy", code: "DTE_HEALTH_SUCCESS" })
  })

  it("keeps partial work degraded and ignores manual history", () => {
    const result = evaluateDteSyncHealth({
      now: atSlot,
      dteEnabled: true,
      dteConfigured: true,
      salesEnabled: false,
      salesConfigured: false,
      dteRuns: [
        run(expectedPeriods[0]!, "partial"),
        { ...run(expectedPeriods[1]!, "success"), trigger: "manual" as const },
      ],
      salesRuns: [],
    })
    expect(result.status).toBe("degraded")
    expect(result.domains[0]!.status).toBe("degraded")
  })

  it("gives an active cron batch a bounded grace before alerting it as missing", () => {
    const waiting = evaluateDteSyncHealth({
      now: atSlot,
      dteEnabled: true,
      dteConfigured: true,
      salesEnabled: false,
      salesConfigured: false,
      dteRuns: [run(expectedPeriods[0]!, "running")],
      salesRuns: [],
    })
    expect(waiting.status).toBe("healthy")
    expect(waiting.domains[0]).toMatchObject({ status: "waiting", code: "DTE_HEALTH_RUN_IN_PROGRESS" })
    expect(decideDteHealthAlert(waiting, null)).toBeNull()

    const expired = evaluateDteSyncHealth({
      now: new Date("2026-08-11T11:16:00.000Z"), // 07:16 Chile
      dteEnabled: true,
      dteConfigured: true,
      salesEnabled: false,
      salesConfigured: false,
      dteRuns: [run(expectedPeriods[0]!, "running")],
      salesRuns: [],
    })
    expect(expired.domains[0]).toMatchObject({ status: "critical", code: "DTE_HEALTH_BATCH_MISSING" })
  })

  it("does not alert during the overnight gap and treats both flags off as disabled", () => {
    const result = evaluateDteSyncHealth({
      now: new Date("2026-08-11T05:00:00.000Z"), // 01:00 Chile
      dteEnabled: false,
      dteConfigured: false,
      salesEnabled: false,
      salesConfigured: false,
      dteRuns: [],
      salesRuns: [],
    })
    expect(result.status).toBe("disabled")
    expect(result.domains.map((domain) => domain.status)).toEqual(["disabled", "disabled"])
  })

  it("reports an enabled but invalid configuration immediately, even outside a due window", () => {
    const result = evaluateDteSyncHealth({
      now: new Date("2026-08-11T05:00:00.000Z"), // 01:00 Chile
      dteEnabled: true,
      dteConfigured: false,
      salesEnabled: false,
      salesConfigured: false,
      dteRuns: [],
      salesRuns: [],
    })

    expect(result.status).toBe("critical")
    expect(result.domains[0]).toMatchObject({ status: "critical", code: "DTE_HEALTH_CONFIGURATION", slot: null })
  })

  it("closes a slot window after twenty minutes, including around date boundaries", () => {
    const afterWindow = new Date("2026-08-11T11:21:00.000Z") // 07:21 Chile
    expect(dueCronSlot([{ label: "07:00", minutesSinceMidnight: 420 }], afterWindow)).toBeNull()
  })

  it("keeps Chile calendar semantics through the DST fall-back hour", () => {
    // Chile repeats 23:00 when DST ends; period/date must still come from the
    // operational timezone rather than UTC or the host locale.
    expect(chileClock(new Date("2026-04-05T03:30:00.000Z"))).toMatchObject({ date: "2026-04-04", period: "2026-04", minutesSinceMidnight: 23 * 60 + 30 })
  })

  it("deduplicates a repeated failed slot and sends recovery only after a measured success", () => {
    const critical = evaluateDteSyncHealth({
      now: atSlot,
      dteEnabled: true,
      dteConfigured: true,
      salesEnabled: false,
      salesConfigured: false,
      dteRuns: [],
      salesRuns: [],
    })
    const first = decideDteHealthAlert(critical, null)
    expect(first?.kind).toBe("alert")
    expect(decideDteHealthAlert(critical, { fingerprint: first!.fingerprint, status: "critical" })).toBeNull()

    const healthy = evaluateDteSyncHealth({
      now: atSlot,
      dteEnabled: true,
      dteConfigured: true,
      salesEnabled: false,
      salesConfigured: false,
      dteRuns: expectedPeriods.map((period) => run(period!, "success")),
      salesRuns: [],
    })
    expect(decideDteHealthAlert(healthy, { fingerprint: first!.fingerprint, status: "critical" })?.kind).toBe("recovery")
  })
})
