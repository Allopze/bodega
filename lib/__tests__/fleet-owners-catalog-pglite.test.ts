import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import {
  createFleetOwnerTx,
  listFleetOwners,
  listFleetOwnersWithVehicleCount,
  setFleetOwnerActiveTx,
  setVehicleOwnershipTx,
  updateFleetOwnerTx,
} from "@/lib/services/fleet-owners"

// Catálogo de empresas propietarias (Administración › Catálogos de flota › Propietarios):
// renombrar y reclasificar sin chocar consigo misma, activar/desactivar con equipos que la
// conservan, recuento de equipos y auditoría. Ninguna operación escribe la faena del equipo.

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const tx = inMemoryDb as never

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => { await pg.close() })

const actor = { userId: "u-actor", email: "admin@chome.test" }

beforeEach(async () => {
  await pg.exec("TRUNCATE audit_log, fuel_vehicles, fleet_owners, worksites, users CASCADE")
  await inMemoryDb.insert(schema.users).values({ id: actor.userId, name: "Admin", email: actor.email, hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values({ id: "w1", code: "W1", name: "Faena Uno" })
  await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: "t1", slug: "t1", name: "Camión", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" }).onConflictDoNothing()
  await inMemoryDb.insert(schema.fleetOwners).values([
    { id: "o-chome", name: "Chome", kind: "propia" },
    { id: "o-asir", name: "ASIR", kind: "relacionada" },
    { id: "o-banco", name: "Banco Itaú", kind: "financiera", isActive: false },
  ])
  await inMemoryDb.insert(schema.fuelVehicles).values([
    { id: "v1", code: "KA-1", plate: "AAAA11", type: "Camión", equipmentTypeId: "t1", worksiteId: "w1", ownerId: "o-asir" },
    { id: "v2", code: "KA-2", plate: "BBBB22", type: "Camión", equipmentTypeId: "t1", worksiteId: "w1", ownerId: "o-asir" },
    { id: "v3", code: "KA-3", plate: "CCCC33", type: "Camión", equipmentTypeId: "t1", worksiteId: "w1" },
  ])
})

const ownerAudit = () => inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "fleet_owner"))
/** `audit_log` guarda el estado anterior y el nuevo como texto JSON. */
const state = (value: string | null | undefined) => JSON.parse(value ?? "null") as Record<string, unknown>


describe("listFleetOwnersWithVehicleCount", () => {
  it("lista activas e inactivas por nombre con cuántos equipos tiene cada una", async () => {
    const rows = await listFleetOwnersWithVehicleCount(tx)
    expect(rows.map((row) => [row.name, row.vehicleCount, row.isActive])).toEqual([
      ["ASIR", 2, true],
      ["Banco Itaú", 0, false],
      ["Chome", 0, true],
    ])
  })
})

describe("updateFleetOwnerTx", () => {
  it("renombra y reclasifica, audita y no toca la faena ni el propietario de los equipos", async () => {
    const result = await updateFleetOwnerTx(tx, actor, { id: "o-asir", name: "  ASIR   y Acuña ", kind: "relacionada" })
    expect(result).toMatchObject({ ok: true, data: { changed: true } })

    const [owner] = await inMemoryDb.select().from(schema.fleetOwners).where(eq(schema.fleetOwners.id, "o-asir"))
    expect(owner).toMatchObject({ name: "ASIR y Acuña", kind: "relacionada" })
    const vehicles = await inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.ownerId, "o-asir"))
    expect(vehicles.map((vehicle) => [vehicle.id, vehicle.worksiteId])).toEqual([["v1", "w1"], ["v2", "w1"]])

    const audit = await ownerAudit()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: "update", entityId: "o-asir", entityCode: "ASIR y Acuña" })
    expect(state(audit[0]?.oldState)).toMatchObject({ name: "ASIR", kind: "relacionada" })
    expect(state(audit[0]?.newState)).toMatchObject({ name: "ASIR y Acuña", kind: "relacionada" })
  })

  it("cambiar sólo el tipo funciona, y repetir el mismo valor no escribe ni audita", async () => {
    expect(await updateFleetOwnerTx(tx, actor, { id: "o-chome", name: "Chome", kind: "tercero" })).toMatchObject({ ok: true, data: { changed: true } })
    expect(await updateFleetOwnerTx(tx, actor, { id: "o-chome", name: "Chome", kind: "tercero" })).toMatchObject({ ok: true, data: { changed: false } })
    expect(await ownerAudit()).toHaveLength(1)
  })

  it("corregir mayúsculas o tildes del propio nombre no choca consigo misma", async () => {
    expect(await updateFleetOwnerTx(tx, actor, { id: "o-asir", name: "asir", kind: "relacionada" })).toMatchObject({ ok: true, data: { changed: true } })
    const [owner] = await inMemoryDb.select().from(schema.fleetOwners).where(eq(schema.fleetOwners.id, "o-asir"))
    expect(owner?.name).toBe("asir")
  })

  it("rechaza el nombre de otra empresa sin distinguir mayúsculas ni tildes, también si está inactiva", async () => {
    expect(await updateFleetOwnerTx(tx, actor, { id: "o-asir", name: "CHOME", kind: "relacionada" }))
      .toMatchObject({ ok: false, field: "name", message: "Ya existe la empresa Chome." })
    expect(await updateFleetOwnerTx(tx, actor, { id: "o-asir", name: "banco itau", kind: "financiera" }))
      .toMatchObject({ ok: false, field: "name", message: "Ya existe la empresa Banco Itaú (inactiva)." })
    const [owner] = await inMemoryDb.select().from(schema.fleetOwners).where(eq(schema.fleetOwners.id, "o-asir"))
    expect(owner?.name).toBe("ASIR")
    expect(await ownerAudit()).toHaveLength(0)
  })

  it("valida nombre, tipo y existencia", async () => {
    expect(await updateFleetOwnerTx(tx, actor, { id: "o-asir", name: "A", kind: "relacionada" })).toMatchObject({ ok: false, field: "name" })
    expect(await updateFleetOwnerTx(tx, actor, { id: "o-asir", name: "x".repeat(121), kind: "relacionada" })).toMatchObject({ ok: false, field: "name" })
    expect(await updateFleetOwnerTx(tx, actor, { id: "o-asir", name: "ASIR", kind: "inventada" })).toMatchObject({ ok: false, field: "kind" })
    expect(await updateFleetOwnerTx(tx, actor, { id: "no-existe", name: "Otra", kind: "tercero" })).toMatchObject({ ok: false })
  })
})

