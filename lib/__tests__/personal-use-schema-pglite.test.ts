import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/**
 * Tabla de períodos de uso personal: la base impide solapes del mismo equipo
 * (trigger `PERSONAL_USE_OVERLAP`) y un término anterior al inicio (CHECK), pero
 * deja pasar períodos contiguos y el mismo rango en otro equipo.
 */

const pg = new PGlite()
const db = drizzle(pg, { schema })
const T = schema.fuelVehiclePersonalUsePeriods

let seq = 0
function period(vehicleId: string, startedOn: string, endedOn: string | null) {
  seq += 1
  return db.insert(T).values({ id: `pu-${seq}`, vehicleId, startedOn, endedOn })
}

/** El error que llega de PGlite envuelto por drizzle; el mensaje de Postgres viaja en `cause`. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    const e = error as { message?: string; cause?: { message?: string; code?: string } }
    return `${e.message ?? ""} ${e.cause?.message ?? ""} ${e.cause?.code ?? ""}`
  }
  return "sin error"
}

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  const now = new Date().toISOString()
  await db.insert(schema.worksites).values({ id: "ws-a", name: "Santa Fe", code: "FN-A", isActive: true, createdAt: now, updatedAt: now })
  await db.insert(schema.fuelEquipmentTypes).values({ id: "fet-t", slug: "t-t", name: "Camión", category: "truck", defaultMeterType: "odometer" })
  await db.insert(schema.fuelVehicles).values([
    { id: "v-1", plate: "PU-1", code: "KA-1", type: "Camión", equipmentTypeId: "fet-t", worksiteId: "ws-a", isActive: true },
    { id: "v-2", plate: "PU-2", code: "KA-2", type: "Camión", equipmentTypeId: "fet-t", worksiteId: "ws-a", isActive: true },
  ])
})

describe("fuel_vehicle_personal_use_periods", () => {
  it("rechaza solapes del mismo equipo", async () => {
    await period("v-1", "2026-09-01", "2026-09-10")
    expect(await failure(period("v-1", "2026-09-10", "2026-09-12"))).toContain("PERSONAL_USE_OVERLAP")
    // Un período abierto también choca con uno que empieza después de su inicio.
    await period("v-1", "2026-09-20", null)
    expect(await failure(period("v-1", "2026-10-05", "2026-10-06"))).toContain("PERSONAL_USE_OVERLAP")
  })

  it("rechaza un término anterior al inicio", async () => {
    expect(await failure(period("v-2", "2026-08-10", "2026-08-09"))).toMatch(/check|23514/i)
  })

  it("rechaza una fecha que no es YYYY-MM-DD", async () => {
    expect(await failure(period("v-2", "10-08-2026", null))).toMatch(/check|23514/i)
  })

  it("permite períodos contiguos", async () => {
    await period("v-2", "2026-10-01", "2026-10-05")
    expect(await failure(period("v-2", "2026-10-06", null))).toBe("sin error")
  })

  it("permite el mismo rango en otro equipo", async () => {
    await db.insert(schema.fuelVehicles).values({ id: "v-3", plate: "PU-3", code: "KA-3", type: "Camión", equipmentTypeId: "fet-t", worksiteId: "ws-a", isActive: true })
    expect(await failure(period("v-3", "2026-09-01", "2026-09-10"))).toBe("sin error")
  })

  it("al editar, la fila no choca consigo misma", async () => {
    await db.insert(schema.fuelVehicles).values({ id: "v-4", plate: "PU-4", code: "KA-4", type: "Camión", equipmentTypeId: "fet-t", worksiteId: "ws-a", isActive: true })
    await db.insert(T).values({ id: "pu-edit", vehicleId: "v-4", startedOn: "2026-07-01", endedOn: null })
    const { eq } = await import("drizzle-orm")
    expect(await failure(db.update(T).set({ endedOn: "2026-07-09" }).where(eq(T.id, "pu-edit")))).toBe("sin error")
  })
})
