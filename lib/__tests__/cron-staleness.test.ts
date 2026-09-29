/**
 * PRV-14 (auditoría de production readiness 2026-09-28): la vigilancia de jobs
 * de Prevención detenidos. Un job que no corre no falla, así que sólo lo delata
 * la falta de corridas exitosas en `cron_runs`.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const tdb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof tdb }
// @ts-expect-error PGlite es compatible en tiempo de ejecución
testGlobal.__db = tdb
await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const NOW = new Date("2026-09-28T15:00:00.000Z")
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString()
let seq = 0
const run = (jobName: string, startedAt: string, outcome = "success") =>
  tdb.insert(schema.cronRuns).values({ id: `cr-${seq++}`, jobName, startedAt, outcome })

beforeEach(async () => {
  await tdb.delete(schema.cronRuns)
})

describe("findStalePreventionCronJobs", () => {
  it("reporta un job diario sin corrida exitosa hace más de 26 h, y no uno al día", async () => {
    const { findStalePreventionCronJobs } = await import("@/lib/services/cron-staleness")
    await run("prevention-cron-staleness", hoursAgo(24 * 30))
    await run("prevention-capa-reminders", hoursAgo(30))
    await run("prevention-capa-reminders", hoursAgo(2), "failed")
    await run("prevention-training-reminders", hoursAgo(10))
    const stale = await findStalePreventionCronJobs(NOW)
    const names = stale.map((job) => job.jobName)
    expect(names).toContain("prevention-capa-reminders")
    expect(names).not.toContain("prevention-training-reminders")
    expect(stale.find((job) => job.jobName === "prevention-capa-reminders")).toMatchObject({ maxAgeHours: 26, lastSuccessAt: expect.any(String) })
  })

  it("una corrida saltada por el candado cuenta como viva", async () => {
    const { findStalePreventionCronJobs } = await import("@/lib/services/cron-staleness")
    await run("prevention-cron-staleness", hoursAgo(24 * 30))
    await run("prevention-permit-expiry", hoursAgo(0.25), "skipped")
    const names = (await findStalePreventionCronJobs(NOW)).map((job) => job.jobName)
    expect(names).not.toContain("prevention-permit-expiry")
  })

  it("no avisa de jobs que nunca corrieron el día en que empieza la vigilancia", async () => {
    const { findStalePreventionCronJobs } = await import("@/lib/services/cron-staleness")
    await run("prevention-cron-staleness", hoursAgo(0.5))
    const names = (await findStalePreventionCronJobs(NOW)).map((job) => job.jobName)
    expect(names).not.toContain("pdtp-daily-reconcile")
    expect(names).not.toContain("pdtp-weekly-reminders")
  })
})
