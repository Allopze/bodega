/**
 * lib/__tests__/pdtp-worker-sensitivity-accreditation.test.ts
 *
 * El RE-28 acredita la N°17 al cerrarse, una vez por persona.
 *
 * Era la única actividad `compuesta` sin ningún componente que la acreditara:
 * la decisión D06 estableció que **no** sale del acta de trabajador nuevo, y su
 * formulario propio no existía. Quedaba en 0 % permanente arrastrando el
 * promedio de la faena.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

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

const { chileDateParts } = await import("@/lib/utils")
const { closeEvaluation, createEvaluation } = await import("@/lib/services/sst-module/evaluations")
const { getDefinition } = await import("@/lib/sst/definitions")
const { getEvaluationApplicableItems } = await import("@/lib/services/sst-module/helpers")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const PROGRAM_YEAR = chileDateParts().year
const USER_ID = "user-sen-1"
const WS_ID = "ws-sen-1"
const WORKER_ID = "wk-sen-1"
const PROGRAM_ID = "pdtp-sen-v1"
const EVAL_ID = "sstev-sen-1"
const ACTIVITY_ID = `${PROGRAM_ID}-a-017`

/**
 * El RE-28 no tiene ítems puntuables, así que `getEvaluationApplicableItems`
 * devuelve cero y el cierre no exige respuestas. Se responde igual, recorriendo
 * la definición completa: es lo que hace una persona en la pantalla, y es de
 * donde sale el resultado del acta.
 */
async function answerAll(evaluationId = EVAL_ID, overrides: Record<string, string> = {}) {
  const definition = getDefinition("identificacion_sensibles", "01")
  const rows = definition.sections.flatMap((section) =>
    section.items
      .filter((item) => item.kind === "si_no_obs")
      .map((item) => ({ seccionId: section.id, itemId: item.id, estado: overrides[item.id] ?? "no" })))
  await inMemoryDb.insert(schema.sstResponses).values(rows.map((row, index) => ({
    id: `resp-sen-${evaluationId}-${index}`,
    evaluationId,
    seccionId: row.seccionId,
    itemId: row.itemId,
    estado: row.estado,
    observacion: null,
  })))
  return rows.length
}

