/**
 * lib/__tests__/prevention-hygiene-pdtp-accreditation.test.ts
 *
 * Enganche entre Higiene/Vigilancia y el programa anual (G6).
 *
 * Cubre las seis actividades que el módulo acredita: la N°45 desde una medición
 * cuantitativa, las N°46-49 desde el pronunciamiento sobre cada protocolo
 * MINSAL, y la N°50 desde cada control de vigilancia realizado, en modo
 * cobertura. La N°44 no está: es constancia manual porque el módulo no admite
 * una evaluación sin valor numérico.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { HygieneAccess } from "@/lib/services/prevention-hygiene"

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
const {
  recordExposureMeasurement,
  recordSurveillanceOutcome,
  setProtocolApplicability,
} = await import("@/lib/services/prevention-hygiene")
const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

/* El motor no acredita fuera del año del programa, así que sembrar 2026 fijo
 * dejaría de ejercitar el camino feliz al cambiar de año civil. */
const PROGRAM_YEAR = chileDateParts().year

const USER_ID = "user-hyg-1"
const WS_ID = "ws-hyg-1"
const OTHER_WS_ID = "ws-hyg-2"
const PROGRAM_ID = "pdtp-hyg-v1"
const AGENT_ID = "agent-hyg-1"
const GROUP_ID = "expgr-hyg-1"
const SURV_PROGRAM_ID = "survpr-hyg-1"

/** Las seis actividades que el módulo acredita, más la N°44 que no. */
const ACTIVITY_NUMBERS = [44, 45, 46, 47, 48, 49, 50] as const
const activityId = (n: number) => `${PROGRAM_ID}-a-${String(n).padStart(3, "0")}`

const access: HygieneAccess = {
  userId: USER_ID,
  scope: { mode: "all", ids: [] },
  permissions: ["prevention:hygiene:measure", "prevention:hygiene:assess"],
}

/** Una medición válida mínima; `value` 1 queda bajo el nivel de acción. */
function measurement(overrides: Record<string, unknown> = {}) {
  return {
    groupId: GROUP_ID,
    measuredOn: `${PROGRAM_YEAR}-06-10`,
    value: 1,
    method: "NCh 2431",
    equipmentTag: "DOS-01",
    ...overrides,
  }
}

async function executionsFor(n: number) {
  return inMemoryDb.select().from(schema.pdtpExecutions)
    .where(eq(schema.pdtpExecutions.activityId, activityId(n)))
}

async function seedEnrollment(id: string, workerId: string, dueOn: string) {
  await inMemoryDb.insert(schema.preventionSurveillanceEnrollments).values({
    id, programId: SURV_PROGRAM_ID, workerId, groupId: GROUP_ID,
    enrolledOn: `${PROGRAM_YEAR}-01-05`, dueOn, status: "pending",
  })
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteParams)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.preventionHygieneHistory)
  await inMemoryDb.delete(schema.preventionProtocolApplicabilities)
  await inMemoryDb.delete(schema.preventionSurveillanceEnrollments)
  await inMemoryDb.delete(schema.preventionSurveillancePrograms)
  await inMemoryDb.delete(schema.preventionExposureMeasurements)
  await inMemoryDb.delete(schema.preventionExposureGroupMembers)
  await inMemoryDb.delete(schema.preventionExposureGroups)
  await inMemoryDb.delete(schema.preventionExposureAgents)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Prevencionista Higiene", email: "prev-hyg@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_ID, name: "Faena Higiene", code: "FH", isActive: true },
    { id: OTHER_WS_ID, name: "Faena Sin Programa", code: "FSP", isActive: true },
  ])

  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID,
    version: 1,
    year: PROGRAM_YEAR,
    title: `PDTP ${PROGRAM_YEAR} higiene`,
    status: "active",
    elaboratedByName: "Prevencionista Higiene",
    elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank",
    complianceTarget: 0.9,
    pesoEjecucion: 0.5,
    pesoVerificacion: 0.3,
    pesoCierre: 0.2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  await inMemoryDb.insert(schema.pdtpActivities).values(ACTIVITY_NUMBERS.map((n) => ({
    id: activityId(n),
    programId: PROGRAM_ID,
    n,
    activity: `Actividad de higiene N°${n}`,
    program: "Higiene y vigilancia",
    responsibleSlugs: ["prevencionista_faena"],
    responsibleDisplay: "PRF",
    scheduleMode: "scheduled",
    scheduleClassificationStatus: "confirmed",
    sourceSheetRow: n,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })))

  await inMemoryDb.insert(schema.preventionExposureAgents).values({
    id: AGENT_ID, code: "RUIDO", name: "Ruido ocupacional", agentType: "physical",
    unit: "dB(A)", permissibleLimit: "85.0000", limitBasis: "DS 594 art. 70",
    createdByUserId: USER_ID,
  })
  await inMemoryDb.insert(schema.preventionExposureGroups).values({
    id: GROUP_ID, code: "GES-01", name: "Operadores de planta", worksiteId: WS_ID,
    agentId: AGENT_ID, processDescription: "Operación de línea de proceso",
    createdByUserId: USER_ID,
  })
  await inMemoryDb.insert(schema.preventionSurveillancePrograms).values({
    id: SURV_PROGRAM_ID, code: "SURV-01", name: "Vigilancia auditiva", protocol: "prexor",
    agentId: AGENT_ID, worksiteId: WS_ID, periodicityMonths: 12,
    legalBasis: "Res. Ex. 1433/2022 MINSAL", status: "active", createdByUserId: USER_ID,
  })
})

