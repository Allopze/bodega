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
 * Las acciones de vínculo Wialon no pueden pisar ni borrar una asociación de
 * una faena que la persona no ve. El caso límite no es teórico: `flota:manage_gps`
 * podría delegarse a un rol acotado a una faena.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const auth = vi.hoisted(() => ({
  session: null as unknown as Session,
  recordAudit: vi.fn(async () => undefined),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/auth/can", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/can")>()
  return {
    ...actual,
    requirePermission: vi.fn(async () => auth.session),
  }
})
vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>()
  return { ...actual, recordAudit: auth.recordAudit }
})
vi.mock("next/cache", () => ({ revalidatePath: auth.revalidatePath }))

const { linkWialonUnitAction, unlinkWialonUnitAction } = await import("./actions")
const { listWialonUnitsForLinking } = await import("@/lib/services/fleet-gps")

function limitedSession(): Session {
  return {
    user: {
      id: IDS.user,
      isGlobal: false,
      roles: [],
      worksiteIds: [IDS.wsA],
      permissions: ["flota:manage_gps"],
    },
    expires: "2099-01-01",
  } as unknown as Session
}

async function linkOf(unitId: string) {
  const [row] = await testDb.select().from(schema.fleetGpsDeviceLinks)
    .where(eq(schema.fleetGpsDeviceLinks.externalDeviceId, unitId))
  return row ?? null
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)
  await testDb.insert(schema.fleetGpsSyncRuns).values({
    id: "run-links",
    provider: "wialon",
    trigger: "manual",
    status: "success",
  })
  await testDb.insert(schema.fleetGpsLatestPositions).values([
    {
      id: "pos-unit-b",
      provider: "wialon",
      externalDeviceId: "unit-b",
      externalGroupId: "0",
      vehicleId: IDS.vB,
      worksiteId: IDS.wsB,
      sourcePlate: "BB-0002",
      normalizedPlate: "BB0002",
      latitude: -33.4,
      longitude: -70.6,
      speedKph: 0,
      headingDegrees: 0,
      ignition: false,
      observedAt: "2026-03-10T12:00:00.000Z",
      syncRunId: "run-links",
    },
    {
      id: "pos-unit-a",
      provider: "wialon",
      externalDeviceId: "unit-a",
      externalGroupId: "0",
      vehicleId: null,
      worksiteId: null,
      sourcePlate: "FREE",
      normalizedPlate: "FREE",
      latitude: -33.4,
      longitude: -70.6,
      speedKph: 0,
      headingDegrees: 0,
      ignition: false,
      observedAt: "2026-03-10T12:00:00.000Z",
      syncRunId: "run-links",
    },
  ])
  await testDb.insert(schema.fleetGpsDeviceLinks).values({
    id: "link-unit-b",
    provider: "wialon",
    externalDeviceId: "unit-b",
    vehicleId: IDS.vB,
    createdByUserId: IDS.user,
  })
  auth.session = limitedSession()
})

describe("acciones de vínculo Wialon con alcance de faena", () => {
  it("la lista de unidades no muestra las vinculadas a otra faena", async () => {
    const units = await listWialonUnitsForLinking(auth.session)
    expect(units.map((unit) => unit.unitId)).toContain("unit-a")
    expect(units.map((unit) => unit.unitId)).not.toContain("unit-b")
  })

  it("no desvincula una unidad asociada a un vehículo de otra faena", async () => {
    const result = await unlinkWialonUnitAction({ unitId: "unit-b" })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/faena/i)
    expect((await linkOf("unit-b"))?.vehicleId).toBe(IDS.vB)
  })

  it("no reasocia una unidad de otra faena aunque el vehículo nuevo sea accesible", async () => {
    const result = await linkWialonUnitAction({ unitId: "unit-b", vehicleId: IDS.vA })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/faena/i)
    expect((await linkOf("unit-b"))?.vehicleId).toBe(IDS.vB)
  })

  it("sí vincula y desvincula una unidad sin asociación dentro de su faena", async () => {
    const linked = await linkWialonUnitAction({ unitId: "unit-a", vehicleId: IDS.vA })
    expect(linked.ok).toBe(true)
    expect((await linkOf("unit-a"))?.vehicleId).toBe(IDS.vA)

    const unlinked = await unlinkWialonUnitAction({ unitId: "unit-a" })
    expect(unlinked.ok).toBe(true)
    expect(await linkOf("unit-a")).toBeNull()
  })
})
