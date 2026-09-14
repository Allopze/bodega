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

/** PPAI-003: la declaración de controles implementados ya no puede ir vacía. */
const DECLARATION = "Se instaló línea de vida y se verificó el arnés del ejecutor"

async function reviewToCorreccion(ppaId: string) {
  const { reviewPpa } = await import("@/lib/services/ppa-module/reportes")
  return reviewPpa(REVIEW_INPUT(ppaId), REVIEWER.userId, REVIEWER.worksiteIds)
}

/** D11: la acción del PPA es la CAPA de origen `ppa` con ese `sourceId`. */
async function linkedCapaId(ppaId: string) {
  const [capa] = await inMemoryDb.select().from(schema.preventionCapaActions)
    .where(eq(schema.preventionCapaActions.sourceId, ppaId))
  return capa!.id
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
    // PPAI-002: rechazar es la decisión más terminal del flujo y ahora exige
    // decir por qué; no exige acción correctiva, que sería absurdo.
    const updated = await reviewPpa({
      ppaId, fuiAlLugar: true, decision: "rechazado",
      reviewNota: "El trabajo se anuló por decisión del cliente",
    }, REVIEWER.userId, REVIEWER.worksiteIds)
    expect(updated.estado).toBe("rechazado")
    expect(updated.version).toBe(2)

    const capas = await inMemoryDb.select().from(schema.preventionCapaActions)
    expect(capas).toHaveLength(0)
  })

  it("reviewPpa con decisión correccion crea una acción CAPA vinculada y avanza a en_correccion", async () => {
    const ppaId = await insertPpaFixture()
    const updated = await reviewToCorreccion(ppaId)
    expect(updated.estado).toBe("en_correccion")
    expect(updated.version).toBe(2)

    const [capa] = await inMemoryDb.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.sourceId, ppaId))
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
    const capas = await inMemoryDb.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.sourceId, ppaId))
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
    await expect(declarePpaCorrection({ ppaId, expectedPpaVersion: 1, expectedCapaVersion: 1, declaration: DECLARATION }, REVIEWER))
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

    const declared = await declarePpaCorrection({ ppaId, expectedPpaVersion: 2, expectedCapaVersion: 1, declaration: DECLARATION }, REVIEWER)
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
    await declarePpaCorrection({ ppaId, expectedPpaVersion: 2, expectedCapaVersion: 1, declaration: DECLARATION }, REVIEWER)

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
    await declarePpaCorrection({ ppaId, expectedPpaVersion: 2, expectedCapaVersion: 1, declaration: DECLARATION }, REVIEWER)

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

/**
 * PPA-03: la misma fila CAPA tenía dos conductores. El módulo CAPA genérico
 * podía cerrarla, cancelarla o reabrirla sin mirar su origen, y el PPA quedaba
 * detenido esperando un estado del CAPA que ya no existía.
 */
