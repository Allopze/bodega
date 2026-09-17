/**
 * lib/__tests__/pdtp-worker-onboarding-accreditation.test.ts
 *
 * Enganche entre el acta de trabajador nuevo y el programa anual (G11).
 *
 * El instrumento ya existía completo —`TRABAJADOR_NUEVO`, revisión 01 del
 * 2026-02-25, con acta de cierre inmutable por DS 44— y lo que faltaba era el
 * cable. Estos tests cierran un acta de verdad, con todos sus ítems respondidos,
 * y verifican que el programa se enteró.
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
const { closeEvaluation } = await import("@/lib/services/sst-module/evaluations")
const { getDefinition } = await import("@/lib/sst/definitions")
const { getEvaluationApplicableItems } = await import("@/lib/services/sst-module/helpers")
const { onWorkerEnteredDotacion } = await import("@/lib/services/pdtp-adapters/worker-lifecycle-connector")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

/* El motor no acredita fuera del año del programa. */
const PROGRAM_YEAR = chileDateParts().year
const USER_ID = "user-onb-1"
const WS_ID = "ws-onb-1"
const WORKER_ID = "wk-onb-1"
const PROGRAM_ID = "pdtp-onb-v1"
const EVAL_ID = "sstev-onb-1"

/** Las cinco que el acta cierra, más la N°17 que a propósito no (decisión D06). */
const ACTIVITY_NUMBERS = [15, 17, 18, 19, 23, 52, 63] as const

/**
 * La N°15 y la N°52 se miden por plazo de cierre, así que ya no acreditan
 * directo: reportan la obligación que abrió la entrada del trabajador. Las
 * otras cuatro siguen acreditando directo.
 */
const BY_OBLIGATION = new Set([15, 52])
const activityId = (n: number) => `${PROGRAM_ID}-a-${String(n).padStart(3, "0")}`

/** El valor conforme depende de la escala del ítem. */
const CONFORMING_BY_KIND: Record<string, string> = {
  cumple_nocumple_na_obs: "cumple",
  entregado_obs: "entregado",
  apto_obs: "apto",
  si_no_obs: "si",
  bueno_regular_malo_obs: "cumple",
}

function conformingFor(kind: string): string {
  return CONFORMING_BY_KIND[kind] ?? "cumple"
}

async function executionsFor(n: number) {
  return inMemoryDb.select().from(schema.pdtpExecutions)
    .where(eq(schema.pdtpExecutions.activityId, activityId(n)))
}

/** El alta del trabajador, que es lo que abre las obligaciones de entrada. */
async function openEntryObligations() {
  return onWorkerEnteredDotacion([{
    workerId: WORKER_ID, worksiteId: WS_ID, kind: "alta",
    occurredAt: `${PROGRAM_YEAR}-04-01T12:00:00.000Z`,
  }], USER_ID)
}

/**
 * Responde todos los ítems aplicables del acta. `closeEvaluation` exige que no
 * quede ninguno sin responder, así que sin esto el cierre falla antes de llegar
 * a la acreditación.
 */
