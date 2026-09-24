/**
 * lib/__tests__/pdtp-program-acknowledgments.test.ts
 *
 * Toma de conocimiento del programa (N°2 y N°3, decisión del 2026-09-23): la
 * difusión del plan se acredita cuando todo su padrón abrió la versión activa.
 *
 * Cubre lo que no se ve leyendo el servicio: que un padrón incompleto no
 * acredita, que la N°2 se reparte a todas las faenas, que una versión que aún
 * declara la N°3 como constancia sólo muestra el avance, que un borrador no
 * registra nada y que repetir la visita no duplica.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { chileDateParts } from "@/lib/utils"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
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

const { getPdtpProgramDiffusionStatus, recordPdtpProgramAcknowledgment } = await import("@/lib/services/pdtp/program-acknowledgments")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

// El motor sólo acredita en el año del programa: se siembra el año en curso.
const PROGRAM_YEAR = chileDateParts().year
const PROGRAM_ID = "pdtp-ack-v1"
const WS_A = "ws-ack-a"
const WS_B = "ws-ack-b"

const ROLES = [
  { id: "rol-gerente-legal", name: "gerente_legal_rrhh", label: "Gerencia Legal y Recursos Humanos", isGlobal: true },
  { id: "rol-subgerente-ops", name: "subgerente_operaciones", label: "Subgerente de operaciones", isGlobal: true },
  { id: "rol-prev-faena", name: "prevencionista_faena", label: "Prevencionista faena", isGlobal: false },
  { id: "rol-jt", name: "jefe_terreno", label: "Jefe de terreno", isGlobal: false },
  { id: "rol-sol-faena", name: "solicitante_faena", label: "Solicitante faena", isGlobal: false },
]

const now = () => new Date().toISOString()

// Las revisiones de catálogo son inmutables (trigger): se siembran una vez.
await inMemoryDb.insert(schema.pdtpCatalogActivities).values([2, 3].map((n) => ({
  id: `pdtp-catalog-00${n}`, code: `PDT-00${n}-DIFUNDIR-EL-PLAN`, status: "active", createdAt: now(), updatedAt: now(),
})))
await inMemoryDb.insert(schema.pdtpCatalogActivityRevisions).values([2, 3].map((n) => ({
  id: `pdtp-catalog-00${n}-r1`, catalogActivityId: `pdtp-catalog-00${n}`, revision: 1, title: `Difundir el plan N°${n}`,
  description: "Difundir el Plan", executionGuidance: "Guía", changeNote: "Fixture de prueba", createdAt: now(),
})))

async function seed(options: { status?: string; n3Mechanism?: string } = {}) {
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpProgramAcknowledgments)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.worksiteUsers)
  await inMemoryDb.delete(schema.userRoles)
  await inMemoryDb.delete(schema.roles)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.roles).values(ROLES)
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena A", code: "FA", isActive: true },
    { id: WS_B, name: "Faena B", code: "FB", isActive: true },
  ])
  const people: Array<{ id: string; role: string; worksite?: string }> = [
    { id: "u-legal", role: "rol-gerente-legal" },
    { id: "u-ops", role: "rol-subgerente-ops" },
    { id: "u-prf-a", role: "rol-prev-faena", worksite: WS_A },
    { id: "u-jt-a", role: "rol-jt", worksite: WS_A },
    { id: "u-prf-b", role: "rol-prev-faena", worksite: WS_B },
    // Adscrito a la faena A pero sin cargo responsable del programa: no es padrón.
    { id: "u-sol-a", role: "rol-sol-faena", worksite: WS_A },
  ]
  await inMemoryDb.insert(schema.users).values(people.map((person) => ({
    id: person.id, name: person.id, email: `${person.id}@example.test`, hashedPassword: "x", isActive: true,
  })))
  await inMemoryDb.insert(schema.userRoles).values(people.map((person) => ({ userId: person.id, roleId: person.role })))
  await inMemoryDb.insert(schema.worksiteUsers).values(people.filter((person) => person.worksite)
    .map((person) => ({ userId: person.id, worksiteId: person.worksite! })))

  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: "PDTP toma de conocimiento", status: options.status ?? "active",
    appliesToAllWorksites: true, elaboratedByName: "JDPR", elaboratedByTitle: "Jefatura", creationMode: "blank",
    complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2, createdAt: now(), updatedAt: now(),
  })
  await inMemoryDb.insert(schema.pdtpActivities).values([
    { n: 2, mechanism: "enganche", activity: "Difundir el Plan a gerencias y subgerencias", slug: "jdpr" },
    { n: 3, mechanism: options.n3Mechanism ?? "enganche", activity: "Difundir el Plan en las faenas", slug: "prf" },
  ].map((row) => ({
    id: `${PROGRAM_ID}-a-00${row.n}`, programId: PROGRAM_ID, n: row.n, catalogActivityId: `pdtp-catalog-00${row.n}`, catalogRevision: 1,
    activity: row.activity, program: "Guía", responsibleSlugs: [row.slug], responsibleDisplay: row.slug.toUpperCase(),
    mechanism: row.mechanism, sourceSheetRow: row.n, createdAt: now(), updatedAt: now(),
  })))
}

async function executionsFor(n: number) {
  return inMemoryDb.select().from(schema.pdtpExecutions)
    .where(and(eq(schema.pdtpExecutions.activityId, `${PROGRAM_ID}-a-00${n}`), eq(schema.pdtpExecutions.sourceType, "toma_conocimiento")))
}

describe("toma de conocimiento del programa", () => {
  beforeEach(() => seed())

  it("arma el padrón por rol y faena, y no cuenta a quien no tiene cargo responsable", async () => {
    await recordPdtpProgramAcknowledgment(PROGRAM_ID, "u-prf-a")
    const status = await getPdtpProgramDiffusionStatus(PROGRAM_ID)

    const byKey = new Map(status!.groups.map((group) => [group.worksiteId ?? "gerencias", group]))
    expect(byKey.get("gerencias")!.people.map((person) => person.userId).sort()).toEqual(["u-legal", "u-ops"])
    const faenaA = byKey.get(WS_A)!
    expect(faenaA.people.map((person) => person.userId).sort()).toEqual(["u-jt-a", "u-prf-a"])
    expect(faenaA.acknowledgedCount).toBe(1)
    expect(faenaA.complete).toBe(false)
    expect(faenaA.people.find((person) => person.userId === "u-jt-a")!.acknowledgedAt).toBeNull()
  })

  it("acredita la N°3 de una faena sólo cuando todo su padrón abrió el programa, una vez", async () => {
    await recordPdtpProgramAcknowledgment(PROGRAM_ID, "u-prf-a")
    expect(await executionsFor(3)).toHaveLength(0)

    await recordPdtpProgramAcknowledgment(PROGRAM_ID, "u-jt-a")
    await recordPdtpProgramAcknowledgment(PROGRAM_ID, "u-jt-a") // volver a entrar no suma

    const executions = await executionsFor(3)
    expect(executions).toHaveLength(1)
    expect(executions[0]).toMatchObject({ worksiteId: WS_A, origin: "integration", executedQuantity: 1 })
    // La faena B tiene su propio padrón, todavía pendiente.
    expect(executions.some((execution) => execution.worksiteId === WS_B)).toBe(false)
  })

  it("acredita la N°2 en todas las faenas del programa cuando las gerencias completan", async () => {
    await recordPdtpProgramAcknowledgment(PROGRAM_ID, "u-legal")
    expect(await executionsFor(2)).toHaveLength(0)
    await recordPdtpProgramAcknowledgment(PROGRAM_ID, "u-ops")

    const executions = await executionsFor(2)
    expect(executions.map((execution) => execution.worksiteId).sort()).toEqual([WS_A, WS_B])
  })

  it("una versión que declara la N°3 como constancia sólo muestra el avance", async () => {
    await seed({ n3Mechanism: "constancia" })
    await recordPdtpProgramAcknowledgment(PROGRAM_ID, "u-prf-a")
    await recordPdtpProgramAcknowledgment(PROGRAM_ID, "u-jt-a")

    const status = await getPdtpProgramDiffusionStatus(PROGRAM_ID)
    const faenaA = status!.groups.find((group) => group.worksiteId === WS_A)!
    expect(faenaA).toMatchObject({ complete: true, accredits: false })
    expect(await executionsFor(3)).toHaveLength(0)
  })

  it("no registra nada sobre una versión que todavía no está activa", async () => {
    await seed({ status: "draft" })
    expect(await recordPdtpProgramAcknowledgment(PROGRAM_ID, "u-prf-a")).toEqual({ recorded: false })
    expect(await inMemoryDb.select().from(schema.pdtpProgramAcknowledgments)).toHaveLength(0)
  })
})
