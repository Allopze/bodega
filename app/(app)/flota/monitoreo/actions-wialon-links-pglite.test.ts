import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * Las acciones de vínculo GPS (Wialon y OnWay) no pueden pisar, excluir ni
 * borrar una asociación de una faena que la persona no ve. El caso límite no es
 * teórico: `flota:manage_gps` podría delegarse a un rol acotado a una faena.
 * Excluir un dispositivo exige motivo, queda auditado y es reversible.
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

const { linkGpsDeviceAction, unlinkGpsDeviceAction, excludeGpsDeviceAction, restoreGpsDeviceAction } = await import("./actions")
const { listGpsDevicesForLinking, listExcludedGpsDevices, getFleetGpsMonitoring } = await import("@/lib/services/fleet-gps")

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

async function linkOf(unitId: string, provider: "onway" | "wialon" = "wialon") {
  const [row] = await testDb.select().from(schema.fleetGpsDeviceLinks)
    .where(and(
      eq(schema.fleetGpsDeviceLinks.externalDeviceId, unitId),
      eq(schema.fleetGpsDeviceLinks.provider, provider),
    ))
  return row ?? null
}

const REASON = "Equipo de un contratista"

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
  await testDb.insert(schema.fleetGpsLatestPositions).values([
    {
      id: "pos-onway-free",
      provider: "onway",
      externalDeviceId: "ow-1",
      externalGroupId: "0",
      vehicleId: null,
      worksiteId: null,
      sourcePlate: "ZZ-9999",
      normalizedPlate: "ZZ9999",
      latitude: -33.4,
      longitude: -70.6,
      speedKph: 0,
      headingDegrees: 0,
      ignition: false,
      observedAt: "2026-03-10T12:00:00.000Z",
      syncRunId: "run-links",
    },
    {
      id: "pos-unit-auto",
      provider: "wialon",
      externalDeviceId: "unit-auto",
      externalGroupId: "0",
      vehicleId: IDS.vA,
      worksiteId: IDS.wsA,
      sourcePlate: "AUTO",
      normalizedPlate: "AUTO",
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

describe("acciones de vínculo GPS con alcance de faena", () => {
  it("la lista de dispositivos no muestra los vinculados a otra faena, e incluye los de OnWay", async () => {
    const devices = await listGpsDevicesForLinking(auth.session)
    const keys = devices.map((device) => `${device.provider}:${device.unitId}`)
    expect(keys).toContain("wialon:unit-a")
    expect(keys).toContain("onway:ow-1")
    expect(keys).not.toContain("wialon:unit-b")
  })

  it("no desvincula un dispositivo asociado a un vehículo de otra faena", async () => {
    const result = await unlinkGpsDeviceAction({ provider: "wialon", unitId: "unit-b" })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/faena/i)
    expect((await linkOf("unit-b"))?.vehicleId).toBe(IDS.vB)
  })

  it("no reasocia un dispositivo de otra faena aunque el vehículo nuevo sea accesible", async () => {
    const result = await linkGpsDeviceAction({ provider: "wialon", unitId: "unit-b", vehicleId: IDS.vA })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/faena/i)
    expect((await linkOf("unit-b"))?.vehicleId).toBe(IDS.vB)
  })

  it("no excluye un dispositivo asociado a un vehículo de otra faena", async () => {
    const result = await excludeGpsDeviceAction({ provider: "wialon", unitId: "unit-b", reason: REASON })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/faena/i)
    expect((await linkOf("unit-b"))?.status).toBe("linked")
  })

  it("sí vincula y desvincula un dispositivo sin asociación dentro de su faena", async () => {
    const linked = await linkGpsDeviceAction({ provider: "wialon", unitId: "unit-a", vehicleId: IDS.vA })
    expect(linked.ok).toBe(true)
    expect((await linkOf("unit-a"))?.vehicleId).toBe(IDS.vA)

    const unlinked = await unlinkGpsDeviceAction({ provider: "wialon", unitId: "unit-a" })
    expect(unlinked.ok).toBe(true)
    expect(await linkOf("unit-a")).toBeNull()
  })

  it("vincula también un equipo de OnWay, con el proveedor en el vínculo", async () => {
    const linked = await linkGpsDeviceAction({ provider: "onway", unitId: "ow-1", vehicleId: IDS.vA })
    expect(linked.ok).toBe(true)
    expect(await linkOf("ow-1", "onway")).toMatchObject({ status: "linked", vehicleId: IDS.vA })
    expect(await linkOf("ow-1", "wialon")).toBeNull()
    expect((await unlinkGpsDeviceAction({ provider: "onway", unitId: "ow-1" })).ok).toBe(true)
  })

  it("desvincular un cruce automático explica que hay que excluirlo", async () => {
    const result = await unlinkGpsDeviceAction({ provider: "wialon", unitId: "unit-auto" })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/autom[aá]tico/i)
    expect(result.message).toMatch(/exclúyelo/i)
  })
})