// ── N°45: medición cuantitativa ───────────────────────────────────────────────

describe("N°45 — medición cuantitativa de exposición", () => {
  it("acredita una ejecución de integración que todavía no cuenta para el cumplimiento", async () => {
    await recordExposureMeasurement(measurement({ reportReference: "https://mutual.cl/informe/123" }), access)

    const rows = await executionsFor(45)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      worksiteId: WS_ID,
      origin: "integration",
      sourceType: "higiene",
      // Nace `submitted`, no `approved`: sólo las inspecciones pueden
      // autoaprobarse, así que el % de cumplimiento no se mueve hasta que
      // alguien la valide.
      status: "submitted",
      approvedByUserId: null,
      year: PROGRAM_YEAR,
      month: 6,
      week: 2,
    })
    const [stored] = await inMemoryDb.select().from(schema.preventionExposureMeasurements)
    expect(rows[0]!.sourceId).toBe(`medicion:${stored!.id}`)
    // La referencia del informe es una URL: cuenta como evidencia real.
    expect(rows[0]!.evidenceStatus).toBe("provided")
  })

  it("ancla la fecha civil al mediodía para no caer en el mes anterior", async () => {
    // Con `T00:00:00Z` el 1 de marzo es el 28 de febrero a las 21:00 en Chile, y
    // la medición quedaría archivada en febrero semana 4.
    await recordExposureMeasurement(measurement({ measuredOn: `${PROGRAM_YEAR}-03-01` }), access)

    const rows = await executionsFor(45)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ month: 3, week: 1 })
  })

  it("deja un rótulo sin inflar la métrica de evidencia cuando no hay informe", async () => {
    await recordExposureMeasurement(measurement(), access)

    const rows = await executionsFor(45)
    expect(rows[0]!.evidenceStatus).toBe("not_required")
    expect(rows[0]!.evidenceText).toContain("GES-01")
  })

  it("cuenta dos mediciones del mismo mes como dos ejecuciones independientes", async () => {
    await recordExposureMeasurement(measurement({ measuredOn: `${PROGRAM_YEAR}-06-10` }), access)
    await recordExposureMeasurement(measurement({ measuredOn: `${PROGRAM_YEAR}-06-11`, value: 90 }), access)

    const rows = await executionsFor(45)
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.sourceId)).size).toBe(2)
  })
})

// ── N°46 a N°49: protocolos MINSAL ────────────────────────────────────────────

