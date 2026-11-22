import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq, inArray } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

// Alta de los equipos del consolidado que faltaban en la flota (Trinorma, 2026-11-21). El script
// importa `@/db` estáticamente: se importa dinámicamente, ya asignado `testGlobal.__db`.

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

const ACTOR = "jefatura@chome.test"
const TERCERO = "Persona Tercera de Prueba"
const SITES = [
  { id: "w-pac", code: "FA-007", name: "Pacifico" },
  { id: "w-sf", code: "SANTA-FE", name: "Santa Fe" },
  { id: "w-flor", code: "FLOR-DEL-LAJA", name: "Flor del Laja" },
  { id: "w-bio", code: "BIODIVERSA", name: "Biodiversa" },
  { id: "w-ten", code: "TENO-ARAUCO", name: "Teno - Arauco" },
  { id: "w-ofi", code: "OFICINA-CENTRAL", name: "Oficina Central" },
  { id: "w-hor", code: "HORCONES", name: "Arauco" },
]
const TYPES = [
  { slug: "camioneta", name: "Camioneta", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" },
  { slug: "grua_horquilla", name: "Grúa horquilla", defaultMeterType: "hour_meter", defaultPerformanceUnit: "liters_per_hour" },
  { slug: "batea", name: "Batea", defaultMeterType: "none", defaultPerformanceUnit: "not_applicable" },
  { slug: "carro", name: "Carro", defaultMeterType: "none", defaultPerformanceUnit: "not_applicable" },
  { slug: "station_wagon", name: "Station wagon", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" },
]

async function load() { return import("../apply-trinorma-equipos-faltantes") }

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await inMemoryDb.insert(schema.users).values({ id: "u-actor", name: "Jefatura", email: ACTOR, hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values(SITES)
  for (const type of TYPES) {
    const existing = await inMemoryDb.select().from(schema.fuelEquipmentTypes).where(eq(schema.fuelEquipmentTypes.slug, type.slug))
    if (!existing.length) await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: `t-${type.slug}`, category: "other", ...type })
  }
  // KRR-002 ya existe por patente: no se crea ni se toca su faena.
  const carro = await inMemoryDb.select().from(schema.fuelEquipmentTypes).where(eq(schema.fuelEquipmentTypes.slug, "carro"))
  await inMemoryDb.insert(schema.fuelVehicles).values({ id: "v-krr", code: null, plate: "JC5652", type: "carro", equipmentTypeId: carro[0]!.id, worksiteId: "w-bio" })
}, 120_000)

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const inventory = [
  { company: "CHOME", code: "H-1", plate: "DLSD-56" },
  { company: "ASIR", code: "KCB-001", plate: "JG-1255" },
  { company: TERCERO, code: "KCB-003", plate: "JF-6641" },
]

describe.sequential("alta de los equipos que faltaban en la flota", () => {
  it("la simulación informa y no escribe", async () => {
    const { applyTrinormaEquiposFaltantes } = await load()
    const before = await inMemoryDb.select().from(schema.fuelVehicles)
    const report = await applyTrinormaEquiposFaltantes({ actorEmail: ACTOR, inventory })
    expect(report.outcomes.filter((o) => o.result === "dry-run")).toHaveLength(11)
    expect(report.outcomes.find((o) => o.item === "KRR-002")).toMatchObject({ result: "ya estaba" })
    expect(await inMemoryDb.select().from(schema.fuelVehicles)).toHaveLength(before.length)
    expect(await inMemoryDb.select().from(schema.fleetOwners)).toHaveLength(0)
  })

  it("con --apply crea los equipos con su faena, su estadía, la marca y la bitácora; no toca los que ya existían", async () => {
    const { applyTrinormaEquiposFaltantes } = await load()
    const report = await applyTrinormaEquiposFaltantes({ actorEmail: ACTOR, apply: true, inventory })
    expect(report.outcomes.filter((o) => o.result === "aplicado")).toHaveLength(11)
    const created = await inMemoryDb.select().from(schema.fuelVehicles).where(inArray(schema.fuelVehicles.plate, ["DLSD-56", "LCCY-14", "JF-6641", "SXCV-49", "GRDW-63", "ZV-6852"]))
    const byPlate = new Map(created.map((vehicle) => [vehicle.plate, vehicle]))
    expect(byPlate.get("DLSD-56")).toMatchObject({ code: "H-1", worksiteId: "w-sf", locationPendingConfirmation: false, meterType: "hour_meter" })
    expect(byPlate.get("LCCY-14")).toMatchObject({ code: "H-13", worksiteId: "w-pac", locationPendingConfirmation: true })
    expect(byPlate.get("JF-6641")).toMatchObject({ code: "KCB-003", worksiteId: "w-flor", locationPendingConfirmation: true, meterType: "none" })
    expect(byPlate.get("SXCV-49")).toMatchObject({ code: null, worksiteId: "w-ofi" })
    // Segunda tanda: el remolque batea va sin código (KRR-01 chocaría con KRR-001) y a Arauco por confirmar.
    expect(byPlate.get("GRDW-63")).toMatchObject({ code: null, type: "batea", worksiteId: "w-hor", locationPendingConfirmation: true, meterType: "none" })
    expect(byPlate.get("ZV-6852")).toMatchObject({ code: "CA-35", worksiteId: "w-flor", locationPendingConfirmation: false })
    // El disparador abrió su estadía en la faena del alta.
    const stays = await inMemoryDb.select().from(schema.fuelVehicleWorksiteIntervals).where(eq(schema.fuelVehicleWorksiteIntervals.vehicleId, byPlate.get("DLSD-56")!.id))
    expect(stays).toMatchObject([{ worksiteId: "w-sf", source: "alta" }])
    // Propietarios desde el inventario: CHOME y ASIR por nombre; el tercero se crea pero no se imprime.
    const owners = await inMemoryDb.select().from(schema.fleetOwners)
    expect(owners.map((owner) => owner.kind).sort()).toEqual(["propia", "relacionada", "tercero"])
    expect(JSON.stringify(report)).not.toContain(TERCERO)
    // El que ya existía sigue igual.
    expect((await inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.id, "v-krr")))[0]).toMatchObject({ worksiteId: "w-bio", code: null })
    const audits = await inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "fuel_vehicle"))
    expect(audits).toHaveLength(11)
  })

  it("una segunda corrida no cambia nada", async () => {
    const { applyTrinormaEquiposFaltantes } = await load()
    const report = await applyTrinormaEquiposFaltantes({ actorEmail: ACTOR, apply: true, inventory })
    expect(report.outcomes.every((o) => o.result === "ya estaba")).toBe(true)
  })
})
