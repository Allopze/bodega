import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures, submission } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Fase 6: el activo cruza vencimientos documentales y la última telemetría.
 * La columna declarada del equipo sigue siendo la fuente canónica del
 * vencimiento; el documento vigente sólo aporta cuando esa columna está vacía.
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

  // vB tiene una revisión técnica vencida en la columna; el documento vigente
  // dice 2027 y no debe tapar esa fecha.
  await testDb.update(schema.fuelVehicles)
    .set({ technicalReviewExpiresAt: "2026-01-15" })
    .where(eq(schema.fuelVehicles.id, IDS.vB))

  await testDb.insert(schema.fleetVehicleDocuments).values([
    {
      id: "ocdoc-a-padron",
      vehicleId: IDS.vA,
      documentType: "Padrón",
      fileName: "padron.pdf",
      filePath: "storage/fleet/padron.pdf",
      expiresAt: "2026-02-01",
      uploadedBy: IDS.user,
    },
    {
      id: "ocdoc-b-revision",
      vehicleId: IDS.vB,
      documentType: "Revisión técnica",
      fileName: "revision.pdf",
      filePath: "storage/fleet/revision.pdf",
      expiresAt: "2027-01-01",
      uploadedBy: IDS.user,
    },
    {
      id: "ocdoc-c-seguro",
      vehicleId: IDS.vC,
      documentType: "Seguro",
      fileName: "seguro.pdf",
      filePath: "storage/fleet/seguro.pdf",
      expiresAt: "2027-01-01",
      uploadedBy: IDS.user,
    },
  ])

  await testDb.insert(schema.fleetGpsSyncRuns).values({
    id: "ocgps-run",
    provider: "onway",
    trigger: "manual",
    status: "success",
  })

  await testDb.insert(schema.fleetGpsLatestPositions).values([
    {
      id: "ocgps-a-old",
      provider: "onway",
      externalDeviceId: "ocgps-dev-a-old",
      externalGroupId: "ocgps-group",
      vehicleId: IDS.vA,
      worksiteId: IDS.wsA,
      sourcePlate: "AA-0001",
      normalizedPlate: "AA-0001",
      latitude: -33.45,
      longitude: -70.66,
      speedKph: 0,
      headingDegrees: 0,
      ignition: true,
      odometer: 1000,
      hourMeter: 50,
      fuelLevel: 50,
      observedAt: "2026-03-01T10:00:00.000Z",
      syncRunId: "ocgps-run",
    },
    {
      id: "ocgps-a-new",
      provider: "onway",
      externalDeviceId: "ocgps-dev-a-new",
      externalGroupId: "ocgps-group",
      vehicleId: IDS.vA,
      worksiteId: IDS.wsA,
      sourcePlate: "AA-0001",
      normalizedPlate: "AA-0001",
      latitude: -33.44,
      longitude: -70.65,
      speedKph: 0,
      headingDegrees: 0,
      ignition: true,
      odometer: 2000,
      hourMeter: 100,
      fuelLevel: 75,
      observedAt: "2026-03-10T10:00:00.000Z",
      syncRunId: "ocgps-run",
    },
  ])

  // Última carga de A: horómetro 1000, una hora después de la telemetría (100).
  const fuelSubmission = submission({
    id: "ocgps-sub",
    clientSubmissionId: "ocgps-client",
    publicResultToken: "ocgps-token",
    vehicleId: IDS.vA,
    worksiteId: IDS.wsA,
    loadedAt: "2026-03-10T11:00:00.000Z",
    submittedAt: "2026-03-10T11:00:00.000Z",
    liters: 100,
    meterType: "hour_meter",
    meterReading: 1000,
  })
  await testDb.insert(schema.fuelTaeSubmissions).values(fuelSubmission)
  await testDb.insert(schema.fuelEquipmentLoads).values({
    id: "ocgps-load",
    source: "field",
    taeSubmissionId: fuelSubmission.id,
    vehicleId: IDS.vA,
    worksiteId: IDS.wsA,
    occurredAt: "2026-03-10T11:00:00.000Z",
    month: "2026-03",
    liters: 100,
    accumulatedLiters: 100,
    meterDelta: 10,
    meterType: "hour_meter",
    meterReading: 1000,
    performanceUnit: "liters_per_hour",
    performanceValue: 10,
    performanceStatus: "computed",
    reviewStatus: "ok",
  })
}, 120_000)

describe("Panel operacional: vencimientos y telemetría por activo", () => {
  it("cruza el próximo vencimiento y los tipos vencidos del equipo", async () => {
    const hub = await getOperationalControlHub(session(["flota:view"]), MARCH, { includeAttention: false })
    const a = hub.assets.find((asset) => asset.id === IDS.vA)!
    const b = hub.assets.find((asset) => asset.id === IDS.vB)!
    const c = hub.assets.find((asset) => asset.id === IDS.vC)!

    expect(a.nextExpiryDate).toBe("2026-02-01")
    expect(a.expiredDocumentTypes).toEqual(["Padrón"])
    // La columna declarada manda: el documento de 2027 no borra la revisión vencida.
    expect(b.nextExpiryDate).toBe("2026-01-15")
    expect(b.expiredDocumentTypes).toEqual(["Revisión técnica"])
    expect(c.nextExpiryDate).toBe("2027-01-01")
    expect(c.expiredDocumentTypes).toEqual([])
  })

  it("toma la telemetría más reciente por vehículo, no la primera", async () => {
    const hub = await getOperationalControlHub(session(["flota:view"]), MARCH, { includeAttention: false })
    const a = hub.assets.find((asset) => asset.id === IDS.vA)!
    const b = hub.assets.find((asset) => asset.id === IDS.vB)!

    expect(a.gpsOdometer).toBe(2000)
    expect(a.gpsFuelLevel).toBe(75)
    expect(a.gpsObservedAt).toContain("2026-03-10")
    expect(b.gpsOdometer).toBeNull()
    expect(b.gpsObservedAt).toBeNull()
  })

  it("marca cuando la lectura de la última carga discrepa de la telemetría", async () => {
    const hub = await getOperationalControlHub(session(["flota:view", "combustibles:view"]), MARCH, { includeAttention: false })
    const a = hub.assets.find((asset) => asset.id === IDS.vA)!
    const b = hub.assets.find((asset) => asset.id === IDS.vB)!

    // 1000 h (carga) vs 100 h (GPS), mismo medidor y dentro de 7 días.
    expect(a.meterMismatch).toBe(true)
    expect(b.meterMismatch).toBe(false)
  })

  it("sin flota:view no devuelve vencimientos ni telemetría", async () => {
    const hub = await getOperationalControlHub(session(["mantenciones:view"]), MARCH, { includeAttention: false })
    const a = hub.assets.find((asset) => asset.id === IDS.vA)!

    expect(a.nextExpiryDate).toBeNull()
    expect(a.expiredDocumentTypes).toEqual([])
    expect(a.gpsOdometer).toBeNull()
    expect(a.gpsObservedAt).toBeNull()
  })
})