describe("PPA-03 — el motor CAPA genérico no conduce acciones de origen ppa (PGlite)", () => {
  const CAPA_ACCESS = {
    ctx: { userId: "user-prev" },
    scope: { mode: "some" as const, ids: ["ws-1"] },
    permissions: ["prevention:capa:complete", "prevention:capa:manage", "prevention:capa:verify", "prevention:capa:close"],
  }

  it("transitionCapaAction y updateCapaAction rechazan el origen ppa sin mutar la fila", async () => {
    const ppaId = await insertPpaFixture()
    await reviewToCorreccion(ppaId)
    const capaId = await linkedCapaId(ppaId)

    const { transitionCapaAction, updateCapaAction } = await import("@/lib/services/prevention-capa")

    await expect(transitionCapaAction({
      ...CAPA_ACCESS,
      input: { actionId: capaId, expectedVersion: 1, toStatus: "in_progress" },
    })).rejects.toThrow(`/prevencion/ppa/${ppaId}`)

    await expect(updateCapaAction({
      ...CAPA_ACCESS,
      input: { actionId: capaId, expectedVersion: 1, priority: "critical" },
    })).rejects.toThrow(`/prevencion/ppa/${ppaId}`)

    const [capa] = await inMemoryDb.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.id, capaId))
    expect(capa?.status).toBe("pending")
    expect(capa?.priority).toBe("medium")
    expect(capa?.version).toBe(1)

    // Sólo queda la transición de creación: ninguna de las dos llamadas escribió.
    const transitions = await inMemoryDb.select().from(schema.preventionCapaTransitions)
      .where(eq(schema.preventionCapaTransitions.actionId, capaId))
    expect(transitions.map((item) => item.changeType)).toEqual(["created"])
  })

  it("una acción de otro origen sigue pasando por el motor genérico", async () => {
    const { createCapaAction, transitionCapaAction } = await import("@/lib/services/prevention-capa")
    const created = await createCapaAction({
      ...CAPA_ACCESS,
      permissions: ["prevention:capa:manage"],
      input: {
        sourceType: "manual", sourceId: "libre-1", worksiteId: "ws-1",
        finding: "Hallazgo de ronda", actionDescription: "Reponer señalética faltante.",
        priority: "medium", targetDate: "2026-09-01", evidenceRequired: false,
      },
    })
    const moved = await transitionCapaAction({
      ...CAPA_ACCESS,
      input: { actionId: created.id, expectedVersion: 1, toStatus: "in_progress" },
    })
    expect(moved.status).toBe("in_progress")
  })

  it("red de seguridad: un CAPA ya en verificación no deja el PPA sin salida", async () => {
    const ppaId = await insertPpaFixture()
    await reviewToCorreccion(ppaId)
    const capaId = await linkedCapaId(ppaId)
    await attachCapaEvidence(capaId)
    // Fila heredada: el CAPA fue empujado fuera del flujo PPA antes de que
    // existiera el guardia de origen. Antes, declarePpaCorrection lanzaba
    // "no está disponible" y el caso quedaba detenido para siempre.
    await inMemoryDb.update(schema.preventionCapaActions)
      .set({ status: "pending_verification" })
      .where(eq(schema.preventionCapaActions.id, capaId))

    const { declarePpaCorrection } = await import("@/lib/services/ppa-module/reportes")
    const declared = await declarePpaCorrection({ ppaId, expectedPpaVersion: 2, expectedCapaVersion: 1, declaration: DECLARATION }, REVIEWER)
    expect(declared.estado).toBe("pendiente_verificacion")

    // Idempotente: no vuelve a transicionar el CAPA que ya estaba en destino.
    const [capa] = await inMemoryDb.select().from(schema.preventionCapaActions)
      .where(eq(schema.preventionCapaActions.id, capaId))
    expect(capa?.version).toBe(1)
  })
})

/**
 * PPA-06: revocar el enlace público es una decisión de un responsable. La
 * función recibía `userId` y lo descartaba, así que el corte quedaba sin autor.
 */
describe("revokePpaToken — traza del actor (PGlite)", () => {
  it("deja una fila de historial con el usuario que revocó", async () => {
    const ppaId = await insertPpaFixture()
    const { revokePpaToken } = await import("@/lib/services/ppa-module/evaluaciones")

    await revokePpaToken(ppaId, "user-jefe", ["ws-1"])

    const [row] = await inMemoryDb.select().from(schema.ppaSubmissions).where(eq(schema.ppaSubmissions.id, ppaId))
    expect(row?.publicTokenRevokedAt).toBeTruthy()

    const history = await inMemoryDb.select().from(schema.ppaStatusHistory)
      .where(eq(schema.ppaStatusHistory.ppaId, ppaId))
    expect(history).toHaveLength(1)
    expect(history[0]?.actorUserId).toBe("user-jefe")
    expect(history[0]?.actorType).toBe("user")
    expect(history[0]?.reason).toBe("Acceso público revocado")
    // El acceso cambia, el estado del caso no.
    expect(history[0]?.fromStatus).toBe("detenido")
    expect(history[0]?.toStatus).toBe("detenido")
  })

  it("una segunda revocación no duplica la traza", async () => {
    const ppaId = await insertPpaFixture()
    const { revokePpaToken } = await import("@/lib/services/ppa-module/evaluaciones")
    await revokePpaToken(ppaId, "user-jefe", ["ws-1"])

    await expect(revokePpaToken(ppaId, "user-prev", ["ws-1"])).rejects.toThrow(/ya está revocado/i)
    const history = await inMemoryDb.select().from(schema.ppaStatusHistory)
      .where(eq(schema.ppaStatusHistory.ppaId, ppaId))
    expect(history).toHaveLength(1)
  })
})

