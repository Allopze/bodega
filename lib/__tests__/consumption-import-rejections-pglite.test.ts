import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/**
 * CO-050: los rechazos de la importación TCT ya no viven sólo en la respuesta
 * del asistente. La ficha del lote los lee por `hashArchivo`, porque un archivo
 * en modo «todas las faenas» crea un lote por faena y el rechazo es de la
 * importación completa.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const { getConsumptionImportRejections, getImportRejectionAccess } = await import("@/lib/combustibles/consumption-import-rejections")

const USER = "user-rejections"
const WS = "ws-rejections"
const session = (isGlobal: boolean): Session => ({
  expires: "2099-01-01",
  user: { id: USER, isGlobal, roles: [], permissions: [], worksiteIds: [WS] },
} as unknown as Session)

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values({
    id: USER, name: "Rechazos", email: "rechazos@test.local", hashedPassword: "x", isActive: true,
  })
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena rechazos", code: "REJ", isActive: true })
  await testDb.insert(schema.fuelImportBatches).values([
    // Dos lotes con el mismo hash: importación multi-faena.
    { id: "batch-a1", worksiteId: WS, fuente: "Copec TCT Diesel", periodoDesde: "2026-06-01", periodoHasta: "2026-06-30", archivoNombre: "a.xlsx", hashArchivo: "hash-a", importadoPor: USER },
    { id: "batch-a2", worksiteId: WS, fuente: "Copec TCT Diesel", periodoDesde: "2026-06-01", periodoHasta: "2026-06-30", archivoNombre: "a.xlsx", hashArchivo: "hash-a", importadoPor: USER },
    // Un solo lote: importación de una faena.
    { id: "batch-single", worksiteId: WS, fuente: "Copec TCT Diesel", periodoDesde: "2026-06-01", periodoHasta: "2026-06-30", archivoNombre: "b.xlsx", hashArchivo: "hash-single", importadoPor: USER },
  ])
  await testDb.insert(schema.fuelConsumptionImportRejections).values([
    { id: "rej-2", hashArchivo: "hash-a", rowIndex: 7, patente: "ZZ-9999", field: "PATENTE", message: "Patente sin vehículo" },
    { id: "rej-1", hashArchivo: "hash-a", rowIndex: 3, patente: "AA-1111", field: "PATENTE", message: "Patente ambigua" },
    { id: "rej-other", hashArchivo: "hash-b", rowIndex: 1, patente: "BB-2222", field: "PATENTE", message: "Otra importación" },
  ])
})

describe("getConsumptionImportRejections", () => {
  it("devuelve sólo los rechazos de la importación y en orden de fila", async () => {
    const rows = await getConsumptionImportRejections("hash-a")

    expect(rows).toEqual([
      { rowIndex: 3, patente: "AA-1111", field: "PATENTE", message: "Patente ambigua" },
      { rowIndex: 7, patente: "ZZ-9999", field: "PATENTE", message: "Patente sin vehículo" },
    ])
  })

  it("una importación sin rechazos devuelve una lista vacía", async () => {
    expect(await getConsumptionImportRejections("hash-sin-rechazos")).toEqual([])
  })

  it("sólo un rol global ve los rechazos de una importación multi-faena", async () => {
    expect(await getImportRejectionAccess(session(false), "hash-a")).toEqual({ visible: false, multiWorksite: true })
    expect(await getImportRejectionAccess(session(true), "hash-a")).toEqual({ visible: true, multiWorksite: true })
    // Una importación de una sola faena no expone datos de otra: su lote sí los ve.
    expect(await getImportRejectionAccess(session(false), "hash-single")).toEqual({ visible: true, multiWorksite: false })
  })
})