async function executions() {
  return inMemoryDb.select().from(schema.pdtpExecutions)
    .where(eq(schema.pdtpExecutions.activityId, ACTIVITY_ID))
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.sstScheduledFollowups)
  await inMemoryDb.delete(schema.sstResponses)
  await inMemoryDb.delete(schema.sstEvaluations)
  // `createEvaluation` crea o reutiliza una visita, que referencia al
  // trabajador: sin borrarla antes, el `delete(workers)` choca contra su FK.
  await inMemoryDb.delete(schema.sstEvaluationVisits)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Prevencionista", email: "prev-sen@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({ id: WS_ID, name: "Faena Sensibles", code: "FS", isActive: true })
  await inMemoryDb.insert(schema.workers).values({
    id: WORKER_ID, rut: "16222333-4", firstName: "Persona", lastName: "Sensible",
    worksiteId: WS_ID, isActive: true, createdAt: now,
  })
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} sensibles`,
    status: "active", elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACTIVITY_ID, programId: PROGRAM_ID, n: 17,
    activity: "Identificación de personas trabajadoras especialmente sensibles",
    program: "Salud ocupacional",
    responsibleSlugs: ["prevencionista_faena"], responsibleDisplay: "PRF",
    scheduleMode: "scheduled", scheduleClassificationStatus: "confirmed",
    indicatorMode: "coverage", subjectSource: "dotacion",
    sourceSheetRow: 17, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.sstEvaluations).values({
    id: EVAL_ID, worksiteId: WS_ID, workerId: WORKER_ID, createdBy: USER_ID,
    definicionCode: "identificacion_sensibles", definicionVersion: "01", tipo: "seguimiento",
    fechaEvaluacion: `${PROGRAM_YEAR}-04-15`, estado: "borrador",
    createdAt: now, updatedAt: now,
  })
})

describe("El RE-28 acredita la N°17 al cerrarse", () => {
  it("cierra la actividad con una ejecución por persona", async () => {
    expect(await answerAll()).toBeGreaterThan(0)

    await closeEvaluation(EVAL_ID, { evaluationId: EVAL_ID }, "all", USER_ID)

    const rows = await executions()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      worksiteId: WS_ID,
      origin: "integration",
      sourceType: "evaluacion_sst",
      sourceId: `sensibles:${EVAL_ID}`,
      status: "submitted",
      year: PROGRAM_YEAR,
      month: 4,
      // Una persona registrada: el padrón es la dotación, así que numerador y
      // denominador se cuentan en la misma unidad.
      executedQuantity: 1,
    })
  })

  it("el resultado sale de si el puesto exige ajuste, no del porcentaje", async () => {
    // Sin ítems puntuables el porcentaje es siempre 0; si el resultado colgara
    // de él, toda persona quedaría con restricciones.
    await answerAll(EVAL_ID, { requiere_ajuste: "si" })
    const cerrada = await closeEvaluation(EVAL_ID, { evaluationId: EVAL_ID }, "all", USER_ID)
    expect(cerrada.resultadoFinal).toBe("habilitado_restricciones")
  })

  it("sin exposición ni ajuste, el registro cierra sin restricciones", async () => {
    await answerAll()
    const cerrada = await closeEvaluation(EVAL_ID, { evaluationId: EVAL_ID }, "all", USER_ID)
    expect(cerrada.resultadoFinal).toBe("habilitado_autonomo")
  })

  it("cerrar dos veces no vuelve a sumar", async () => {
    await answerAll()
    await closeEvaluation(EVAL_ID, { evaluationId: EVAL_ID }, "all", USER_ID)
    await closeEvaluation(EVAL_ID, { evaluationId: EVAL_ID }, "all", USER_ID)
    expect(await executions()).toHaveLength(1)
  })

  it("no acredita la N°17 desde el acta de trabajador nuevo (D06)", async () => {
    // El acta de ingreso tiene una "declaración de salud" que no es el RE-28.
    // Son dos instrumentos y dos conectores, y así se quedan.
    await inMemoryDb.update(schema.sstEvaluations)
      .set({ definicionCode: "trabajador_nuevo", tipo: "nuevo" })
      .where(eq(schema.sstEvaluations.id, EVAL_ID))
    const definition = getDefinition("trabajador_nuevo", "01")
    const items = getEvaluationApplicableItems(definition, [], null)
    const conforming: Record<string, string> = {
      cumple_nocumple_na_obs: "cumple", entregado_obs: "entregado", apto_obs: "apto",
      si_no_obs: "si", bueno_regular_malo_obs: "cumple",
    }
    await inMemoryDb.insert(schema.sstResponses).values(items.map(({ seccionId, item }, index) => ({
      id: `resp-nuevo-${index}`, evaluationId: EVAL_ID, seccionId, itemId: item.id,
      estado: conforming[item.kind] ?? "cumple", observacion: null,
    })))

    await closeEvaluation(EVAL_ID, { evaluationId: EVAL_ID }, "all", USER_ID)

    expect(await executions()).toHaveLength(0)
  })

  it("abrir un RE-28 no programa los seguimientos de día 0/7/15/30", async () => {
    // Comparte `tipo: 'seguimiento'` con el control post-incidente y no comparte
    // su cadencia. Sin el opt-out de la definición nacería con cuatro
    // seguimientos que nadie va a realizar.
    const created = await createEvaluation({
      worksiteId: WS_ID,
      workerId: WORKER_ID,
      definicionCode: "identificacion_sensibles",
      tipo: "seguimiento",
      fechaEvaluacion: `${PROGRAM_YEAR}-05-02`,
      cargos: ["operador"],
    }, USER_ID)

    const followups = await inMemoryDb.select().from(schema.sstScheduledFollowups)
      .where(eq(schema.sstScheduledFollowups.evaluationId, created.id))
    expect(followups).toHaveLength(0)
  })

  it("el acta se cierra igual sin programa PDTP activo", async () => {
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "draft" })
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))
    await answerAll()

    const closed = await closeEvaluation(EVAL_ID, { evaluationId: EVAL_ID }, "all", USER_ID)

    expect(closed.estado).toBe("cerrado")
    expect(await executions()).toHaveLength(0)
  })
})
