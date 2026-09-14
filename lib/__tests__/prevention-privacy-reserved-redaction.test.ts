/**
 * PRI-002 (auditoría 2026-09-14) — comprobación de supresión en un caso
 * reservado, contra PostgreSQL real (PGlite).
 *
 * La suite completa del dominio (`prevention-privacy-postgres.test.ts`) sólo
 * corre con una base descartable declarada por variable de entorno, así que la
 * regresión de este hallazgo necesita su propio archivo: aquí se ejercita el
 * camino `reserved_case` + `deletion` de `executePreventionPrivacyRight` con la
 * transacción y las restricciones reales.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

process.env.PREVENTION_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
process.env.PREVENTION_DATA_ENCRYPTION_KEY_VERSION = "pri002-test"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const { executePreventionPrivacyRight } = await import("@/lib/services/prevention-privacy-rights")

const NOW = new Date("2026-09-14T10:00:00.000Z").toISOString()
const ACCESS = {
  ctx: { userId: "u-investigador" },
  scope: { mode: "some" as const, ids: ["ws-pri"] },
  permissions: ["prevention:privacy:manage_requests", "prevention:reserved_case:investigate"],
}

/** El payload redactado que el operador propone para reemplazar al original. */
function suprimirCon(redactedPayload: Record<string, unknown>) {
  return executePreventionPrivacyRight({
    ...ACCESS,
    input: {
      requestId: "req-pri",
      domain: "reserved_case",
      entityId: "case-pri",
      operation: "deletion",
      reason: "Supresión del titular conservando la evidencia obligatoria",
      changes: { redactedPayload },
    },
  })
}