describe("setFleetOwnerActiveTx", () => {
  it("desactivar una empresa con equipos no los toca: la conservan y siguen contando", async () => {
    expect(await setFleetOwnerActiveTx(tx, actor, { id: "o-asir", isActive: false })).toMatchObject({ ok: true, data: { changed: true, name: "ASIR" } })

    const [owner] = await inMemoryDb.select().from(schema.fleetOwners).where(eq(schema.fleetOwners.id, "o-asir"))
    expect(owner?.isActive).toBe(false)
    const rows = await listFleetOwnersWithVehicleCount(tx)
    expect(rows.find((row) => row.id === "o-asir")).toMatchObject({ isActive: false, vehicleCount: 2 })
    // Un equipo que ya la tiene puede seguir con ella; a otro equipo ya no se le puede asignar.
    expect(await setVehicleOwnershipTx(tx, actor, { vehicleId: "v1", ownerId: "o-asir", locationPendingConfirmation: false })).toMatchObject({ ok: true })
    expect(await setVehicleOwnershipTx(tx, actor, { vehicleId: "v3", ownerId: "o-asir" })).toMatchObject({ ok: false })
    expect((await listFleetOwners(tx, { onlyActive: true })).map((row) => row.id)).toEqual(["o-chome"])

    const audit = await ownerAudit()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: "update", entityId: "o-asir" })
    expect(state(audit[0]?.oldState)).toMatchObject({ isActive: true })
    expect(state(audit[0]?.newState)).toMatchObject({ isActive: false })
  })

  it("reactivar vuelve a ofrecerla, y repetir el estado no escribe ni audita", async () => {
    expect(await setFleetOwnerActiveTx(tx, actor, { id: "o-banco", isActive: true })).toMatchObject({ ok: true, data: { changed: true } })
    expect(await setFleetOwnerActiveTx(tx, actor, { id: "o-banco", isActive: true })).toMatchObject({ ok: true, data: { changed: false } })
    expect(await ownerAudit()).toHaveLength(1)
    expect(await setVehicleOwnershipTx(tx, actor, { vehicleId: "v3", ownerId: "o-banco" })).toMatchObject({ ok: true })
  })

  it("una empresa inexistente no se puede activar", async () => {
    expect(await setFleetOwnerActiveTx(tx, actor, { id: "no-existe", isActive: true })).toMatchObject({ ok: false })
  })
})

describe("createFleetOwnerTx desde el catálogo", () => {
  it("una empresa inactiva con el mismo nombre se rechaza indicando dónde se reactiva", async () => {
    const result = await createFleetOwnerTx(tx, actor, { name: "BANCO ITAU", kind: "financiera" })
    expect(result).toMatchObject({ ok: false, field: "name" })
    expect(result.message).toContain("Catálogos de flota › Propietarios")
  })
})
