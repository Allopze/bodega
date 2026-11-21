import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq, sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import {
  keptFractionSql,
  notPersonalUseOnDaySql,
  personalUseDaysInSql,
  personalUseOnDaySql,
} from "@/lib/fleet/personal-use-sql"

/** La regla común en SQL: el mismo cruce día ↔ período que la versión en memoria. */

const pg = new PGlite()
const db = drizzle(pg, { schema })
const V = schema.fuelVehicles

async function one<T>(expr: ReturnType<typeof sql<T>>, vehicleId = "v-1"): Promise<T> {
  const [row] = await db.select({ value: expr }).from(V).where(eq(V.id, vehicleId))
  return row!.value
}

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  const now = new Date().toISOString()
  await db.insert(schema.worksites).values({ id: "ws-a", name: "Santa Fe", code: "FN-A", isActive: true, createdAt: now, updatedAt: now })
  await db.insert(schema.fuelEquipmentTypes).values({ id: "fet-t", slug: "t-t", name: "Camión", category: "truck", defaultMeterType: "odometer" })
  await db.insert(V).values([
    { id: "v-1", plate: "PU-1", code: "KA-1", type: "Camión", equipmentTypeId: "fet-t", worksiteId: "ws-a", isActive: true },
    { id: "v-2", plate: "PU-2", code: "KA-2", type: "Camión", equipmentTypeId: "fet-t", worksiteId: "ws-a", isActive: true },
  ])
  await db.insert(schema.fuelVehiclePersonalUsePeriods).values([
    { id: "pu-1", vehicleId: "v-1", startedOn: "2026-10-10", endedOn: "2026-10-19" },
    { id: "pu-2", vehicleId: "v-2", startedOn: "2026-10-25", endedOn: null },
  ])
})

describe("personalUseOnDaySql", () => {
  it("es verdadero el último día del período y falso el siguiente", async () => {
    expect(await one(personalUseOnDaySql(V.id, sql`'2026-10-19'`))).toBe(true)
    expect(await one(personalUseOnDaySql(V.id, sql`'2026-10-20'`))).toBe(false)
    expect(await one(notPersonalUseOnDaySql(V.id, sql`'2026-10-20'`))).toBe(true)
  })

  it("un período abierto cubre cualquier día desde su inicio", async () => {
    expect(await one(personalUseOnDaySql(V.id, sql`'2026-10-24'`), "v-2")).toBe(false)
    expect(await one(personalUseOnDaySql(V.id, sql`'2026-12-31'`), "v-2")).toBe(true)
  })
})

describe("personalUseDaysInSql / keptFractionSql", () => {
  it("cuenta los días del período dentro del mes", async () => {
    expect(Number(await one(personalUseDaysInSql(V.id, sql`'2026-10-01'`, sql`'2026-10-31'`)))).toBe(10)
    expect(Number(await one(keptFractionSql(V.id, sql`'2026-10-01'`, sql`'2026-10-31'`)))).toBeCloseTo(21 / 31, 10)
  })

  it("un período abierto cuenta hasta hoy, no hasta el final del rango", async () => {
    expect(Number(await one(personalUseDaysInSql(V.id, sql`'2026-10-01'`, sql`'2026-10-31'`, "2026-11-20"), "v-2"))).toBe(7)
    expect(Number(await one(personalUseDaysInSql(V.id, sql`'2026-10-01'`, sql`'2026-10-31'`, "2026-10-28"), "v-2"))).toBe(4)
  })

  it("un registro del mes en curso se prorratea sobre los días transcurridos", async () => {
    // Hoy 28-10, abierto desde el 25: 4 días personales de 28 transcurridos.
    expect(Number(await one(keptFractionSql(V.id, sql`'2026-10-01'`, sql`'2026-10-31'`, "2026-10-28"), "v-2"))).toBeCloseTo(24 / 28, 10)
  })

  it("un registro con período inválido o al revés se conserva entero, sin romper la consulta", async () => {
    // Texto tipado, como las columnas `periodo_desde/hasta` (un literal sin tipo lo convierte el analizador).
    expect(Number(await one(keptFractionSql(V.id, sql`'2026-10-10'::text`, sql`'2026-10-09'::text`)))).toBe(1)
    expect(Number(await one(keptFractionSql(V.id, sql`'no-es-fecha'::text`, sql`'2026-10-31'::text`)))).toBe(1)
    expect(Number(await one(keptFractionSql(V.id, sql`null::text`, sql`'2026-10-31'::text`)))).toBe(1)
  })

  it("sin equipo la fracción es 1", async () => {
    expect(Number(await one(keptFractionSql(sql`null::text`, sql`'2026-10-01'`, sql`'2026-10-31'`)))).toBe(1)
  })

  it("un rango sin uso personal se conserva entero", async () => {
    expect(Number(await one(keptFractionSql(V.id, sql`'2026-09-01'`, sql`'2026-09-30'`)))).toBe(1)
  })
})