/**
 * PPA-04: la cola offline reenvía cuando la sincronización se interrumpe entre
 * el commit del servidor y la confirmación al cliente. Sin clave de
 * idempotencia ese reenvío duplicaba la evaluación (o la perdía si el cliente
 * la daba por fallida). Mismo patrón que incidentes y TAE.
 */
describe("createPpaSubmission — idempotencia del reenvío offline (PGlite)", () => {
  // derivePpaPublicToken firma el enlace público con el secreto del servidor,
  // que en producción exige validateEnv() y aquí no está.
  const previousSecret = process.env.AUTH_SECRET
  beforeEach(() => { process.env.AUTH_SECRET = "test-auth-secret" })
  afterAll(() => { process.env.AUTH_SECRET = previousSecret })

  /** Respuestas que NO detienen el trabajo: evita el camino de notificaciones. */
  const payload = (clientSubmissionId?: string) => ({
    clientSubmissionId,
    worksiteId: "ws-1",
    workerName: "Juan Pérez",
    workerRut: "11.111.111-1",
    tipoTrabajo: "conductor_batea",
    cambioPlanificado: "no" as const,
    peligroNoControlado: "no" as const,
    controles: ["epp", "herramientas"],
    seguroComenzar: "si" as const,
    complementarias: {},
  })

  it("dos entregas con la misma clave producen UNA fila y el MISMO token", async () => {
    const { createPpaSubmission, getPpaByToken } = await import("@/lib/services/ppa-module/evaluaciones")
    const input = payload("ppa-8f2b1c44-0d3e-4a91-b7c6-59ee12ab3d70")

    const first = await createPpaSubmission(input)
    // Segunda entrega: el cliente nunca recibió la confirmación de la primera.
    const second = await createPpaSubmission(input)

    expect(second.submission.id).toBe(first.submission.id)
    expect(second.token).toBe(first.token)

    const rows = await inMemoryDb.select().from(schema.ppaSubmissions)
    expect(rows).toHaveLength(1)
    // El reenvío tampoco duplica la historia de estados.
    const history = await inMemoryDb.select().from(schema.ppaStatusHistory)
    expect(history).toHaveLength(1)

    // El token devuelto en el reenvío sigue abriendo la fila original.
    const byToken = await getPpaByToken(second.token)
    expect(byToken?.id).toBe(first.submission.id)
  })

  it("claves distintas siguen creando PPA distintos", async () => {
    const { createPpaSubmission } = await import("@/lib/services/ppa-module/evaluaciones")
    const first = await createPpaSubmission(payload("ppa-11111111-1111-4111-8111-111111111111"))
    const second = await createPpaSubmission(payload("ppa-22222222-2222-4222-8222-222222222222"))

    expect(second.submission.id).not.toBe(first.submission.id)
    expect(second.token).not.toBe(first.token)
    expect(await inMemoryDb.select().from(schema.ppaSubmissions)).toHaveLength(2)
  })

  it("sin clave del cliente el servidor genera una y el envío sigue funcionando", async () => {
    const { createPpaSubmission } = await import("@/lib/services/ppa-module/evaluaciones")
    const first = await createPpaSubmission(payload())
    const second = await createPpaSubmission(payload())

    expect(first.submission.clientSubmissionId).toMatch(/^srv-/)
    expect(second.submission.id).not.toBe(first.submission.id)
    expect(await inMemoryDb.select().from(schema.ppaSubmissions)).toHaveLength(2)
  })
})

