import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { desc, eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/**
 * CO-062: el escaneo batch ya no vuelve a procesar siempre las mismas primeras
 * filas. Pagina por vehículo, guarda el cursor en la regla y marca la corrida
 * como truncada cuando quedan vehículos fuera; el cron la reporta `partial`.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const { runAllBatchRules } = await import("@/lib/combustibles/anomaly-detector")

const RULE_ID = "rule-cursor"
const WS = "ws-cursor"
const USER = "user-cursor"
const TYPE = "type-cursor"
const BATCH = "batch-cursor"
const TOTAL = 101
const PAGE = 100

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values({
    id: USER, name: "Cursor", email: "cursor@test.local", hashedPassword: "x", isActive: true,
  })
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena cursor", code: "CUR", isActive: true })
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: TYPE, slug: "camion-cursor", name: "Camión cursor" })
  await testDb.insert(schema.fuelOperationBatches).values({
    id: BATCH, archivoNombre: "cursor.xlsx", hashArchivo: "cursor-hash", estado: "importado",
    periodoDesde: "2026-06-01", periodoHasta: "2026-06-30", importadoPor: USER,
  })
  await testDb.insert(schema.fuelAnomalyRules).values({
    id: RULE_ID, code: "rendimiento_fuera_historico", name: "Rendimiento fuera de histórico",
    description: null, severity: "medium", isActive: true,
    config: JSON.stringify({ minSample: 3, batchRowLimit: PAGE }),
  })

  const vehicles = Array.from({ length: TOTAL }, (_, index) => {
    const id = `veh-${String(index).padStart(3, "0")}`
    return {
      id, plate: `CU-${String(index).padStart(3, "0")}`, type: "camion",
      equipmentTypeId: TYPE, worksiteId: WS, isActive: true, performanceUnit: "km_per_liter",
    }
  })
  await testDb.insert(schema.fuelVehicles).values(vehicles)
  await testDb.insert(schema.fuelOperationRecords).values(vehicles.map((vehicle, index) => ({
    id: `op-${String(index).padStart(3, "0")}`,
    batchId: BATCH,
    worksiteId: WS,
    vehicleId: vehicle.id,
    plate: vehicle.plate,
    fecha: `2026-06-${String((index % 28) + 1).padStart(2, "0")}`,
    liters: 10,
    rendimiento: 10,
    tipoRendimiento: "km_lt",
  })))
})

describe("runAllBatchRules · cursor durable y truncamiento", () => {
  it("procesa una página de vehículos, guarda el cursor y marca truncated", async () => {
    const results = await runAllBatchRules()
    const result = results.find((row) => row.ruleCode === "rendimiento_fuera_historico")!

    expect(result).toMatchObject({ status: "completed", failed: 0, truncated: true })

    const [rule] = await testDb.select({ cursor: schema.fuelAnomalyRules.cursor })
      .from(schema.fuelAnomalyRules)
      .where(eq(schema.fuelAnomalyRules.id, RULE_ID))
    // 101 vehículos, página de 100: el cursor queda en el último de la página.
    expect(rule?.cursor).toBe("veh-099")

    const [execution] = await testDb.select({
      truncated: schema.fuelAnomalyExecutions.truncated,
      casesFailed: schema.fuelAnomalyExecutions.casesFailed,
    })
      .from(schema.fuelAnomalyExecutions)
      .where(eq(schema.fuelAnomalyExecutions.ruleId, RULE_ID))
      .orderBy(desc(schema.fuelAnomalyExecutions.startedAt))
      .limit(1)
    expect(execution).toMatchObject({ truncated: true, casesFailed: 0 })
  })
})
