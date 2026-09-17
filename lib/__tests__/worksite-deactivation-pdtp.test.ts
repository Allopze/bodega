/**
 * D13: desactivar una faena la retira del programa preventivo.
 *
 * Las lecturas ya la excluían (`listScopedWorksites` filtra activas y
 * `resolveProgramWorksiteIds` intersecta contra eso), pero la membresía quedaba
 * viva en `pdtp_program_worksites` y el programa seguía declarando una faena
 * que ya no opera.
 *
 * La asimetría es intencional y es lo que este test fija: desactivar retira,
 * reactivar NO repone. Desactivar es una medida de seguridad; inscribir una
 * faena en el programa anual es una decisión de la pantalla de aplicabilidad.
 */
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq, inArray } from "drizzle-orm"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import path from "node:path"
import * as schema from "@/db/schema"
import type { DB } from "@/db"

const pg = new PGlite()
const pgLiteDb = drizzle(pg, { schema })
const inMemoryDb = pgLiteDb as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
}))

const migrationsFolder = path.resolve(process.cwd(), "db/migrations")
const now = "2026-08-13T12:00:00.000Z"
const worksiteId = "ws-deact"
const programId = "prog-deact"

const CAPA_ABIERTAS = ["pending", "in_progress", "pending_verification", "reopened"] as const

/** Réplica del efecto de `toggleWorksiteActive`, sin el boundary de Next. */
async function toggleActive(activate: boolean, motivo = "Término de contrato con el mandante") {
  const razonCierre = `Cierre de faena: ${motivo}`
  const dropped = activate
    ? []
    : await inMemoryDb.update(schema.pdtpProgramWorksites)
        .set({ isActive: false })
        .where(and(
          eq(schema.pdtpProgramWorksites.worksiteId, worksiteId),
          eq(schema.pdtpProgramWorksites.isActive, true),
        ))
        .returning({ programId: schema.pdtpProgramWorksites.programId })

  if (!activate) {
    await inMemoryDb.update(schema.preventionCapaActions).set({
      status: "cancelled",
      cancelledByUserId: "user-deact",
      cancelledAt: now,
      cancellationReason: razonCierre,
      updatedAt: now,
    }).where(and(
      eq(schema.preventionCapaActions.worksiteId, worksiteId),
      inArray(schema.preventionCapaActions.status, [...CAPA_ABIERTAS]),
    ))
  }
  await inMemoryDb.update(schema.worksites)
    .set({ isActive: activate, updatedAt: now })
    .where(eq(schema.worksites.id, worksiteId))
  return dropped
}

async function membershipIsActive() {
  const [row] = await inMemoryDb.select().from(schema.pdtpProgramWorksites)
    .where(eq(schema.pdtpProgramWorksites.worksiteId, worksiteId)).limit(1)
  return row?.isActive
}

describe("desactivar una faena la retira del programa preventivo", () => {
  beforeAll(async () => {
    await migratePGlite(pg, migrationsFolder)
    await inMemoryDb.insert(schema.worksites).values({
      id: worksiteId, name: "Faena a cerrar", code: "DEACT", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.users).values({
      id: "user-deact", name: "Test", email: "deact@chome.cl",
      hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpPrograms).values({
      id: programId, year: 2026, version: 1, title: "Programa", status: "active", appliesToAllWorksites: true,
      elaboratedByName: "Test", elaboratedByTitle: "Prevención",
      createdAt: now, updatedAt: now,
    })
    await inMemoryDb.insert(schema.pdtpProgramWorksites).values({
      id: "pw-deact", programId, worksiteId, isActive: true, addedAt: now,
    })
    await inMemoryDb.insert(schema.preventionCapaActions).values([
      {
        id: "capa-abierta", code: "CAPA-2026-9001", sourceType: "manual", sourceId: "x",
        worksiteId, finding: "Extintor sin carga", actionDescription: "Recargar",
        priority: "medium", targetDate: "2026-09-01", status: "in_progress",
        createdByUserId: "user-deact", createdAt: now, updatedAt: now,
      },
      {
        id: "capa-verificada", code: "CAPA-2026-9002", sourceType: "manual", sourceId: "y",
        worksiteId, finding: "Señalética faltante", actionDescription: "Instalar",
        priority: "low", targetDate: "2026-07-01", status: "verified",
        createdByUserId: "user-deact", createdAt: now, updatedAt: now,
      },
    ])
  })

  afterAll(async () => { await pg.close() })

  it("al desactivar, la membresía del programa queda inactiva y se informa cuál", async () => {
    expect(await membershipIsActive()).toBe(true)
    const dropped = await toggleActive(false)
    expect(dropped.map((row) => row.programId)).toEqual([programId])
    expect(await membershipIsActive()).toBe(false)
  })

  it("cancela las acciones correctivas abiertas con el motivo del cierre", async () => {
    const rows = await inMemoryDb.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.worksiteId, worksiteId))
    const abierta = rows.find((row) => row.id === "capa-abierta")!
    const verificada = rows.find((row) => row.id === "capa-verificada")!

    expect(abierta.status).toBe("cancelled")
    expect(abierta.cancellationReason).toBe("Cierre de faena: Término de contrato con el mandante")
    // Una acción ya verificada conserva su historial: cerrar la faena no
    // reescribe lo que se resolvió antes.
    expect(verificada.status).toBe("verified")
    expect(verificada.cancellationReason).toBeNull()
  })

  it("al reactivar, la membresía NO se repone sola", async () => {
    const dropped = await toggleActive(true)
    expect(dropped).toHaveLength(0)
    expect(await membershipIsActive()).toBe(false)
  })

  it("desactivar de nuevo no informa programas que ya estaban retirados", async () => {
    const dropped = await toggleActive(false)
    expect(dropped).toHaveLength(0)
  })
})
