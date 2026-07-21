/**
 * H-28: el workflow segregado de PPA (`lib/services/ppa-module/reportes.ts`)
 * — revisión, declaración de corrección, verificación, reinicio, cancelación
 * y cierre, todos con optimistic locking por `version` y derivación de una
 * acción CAPA — no tenía cobertura de persistencia real. `ppa-service.test.ts`
 * mockea `@/db` a mano; `prevencion-ppa-admin.test.ts` mockea el servicio
 * completo (boundary/wiring legítimo: permisos, validación, propagación de
 * error — se mantiene mockeado). Este archivo usa PGlite siguiendo el mismo
 * patrón que `prevention-pdtp.test.ts` y `prevention-documents-persistence.test.ts`.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import { nanoid } from "@/lib/id"

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

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.ppaStatusHistory)
  await inMemoryDb.delete(schema.ppaCorrectiveActions)
  await inMemoryDb.delete(schema.ppaSubmissions)
  await inMemoryDb.delete(schema.preventionCapaEvidence)
  await inMemoryDb.delete(schema.preventionCapaActions)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values([
    { id: "user-prev", name: "Prevencionista", email: "prev@example.test", hashedPassword: "x" },
    { id: "user-jefe", name: "Jefe de faena", email: "jefe@example.test", hashedPassword: "x" },
  ])
  await inMemoryDb.insert(schema.worksites).values([
    { id: "ws-1", name: "Faena A", code: "FA", isActive: true },
    { id: "ws-2", name: "Faena B", code: "FB", isActive: true },
  ])
})

const REVIEWER = { userId: "user-prev", worksiteIds: ["ws-1"], permissions: ["ppa:correct", "prevention:capa:complete"] }
const VERIFIER = { userId: "user-jefe", worksiteIds: ["ws-1"], permissions: ["ppa:verify", "ppa:authorize_restart", "ppa:close", "ppa:cancel", "prevention:capa:verify", "prevention:capa:manage"] }

async function insertPpaFixture(overrides: Partial<typeof schema.ppaSubmissions.$inferInsert> = {}) {
  const id = `ppa-${nanoid()}`
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.ppaSubmissions).values({
    id,
    worksiteId: "ws-1",
    workerId: null,
    workerName: "Juan Pérez",
    workerRut: "11.111.111-1",
    workerCompany: "Chome",
    manualIdentificacion: true,
    tipoTrabajo: "trabajo_altura",
    esCritica: true,
    answersJson: {},
    resultado: "detenido",
    triggeredReasons: ["sin_arnes"],
    estado: "detenido",
    publicToken: `tok-${id}`,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  })
  return id
}

const REVIEW_INPUT = (ppaId: string) => ({
  ppaId, fuiAlLugar: true, decision: "correccion" as const,
  accionCorrectiva: "Instalar línea de vida y verificar arnés antes de continuar.",
  responsibleRole: "prevencionista_faena" as const, responsible: "Ana Soto",
  dueDate: "2026-08-01", priority: "media" as const,
})

async function reviewToCorreccion(ppaId: string) {
  const { reviewPpa } = await import("@/lib/services/ppa-module/reportes")
  return reviewPpa(REVIEW_INPUT(ppaId), REVIEWER.userId, REVIEWER.worksiteIds)
}

async function linkedCapaId(ppaId: string) {
  const [legacy] = await inMemoryDb.select().from(schema.ppaCorrectiveActions).where(eq(schema.ppaCorrectiveActions.ppaId, ppaId))
  return legacy!.capaActionId!
}

/** El CAPA nace con evidenceRequired=true; sin evidencia, el paso a pending_verification se rechaza. */
async function attachCapaEvidence(capaId: string) {
  await inMemoryDb.insert(schema.preventionCapaEvidence).values({
    id: `cev-${nanoid()}`, actionId: capaId, kind: "document", reference: "evidencia.pdf",
    uploadedByUserId: "user-prev", createdAt: new Date().toISOString(),
  })
}