describe("PRI-002 — supresión en un caso reservado", () => {
  beforeAll(async () => {
    await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
    await testDb.insert(schema.worksites).values({ id: "ws-pri", name: "Faena Cordillera", code: "FN-PRI" })
    await testDb.insert(schema.users).values({
      id: "u-investigador", name: "Investigador", email: "inv@chome.cl", hashedPassword: "x",
    })
    await testDb.insert(schema.workers).values({
      id: "wrk-titular",
      rut: "12.345.678-9",
      firstName: "José",
      lastName: "Muñoz Rivas",
      position: "Operador de planta",
      worksiteId: "ws-pri",
    })
  })
  afterAll(async () => { await pg.close() })

  beforeEach(async () => {
    await testDb.delete(schema.preventionSensitiveAccessAudit)
    await testDb.delete(schema.preventionPrivacyRequestExecutions)
    await testDb.delete(schema.preventionReservedCaseSubjects)
    await testDb.delete(schema.preventionReservedCaseMembers)
    await testDb.delete(schema.preventionReservedCases)
    await testDb.delete(schema.preventionPrivacyRequests)

    await testDb.insert(schema.preventionPrivacyRequests).values({
      id: "req-pri",
      subjectWorkerId: "wrk-titular",
      rightType: "deletion",
      status: "en_proceso",
      requestScope: "Caso reservado del titular",
      receivedAt: NOW,
      identityVerifiedAt: NOW,
      identityVerifiedByUserId: "u-investigador",
      createdAt: NOW,
      updatedAt: NOW,
    })
    await testDb.insert(schema.preventionReservedCases).values({
      id: "case-pri",
      code: "RC-PRI-1",
      worksiteId: "ws-pri",
      category: "denuncia_reservada",
      status: "en_investigacion",
      encryptedPayload: "cifrado-original",
      iv: "iv",
      authTag: "tag",
      keyVersion: "pri002-test",
      createdByUserId: "u-investigador",
      createdAt: NOW,
      updatedAt: NOW,
    })
    await testDb.insert(schema.preventionReservedCaseMembers).values({
      caseId: "case-pri",
      userId: "u-investigador",
      memberRole: "investigador",
      purpose: "Investigación del caso",
      assignedByUserId: "u-investigador",
      assignedAt: NOW,
    })
    await testDb.insert(schema.preventionReservedCaseSubjects).values({
      id: "rcs-pri",
      caseId: "case-pri",
      workerId: "wrk-titular",
      relationship: "denunciante",
      linkagePurpose: "Titular de la denuncia",
      linkedByUserId: "u-investigador",
      linkedAt: NOW,
    })
  })

  /*
   * El defecto: el RUT se comparaba literalmente contra el valor guardado
   * ("12.345.678-9"), así que escribirlo en el formato de uso corriente
   * —sin puntos— pasaba la comprobación y la supresión se daba por buena con el
   * identificador nacional del titular intacto dentro del caso.
   */
  it("PRI-002: rechaza el RUT del titular escrito con otro formato (antes pasaba)", async () => {
    await expect(suprimirCon({ resumen: "El denunciante 12345678-9 mantiene su versión" }))
      .rejects.toThrow(/identificadores directos/i)
  })

  /*
   * Mismo defecto con los acentos: la ficha dice "José Muñoz Rivas" y el
   * redactor escribe "Jose Munoz". Antes eran cadenas distintas y no coincidía
   * ninguna.
   */
  it("PRI-002: rechaza el nombre del titular sin tildes (antes pasaba)", async () => {
    await expect(suprimirCon({ resumen: "Jose Munoz declaró ante el comité" }))
      .rejects.toThrow(/identificadores directos/i)
  })

  /*
   * Apellido compuesto: se comparaba entero ("Muñoz Rivas"), de modo que dejar
   * sólo una de las dos mitades no activaba nada.
   */
  it("PRI-002: rechaza una sola mitad de un apellido compuesto (antes pasaba)", async () => {
    await expect(suprimirCon({ resumen: "La persona de apellido Rivas relató los hechos" }))
      .rejects.toThrow(/identificadores directos/i)
  })

  /*
   * El identificador técnico reidentifica al titular con una consulta a
   * `workers` y no se miraba en absoluto.
   */
  it("PRI-002: rechaza el identificador interno del trabajador (antes pasaba)", async () => {
    await expect(suprimirCon({ referencia: "wrk-titular" }))
      .rejects.toThrow(/identificadores directos/i)
  })

  it("PRI-002: sigue rechazando el nombre tal cual, como antes del arreglo", async () => {
    await expect(suprimirCon({ resumen: "José Muñoz Rivas declaró ante el comité" }))
      .rejects.toThrow(/identificadores directos/i)
  })

  it("aplica la supresión cuando el payload no nombra al titular de ninguna forma", async () => {
    const execution = await suprimirCon({ resumen: "El denunciante mantiene su versión de los hechos" })

    expect(execution).toMatchObject({ operation: "deletion", outcome: "applied" })
    const [subjectLink] = await testDb.select().from(schema.preventionReservedCaseSubjects)
      .where(eq(schema.preventionReservedCaseSubjects.id, "rcs-pri"))
    expect(subjectLink?.removedAt).toBeTruthy()
    const [reservedCase] = await testDb.select().from(schema.preventionReservedCases)
      .where(eq(schema.preventionReservedCases.id, "case-pri"))
    expect(reservedCase?.encryptedPayload).not.toBe("cifrado-original")
  })

  /*
   * Cuasi-identificadores: cargo y faena NO bloquean —la plataforma no declara
   * hasta dónde llega la anonimización exigible—, pero la ejecución los deja
   * anotados para que la reidentificación por contexto sea revisable en vez de
   * invisible. Antes no quedaba rastro alguno de ellos.
   */
  it("PRI-002: deja anotado en la auditoría el contexto que sigue permitiendo reidentificar", async () => {
    const execution = await suprimirCon({
      resumen: "El operador de planta de Faena Cordillera relató los hechos del 3 de marzo",
    })

    expect(execution.details).toMatchObject({ quasiIdentifiersRetained: ["cargo", "faena"] })
  })

  it("no anota cuasi-identificadores cuando el texto tampoco los menciona", async () => {
    const execution = await suprimirCon({ resumen: "Se recibió el relato y se archivó la evidencia" })
    expect(execution.details).toMatchObject({ quasiIdentifiersRetained: [] })
  })
})
