import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { IncidentAccess } from "@/lib/services/prevention-incidents"

/*
 * El sexo vive en la ficha del trabajador y el incidente lo copia al vincular a
 * la persona. Sin esa copia, la desagregación por sexo de los indicadores cae
 * entera en «sin dato» aunque el padrón lo tenga.
 */

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite compatibility
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const USER_ID = "u-sex-1"
const WS_ID = "ws-sex-1"
const OCCURRED_AT = new Date(Date.now() - 60 * 60_000).toISOString()
const KNOWN_AT = new Date(Date.now() - 50 * 60_000).toISOString()

const access: IncidentAccess = {
  ctx: { userId: USER_ID },
  scope: { mode: "all", ids: [] },
  permissions: ["prevention:incidents:view", "prevention:incidents:report"],
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.preventionIncidentNotifications)
  await inMemoryDb.delete(schema.preventionIncidentPeople)
  await inMemoryDb.delete(schema.preventionIncidents)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({ id: USER_ID, name: "Prevencionista", email: "sex@example.test", hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values({ id: WS_ID, name: "Faena Sexo", code: "FSEX", isActive: true })
  await inMemoryDb.insert(schema.workers).values([
    { id: "wrk-mujer", firstName: "Rosa", lastName: "Díaz", worksiteId: WS_ID, sex: "female" },
    { id: "wrk-sin-dato", firstName: "Juan", lastName: "Soto", worksiteId: WS_ID },
  ])
})

async function reportWith(people: Array<{ workerId: string | null; sex?: "female" | "male" | "intersex" | "unspecified" | null }>, submission: string) {
  const { reportPreventionIncident } = await import("@/lib/services/prevention-incidents")
  const res = await reportPreventionIncident({
    access,
    input: {
      clientSubmissionId: submission,
      worksiteId: WS_ID,
      companyName: "Empresa Test",
      eventType: "work_accident",
      occurredAt: OCCURRED_AT,
      knownAt: KNOWN_AT,
      location: "Planta",
      initialNarrative: "Golpe con herramienta",
      actualSeverity: "medical_treatment",
      potentialSeverity: "medium",
      people: people.map((person, index) => ({
        ...person,
        displayLabel: `Persona ${index + 1}`,
        employerName: "Empresa Test",
        relationshipType: "employee" as const,
      })),
    },
  })
  return inMemoryDb.select().from(schema.preventionIncidentPeople)
    .where(eq(schema.preventionIncidentPeople.incidentId, res.incident.id))
    .orderBy(schema.preventionIncidentPeople.displayLabel)
}

describe("sexo del trabajador en el incidente", () => {
  it("copia el sexo del padrón a la persona vinculada", async () => {
    const [person] = await reportWith([{ workerId: "wrk-mujer" }], "sub-sex-copia")
    expect(person?.sex).toBe("female")
  })

  it("lo que declara el reporte prevalece sobre el padrón", async () => {
    const [person] = await reportWith([{ workerId: "wrk-mujer", sex: "unspecified" }], "sub-sex-declarado")
    expect(person?.sex).toBe("unspecified")
  })

  it("un trabajador sin sexo registrado y una persona sin vínculo quedan sin dato", async () => {
    const people = await reportWith([{ workerId: "wrk-sin-dato" }, { workerId: null }], "sub-sex-vacio")
    expect(people.map((person) => person.sex)).toEqual([null, null])
  })

  it("el padrón rechaza un valor fuera del catálogo", async () => {
    await expect(inMemoryDb.insert(schema.workers).values({
      id: "wrk-invalido", firstName: "X", lastName: "Y", worksiteId: WS_ID, sex: "otro",
    })).rejects.toThrow()
  })
})
