import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB, Tx } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures, submission } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Revisión de una carga TAE: un día de uso personal no abre casos por usar el
 * equipo fuera de la operación («fuera de horario», «faena distinta»). Las reglas
 * de integridad del dato (sellos, lecturas, evidencia) siguen igual.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { detectTaeAnomaliesInTx } = await import("@/lib/services/fuel-tae/anomalies")

const SATURDAY_NOON = "2026-10-17T15:00:00.000Z" // sábado 17-10, 12:00 en Chile: fuera de un horario lunes a viernes

async function review(id: string, overrides: Partial<typeof schema.fuelTaeSubmissions.$inferInsert>) {
  const row = submission({ id, loadedAt: SATURDAY_NOON, submittedAt: SATURDAY_NOON, removedSealNumber: `R-${id}`, installedSealNumber: `I-${id}`, ...overrides })
  await testDb.insert(schema.fuelTaeSubmissions).values(row)
  const [saved] = await testDb.select().from(schema.fuelTaeSubmissions).where(eq(schema.fuelTaeSubmissions.id, id))
  await testDb.transaction(async (tx) => {
    await detectTaeAnomaliesInTx(saved as Parameters<typeof detectTaeAnomaliesInTx>[0], tx as unknown as Tx, IDS.user, "validated")
  })
  const cases = await testDb.select({ ruleCode: schema.fuelAnomalyCases.ruleCode }).from(schema.fuelAnomalyCases)
    .where(and(eq(schema.fuelAnomalyCases.referenceEntityType, "fuel_tae_submission"), eq(schema.fuelAnomalyCases.referenceEntityId, id)))
  return cases.map((c) => c.ruleCode).sort()
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  const now = "2026-10-01T12:00:00.000Z"
  await testDb.insert(schema.fuelAnomalyRules).values([
    { id: "r-horario", code: "carga_fuera_horario", name: "Carga fuera de horario operativo", severity: "low", createdAt: now, updatedAt: now },
    { id: "r-faena", code: "carga_faena_distinta", name: "Carga en faena distinta", severity: "medium", createdAt: now, updatedAt: now },
  ]).onConflictDoNothing()
  const schedule = { timezone: "America/Santiago", days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" }
  await testDb.update(schema.fuelVehicles).set({ operatingSchedule: schedule }).where(eq(schema.fuelVehicles.id, IDS.vA))
  await testDb.update(schema.fuelVehicles).set({ operatingSchedule: schedule }).where(eq(schema.fuelVehicles.id, IDS.vB))
  await testDb.insert(schema.fuelVehiclePersonalUsePeriods).values({ id: "tae-pu", vehicleId: IDS.vB, startedOn: "2026-10-15", endedOn: "2026-10-19" })
}, 60_000)

describe("detectTaeAnomaliesInTx con uso personal", () => {
  it("sin uso personal, una carga del sábado en otra faena abre «fuera de horario» y «faena distinta»", async () => {
    // vA es de la faena A; la carga se registra en la B.
    expect(await review("tae-sin-pu", { vehicleId: IDS.vA, worksiteId: IDS.wsC })).toEqual(["carga_faena_distinta", "carga_fuera_horario"])
  })

  it("en un día de uso personal, la misma carga no abre esos casos", async () => {
    // vB es de la faena B; la carga se registra en la C, dentro de su período de uso personal.
    expect(await review("tae-con-pu", { vehicleId: IDS.vB, worksiteId: IDS.wsC, equipmentCodeSnapshot: "KB-2" })).toEqual([])
  })
})
