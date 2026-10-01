import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { resolveDictionaryId, listDictionaryNames } = await import("@/lib/services/miper/dictionaries")
const { buildMiperHeaderPrefill } = await import("@/lib/services/miper/prefill")

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: "ws-d", name: "Biodiversa", code: "BIO", commune: "Cabrero" })
  await testDb.insert(schema.roles).values({ id: "rol-ac", name: "admin_contrato", label: "Administrador de contrato", isGlobal: false })
  await testDb.insert(schema.users).values([
    { id: "u-ac", name: "Juan Pérez", email: "jp@d.cl", hashedPassword: "x", isActive: true },
    { id: "u-other", name: "Otra Persona", email: "op@d.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.userRoles).values({ userId: "u-ac", roleId: "rol-ac" })
  await testDb.insert(schema.worksiteUsers).values([{ userId: "u-ac", worksiteId: "ws-d", isPrimary: true }, { userId: "u-other", worksiteId: "ws-d" }])
  await testDb.insert(schema.systemSettings).values([
    { key: "company_name", value: "Servicios Industriales Chome" },
    { key: "company_rut", value: "78.023.530-6" },
    { key: "company_adherent_number", value: "252086" },
  ])
  await testDb.insert(schema.workers).values([
    { id: "w1", firstName: "A", lastName: "Uno", rut: "1-9", sex: "male", worksiteId: "ws-d", isActive: true },
    { id: "w2", firstName: "B", lastName: "Dos", rut: "2-7", sex: "male", worksiteId: "ws-d", isActive: true },
    { id: "w3", firstName: "C", lastName: "Tres", rut: "3-5", sex: "female", worksiteId: "ws-d", isActive: true },
    { id: "w4", firstName: "D", lastName: "Cuatro", rut: "4-3", sex: null, worksiteId: "ws-d", isActive: true },
    { id: "w5", firstName: "E", lastName: "Cinco", rut: "5-1", sex: "female", worksiteId: "ws-d", isActive: false },
  ])
}, 60_000)

describe("diccionarios MIPER", () => {
  it("resuelve al mismo id escrituras casi iguales y no duplica", async () => {
    const a = await resolveDictionaryId(testDb, "activity", "ws-d", "Carga de lodo")
    const b = await resolveDictionaryId(testDb, "activity", "ws-d", "  carga DE  lodo ")
    expect(a).toBeTruthy()
    expect(b).toBe(a)
    expect((await listDictionaryNames(testDb, "ws-d")).activities).toEqual(["Carga de lodo"])
  })
  it("vacío resuelve a null; tareas, puestos y lugares cuelgan de la faena", async () => {
    expect(await resolveDictionaryId(testDb, "task", "ws-d", "   ")).toBeNull()
    for (const kind of ["task", "position", "location"] as const) expect(await resolveDictionaryId(testDb, kind, "ws-d", `Valor ${kind}`)).toBeTruthy()
    const names = await listDictionaryNames(testDb, "ws-d")
    expect(names.tasks).toEqual(["Valor task"])
    expect(names.locations).toEqual(["Valor location"])
  })
})

describe("prellenado del encabezado", () => {
  it("toma empresa, comuna, Administrador de contrato y dotación activa por sexo", async () => {
    const prefill = await buildMiperHeaderPrefill(testDb, "ws-d")
    expect(prefill).toMatchObject({
      companyName: "Servicios Industriales Chome", companyRut: "78.023.530-6", adherentNumber: "252086",
      companyCommune: "Cabrero", worksiteName: "Biodiversa",
      siteRepresentativeUserId: "u-ac", siteRepresentativeName: "Juan Pérez",
      headcount: { total: 4, male: 2, female: 1, other: 1, unrecorded: 1 },
    })
  })
})