/**
 * PPA-08: cada paso del flujo escribe su fecha JUNTO a su actor. Los cuatro
 * CHECK de la migración 0179 son lo único que impide la mitad huérfana —fecha
 * sin actor, o actor sin fecha—, un estado que ninguna transición produce pero
 * que sí puede dejar un backfill, un script de corrección o un servicio futuro.
 * Se prueba por inserción directa a la tabla justamente porque ningún servicio
 * intenta ese estado: sin esto nada demuestra que la base los esté aplicando.
 */
describe("PPA-08 — simetría fecha↔actor en ppa_submissions (PGlite)", () => {
  const AT = "2026-08-16T12:00:00.000Z"
  type Overrides = Partial<typeof schema.ppaSubmissions.$inferInsert>
  const PARES: Array<{ check: string; soloFecha: Overrides; soloActor: Overrides }> = [
    { check: "ppa_submissions_correction_declared_check", soloFecha: { correctionDeclaredAt: AT }, soloActor: { correctionDeclaredByUserId: "user-prev" } },
    { check: "ppa_submissions_verified_check",            soloFecha: { verifiedAt: AT },           soloActor: { verifiedByUserId: "user-prev" } },
    { check: "ppa_submissions_authorized_check",          soloFecha: { authorizedAt: AT },         soloActor: { authorizedByUserId: "user-jefe" } },
    { check: "ppa_submissions_closed_check",              soloFecha: { closedAt: AT },             soloActor: { closedByUserId: "user-jefe" } },
  ]

  /**
   * Mensaje completo del rechazo, o "" si la inserción pasó. Drizzle envuelve
   * el error de Postgres: el nombre de la constraint viaja en `cause`, que
   * `.rejects.toThrow()` no inspecciona (mismo motivo que el helper de
   * db/__tests__/pdtp-check-constraints.test.ts). Afirmar sobre el nombre —y no
   * sobre /violates check/— es lo que distingue "la base rechazó" de "la base
   * rechazó POR ESTE check".
   */
  async function violationMessage(promise: Promise<unknown>): Promise<string> {
    try {
      await promise
      return ""
    } catch (error) {
      const cause = (error as { cause?: { message?: string } }).cause
      return `${(error as Error).message}\n${cause?.message ?? ""}`
    }
  }

  it("rechaza la fecha sin su actor", async () => {
    for (const { check, soloFecha } of PARES) {
      expect(await violationMessage(insertPpaFixture(soloFecha))).toMatch(check)
    }
  })

  it("rechaza el actor sin su fecha", async () => {
    for (const { check, soloActor } of PARES) {
      expect(await violationMessage(insertPpaFixture(soloActor))).toMatch(check)
    }
  })

  it("acepta los cuatro pares completos: lo prohibido es la mitad, no el paso", async () => {
    const id = await insertPpaFixture({
      estado: "cerrado",
      correctionDeclaredAt: AT, correctionDeclaredByUserId: "user-prev",
      verifiedAt:           AT, verifiedByUserId:           "user-prev",
      authorizedAt:         AT, authorizedByUserId:         "user-jefe",
      closedAt:             AT, closedByUserId:             "user-jefe",
    })
    const [row] = await inMemoryDb.select().from(schema.ppaSubmissions).where(eq(schema.ppaSubmissions.id, id))
    expect(row?.closedByUserId).toBe("user-jefe")
    expect(row?.verifiedAt).toBeTruthy()
  })
})
