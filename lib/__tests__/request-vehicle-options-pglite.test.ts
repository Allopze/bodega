/**
 * Catálogo de equipos de flota para el formulario de solicitudes (2026-11-07):
 * sólo activos, dentro del alcance de la sesión, y con las OT abiertas de cada
 * uno para poder vincular el pedido de repuestos a la orden.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import path from "node:path"
import type { Session } from "next-auth"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof testDb }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("server-only", () => ({}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { IDS, seedMantFixtures } = await import("./mantencion-sync-fixtures")
const { listVehicleOptionsForRequests } = await import("@/lib/services/request-vehicle-options")

const SNAPSHOT = { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" as const }

function sessionOf(opts: { isGlobal: boolean; worksiteIds: string[] }): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: IDS.jefe, name: "Alexis Morales", email: "jefe@chome.test", permissions: ["repuestos:create"], roles: [], ...opts },
  } as unknown as Session
}

type OtStatus = "solicitada" | "asignada" | "cerrada" | "anulada"

/** Una fila que cumple los `check` del estado pedido. */
async function insertOt(id: string, vehicleId: string, worksiteId: string, status: OtStatus, createdAt: string) {
  const assigned = status !== "solicitada" && status !== "anulada"
  const closed = status === "cerrada"
  await testDb.insert(schema.mantWorkOrders).values({
    id, folio: `OT-TST-${id}`, vehicleId, worksiteId, equipmentSnapshot: SNAPSHOT,
    repair: true, maintenance: false, requestDate: "2026-02-20",
    requestedByUserId: IDS.jefe, requesterName: "Alexis Morales", repairDescription: "Falla de frenos en la cabina",
    status, createdAt,
    ...(assigned ? { assignedToUserId: IDS.mecBio, assignedByUserId: IDS.jefe, assignedAt: "2026-02-21T12:00:00Z" } : {}),
    ...(closed ? {
      workshopKind: "interno", workshopEntryAt: "2026-02-22T08:00:00Z", estimatedDeliveryDate: "2026-02-25",
      startedAt: "2026-02-22T08:00:00Z", startedByUserId: IDS.mecBio,
      workshopExitAt: "2026-02-24T08:00:00Z", finishedAt: "2026-02-24T08:00:00Z", finishedByUserId: IDS.mecBio,
      receivedAt: "2026-02-24T09:00:00Z", receiverName: "Pedro Soto", receivedByUserId: IDS.jefe, receivedRecordedAt: "2026-02-24T09:00:00Z",
      faenaReceivedAt: "2026-02-25T09:00:00Z", faenaReceiverName: "Admin Contrato", faenaReceivedByUserId: IDS.jefe, closedAt: "2026-02-25T09:00:00Z",
    } : {}),
    ...(status === "anulada" ? { voidedAt: "2026-03-02T12:00:00Z", voidedByUserId: IDS.jefe, voidReason: "Pedida por error" } : {}),
  })
}

describe("listVehicleOptionsForRequests", () => {
  beforeAll(async () => {
    await seedMantFixtures(testDb as unknown as DB)
    await insertOt("ot-abierta", IDS.truckBio, IDS.wsBio, "asignada", "2026-03-02T10:00:00Z")
    await insertOt("ot-sin-asignar", IDS.truckBio, IDS.wsBio, "solicitada", "2026-03-03T10:00:00Z")
    await insertOt("ot-cerrada", IDS.truckBio, IDS.wsBio, "cerrada", "2026-03-04T10:00:00Z")
    await insertOt("ot-anulada", IDS.truckBio, IDS.wsBio, "anulada", "2026-03-05T10:00:00Z")
    await insertOt("ot-maquina", IDS.machineBio, IDS.wsBio, "asignada", "2026-03-06T10:00:00Z")
  })

  afterAll(async () => {
    await pg.close()
  })

  it("sólo lista vehículos activos del alcance de la sesión", async () => {
    // Faena Biodiversa: el camión y la máquina; el dado de baja (KA-999) queda fuera.
    const bio = await listVehicleOptionsForRequests(sessionOf({ isGlobal: false, worksiteIds: [IDS.wsBio] }))
    expect(bio.map((v) => v.id).sort()).toEqual([IDS.machineBio, IDS.truckBio].sort())
    expect(bio.every((v) => v.worksiteId === IDS.wsBio)).toBe(true)

    // Alcance global: ve las tres faenas, siempre sin los inactivos.
    const global = await listVehicleOptionsForRequests(sessionOf({ isGlobal: true, worksiteIds: [] }))
    expect(global.map((v) => v.id)).toEqual(expect.arrayContaining([IDS.truckBio, IDS.truckCho, IDS.truckAra, IDS.machineBio]))
    expect(global.map((v) => v.id)).not.toContain(IDS.retired)

    // Sin faenas asignadas no hay catálogo.
    expect(await listVehicleOptionsForRequests(sessionOf({ isGlobal: false, worksiteIds: [] }))).toEqual([])
  })

  it("describe cada equipo con código y patente, tipo y faena, ordenado por patente", async () => {
    const options = await listVehicleOptionsForRequests(sessionOf({ isGlobal: false, worksiteIds: [IDS.wsBio] }))
    const truck = options.find((v) => v.id === IDS.truckBio)
    expect(truck).toMatchObject({
      code: "KA-135", plate: "RBYD-98", label: "KA-135 · RBYD-98", hint: "Camión · Biodiversa",
      worksiteId: IDS.wsBio, brand: "Scania", model: "R450", operationalStatus: "operativo",
    })
    // «MQ-01» antes que «RBYD-98».
    expect(options.map((v) => v.plate)).toEqual(["MQ-01", "RBYD-98"])
  })

  it("adjunta las OT abiertas y omite cerradas/anuladas", async () => {
    const options = await listVehicleOptionsForRequests(sessionOf({ isGlobal: true, worksiteIds: [] }))
    const truck = options.find((v) => v.id === IDS.truckBio)!
    expect(truck.openWorkOrders.map((ot) => ot.id).sort()).toEqual(["ot-abierta", "ot-sin-asignar"])
    expect(truck.openWorkOrders.find((ot) => ot.id === "ot-abierta")).toEqual({ id: "ot-abierta", folio: "OT-TST-ot-abierta", status: "asignada" })
    expect(options.find((v) => v.id === IDS.machineBio)!.openWorkOrders.map((ot) => ot.id)).toEqual(["ot-maquina"])
    // Un equipo sin OT trae la lista vacía, no `undefined`.
    expect(options.find((v) => v.id === IDS.truckCho)!.openWorkOrders).toEqual([])
  })
})
