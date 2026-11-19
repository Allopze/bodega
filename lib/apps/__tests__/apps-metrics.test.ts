import { describe, expect, it } from "vitest"
import { APPS, type AppCronJob } from "../catalog"
import { TREND_WEEKS, buildAppsOverview, integrationStatus, trendWeeks, weekStartOf, worstStatus } from "../metrics"

const NOW = new Date("2026-11-19T15:00:00Z") // jueves
const WEEK = "2026-11-16"
const job: AppCronJob = { jobName: "fuel-copec-sync", appId: "combustibles", label: "Copec", maxAgeHours: 26 }

function overview(partial: Partial<Parameters<typeof buildAppsOverview>[0]> = {}) {
  return buildAppsOverview({
    activity: [],
    users: [],
    last: [],
    access: [],
    cron: [],
    enabledModuleIds: new Set(APPS.map((app) => app.id)),
    currentWeekStart: WEEK,
    now: NOW,
    ...partial,
  })
}

const appOf = (result: ReturnType<typeof overview>, id: string) => result.apps.find((app) => app.id === id)!

describe("semanas", () => {
  it("el lunes de la semana", () => {
    expect(weekStartOf(new Date("2026-11-19T00:00:00Z"))).toBe("2026-11-16")
    expect(weekStartOf(new Date("2026-11-16T00:00:00Z"))).toBe("2026-11-16")
    expect(weekStartOf(new Date("2026-11-22T00:00:00Z"))).toBe("2026-11-16")
  })

  it("doce lunes terminando en la semana actual", () => {
    const weeks = trendWeeks(WEEK)
    expect(weeks).toHaveLength(TREND_WEEKS)
    expect(weeks.at(-1)).toBe(WEEK)
    expect(weeks[0]).toBe("2026-08-31")
  })
})

describe("estado de una integración", () => {
  const row = (outcome: string, aliveHoursAgo: number | null) => ({
    jobName: job.jobName,
    lastStartedAt: NOW.toISOString(),
    lastOutcome: outcome,
    lastDetail: null,
    lastAliveAt: aliveHoursAgo === null ? null : new Date(NOW.getTime() - aliveHoursAgo * 3_600_000).toISOString(),
    failures7d: 0,
  })

  it("sin corridas no es una alerta", () => expect(integrationStatus(job, undefined, NOW)).toBe("never"))
  it("la última corrida fallida manda", () => expect(integrationStatus(job, row("failed", 1), NOW)).toBe("failing"))
  it("al día dentro del plazo", () => expect(integrationStatus(job, row("success", 2), NOW)).toBe("ok"))
  it("una corrida omitida por candado cuenta como viva", () => expect(integrationStatus(job, row("skipped", 2), NOW)).toBe("ok"))
  it("detenida cuando pasa el plazo sin corrida buena", () => expect(integrationStatus(job, row("success", 30), NOW)).toBe("stale"))
  it("detenida si quedó colgada en curso", () => expect(integrationStatus(job, row("running", null), NOW)).toBe("stale"))

  it("el peor estado gana", () => {
    expect(worstStatus([])).toBe("none")
    expect(worstStatus(["ok", "never", "stale"])).toBe("stale")
    expect(worstStatus(["stale", "failing", "ok"])).toBe("failing")
  })
})