describe("PPA workflow — persistencia real (PGlite)", () => {
  it("reviewPpa con decisión rechazado no crea CAPA y deja el PPA rechazado", async () => {
    const ppaId = await insertPpaFixture()
    const { reviewPpa } = await import("@/lib/services/ppa-module/reportes")
    const updated = await reviewPpa({ ppaId, fuiAlLugar: true, decision: "rechazado" }, REVIEWER.userId, REVIEWER.worksiteIds)
    expect(updated.estado).toBe("rechazado")
    expect(updated.version).toBe(2)

    const capas = await inMemoryDb.select().from(schema.ppaCorrectiveActions)
    expect(capas).toHaveLength(0)
  })

  it("reviewPpa con decisión correccion crea una acción CAPA vinculada y avanza a en_correccion", async () => {
    const ppaId = await insertPpaFixture()
    const updated = await reviewToCorreccion(ppaId)
    expect(updated.estado).toBe("en_correccion")
    expect(updated.version).toBe(2)

    const [legacy] = await inMemoryDb.select().from(schema.ppaCorrectiveActions).where(eq(schema.ppaCorrectiveActions.ppaId, ppaId))
    expect(legacy?.capaActionId).toBeTruthy()
    const [capa] = await inMemoryDb.select().from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.id, legacy!.capaActionId!))
    expect(capa?.status).toBe("pending")
    expect(capa?.sourceType).toBe("ppa")

    const history = await inMemoryDb.select().from(schema.ppaStatusHistory).where(eq(schema.ppaStatusHistory.ppaId, ppaId))
    expect(history).toHaveLength(1)
    expect(history[0]?.toStatus).toBe("en_correccion")
  })

  it("reviewPpa rechaza reprocesar un PPA que ya fue resuelto, sin mutación parcial", async () => {
    const ppaId = await insertPpaFixture()
    await reviewToCorreccion(ppaId)

    const { reviewPpa } = await import("@/lib/services/ppa-module/reportes")
    await expect(reviewPpa(REVIEW_INPUT(ppaId), REVIEWER.userId, REVIEWER.worksiteIds))
      .rejects.toThrow(/ya fue resuelto/i)

    // No debe haber creado una segunda acción CAPA ni una segunda entrada de historial.
    const capas = await inMemoryDb.select().from(schema.ppaCorrectiveActions).where(eq(schema.ppaCorrectiveActions.ppaId, ppaId))
    expect(capas).toHaveLength(1)
    const history = await inMemoryDb.select().from(schema.ppaStatusHistory).where(eq(schema.ppaStatusHistory.ppaId, ppaId))
    expect(history).toHaveLength(1)
  })

  it("reviewPpa rechaza un PPA fuera del alcance de faena del usuario (lectura real desde BD)", async () => {
    const ppaId = await insertPpaFixture({ worksiteId: "ws-2" })
    const { reviewPpa } = await import("@/lib/services/ppa-module/reportes")
    await expect(reviewPpa(REVIEW_INPUT(ppaId), REVIEWER.userId, REVIEWER.worksiteIds))
      .rejects.toThrow(/no encontrado/i)
  })

  it("declarePpaCorrection rechaza expectedPpaVersion desactualizada sin mutar estado", async () => {
    const ppaId = await insertPpaFixture()
    await reviewToCorreccion(ppaId) // ppa queda en version 2
    const capaId = await linkedCapaId(ppaId)
    await attachCapaEvidence(capaId)

    const { declarePpaCorrection } = await import("@/lib/services/ppa-module/reportes")
    await expect(declarePpaCorrection({ ppaId, expectedPpaVersion: 1, expectedCapaVersion: 1 }, REVIEWER))
      .rejects.toThrow(/cambió o no está en corrección/i)

    const [row] = await inMemoryDb.select().from(schema.ppaSubmissions).where(eq(schema.ppaSubmissions.id, ppaId))
    expect(row?.estado).toBe("en_correccion")
    expect(row?.version).toBe(2)
  })

  it("flujo completo: declarar corrección → verificar (aceptado) → autorizar reinicio → cerrar", async () => {
    const ppaId = await insertPpaFixture()
    await reviewToCorreccion(ppaId)
    const capaId = await linkedCapaId(ppaId)
    await attachCapaEvidence(capaId)

    const { declarePpaCorrection, verifyPpaCorrection, authorizePpaRestart, closePpa } = await import("@/lib/services/ppa-module/reportes")

    const declared = await declarePpaCorrection({ ppaId, expectedPpaVersion: 2, expectedCapaVersion: 1 }, REVIEWER)
    expect(declared.estado).toBe("pendiente_verificacion")
    expect(declared.version).toBe(3)
    const [capaAfterDeclare] = await inMemoryDb.select().from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.id, capaId))
    expect(capaAfterDeclare?.status).toBe("pending_verification")

    const verified = await verifyPpaCorrection({
      ppaId, expectedPpaVersion: 3, expectedCapaVersion: capaAfterDeclare!.version,
      accepted: true, comment: "Control verificado en terreno.", effectivenessStatus: "effective", effectivenessAssessment: "Línea de vida instalada y probada.",
    }, VERIFIER)
    expect(verified.estado).toBe("pendiente_verificacion")
    expect(verified.verifiedAt).toBeTruthy()
    expect(verified.version).toBe(4)
    const [capaAfterVerify] = await inMemoryDb.select().from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.id, capaId))
    expect(capaAfterVerify?.status).toBe("verified")

    const restarted = await authorizePpaRestart({ ppaId, expectedPpaVersion: 4, comment: "Reinicio autorizado" }, VERIFIER)
    expect(restarted.estado).toBe("autorizado")
    expect(restarted.version).toBe(5)

    const closed = await closePpa({ ppaId, expectedPpaVersion: 5, comment: "Caso cerrado, control efectivo." }, VERIFIER)
    expect(closed.estado).toBe("cerrado")
    expect(closed.version).toBe(6)

    const history = await inMemoryDb.select().from(schema.ppaStatusHistory).where(eq(schema.ppaStatusHistory.ppaId, ppaId))
    expect(history.map((h) => h.toStatus)).toEqual(["en_correccion", "pendiente_verificacion", "pendiente_verificacion", "autorizado", "cerrado"])
  })

  it("verifyPpaCorrection rechazado reabre el CAPA y devuelve el PPA a en_correccion", async () => {
    const ppaId = await insertPpaFixture()
    await reviewToCorreccion(ppaId)
    const capaId = await linkedCapaId(ppaId)
    await attachCapaEvidence(capaId)

    const { declarePpaCorrection, verifyPpaCorrection } = await import("@/lib/services/ppa-module/reportes")
    await declarePpaCorrection({ ppaId, expectedPpaVersion: 2, expectedCapaVersion: 1 }, REVIEWER)

    const [capaBeforeVerify] = await inMemoryDb.select().from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.id, capaId))
    const rejected = await verifyPpaCorrection({
      ppaId, expectedPpaVersion: 3, expectedCapaVersion: capaBeforeVerify!.version,
      accepted: false, comment: "Control insuficiente, falta anclaje certificado.",
    }, VERIFIER)
    expect(rejected.estado).toBe("en_correccion")
    expect(rejected.verifiedAt).toBeNull()

    const [capaAfter] = await inMemoryDb.select().from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.id, capaId))
    expect(capaAfter?.status).toBe("reopened")
  })

  it("closePpa rechaza si la acción CAPA vinculada no está verificada", async () => {
    const ppaId = await insertPpaFixture()
    await reviewToCorreccion(ppaId)
    const capaId = await linkedCapaId(ppaId)
    await attachCapaEvidence(capaId)
    const { declarePpaCorrection, closePpa } = await import("@/lib/services/ppa-module/reportes")
    await declarePpaCorrection({ ppaId, expectedPpaVersion: 2, expectedCapaVersion: 1 }, REVIEWER)

    // El PPA no llegó a "autorizado" (faltó verificar + autorizar reinicio), así
    // que closePpa debe rechazar por precondición de estado antes de tocar el CAPA.
    await expect(closePpa({ ppaId, expectedPpaVersion: 3, comment: "Intento de cierre prematuro" }, VERIFIER))
      .rejects.toThrow(/solo se puede cerrar/i)

    const [capa] = await inMemoryDb.select().from(schema.preventionCapaActions).where(eq(schema.preventionCapaActions.id, capaId))
    expect(capa?.status).toBe("pending_verification")
  })

  it("cancelPpa cancela un PPA detenido sin CAPA vinculado", async () => {
    const ppaId = await insertPpaFixture()
    const { cancelPpa } = await import("@/lib/services/ppa-module/reportes")
    const cancelled = await cancelPpa({ ppaId, expectedPpaVersion: 1, reason: "Tarea descartada por el turno" }, VERIFIER)
    expect(cancelled.estado).toBe("cancelado")
    expect(cancelled.cancelledByUserId).toBe("user-jefe")
  })
})