describe("N°46-49 — pronunciamiento sobre protocolos MINSAL", () => {
  it("acredita la N°46 al declarar PREXOR y otra vez en cada reevaluación", async () => {
    const first = (await setProtocolApplicability({
      worksiteId: WS_ID, protocolCode: "prexor", status: "applicable",
      lastAssessedOn: `${PROGRAM_YEAR}-02-05`,
    }, access))!

    // El seguimiento del trimestre siguiente vive en la MISMA fila: sin el
    // sufijo de versión en el `sourceId`, la clave idempotente del motor —que no
    // lleva mes— lo tomaría por un reintento y la N°46 nunca pasaría de 1 de 4.
    await setProtocolApplicability({
      worksiteId: WS_ID, protocolCode: "prexor", status: "applicable",
      lastAssessedOn: `${PROGRAM_YEAR}-05-05`, expectedVersion: first.version,
    }, access)

    const rows = await executionsFor(46)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.sourceId).sort()).toEqual([
      `protocolo:${first.id}:v1`,
      `protocolo:${first.id}:v2`,
    ])
    expect(rows.map((row) => row.month).sort()).toEqual([2, 5])
  })

  it("mapea cada protocolo del programa a su actividad", async () => {
    await setProtocolApplicability({ worksiteId: WS_ID, protocolCode: "tmert", status: "applicable" }, access)
    await setProtocolApplicability({ worksiteId: WS_ID, protocolCode: "psicosocial", status: "applicable" }, access)
    await setProtocolApplicability({ worksiteId: WS_ID, protocolCode: "uv", status: "applicable" }, access)

    expect(await executionsFor(47)).toHaveLength(1)
    expect(await executionsFor(48)).toHaveLength(1)
    expect(await executionsFor(49)).toHaveLength(1)
  })

  it("no acredita los protocolos que el programa no planifica", async () => {
    await setProtocolApplicability({
      worksiteId: WS_ID, protocolCode: "silice", status: "not_applicable",
      justification: "La faena no interviene materiales con sílice cristalina.",
    }, access)

    const all = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(all).toHaveLength(0)
  })

  it("acredita un descarte justificado: declarar que no aplica también es evaluar", async () => {
    await setProtocolApplicability({
      worksiteId: WS_ID, protocolCode: "uv", status: "not_applicable",
      justification: "Toda la operación de esta faena es bajo techo.",
    }, access)

    expect(await executionsFor(49)).toHaveLength(1)
  })

  it("no acredita volver el pronunciamiento a pendiente", async () => {
    await setProtocolApplicability({ worksiteId: WS_ID, protocolCode: "prexor", status: "pending_assessment" }, access)

    expect(await executionsFor(46)).toHaveLength(0)
  })
})

// ── N°50: control de vigilancia ───────────────────────────────────────────────

