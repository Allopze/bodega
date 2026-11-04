/**
 * «Por revisar» › casos por semana (CHART-023, P-6) contra Postgres real (PGlite): cuándo se creó o
 * se modificó una regla de detección, para marcarlo en la serie.
 *
 * `fuel_anomaly_rules` no tiene versionado, así que el dato se arma con `created_at`, la bitácora
 * (`audit_log`, entidad `fuel_anomaly_rule`) y `updated_at`. Aquí se comprueba cada fuente, que un
 * mismo cambio contado por dos no se duplique y que el día se mida en hora de Chile.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

import { getFuelAnomalyRuleChanges } from "@/lib/combustibles/inbox/queries"

// Martes 3 de noviembre de 2026, mediodía en Chile (UTC-3): la ventana de cuatro semanas parte el lunes 12 de octubre.
const NOW = new Date("2026-11-03T15:00:00.000Z")

let seq = 0
async function audit(values: { entityType?: string; action?: string; entityId: string; entityCode?: string; createdAt: string }) {
  seq += 1
  await inMemoryDb.insert(schema.auditLog).values({ id: `aud-${seq}`, entityType: "fuel_anomaly_rule", action: "update", ...values })
}

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

describe("cambios de reglas de detección", () => {
  beforeAll(async () => {
    await inMemoryDb.insert(schema.fuelAnomalyRules).values([
      // Creada antes de la ventana y tocada el 29 de octubre sin pasar por la bitácora (guardar el umbral de rendimiento).
      { id: "r-sello", code: "sello_repetido", name: "Sello repetido", severity: "high", createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-10-29T15:00:00.000Z" },
      // Creada dentro de la ventana (por el cron o por una persona): `updated_at` nace igual.
      { id: "r-km", code: "kilometraje_regresivo", name: "Kilometraje inferior al anterior", severity: "high", createdAt: "2026-10-21T13:00:00.000Z", updatedAt: "2026-10-21T13:00:00.000Z" },
      // Editada dos veces; la última queda en `updated_at` y también en la bitácora.
      { id: "r-hor", code: "horometro_regresivo", name: "Horómetro inferior al anterior", severity: "high", createdAt: "2026-08-01T12:00:00.000Z", updatedAt: "2026-10-14T13:00:00.000Z" },
      // Vieja y quieta: no aparece.
      { id: "r-old", code: "carga_fuera_horario", name: "Carga fuera de horario operativo", severity: "low", createdAt: "2026-08-01T12:00:00.000Z", updatedAt: "2026-08-01T12:00:00.000Z" },
      { id: "r-cfd", code: "carga_faena_distinta", name: "Carga en faena distinta de la asignada al equipo", severity: "medium", createdAt: "2026-08-01T12:00:00.000Z", updatedAt: "2026-08-01T12:00:00.000Z" },
    ])
    await audit({ entityId: "r-hor", entityCode: "horometro_regresivo", createdAt: "2026-10-13T13:00:00.000Z" })
    await audit({ entityId: "r-hor", entityCode: "horometro_regresivo", createdAt: "2026-10-14T13:00:00.500Z" })
    // 02:30 UTC del lunes 2 de noviembre = domingo 1 a las 23:30 en Chile: es del día 1 y de la semana del 26 de octubre.
    await audit({ entityId: "r-cfd", entityCode: "carga_faena_distinta", createdAt: "2026-11-02T02:30:00.000Z" })
    // Lo que no es un cambio de regla: otra entidad, la creación (ya la cubre `created_at`) y una edición anterior a la ventana.
    await audit({ entityType: "fuel_control_settings", entityId: "performance", createdAt: "2026-10-20T12:00:00.000Z" })
    await audit({ action: "create", entityId: "r-km", entityCode: "kilometraje_regresivo", createdAt: "2026-10-21T13:00:00.000Z" })
    await audit({ entityId: "r-old", entityCode: "carga_fuera_horario", createdAt: "2026-09-02T12:00:00.000Z" })
  })

  it("junta la creación, cada edición de la bitácora y el `updated_at` sin explicar, de más antiguo a más reciente", async () => {
    const changes = await getFuelAnomalyRuleChanges({ now: NOW, weeks: 4 })

    expect(changes.map(({ ruleCode, kind, day, weekStart }) => [ruleCode, kind, day, weekStart])).toEqual([
      ["horometro_regresivo", "changed", "2026-10-13", "2026-10-12"],
      // La última edición está en la bitácora y en `updated_at`: cuenta una sola vez.
      ["horometro_regresivo", "changed", "2026-10-14", "2026-10-12"],
      ["kilometraje_regresivo", "created", "2026-10-21", "2026-10-19"],
      ["sello_repetido", "changed", "2026-10-29", "2026-10-26"],
      // Domingo de noche en Chile: es del 1 de noviembre y de la semana que parte el 26.
      ["carga_faena_distinta", "changed", "2026-11-01", "2026-10-26"],
    ])
  })

  it("trae el nombre de la regla para que el gráfico la nombre", async () => {
    const changes = await getFuelAnomalyRuleChanges({ now: NOW, weeks: 4 })

    expect(changes.find((change) => change.ruleCode === "kilometraje_regresivo")?.ruleName).toBe("Kilometraje inferior al anterior")
    expect(changes.find((change) => change.ruleCode === "carga_faena_distinta")?.ruleName).toBe("Carga en faena distinta de la asignada al equipo")
  })

  it("una ventana más corta deja fuera lo anterior a ella", async () => {
    const changes = await getFuelAnomalyRuleChanges({ now: NOW, weeks: 2 })

    expect(changes.map((change) => change.ruleCode)).toEqual(["sello_repetido", "carga_faena_distinta"])
  })

  it("una regla sin cambios en la ventana no deja ninguno", async () => {
    expect(await getFuelAnomalyRuleChanges({ now: new Date("2027-03-03T15:00:00.000Z"), weeks: 4 })).toEqual([])
  })
})