describe("indicadores por app", () => {
  it("suma movimientos de varios tipos en su app y arma la tendencia semanal", () => {
    const result = overview({
      activity: [
        { entityType: "purchase_request", weekStart: WEEK, weekCount: 5, windowCount: 5 },
        { entityType: "request_item", weekStart: WEEK, weekCount: 3, windowCount: 3 },
        { entityType: "purchase_request", weekStart: "2026-11-09", weekCount: 2, windowCount: 2 },
        { entityType: "purchase_request", weekStart: "2026-09-07", weekCount: 4, windowCount: 0 },
      ],
    })
    const requests = appOf(result, "requests")
    expect(requests.movements).toBe(10)
    expect(requests.trend.at(-1)).toBe(8)
    expect(requests.trend.at(-2)).toBe(2)
    expect(requests.trend[1]).toBe(4)
  })

  it("cuenta personas distintas por app y en total", () => {
    const result = overview({
      users: [
        { entityType: "purchase_request", userId: "u1" },
        { entityType: "request_item", userId: "u1" },
        { entityType: "purchase_order", userId: "u2" },
        { entityType: "tipo_sin_app", userId: "u3" },
      ],
    })
    expect(appOf(result, "requests").activeUsers).toBe(1)
    expect(appOf(result, "purchasing").activeUsers).toBe(1)
    expect(result.totalActiveUsers).toBe(3)
  })

  it("reporta los movimientos sin app en vez de esconderlos", () => {
    const result = overview({
      activity: [{ entityType: "tipo_sin_app", weekStart: WEEK, weekCount: 7, windowCount: 7 }],
    })
    expect(result.unassigned).toEqual({ movements: 7, entityTypes: ["tipo_sin_app"] })
  })

  it("una app sin movimientos en 30 días queda sin uso; una de sólo lectura, no", () => {
    const result = overview({
      last: [
        { entityType: "purchase_order", lastAt: "2026-11-18T10:00:00Z" },
        { entityType: "receipt", lastAt: "2026-09-01T10:00:00Z" },
      ],
    })
    expect(appOf(result, "purchasing").idle).toBe(false)
    expect(appOf(result, "receiving").idle).toBe(true)
    expect(appOf(result, "receiving").lastActivityAt).toBe("2026-09-01T10:00:00Z")
    expect(appOf(result, "reports").idle).toBe(false)
  })

  it("acceso, interruptor y peor estado de integraciones", () => {
    const enabled = new Set(APPS.map((app) => app.id).filter((id) => id !== "billing"))
    const result = overview({
      enabledModuleIds: enabled,
      access: [{ moduleId: "combustibles", users: 12 }],
      cron: [{
        jobName: "fuel-copec-sync",
        lastStartedAt: NOW.toISOString(),
        lastOutcome: "failed",
        lastDetail: "timeout",
        lastAliveAt: null,
        failures7d: 3,
      }],
    })
    const fuel = appOf(result, "combustibles")
    expect(fuel.usersWithAccess).toBe(12)
    expect(fuel.integrationStatus).toBe("failing")
    expect(fuel.integrations.find((integration) => integration.jobName === "fuel-copec-sync")?.failures7d).toBe(3)
    expect(appOf(result, "billing").enabled).toBe(false)
    expect(appOf(result, "requests").integrationStatus).toBe("none")
  })

  it("las visitas suman personas activas y sacan de «sin uso» a una app sin movimientos", () => {
    const result = overview({
      users: [{ entityType: "purchase_order", userId: "u1" }],
      visitors: [
        { moduleId: "purchasing", userId: "u1" },
        { moduleId: "purchasing", userId: "u2" },
        { moduleId: "reports", userId: "u3" },
      ],
      visits: [
        { moduleId: "purchasing", visits: 9, lastVisitAt: "2026-11-19T12:00:00Z" },
        { moduleId: "reports", visits: 4, lastVisitAt: "2026-11-18T12:00:00Z" },
      ],
      visitsTrackedSince: "2026-11-19",
    })
    const purchasing = appOf(result, "purchasing")
    expect(purchasing.activeUsers).toBe(2)
    expect(purchasing.movementUsers).toBe(1)
    expect(purchasing.visits).toBe(9)
    expect(purchasing.idle).toBe(false)
    expect(purchasing.lastActivityAt).toBe("2026-11-19T12:00:00Z")
    expect(appOf(result, "reports").activeUsers).toBe(1)
    expect(result.totalActiveUsers).toBe(3)
  })

  it("una app de sólo lectura queda «sin uso» sólo cuando las visitas cubren los 30 días", () => {
    expect(appOf(overview({ visitsTrackedSince: "2026-11-10" }), "analytics").idle).toBe(false)
    expect(appOf(overview({ visitsTrackedSince: "2026-09-01" }), "analytics").idle).toBe(true)
  })
})
