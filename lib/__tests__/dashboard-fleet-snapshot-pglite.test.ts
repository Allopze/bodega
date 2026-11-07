import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/**
 * El KPI de vencimientos del Tablero cuenta **equipos activos**, no filas de
 * `fleet_vehicle_documents`, y usa el mismo criterio que Flota y el Panel:
 * la columna declarada del equipo manda y el documento vigente sólo aporta
 * cuando esa columna está vacía. Antes el Tablero contaba sólo PDFs y omitía
 * la revisión técnica escrita en la ficha.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const { getFleetDashboardSnapshot } = await import("@/lib/services/dashboard-domains-data")

const WS = "ws-dash-fleet"
const USER = "user-dash-fleet"
const TODAY = "2026-03-01"
const HORIZON = "2026-03-31"

function session(): Session {
  return {
    expires: "2099-01-01",
    user: {
      id: USER, email: "flota@test.local", roles: [], isGlobal: true, isActive: true,
      worksiteIds: [WS], primaryWorksiteId: WS, avatarColor: null,
      permissions: ["flota:view"],
    },
  }
}

async function vehicle(id: string, isActive: boolean, expiries: Partial<{
  soapExpiresAt: string | null
  technicalReviewExpiresAt: string | null
  circulationPermitExpiresAt: string | null
  insuranceExpiresAt: string | null
}> = {}) {
  await testDb.insert(schema.fuelVehicles).values({
    id, plate: `PL-${id}`, type: "camioneta", equipmentTypeId: "et-dash-fleet",
    worksiteId: WS, isActive, ...expiries,
  })
}

async function document(id: string, vehicleId: string, expiresAt: string | null, status: string, documentType = "revision_tecnica") {
  await testDb.insert(schema.fleetVehicleDocuments).values({
    id, vehicleId, documentType,
    fileName: `${id}.pdf`, filePath: `storage/fleet/${id}.pdf`,
    expiresAt, status, uploadedBy: USER,
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values({
    id: USER, name: "Flota", email: "flota@test.local", hashedPassword: "x", isActive: true,
  })
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena flota", code: "DFL", isActive: true })
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "et-dash-fleet", slug: "camioneta-dash-fleet", name: "Camioneta" })

  // A: la columna declarada vence antes que el documento; cuenta como vencido.
  await vehicle("a", true, { soapExpiresAt: "2026-01-01" })
  await document("doc-a", "a", "2026-02-01", "current", "soap")

  // B: sin columna declarada; el documento vigente aporta el vencimiento próximo.
  await vehicle("b", true)
  await document("doc-b", "b", "2026-03-15", "current", "permiso_circulacion")
  // Una versión reemplazada no puede mover el vencimiento.
  await document("doc-b-old", "b", "2025-01-01", "replaced", "permiso_circulacion")

  // C: vence lejos, no cuenta en la ventana.
  await vehicle("c", true, { insuranceExpiresAt: "2027-01-01" })

  // D: dado de baja; su documento vencido no bloquea nada.
  await vehicle("d", false)
  await document("doc-d", "d", "2026-01-01", "current", "soap")
})

describe("getFleetDashboardSnapshot", () => {
  it("cuenta equipos activos y resuelve la fecha con la columna declarada + el documento vigente", async () => {
    const snapshot = await getFleetDashboardSnapshot(session(), TODAY, HORIZON)

    expect(snapshot).toEqual({ activeVehicles: 3, expired: 1, within30: 1 })
  })
})