describe("exclusión de dispositivos GPS", () => {
  it("exige un motivo de al menos 10 caracteres", async () => {
    const result = await excludeGpsDeviceAction({ provider: "wialon", unitId: "unit-a", reason: "corto" })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/10 caracteres/)
    expect(await linkOf("unit-a")).toBeNull()
  })

  it("rechaza un proveedor desconocido y un dispositivo que ya no está en la lectura", async () => {
    expect((await excludeGpsDeviceAction({ provider: "otro" as never, unitId: "unit-a", reason: REASON })).ok).toBe(false)
    const missing = await excludeGpsDeviceAction({ provider: "wialon", unitId: "no-existe", reason: REASON })
    expect(missing.ok).toBe(false)
    expect(missing.message).toMatch(/última lectura/)
  })

  it("excluye: guarda el motivo, deja la posición sin vehículo, audita y deja de contar como pendiente", async () => {
    const before = await getFleetGpsMonitoring(auth.session)
    expect(before.unmatchedByProvider.wialon).toBe(1)
    auth.recordAudit.mockClear()

    const result = await excludeGpsDeviceAction({ provider: "wialon", unitId: "unit-a", reason: `  ${REASON}  ` })
    expect(result.ok).toBe(true)
    expect(await linkOf("unit-a")).toMatchObject({ status: "excluded", vehicleId: null, reason: REASON })
    const [position] = await testDb.select().from(schema.fleetGpsLatestPositions)
      .where(eq(schema.fleetGpsLatestPositions.externalDeviceId, "unit-a"))
    expect(position).toMatchObject({ vehicleId: null, worksiteId: null })
    expect(auth.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "fleet_gps_device_link",
        entityId: "wialon:unit-a",
        newState: { status: "excluded", reason: REASON },
      }),
      expect.anything(),
    )

    const after = await getFleetGpsMonitoring(auth.session)
    expect(after.unmatchedByProvider.wialon).toBe(0)
    // OnWay conserva su pendiente: la exclusión es por proveedor y dispositivo.
    expect(after.unmatchedByProvider.onway).toBe(1)

    const devices = await listGpsDevicesForLinking(auth.session)
    expect(devices.map((device) => device.unitId)).not.toContain("unit-a")
    expect(await listExcludedGpsDevices(auth.session)).toEqual([
      expect.objectContaining({ provider: "wialon", unitId: "unit-a", unitName: "FREE", reason: REASON }),
    ])
  })

  it("un dispositivo ya excluido no se excluye dos veces ni se desvincula", async () => {
    expect((await excludeGpsDeviceAction({ provider: "wialon", unitId: "unit-a", reason: REASON })).ok).toBe(false)
    const unlink = await unlinkGpsDeviceAction({ provider: "wialon", unitId: "unit-a" })
    expect(unlink.ok).toBe(false)
    expect(unlink.message).toMatch(/excluido/i)
  })

  it("restaurar borra el link: vuelve al cruce automático", async () => {
    const result = await restoreGpsDeviceAction({ provider: "wialon", unitId: "unit-a" })
    expect(result.ok).toBe(true)
    expect(await linkOf("unit-a")).toBeNull()
    expect(await listExcludedGpsDevices(auth.session)).toEqual([])
    expect((await getFleetGpsMonitoring(auth.session)).unmatchedByProvider.wialon).toBe(1)
    expect((await restoreGpsDeviceAction({ provider: "wialon", unitId: "unit-a" })).ok).toBe(false)
  })

  it("vincular un dispositivo excluido lo devuelve a la flota y borra el motivo", async () => {
    await excludeGpsDeviceAction({ provider: "wialon", unitId: "unit-a", reason: REASON })
    const linked = await linkGpsDeviceAction({ provider: "wialon", unitId: "unit-a", vehicleId: IDS.vA })
    expect(linked.ok).toBe(true)
    expect(await linkOf("unit-a")).toMatchObject({ status: "linked", vehicleId: IDS.vA, reason: null })
    await unlinkGpsDeviceAction({ provider: "wialon", unitId: "unit-a" })
  })
})
