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

async function run(apply: boolean) {
  const { applyFleetCopecDecisions20261029 } = await import("../apply-fleet-copec-decisions-2026-10-29")
  return applyFleetCopecDecisions20261029({ actorEmail: ACTOR, apply })
}

async function worksiteId(name: string, isActive = true) {
  const rows = await inMemoryDb.select().from(schema.worksites).where(eq(schema.worksites.name, name))
  return rows.find((row) => row.isActive === isActive)?.id
}

/** La forma de producción el 2026-10-29: faenas activas y dadas de baja con el mismo nombre. */
beforeEach(async () => {
  // CASCADE: dar de alta una faena le crea casillas del programa preventivo en varias tablas.
  await pg.exec("TRUNCATE audit_log, fuel_storage_locations, fuel_vehicle_products, fuel_vehicle_operational_intervals, fuel_vehicles, worksites, users CASCADE")
  await inMemoryDb.insert(schema.users).values({ id: "u-actor", name: "Jefatura", email: ACTOR, hashedPassword: "x" })
  for (const id of ["fuel-diesel", "fuel-bluemax"]) {
    await inMemoryDb.insert(schema.fuelProducts).values({ id, code: id, name: id }).onConflictDoNothing()
  }
  await inMemoryDb.insert(schema.worksites).values([
    { id: "w-bio", name: "Biodiversa", code: "BIODIVERSA", isActive: true },
    { id: "w-cho", name: "Cholguan - Arauco", code: "CHOLGUAN-ARAUCO", isActive: true },
    { id: "w-sfg", name: "Santa Fe - Grúas", code: "SANTA-FE-GRUAS", isActive: true },
    { id: "w-mas", name: "Masisa", code: "MASISA", isActive: true },
    { id: "w-ofi", name: "Oficina Central", code: "OFICINA-CENTRAL", isActive: true },
    { id: "w-mas-old", name: "Masisa", code: "FA-006", isActive: false },
    { id: "w-pac-old", name: "Pacifico", code: "FA-007", isActive: false },
  ])
  await inMemoryDb.insert(schema.fuelVehicles).values([
    { id: "v-old-1", plate: "AAAA-11", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-mas-old" },
    { id: "v-old-2", plate: "BBBB-22", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-mas-old" },
    { id: "v-pac", plate: "CCCC-33", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-pac-old" },
  ])
})

describe("decisiones de flota para la sincronización Copec (2026-10-29)", () => {
  it("en dry-run informa el plan completo y no escribe nada", async () => {
    const outcomes = await run(false)
    expect(outcomes.filter((o) => o.action === "crear faena").map((o) => o.result)).toEqual(["dry-run", "dry-run"])
    expect(outcomes.filter((o) => o.action.startsWith("alta ")).every((o) => o.result === "dry-run")).toBe(true)
    // Los que van a una faena nueva lo dicen: en dry-run la faena todavía no existe.
    expect(outcomes.find((o) => o.item === "RFJR-63")).toMatchObject({ result: "dry-run", detail: "la faena se crea o reactiva en este mismo plan" })
    expect(await inMemoryDb.select().from(schema.auditLog)).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.fuelVehicles)).toHaveLength(3)
    expect(await inMemoryDb.select().from(schema.fuelStorageLocations)).toHaveLength(0)
  })

  it("crea las faenas, reactiva Pacífico, traslada a la activa, da de alta los 32 vehículos y las 3 vasijas, con bitácora", async () => {
    await run(true)

    const fabrica = await worksiteId("Fábrica de Puertas")
    const flor = await worksiteId("Flor del Laja")
    expect(fabrica).toBeTruthy()
    expect(flor).toBeTruthy()

    // Masisa de baja → Masisa activa. Pacífico se reactiva (no se duplica) y su vehículo se queda.
    const moved = await inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.worksiteId, "w-mas"))
    expect(moved.map((v) => v.plate).sort()).toEqual(["AAAA-11", "BBBB-22"])
    expect((await inMemoryDb.select().from(schema.worksites).where(eq(schema.worksites.id, "w-pac-old")))[0]?.isActive).toBe(true)
    expect((await inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, "v-pac")))[0]?.worksiteId).toBe("w-pac-old")

    const created = (await inMemoryDb.select().from(schema.fuelVehicles)).filter((v) => v.notes?.endsWith("Copec (2026-10-29)."))
    expect(created).toHaveLength(32)
    const byPlate = new Map(created.map((v) => [v.plate, v]))
    expect(byPlate.get("KXZD-20")).toMatchObject({ code: "KCH-130", type: "tracto", equipmentTypeId: "fet-tracto", meterType: "odometer", worksiteId: "w-sfg", brand: "Mercedes", year: 2018 })
    expect(byPlate.get("RBYD-98")).toMatchObject({ code: "KA-135", type: "camion", worksiteId: "w-cho" })
    expect(byPlate.get("RFJR-63")?.worksiteId).toBe(fabrica)
    expect(byPlate.get("WK-5867")?.worksiteId).toBe(flor)
    expect(byPlate.get("FZFS-26")).toMatchObject({ code: "KCH-119", worksiteId: "w-pac-old" })
    // Segunda tanda: inventario + faena decidida; ADMINISTRACION va a Oficina Central.
    expect(byPlate.get("VHVL-38")).toMatchObject({ code: "CA-99", type: "camioneta", equipmentTypeId: "fet-camioneta", worksiteId: "w-ofi" })
    expect(byPlate.get("RWYH-93")?.worksiteId).toBe("w-ofi")
    const minibus = (await inMemoryDb.select().from(schema.fuelEquipmentTypes).where(eq(schema.fuelEquipmentTypes.slug, "minibus")))[0]
    expect(minibus).toMatchObject({ name: "Minibús", category: "light", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter", isActive: true })
    expect(byPlate.get("FBKS-63")).toMatchObject({ type: "minibus", equipmentTypeId: minibus!.id, meterType: "odometer" })
    expect(byPlate.get("TBZW-37")).toMatchObject({ worksiteId: fabrica, year: null })

    const products = await inMemoryDb.select().from(schema.fuelVehicleProducts).where(eq(schema.fuelVehicleProducts.vehicleId, byPlate.get("SGCP-77")!.id))
    expect(products.map((p) => p.productId).sort()).toEqual(["fuel-bluemax", "fuel-diesel"])
    const intervals = await inMemoryDb.select().from(schema.fuelVehicleOperationalIntervals).where(eq(schema.fuelVehicleOperationalIntervals.vehicleId, byPlate.get("SGCP-77")!.id))
    expect(intervals).toHaveLength(1)

    const tanks = await inMemoryDb.select().from(schema.fuelStorageLocations)
    expect(tanks.map((t) => [t.taeCardNumber, t.worksiteId, t.productId]).sort()).toEqual([
      ["1-242269-00230-9-1", "w-cho", "fuel-diesel"],
      ["1-242269-00233-9-8", "w-mas", "fuel-diesel"],
      ["1-242269-00248-9-1", flor, "fuel-diesel"],
    ].sort())

    const audit = await inMemoryDb.select().from(schema.auditLog)
    // 2 faenas + 1 tipo + 1 reactivación + 2 traslados + 32 vehículos + 3 estanques, todos del responsable.
    expect(audit).toHaveLength(41)
    expect(audit.every((row) => row.userId === "u-actor")).toBe(true)
  })

  it("una segunda corrida no escribe nada: todo «ya estaba»", async () => {
    await run(true)
    const auditAfterFirst = (await inMemoryDb.select().from(schema.auditLog)).length
    const second = await run(true)
    expect(second.filter((o) => o.result === "aplicado")).toEqual([])
    expect((await inMemoryDb.select().from(schema.auditLog)).length).toBe(auditAfterFirst)
    expect(await inMemoryDb.select().from(schema.fuelVehicles)).toHaveLength(35)
  })

  it("respeta una patente que ya existe y una faena nueva que ya estaba con otro nombre", async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: "w-fab", name: "Fab. Puertas", code: "FAB-PUERTAS", isActive: true })
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: "v-kxzd", plate: "KXZD20", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-bio" })
    const outcomes = await run(true)
    expect(outcomes.find((o) => o.item === "Fábrica de Puertas")).toMatchObject({ result: "ya estaba" })
    expect(outcomes.find((o) => o.item === "KXZD-20")).toMatchObject({ result: "ya estaba" })
    expect((await inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, "v-kxzd")))[0]?.worksiteId).toBe("w-bio")
    expect((await inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.plate, "RFJR-63")))[0]?.worksiteId).toBe("w-fab")
  })

  it("corrige lo que dejó la corrida anterior: RWYH-93 a Oficina Central y FBKS-63 al tipo Minibús", async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: "w-fab", name: "Fab. Puertas", code: "FAB-PUERTAS", isActive: true })
    await inMemoryDb.insert(schema.fuelVehicles).values([
      { id: "v-rwyh", plate: "RWYH-93", code: "CA-96", type: "camioneta", equipmentTypeId: "fet-camioneta", worksiteId: "w-pac-old" },
      { id: "v-fbks", plate: "FBKS-63", code: "CA-95", type: "camioneta", equipmentTypeId: "fet-camioneta", worksiteId: "w-fab" },
    ])
    const outcomes = await run(true)
    expect(outcomes.filter((o) => o.action.startsWith("corregir")).map((o) => [o.item, o.result])).toEqual([["RWYH-93", "aplicado"], ["FBKS-63", "aplicado"]])
    expect((await inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, "v-rwyh")))[0]?.worksiteId).toBe("w-ofi")
    expect((await inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, "v-fbks")))[0]).toMatchObject({ type: "minibus", worksiteId: "w-fab" })
    const corrections = (await inMemoryDb.select().from(schema.auditLog)).filter((row) => row.action === "update" && (row.reason?.includes("corresponde a Administración") || row.reason?.includes("es un minibús")))
    expect(corrections).toHaveLength(2)

    const again = await run(true)
    expect(again.filter((o) => o.action.startsWith("corregir")).map((o) => o.result)).toEqual(["ya estaba", "ya estaba"])
  })

  it("no traslada si hay más de una faena activa con el mismo nombre", async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: "w-mas-2", name: "MASISA", code: "MASISA-2", isActive: true })
    const outcomes = await run(true)
    expect(outcomes.find((o) => o.item === "Masisa")).toMatchObject({ result: "omitido", detail: "hay más de una faena activa con ese nombre" })
    expect((await inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, "v-old-1")))[0]?.worksiteId).toBe("w-mas-old")
  })

  it("exige un responsable activo para la bitácora", async () => {
    const { applyFleetCopecDecisions20261029 } = await import("../apply-fleet-copec-decisions-2026-10-29")
    await expect(applyFleetCopecDecisions20261029({ actorEmail: "nadie@chome.test", apply: true })).rejects.toThrow(/responsable/)
    expect(await inMemoryDb.select().from(schema.auditLog)).toHaveLength(0)
  })
})
