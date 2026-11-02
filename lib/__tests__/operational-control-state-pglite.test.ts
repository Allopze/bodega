import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Fase 4 del Panel: la disponibilidad no mezcla equipos inactivos y el estado
 * denormalizado se contrasta con el intervalo abierto.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { getOperationalControlHub } = await import("@/lib/services/operational-control")

function session(permissions: string[]): Session {
  return {
    user: { id: IDS.user, isGlobal: true, roles: [], worksiteIds: [], permissions },
    expires: "2099-01-01",
  } as unknown as Session
}

const MARCH = { from: "2026-03-01", to: "2026-03-31" }

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)

  await testDb.update(schema.fuelVehicles).set({ operationalStatus: "operativo" }).where(eq(schema.fuelVehicles.id, IDS.vA))
  await testDb.update(schema.fuelVehicles).set({ operationalStatus: "operativo" }).where(eq(schema.fuelVehicles.id, IDS.vB))
  await testDb.update(schema.fuelVehicles).set({ isActive: false }).where(eq(schema.fuelVehicles.id, IDS.vC))

  await testDb.insert(schema.fuelVehicleOperationalIntervals).values([
    // vA: 15 días operativo + 4 en mantención + 12 operativo abierto hasta el
    // fin del período. Total 31 días; operativo 27.
    { id: "ocs-a-1", vehicleId: IDS.vA, status: "operativo", startedAt: "2026-03-01T00:00:00.000Z", endedAt: "2026-03-16T00:00:00.000Z", changedBy: IDS.user },
    { id: "ocs-a-2", vehicleId: IDS.vA, status: "mantencion", startedAt: "2026-03-16T00:00:00.000Z", endedAt: "2026-03-20T00:00:00.000Z", changedBy: IDS.user },
    { id: "ocs-a-3", vehicleId: IDS.vA, status: "operativo", startedAt: "2026-03-20T00:00:00.000Z", endedAt: null, changedBy: IDS.user },
    // vB: la ficha dice operativo, pero el intervalo abierto dice mantención.
    { id: "ocs-b-1", vehicleId: IDS.vB, status: "mantencion", startedAt: "2026-03-25T00:00:00.000Z", endedAt: null, changedBy: IDS.user },
    // vC está inactivo: su historial no puede entrar en la disponibilidad.
    { id: "ocs-c-1", vehicleId: IDS.vC, status: "mantencion", startedAt: "2026-02-01T00:00:00.000Z", endedAt: null, changedBy: IDS.user },
  ])
}, 120_000)

describe("Panel operacional: estado y cobertura", () => {
  it("la disponibilidad excluye al equipo inactivo y la cobertura usa el calendario de activos", async () => {
    const hub = await getOperationalControlHub(session(["flota:view"]), MARCH, { includeAttention: false })

    // vA 648 h operativas de 744 h registradas; vB suma 168 h en mantención.
    // El borde del período se castea a timestamptz según la zona de la sesión,
    // así que se comprueba el rango. Si el inactivo vC pesara, su historial
    // subiría la cobertura al 100 % y bajaría la disponibilidad bajo 40 %.
    expect(hub.metrics.availabilityPercent).toBeGreaterThan(70)
    expect(hub.metrics.availabilityPercent).toBeLessThan(72)
    expect(hub.metrics.stateCoveragePercent).toBeGreaterThan(60)
    expect(hub.metrics.stateCoveragePercent).toBeLessThan(62)
  })

  it("marca el estado discreto entre la ficha y el intervalo abierto, sin marcar al inactivo", async () => {
    const hub = await getOperationalControlHub(session(["flota:view"]), MARCH, { includeAttention: false })
    const a = hub.assets.find((asset) => asset.id === IDS.vA)!
    const b = hub.assets.find((asset) => asset.id === IDS.vB)!
    const c = hub.assets.find((asset) => asset.id === IDS.vC)!

    expect(a.stateMismatch).toBe(false)
    expect(b.stateMismatch).toBe(true)
    expect(c.stateMismatch).toBe(false)
  })

  it("sin flota:view no calcula disponibilidad ni cobertura", async () => {
    const hub = await getOperationalControlHub(session(["prevention:inspections:view"]), MARCH, { includeAttention: false })

    expect(hub.metrics.availabilityPercent).toBeNull()
    expect(hub.metrics.stateCoveragePercent).toBeNull()
  })
})