async function answerAll(overrides: Record<string, { estado: string; observacion?: string }> = {}) {
  const definition = getDefinition("trabajador_nuevo", "01")
  const items = getEvaluationApplicableItems(definition, [], null)
  const rows = items.map(({ seccionId, item }, index) => {
    const key = `${seccionId}::${item.id}`
    const override = overrides[key]
    return {
      id: `resp-${index}`,
      evaluationId: EVAL_ID,
      seccionId,
      itemId: item.id,
      estado: override?.estado ?? conformingFor(item.kind),
      observacion: override?.observacion ?? null,
    }
  })
  await inMemoryDb.insert(schema.sstResponses).values(rows)
  return rows.length
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  // Las ejecuciones antes que las obligaciones: `obligation_id` es
  // `ON DELETE SET NULL`, y anular dos de la misma celda a la vez choca contra
  // el índice único parcial de período.
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpObligations)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.sstResponses)
  await inMemoryDb.delete(schema.sstEvaluations)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Prevencionista", email: "prev-onb@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({ id: WS_ID, name: "Faena Onboarding", code: "FO", isActive: true })
  await inMemoryDb.insert(schema.workers).values({
    id: WORKER_ID, rut: "15111222-3", firstName: "Nuevo", lastName: "Trabajador",
    worksiteId: WS_ID, isActive: true, createdAt: now,
  })

  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} onboarding`,
    status: "active", appliesToAllWorksites: true, elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values(ACTIVITY_NUMBERS.map((n) => ({
    id: activityId(n), programId: PROGRAM_ID, n,
    activity: `Actividad de habilitación N°${n}`, program: "Habilitación del trabajador",
    responsibleSlugs: ["prevencionista_faena"], responsibleDisplay: "PRF",
    scheduleMode: "on_demand", scheduleClassificationStatus: "confirmed",
    // Los cinco campos que `createPdtpObligation` exige para poder abrir un
    // caso: sin ellos la N°15 y la N°52 no tendrían obligación que reportar.
    dueDays: 0,
    evidenceRequirement: "Acta de trabajador nuevo firmada.",
    indicatorMode: BY_OBLIGATION.has(n) ? "closed_on_time" : "planned_vs_completed",
    sourceSheetRow: n, createdAt: now, updatedAt: now,
  })))

  await inMemoryDb.insert(schema.sstEvaluations).values({
    id: EVAL_ID, worksiteId: WS_ID, workerId: WORKER_ID, createdBy: USER_ID,
    definicionCode: "trabajador_nuevo", definicionVersion: "01", tipo: "nuevo",
    fechaEvaluacion: `${PROGRAM_YEAR}-04-01`, estado: "borrador",
    createdAt: now, updatedAt: now,
  })
})

describe("El acta de trabajador nuevo acredita al cerrarse", () => {
  it("cierra las seis actividades cuando todos los ítems quedan conformes", async () => {
    await openEntryObligations()
    const answered = await answerAll()
    expect(answered).toBeGreaterThan(0)

    await closeEvaluation(EVAL_ID, { evaluationId: EVAL_ID }, "all")

    // N°19 cierra junto con las otras: la carpeta del trabajador queda al día
    // con los mismos tres componentes que ya cierran la N°15, N°18 y N°23.
    for (const n of [18, 19, 23, 63]) {
      const rows = await executionsFor(n)
      expect(rows, `N°${n}`).toHaveLength(1)
      expect(rows[0], `N°${n}`).toMatchObject({
        worksiteId: WS_ID,
        origin: "integration",
        sourceType: "evaluacion_sst",
        sourceId: `habilitacion:${EVAL_ID}`,
        // Nace `submitted`: sólo las inspecciones pueden autoaprobarse.
        status: "submitted",
        year: PROGRAM_YEAR,
        month: 4,
        week: 1,
        // Acreditación directa: no cuelga de ninguna obligación.
        obligationId: null,
      })
    }

    // La N°15 y la N°52 cierran su obligación en vez de acreditar directo, que
    // es lo único que el indicador de plazo mira.
    for (const n of [15, 52]) {
      const rows = await executionsFor(n)
      expect(rows, `N°${n}`).toHaveLength(1)
      expect(rows[0]!.obligationId, `N°${n}`).toBeTruthy()
      expect(rows[0], `N°${n}`).toMatchObject({ status: "submitted", worksiteId: WS_ID })
    }
    const obligations = await inMemoryDb.select().from(schema.pdtpObligations)
    expect(obligations).toHaveLength(2)
    expect(obligations.every((o) => o.status === "reported")).toBe(true)
  })

  it("no acredita la N°17: el RE-28 no es la declaración de salud del acta", async () => {
    // Decisión D06. El acta tiene "Declaración de salud", que no es el RE-28 ni
    // tiene su criterio de sensibilidad.
    await openEntryObligations()
    await answerAll()
    await closeEvaluation(EVAL_ID, { evaluationId: EVAL_ID }, "all")
    expect(await executionsFor(17)).toHaveLength(0)
  })

  it("un ítem no conforme no cierra su actividad", async () => {
    // El RIOHS marcado "no cumple" prueba que no se entregó.
    await openEntryObligations()
    await answerAll({
      "induccion_capacitacion::riohs": { estado: "no_cumple", observacion: "No se alcanzó a entregar en la incorporación." },
    })
    await closeEvaluation(EVAL_ID, { evaluationId: EVAL_ID }, "all")

    expect(await executionsFor(18)).toHaveLength(0)
    // La inducción IRL sí se hizo, así que la N°15 no se ve arrastrada.
    expect(await executionsFor(15)).toHaveLength(1)
    // La carpeta no queda al día si falta uno de sus tres componentes.
    expect(await executionsFor(19)).toHaveLength(0)
  })

  it("la entrega de EPP exige la sección completa, no una prenda", async () => {
    await openEntryObligations()
    await answerAll({
      "epp::guantes_seguridad": { estado: "no_entregado", observacion: "Sin stock de la talla al momento del ingreso." },
    })
    await closeEvaluation(EVAL_ID, { evaluationId: EVAL_ID }, "all")
    expect(await executionsFor(23)).toHaveLength(0)
  })

  it("cerrar dos veces no vuelve a sumar", async () => {
    await openEntryObligations()
    await answerAll()
    await closeEvaluation(EVAL_ID, { evaluationId: EVAL_ID }, "all")
    // El servicio devuelve el acta tal cual si ya estaba cerrada; la clave
    // idempotente del motor cubre el resto.
    await closeEvaluation(EVAL_ID, { evaluationId: EVAL_ID }, "all")
    expect(await executionsFor(15)).toHaveLength(1)
  })

  it("sin obligación abierta, el acta cierra igual y las directas acreditan", async () => {
    // El caso del trabajador que entró antes de que existiera el abridor. El
    // kit deja un `warn` y sigue: perder la N°15 es el costo de no haber
    // registrado su entrada, y no puede arrastrar a las otras cuatro.
    await answerAll()

    const closed = await closeEvaluation(EVAL_ID, { evaluationId: EVAL_ID }, "all")

    expect(closed.estado).toBe("cerrado")
    expect(await inMemoryDb.select().from(schema.pdtpObligations)).toHaveLength(0)
    expect(await executionsFor(15)).toHaveLength(0)
    expect(await executionsFor(52)).toHaveLength(0)
    for (const n of [18, 19, 23, 63]) {
      expect(await executionsFor(n), `N°${n}`).toHaveLength(1)
    }
  })

  it("el acta se cierra igual sin programa PDTP activo", async () => {
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "draft" })
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))
    await answerAll()

    const closed = await closeEvaluation(EVAL_ID, { evaluationId: EVAL_ID }, "all")

    expect(closed.estado).toBe("cerrado")
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)
  })
})

describe("onboardingActivityNumbers — el mapa, sin base de datos", () => {
  it("mapea los ítems que el texto del acta respalda", async () => {
    const { onboardingActivityNumbers } = await import("@/lib/services/pdtp-adapters/worker-onboarding-connector")
    const numbers = onboardingActivityNumbers({
      resultadoFinal: "habilitado_autonomo",
      responses: [
        { seccionId: "induccion_capacitacion", itemId: "induccion_irl", estado: "cumple" },
        { seccionId: "induccion_capacitacion", itemId: "riohs", estado: "cumple" },
        { seccionId: "induccion_capacitacion", itemId: "capacitacion_epp", estado: "cumple" },
        { seccionId: "epp", itemId: "casco_seguridad", estado: "entregado" },
      ],
    })
    // N°19 cierra junto con las tres: es el mismo hecho archivado.
    expect(numbers).toEqual([15, 18, 19, 23, 52, 63])
  })

  it("una habilitación con restricciones no es la inducción completa", async () => {
    const { onboardingActivityNumbers } = await import("@/lib/services/pdtp-adapters/worker-onboarding-connector")
    const numbers = onboardingActivityNumbers({
      resultadoFinal: "habilitado_restricciones",
      responses: [{ seccionId: "induccion_capacitacion", itemId: "riohs", estado: "cumple" }],
    })
    // Sólo el RIOHS: faltan la inducción y el EPP, así que la carpeta (N°19)
    // tampoco queda al día.
    expect(numbers).toEqual([18])
  })

  it("la carpeta (N°19) no cierra si falta uno de sus tres componentes", async () => {
    const { onboardingActivityNumbers } = await import("@/lib/services/pdtp-adapters/worker-onboarding-connector")
    const numbers = onboardingActivityNumbers({
      resultadoFinal: null,
      responses: [
        { seccionId: "induccion_capacitacion", itemId: "induccion_irl", estado: "cumple" },
        { seccionId: "induccion_capacitacion", itemId: "riohs", estado: "cumple" },
        // Sin EPP entregado.
      ],
    })
    expect(numbers).toEqual([15, 18])
  })

  it("los ítems de EPP no aplicables al cargo no cuentan en contra", async () => {
    const { onboardingActivityNumbers } = await import("@/lib/services/pdtp-adapters/worker-onboarding-connector")
    const numbers = onboardingActivityNumbers({
      resultadoFinal: null,
      responses: [
        { seccionId: "epp", itemId: "casco_seguridad", estado: "entregado" },
        { seccionId: "epp", itemId: "otros_epp", estado: "na" },
      ],
    })
    expect(numbers).toEqual([23])
  })

  it("una sección de EPP sin ningún ítem aplicable no acredita", async () => {
    const { onboardingActivityNumbers } = await import("@/lib/services/pdtp-adapters/worker-onboarding-connector")
    const numbers = onboardingActivityNumbers({
      resultadoFinal: null,
      responses: [{ seccionId: "epp", itemId: "casco_seguridad", estado: "na" }],
    })
    expect(numbers).toEqual([])
  })
})
