/**
 * P2-19 — Programación precargaba los peligros MIPER con una consulta POR FAENA
 * en cada carga de la pantalla. `listRiskEntriesByWorksite` los trae todos en una
 * sola, con el mismo tope por faena que la versión individual.
 *
 * Postgres real (PGlite) y no un mock del constructor de consultas: lo que se
 * prueba es el `row_number() over (partition by …)` y el alcance de faena.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const queries: string[] = []
const pg = new PGlite()
const testDb = drizzle(pg, {
  schema,
  logger: { logQuery: (query: string) => { queries.push(query) } },
}) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const {
  RISK_ENTRIES_PER_WORKSITE_LIMIT,
  listRiskEntriesByWorksite,
  listRiskEntriesForWorksite,
} = await import("@/lib/services/prevention-inspections/programs")

const USER = "risk-entries-user"
const WS_A = "ws-risk-a"
const WS_B = "ws-risk-b"
const WS_EMPTY = "ws-risk-empty"
const WS_OUT = "ws-risk-out"

const scope = (...ids: string[]) => ({ mode: "some", ids }) as WorksiteScope
const access = (permissions: string[], worksiteScope: WorksiteScope) => ({ userId: USER, scope: worksiteScope, permissions })
const VIEW = ["prevention:inspections:view"]

async function seedMatrix(worksiteId: string) {
  const id = `matrix-${worksiteId}`
  await testDb.insert(schema.preventionRiskMatrices).values({
    id, worksiteId, matrixVersion: 1, title: `MIPER ${worksiteId}`,
    methodologyId: "meth-risk-entries", methodologySnapshot: {}, isLegacy: true,
    revisionReason: "Versión inicial de la matriz para la prueba.",
    participationSummary: "Participación documentada del comité paritario.",
    consultationEvidenceReference: "acta-consulta-risk-entries",
    createdByUserId: USER,
  })
  return id
}

const entry = (matrixId: string, hazardCode: string, hazard: string | null) => ({
  id: `entry-${matrixId}-${hazardCode}`, matrixId, hazardCode, hazard,
})

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([WS_A, WS_B, WS_EMPTY, WS_OUT].map((id) => ({ id, name: `Faena ${id}`, code: id.slice(-8).toUpperCase(), isActive: true })))
  await testDb.insert(schema.users).values({ id: USER, name: "Prevencionista", email: "risk-entries@chome.cl", hashedPassword: "x", isActive: true })
  await testDb.insert(schema.preventionRiskMethodologies).values({
    id: "meth-risk-entries", code: "ISP", name: "Matriz ISP", versionLabel: "v1", kind: "primary",
    authoritySource: "ISP", createdByUserId: USER,
  })

  const [matrixA, matrixB, , matrixOut] = await Promise.all([WS_A, WS_B, WS_EMPTY, WS_OUT].map(seedMatrix))
  // La faena de la A tiene 501 peligros: uno más que el tope. Los códigos se ordenan como texto.
  await testDb.insert(schema.preventionRiskEntries).values(
    Array.from({ length: RISK_ENTRIES_PER_WORKSITE_LIMIT + 1 }, (_, index) => entry(matrixA!, `H-${String(index + 1).padStart(3, "0")}`, `Peligro A${index + 1}`)),
  )
  await testDb.insert(schema.preventionRiskEntries).values([
    entry(matrixB!, "Z-02", null),
    entry(matrixB!, "Z-01", "Atropello de personas"),
  ])
  await testDb.insert(schema.preventionRiskEntries).values(entry(matrixOut!, "X-01", "Peligro de una faena ajena"))
})

describe("listRiskEntriesByWorksite", () => {
  it("agrupa por faena y ordena por código de peligro; una faena sin peligros aparece vacía", async () => {
    const result = await listRiskEntriesByWorksite([WS_B, WS_EMPTY], access(VIEW, scope(WS_A, WS_B, WS_EMPTY)))
    expect(Object.keys(result).sort()).toEqual([WS_B, WS_EMPTY].sort())
    expect(result[WS_B]).toEqual([
      { id: `entry-matrix-${WS_B}-Z-01`, hazardCode: "Z-01", hazard: "Atropello de personas" },
      { id: `entry-matrix-${WS_B}-Z-02`, hazardCode: "Z-02", hazard: null },
    ])
    expect(result[WS_EMPTY]).toEqual([])
  })

  it("consulta TODAS las faenas con UNA sola sentencia, no una por faena", async () => {
    const before = queries.length
    await listRiskEntriesByWorksite([WS_B, WS_EMPTY, WS_A], access(VIEW, scope(WS_A, WS_B, WS_EMPTY)))
    const issued = queries.slice(before).filter((query) => /prevention_risk_entries/i.test(query))
    expect(issued).toHaveLength(1)
    expect(queries.slice(before)).toHaveLength(1)
  })

  it("el tope es POR faena: una MIPER enorme no deja sin peligros a las demás", async () => {
    const result = await listRiskEntriesByWorksite([WS_A, WS_B], access(VIEW, scope(WS_A, WS_B)))
    expect(result[WS_A]).toHaveLength(RISK_ENTRIES_PER_WORKSITE_LIMIT)
    // Se queda con los primeros por código; el 501.º es el que no entra.
    expect(result[WS_A]?.[0]?.hazardCode).toBe("H-001")
    expect(result[WS_A]?.at(-1)?.hazardCode).toBe(`H-${RISK_ENTRIES_PER_WORKSITE_LIMIT}`)
    expect(result[WS_B]).toHaveLength(2)
  })

  it("devuelve lo mismo que la versión por faena, que sigue siendo la referencia", async () => {
    const worksiteAccess = access(VIEW, scope(WS_A, WS_B))
    const result = await listRiskEntriesByWorksite([WS_A, WS_B], worksiteAccess)
    for (const worksiteId of [WS_A, WS_B]) {
      expect(result[worksiteId]).toEqual(await listRiskEntriesForWorksite(worksiteId, worksiteAccess))
    }
  })

  it("una faena fuera del alcance se descarta en silencio, sin filtrar sus peligros", async () => {
    const result = await listRiskEntriesByWorksite([WS_B, WS_OUT], access(VIEW, scope(WS_B)))
    expect(Object.keys(result)).toEqual([WS_B])
    expect(JSON.stringify(result)).not.toContain("faena ajena")
  })

  it("con alcance total acepta cualquier faena", async () => {
    const result = await listRiskEntriesByWorksite([WS_OUT], access(VIEW, { mode: "all" } as WorksiteScope))
    expect(result[WS_OUT]?.map((row) => row.hazardCode)).toEqual(["X-01"])
  })

  it("sin permiso de ver inspecciones no entrega nada, con el mismo error que 'no existe'", async () => {
    await expect(listRiskEntriesByWorksite([WS_B], access([], scope(WS_B)))).rejects.toThrow("Inspección no encontrada o fuera de alcance.")
  })

  it("sin faenas no consulta nada y devuelve un objeto vacío", async () => {
    const before = queries.length
    expect(await listRiskEntriesByWorksite([], access(VIEW, scope(WS_A)))).toEqual({})
    expect(await listRiskEntriesByWorksite([WS_OUT], access(VIEW, scope(WS_A)))).toEqual({})
    expect(queries.length).toBe(before)
  })

  it("una faena repetida en la lista no duplica sus peligros", async () => {
    const result = await listRiskEntriesByWorksite([WS_B, WS_B], access(VIEW, scope(WS_B)))
    expect(result[WS_B]).toHaveLength(2)
  })
})
