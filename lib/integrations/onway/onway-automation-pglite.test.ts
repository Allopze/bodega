import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { setVehicleWorksiteForTest } from "@/lib/testing/fleet-stays"

/**
 * Reglas de alertas OnWay después de un traslado. La faena de una alerta es la
 * del día en que ocurrió (la fija la ingesta y la corrige el traslado), así que
 * una alerta anterior al traslado sigue en la faena vieja aunque el equipo hoy
 * esté en otra. La automatización comparaba esa faena con la ACTUAL del equipo y
 * lanzaba `ONWAY_VEHICLE_SCOPE_CHANGED`: la alerta más antigua tumbaba la cola
 * en cada corrida y ninguna faena volvía a recibir CAPA.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  eligible: vi.fn(async (_permission: string, _worksiteId: string) => ["u-oa-owner"]),
  failCapaFor: new Set<string>(),
}))
vi.mock("@/lib/services/notification-targeting", () => ({
  getUserIdsWithPermissionForWorksite: (permission: string, worksiteId: string) => mocks.eligible(permission, worksiteId),
}))
vi.mock("@/lib/services/prevention-capa", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/services/prevention-capa")>()
  return {
    ...real,
    createCapaActionWithClient: (...args: Parameters<typeof real.createCapaActionWithClient>) => {
      const input = args[1] as { sourceId?: string }
      if (input.sourceId && mocks.failCapaFor.has(input.sourceId)) throw new Error("CAPA_CAIDA")
      return real.createCapaActionWithClient(...args)
    },
  }
})

const { applyOnwayAlertRules } = await import("./onway-automation")

const WS = { a: "ws-oa-a", b: "ws-oa-b" } as const
const V = "veh-oa-1"

let alertSeq = 0
async function alert(opts: { worksiteId: string; occurredAt: string; vehicleId?: string }): Promise<string> {
  alertSeq += 1
  const id = `gpsalert-oa-${alertSeq}`
  await testDb.insert(schema.fleetGpsAlerts).values({
    id, provider: "onway", externalDeviceId: "dev-oa", externalEventKey: `ev-${alertSeq}`,
    vehicleId: opts.vehicleId ?? V, worksiteId: opts.worksiteId, alertType: "exceso_velocidad",
    title: "Exceso de velocidad", priority: "high", occurredAt: opts.occurredAt,
  })
  return id
}

const alertRow = async (id: string) =>
  (await testDb.select().from(schema.fleetGpsAlerts).where(eq(schema.fleetGpsAlerts.id, id)))[0]
const capaOf = async (alertId: string) =>
  (await testDb.select().from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.sourceId, alertId)))[0]

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values({ id: "u-oa-owner", name: "Dueña de la regla", email: "owner@example.test", hashedPassword: "x" })
  await testDb.insert(schema.worksites).values([
    { id: WS.a, name: "Santa Fe", code: "OA-A", isActive: true, createdAt: now, updatedAt: now },
    { id: WS.b, name: "Mininco", code: "OA-B", isActive: true, createdAt: now, updatedAt: now },
  ])
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-oa", slug: "t-oa", name: "Camión", category: "truck", defaultMeterType: "odometer" })
  await testDb.insert(schema.fuelVehicles).values({
    id: V, plate: "OA-0001", code: "KA-OA", type: "Camión", equipmentTypeId: "fet-oa", worksiteId: WS.a, isActive: true,
  })
  // Pasó a Mininco el 15-11: hoy es de Mininco, pero lo de antes ocurrió en Santa Fe.
  await setVehicleWorksiteForTest(testDb, V, WS.b, "2026-11-15")
  await testDb.insert(schema.fleetGpsAlertRules).values([
    { id: "rule-oa-a", provider: "onway", alertType: "exceso_velocidad", category: "conduccion", worksiteId: WS.a, destination: "capa", ownerUserId: "u-oa-owner", cooldownMinutes: 1, isEnabled: true },
    { id: "rule-oa-b", provider: "onway", alertType: "exceso_velocidad", category: "conduccion", worksiteId: WS.b, destination: "capa", ownerUserId: "u-oa-owner", cooldownMinutes: 1, isEnabled: true },
  ])
}, 60_000)

beforeEach(() => {
  mocks.failCapaFor.clear()
})

describe("applyOnwayAlertRules después de un traslado", () => {
  it("una alerta anterior al traslado se procesa en su faena y no detiene las siguientes", async () => {
    const before = await alert({ worksiteId: WS.a, occurredAt: "2026-11-10T12:00:00Z" })
    const after = await alert({ worksiteId: WS.b, occurredAt: "2026-11-16T12:00:00Z" })

    const result = await applyOnwayAlertRules()

    expect(result).toMatchObject({ actioned: 2 })
    expect(await alertRow(before)).toMatchObject({ processingStatus: "actioned", ruleId: "rule-oa-a", worksiteId: WS.a })
    expect(await capaOf(before)).toMatchObject({ worksiteId: WS.a })
    expect(await alertRow(after)).toMatchObject({ processingStatus: "actioned", ruleId: "rule-oa-b", worksiteId: WS.b })
    expect(await capaOf(after)).toMatchObject({ worksiteId: WS.b })
  })

  it("una alerta que falla queda bloqueada y la cola sigue", async () => {
    const broken = await alert({ worksiteId: WS.a, occurredAt: "2026-11-11T12:00:00Z" })
    const next = await alert({ worksiteId: WS.b, occurredAt: "2026-11-17T12:00:00Z" })
    mocks.failCapaFor.add(broken)

    const result = await applyOnwayAlertRules()

    expect(result).toMatchObject({ actioned: 1, blocked: 1 })
    expect(await alertRow(broken)).toMatchObject({ processingStatus: "blocked", ruleId: "rule-oa-a", linkedEntityId: null })
    expect(await capaOf(broken)).toBeUndefined()
    expect(await alertRow(next)).toMatchObject({ processingStatus: "actioned" })
    // La siguiente corrida no la vuelve a tomar.
    expect(await applyOnwayAlertRules()).toMatchObject({ actioned: 0, blocked: 0 })
  })
})
