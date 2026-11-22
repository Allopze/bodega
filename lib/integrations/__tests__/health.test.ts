import { describe, expect, it } from "vitest"
import { INTEGRATION_JOBS, type IntegrationJob } from "../health-catalog"
import { integrationStatus, worstStatus } from "../health"
import { APPS } from "@/lib/apps/catalog"

const NOW = new Date("2026-11-19T15:00:00Z")
const job: IntegrationJob = { jobName: "fuel-copec-sync", moduleId: "combustibles", label: "Copec", maxAgeHours: 26 }

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

describe("catálogo de integraciones", () => {
  it("no repite un job", () => {
    const names = INTEGRATION_JOBS.map((entry) => entry.jobName)
    expect(new Set(names).size).toBe(names.length)
  })

  it("cada job pertenece a un módulo con entrada en el catálogo de apps", () => {
    // El orden de los grupos de la pantalla sale del área de la app del módulo.
    const appIds = new Set(APPS.map((app) => app.id))
    for (const entry of INTEGRATION_JOBS) expect(appIds.has(entry.moduleId), entry.jobName).toBe(true)
  })
})
