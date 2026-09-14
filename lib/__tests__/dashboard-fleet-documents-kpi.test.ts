/**
 * `FLO-001` (auditoría 2026-09-14): el KPI de documentos de flota del tablero
 * contaba **todas** las versiones —vigentes y reemplazadas— y no excluía a los
 * vehículos dados de baja. La lista de flota ya había resuelto exactamente eso
 * y lo había dejado escrito; el tablero no aplicaba el filtro. Cada renovación
 * de una póliza o una revisión técnica sumaba uno al contador de «vencidos»,
 * así que el módulo que renueva con disciplina mostraba el peor número.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const { getExpiringFleetDocuments } = await import("@/lib/services/dashboard-domains-data")

const WS = "ws-flo-kpi"
const USER = "user-flo-kpi"
const TODAY = "2026-09-14"
const HORIZON = "2026-10-14"

function session(): Session {
  return {
    expires: "2099-01-01",
    user: {
      id: USER, email: "flota@test.local", roles: [], isGlobal: true, isActive: true,
      worksiteIds: [WS], primaryWorksiteId: WS, avatarColor: null,
      permissions: ["fleet:view"],
    },
  }
}

async function vehicle(id: string, isActive: boolean) {
  await testDb.insert(schema.fuelVehicles).values({
    id, plate: `PL-${id}`, type: "camioneta", equipmentTypeId: "et-flo-kpi",
    worksiteId: WS, isActive,
  })
}

async function document(id: string, vehicleId: string, expiresAt: string, status: string, documentType = "revision_tecnica") {
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
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena flota", code: "FLO", isActive: true })
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "et-flo-kpi", slug: "camioneta-flo-kpi", name: "Camioneta" })

  await vehicle("veh-activo", true)
  await vehicle("veh-baja", false)

  // La póliza del año pasado, ya reemplazada, y la vigente que aún no vence.
  await document("doc-reemplazada", "veh-activo", "2025-10-01", "replaced")
  await document("doc-vigente", "veh-activo", "2027-01-01", "current")   // la revisión técnica renovada
  // Un documento vencido de verdad, en un vehículo que circula.
  await document("doc-vencida", "veh-activo", "2026-08-01", "current", "soap")
  // Y uno vencido de un vehículo dado de baja: no bloquea nada.
  await document("doc-baja", "veh-baja", "2026-08-01", "current")
})

describe("el KPI de documentos de flota", () => {
  it("cuenta el vencido del vehículo que circula, y sólo ése", async () => {
    const kpi = await getExpiringFleetDocuments(session(), TODAY, HORIZON)
    expect(kpi.expired).toBe(1)
  })

  it("no cuenta la versión reemplazada: renovar saca del atraso", async () => {
    // Si contara `replaced`, `doc-reemplazada` sumaría un segundo vencido y
    // subir la póliza nueva nunca bajaría el indicador.
    const kpi = await getExpiringFleetDocuments(session(), TODAY, HORIZON)
    expect(kpi.expired).not.toBe(2)
  })

  it("no cuenta los documentos de un vehículo dado de baja", async () => {
    await testDb.insert(schema.fleetVehicleDocuments).values({
      id: "doc-baja-2", vehicleId: "veh-baja", documentType: "soap",
      fileName: "x.pdf", filePath: "storage/fleet/x.pdf",
      expiresAt: "2026-07-01", status: "current", uploadedBy: USER,
    })
    const kpi = await getExpiringFleetDocuments(session(), TODAY, HORIZON)
    expect(kpi.expired).toBe(1)
  })

  it("cuenta por separado lo que vence dentro del horizonte", async () => {
    await document("doc-por-vencer", "veh-activo", "2026-09-30", "current", "permiso_circulacion")
    const kpi = await getExpiringFleetDocuments(session(), TODAY, HORIZON)
    expect(kpi.within30).toBe(1)
    expect(kpi.expired).toBe(1)
  })
})
