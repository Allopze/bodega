import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

// El script importa `@/db` estáticamente: se importa dinámicamente dentro de
// cada test, una vez asignado `testGlobal.__db`.

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const ACTOR = "jefatura@chome.test"
const OLD_CAMIONES = "Planilla «Diferencias actividades por equipo»."

async function load() { return import("../apply-mantencion-correcciones-2026-10-31") }

async function origin(name: string) {
  const [row] = await inMemoryDb.select().from(schema.mantSchedules).where(eq(schema.mantSchedules.name, name))
  return row?.origin
}

beforeEach(async () => {
  await pg.exec("TRUNCATE audit_log, mant_equipment_history, mant_equipment_profiles, mant_schedules, mant_brands, fuel_vehicles, worksites, users CASCADE")
  await inMemoryDb.insert(schema.users).values({ id: "u-actor", name: "Jefatura", email: ACTOR, hashedPassword: "x" })
  await inMemoryDb.insert(schema.mantSchedules).values([
    { id: "s-cam", name: "Camiones y tractos", nameKey: "camiones y tractos", unit: "km", origin: OLD_CAMIONES },
    { id: "s-maq", name: "Maquinaria pesada", nameKey: "maquinaria pesada", unit: "h", origin: "Texto editado por una persona." },
  ])
})

describe("apply-mantencion-correcciones-2026-10-31", () => {
  it("dry-run no escribe", async () => {
    const { applyMantencionCorrecciones20261031, SCHEDULE_ORIGIN_FIXES } = await load()
    const out = await applyMantencionCorrecciones20261031({ actorEmail: ACTOR })
    expect(out.find((o) => o.item === "Camiones y tractos")?.result).toBe("dry-run")
    expect(await origin("Camiones y tractos")).toBe(OLD_CAMIONES)
    expect(SCHEDULE_ORIGIN_FIXES[0].oldOrigin).toBe(OLD_CAMIONES)
    expect(await inMemoryDb.select().from(schema.auditLog)).toHaveLength(0)
  })

  it("--apply corrige sólo la descripción que aún trae el texto viejo, y repetirlo no cambia nada", async () => {
    const { applyMantencionCorrecciones20261031, SCHEDULE_ORIGIN_FIXES } = await load()
    const first = await applyMantencionCorrecciones20261031({ actorEmail: ACTOR, apply: true })
    expect(first.find((o) => o.item === "Camiones y tractos")?.result).toBe("aplicado")
    expect(first.find((o) => o.item === "Maquinaria pesada")?.result).toBe("omitido")
    expect(await origin("Camiones y tractos")).toBe(SCHEDULE_ORIGIN_FIXES[0].newOrigin)
    expect(await origin("Maquinaria pesada")).toBe("Texto editado por una persona.")
    expect(await inMemoryDb.select().from(schema.auditLog)).toHaveLength(1)
    const second = await applyMantencionCorrecciones20261031({ actorEmail: ACTOR, apply: true })
    expect(second.find((o) => o.item === "Camiones y tractos")?.result).toBe("ya estaba")
    expect(await inMemoryDb.select().from(schema.auditLog)).toHaveLength(1)
  })

  it("P3_APPROVED viene vacía: sin aprobaciones no toca equipos", async () => {
    const { P3_APPROVED, applyMantencionCorrecciones20261031 } = await load()
    expect(P3_APPROVED).toHaveLength(0)
    const out = await applyMantencionCorrecciones20261031({ actorEmail: ACTOR, apply: true })
    expect(out.find((o) => o.item === "equipos P3")?.result).toBe("omitido")
  })

  it("rechaza un correo sin usuario activo", async () => {
    const { applyMantencionCorrecciones20261031 } = await load()
    await expect(applyMantencionCorrecciones20261031({ actorEmail: "nadie@chome.test" })).rejects.toThrow(/usuario activo/)
  })

  it("aplica correcciones de equipos aprobadas: código, patente real y paso a horas", async () => {
    const { applyMantencionCorrecciones20261031 } = await load()
    await inMemoryDb.insert(schema.worksites).values({ id: "w1", name: "Faena", code: "FAENA", isActive: true })
    await inMemoryDb.insert(schema.mantBrands).values({ id: "b1", name: "Marca", nameKey: "marca" })
    await inMemoryDb.insert(schema.fuelEquipmentTypes).values({
      id: "fet-grua-horquilla", name: "Grúa horquilla", slug: "grua-horquilla", category: "heavy",
      defaultMeterType: "hour_meter", defaultPerformanceUnit: "liters_per_hour",
    } as never).onConflictDoNothing()
    const base = { type: "Camión", worksiteId: "w1", equipmentTypeId: "fet-camion", meterType: "odometer", performanceUnit: "km_per_liter" }
    await inMemoryDb.insert(schema.fuelVehicles).values([
      { id: "v1", plate: "CBJY-18", code: "KA-91", ...base },
      { id: "v2", plate: "CPSG-30", code: "CPSG-30", ...base },
      { id: "v3", plate: "LC-1315", code: "LC-1315", ...base },
    ])
    await inMemoryDb.insert(schema.mantEquipmentProfiles).values([
      { vehicleId: "v1", brandId: "b1", scheduleId: "s-cam", noPlate: false },
      { vehicleId: "v2", brandId: "b1", scheduleId: "s-cam", noPlate: true },
      { vehicleId: "v3", brandId: "b1", scheduleId: "s-cam", noPlate: true },
    ])
    const approved = [
      { kind: "renombrar-codigo", code: "KA-91", newCode: "KA-71", plateExpected: "CBJY-18" },
      { kind: "patente-real", code: "CPSG-30" },
      { kind: "a-horas", code: "LC-1315", typeName: "Grúa horquilla", scheduleName: "Maquinaria pesada" },
    ] as const
    const out = await applyMantencionCorrecciones20261031({ actorEmail: ACTOR, apply: true, approved })
    expect(out.filter((o) => o.item !== "Camiones y tractos" && o.item !== "Maquinaria pesada").map((o) => o.result)).toEqual(["aplicado", "aplicado", "aplicado"])
    const [v1] = await inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, "v1"))
    expect(v1?.code).toBe("KA-71")
    const [p2] = await inMemoryDb.select().from(schema.mantEquipmentProfiles).where(eq(schema.mantEquipmentProfiles.vehicleId, "v2"))
    expect(p2?.noPlate).toBe(false)
    const [v3] = await inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, "v3"))
    expect(v3).toMatchObject({ type: "Grúa horquilla", equipmentTypeId: "fet-grua-horquilla", meterType: "hour_meter", performanceUnit: "liters_per_hour" })
    const [p3] = await inMemoryDb.select().from(schema.mantEquipmentProfiles).where(eq(schema.mantEquipmentProfiles.vehicleId, "v3"))
    expect(p3?.scheduleId).toBe("s-maq")
    // Idempotente.
    const again = await applyMantencionCorrecciones20261031({ actorEmail: ACTOR, apply: true, approved })
    expect(again.filter((o) => o.item === "LC-1315" || o.item === "CPSG-30").map((o) => o.result)).toEqual(["ya estaba", "ya estaba"])
  })
})