describe("N°50 — control de trabajadores en vigilancia", () => {
  beforeEach(async () => {
    await inMemoryDb.insert(schema.workers).values({
      id: "wk-1", rut: "11111111-1", firstName: "Trabajador", lastName: "Uno",
      worksiteId: WS_ID, isActive: true, createdAt: new Date().toISOString(),
    })
    await seedEnrollment("surven-1", "wk-1", `${PROGRAM_YEAR}-06-30`)
  })

  it("acredita el control efectivamente realizado", async () => {
    await recordSurveillanceOutcome({
      enrollmentId: "surven-1", status: "attended", attendedOn: `${PROGRAM_YEAR}-06-12`,
    }, access)

    const rows = await executionsFor(50)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      sourceType: "vigilancia",
      sourceId: "vigilancia:surven-1",
      month: 6,
      week: 2,
    })
  })

  it("no acredita citar, ausentar ni eximir", async () => {
    await recordSurveillanceOutcome({ enrollmentId: "surven-1", status: "summoned" }, access)
    expect(await executionsFor(50)).toHaveLength(0)

    await recordSurveillanceOutcome({
      enrollmentId: "surven-1", status: "absent", absenceReason: "No se presentó a la citación.",
    }, access)
    expect(await executionsFor(50)).toHaveLength(0)
  })

  it("devuelve la ejecución al programa cuando el control deja de estar asistido", async () => {
    await recordSurveillanceOutcome({
      enrollmentId: "surven-1", status: "attended", attendedOn: `${PROGRAM_YEAR}-06-12`,
    }, access)
    expect((await executionsFor(50))[0]!.status).toBe("submitted")

    await recordSurveillanceOutcome({
      enrollmentId: "surven-1", status: "absent", absenceReason: "Se corrigió: nunca asistió al control.",
    }, access)

    const rows = await executionsFor(50)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe("draft")
  })

  it("mide por cobertura: todo el padrón o nada", async () => {
    // Cobertura sólo cuenta en meses planificados, así que la actividad necesita
    // calendario; y su padrón son los expuestos del GES, no la dotación.
    await inMemoryDb.update(schema.pdtpActivities)
      .set({ indicatorMode: "coverage" })
      .where(eq(schema.pdtpActivities.id, activityId(50)))
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: "sched-50", activityId: activityId(50), year: PROGRAM_YEAR, month: 6, week: 2,
      plannedQuantity: 1, sourceColumn: "T",
    })
    await inMemoryDb.insert(schema.pdtpActivityWorksiteParams).values({
      id: "param-50", activityId: activityId(50), worksiteId: WS_ID, expectedSubjectCount: 3,
    })

    await inMemoryDb.insert(schema.workers).values([
      { id: "wk-2", rut: "22222222-2", firstName: "Trabajador", lastName: "Dos",
        worksiteId: WS_ID, isActive: true, createdAt: new Date().toISOString() },
      { id: "wk-3", rut: "33333333-3", firstName: "Trabajador", lastName: "Tres",
        worksiteId: WS_ID, isActive: true, createdAt: new Date().toISOString() },
    ])
    await seedEnrollment("surven-2", "wk-2", `${PROGRAM_YEAR}-06-30`)
    await seedEnrollment("surven-3", "wk-3", `${PROGRAM_YEAR}-06-30`)

    const attend = async (enrollmentId: string) => {
      await recordSurveillanceOutcome({
        enrollmentId, status: "attended", attendedOn: `${PROGRAM_YEAR}-06-12`,
      }, access)
      // El cumplimiento formal sólo cuenta ejecuciones aprobadas: la
      // acreditación automática las deja `submitted` a propósito.
      await inMemoryDb.update(schema.pdtpExecutions)
        .set({ status: "approved", approvedByUserId: USER_ID, approvedAt: new Date().toISOString() })
        .where(and(
          eq(schema.pdtpExecutions.sourceId, `vigilancia:${enrollmentId}`),
          eq(schema.pdtpExecutions.activityId, activityId(50)),
        ))
    }

    await attend("surven-1")
    await attend("surven-2")
    const partial = await getPdtpComplianceIndicators(PROGRAM_ID, WS_ID)
    expect(partial!.annual.executed).toBe(0)

    await attend("surven-3")
    const complete = await getPdtpComplianceIndicators(PROGRAM_ID, WS_ID)
    expect(complete!.annual.planned).toBe(3)
    expect(complete!.annual.executed).toBe(3)
    expect(complete!.annual.percent).toBe(1)
  })
})

// ── Tolerancia a fallos ───────────────────────────────────────────────────────

describe("el enganche nunca tumba el registro de higiene", () => {
  it("registra la medición aunque no haya programa PDTP activo", async () => {
    await inMemoryDb.update(schema.pdtpPrograms)
      .set({ status: "draft" })
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))

    const result = await recordExposureMeasurement(measurement(), access)

    expect(result.measurement.id).toBeTruthy()
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)
  })

  it("registra el pronunciamiento aunque la actividad esté excluida de la faena", async () => {
    await inMemoryDb.insert(schema.pdtpActivityWorksiteExclusions).values({
      id: "excl-46", activityId: activityId(46), worksiteId: WS_ID,
      reason: "La faena no tiene exposición a ruido sobre el nivel de acción.",
      createdByUserId: USER_ID, createdAt: new Date().toISOString(),
    })

    const saved = await setProtocolApplicability({
      worksiteId: WS_ID, protocolCode: "prexor", status: "applicable",
    }, access)

    expect(saved!.id).toBeTruthy()
    expect(await executionsFor(46)).toHaveLength(0)
  })
})
