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

import { promises as fs } from "node:fs"
import nodePath from "node:path"
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

const { chileDateParts, todayInChile } = await import("@/lib/utils")
const {
  recordExposureMeasurement,
  recordHygieneMeasurementSlotStatus,
  recordSurveillanceOutcome,
  setProtocolApplicability,
} = await import("@/lib/services/prevention-hygiene")
const { getPdtpComplianceIndicators } = await import("@/lib/services/pdtp/compliance")
const { ensureHygieneMeasurementSlotsForWorksiteTx } = await import("@/lib/services/prevention-program-slots")
const { resolvePdtpSubjectCount } = await import("@/lib/services/pdtp/subject-registry")
const { enrollGroupInSurveillance, listSurveillancePrograms } = await import("@/lib/services/prevention-hygiene")
const { onExposureMeasurementRecorded } = await import("@/lib/services/pdtp-adapters/hygiene-accreditation-connector")
const { LEGACY_SURVEILLANCE_EXEMPT_REASON_PLACEHOLDER } = await import("@/lib/prevention/hygiene")

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
/**
 * El informe de laboratorio, escrito de verdad en el almacenamiento de prueba.
 *
 * `recordExposureMeasurement` vuelve a leer el archivo del disco para calcular
 * su sha256 —no confía en lo que devuelve la subida, que pasa por el navegador—,
 * así que un fixture con una ruta inventada no sirve: tiene que existir.
 */
const EVIDENCE_STORAGE_NAME = "informe-ges-01.pdf"
const EVIDENCE_PATH = `storage/hygiene-evidence/${EVIDENCE_STORAGE_NAME}`

/* `storage_path` es único global —dos mediciones no comparten archivo—, así que
 * cada medición de un mismo caso necesita el suyo. */
let evidenceSeq = 0
async function anotherEvidenceFile() {
  evidenceSeq += 1
  const name = `informe-ges-01-${evidenceSeq}.pdf`
  await writeEvidenceFile(name)
  return `storage/hygiene-evidence/${name}`
}

async function writeEvidenceFile(storageName: string) {
  const { resolveHygieneEvidenceDir } = await import("@/lib/storage/config")
  const dir = resolveHygieneEvidenceDir()
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(nodePath.join(dir, storageName), "informe de laboratorio de prueba")
}

async function seedEvidenceFile() {
  await writeEvidenceFile(EVIDENCE_STORAGE_NAME)
}

function measurement(overrides: Record<string, unknown> = {}) {
  return {
    groupId: GROUP_ID,
    measuredOn: `${PROGRAM_YEAR}-06-10`,
    value: 1,
    method: "NCh 2431",
    equipmentTag: "DOS-01",
    evidencePath: EVIDENCE_PATH,
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
  await seedEvidenceFile()
  await inMemoryDb.delete(schema.pdtpExecutionDeviations)
  await inMemoryDb.delete(schema.pdtpChangeLog)
  await inMemoryDb.delete(schema.pdtpFulfillmentEvents)
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteParams)
  await inMemoryDb.delete(schema.pdtpActivityWorksiteExclusions)
  await inMemoryDb.delete(schema.pdtpActivitySchedule)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.auditLog)
  await inMemoryDb.delete(schema.preventionProtocolApplicabilities)
  await inMemoryDb.delete(schema.preventionSurveillanceEnrollments)
  await inMemoryDb.delete(schema.preventionSurveillancePrograms)
  await inMemoryDb.delete(schema.preventionHygieneMeasurementSlots)
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
    appliesToAllWorksites: true,
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
  it("acredita y auto-aprueba de inmediato: la casilla más el informe real ya son la validación completa", async () => {
    await recordExposureMeasurement(measurement({ reportReference: "https://mutual.cl/informe/123" }), access)

    const rows = await executionsFor(45)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      worksiteId: WS_ID,
      origin: "integration",
      sourceType: "higiene",
      // Nace `approved` y no `submitted`: `higiene` está en
      // AUTO_APPROVE_SOURCE_TYPES_WITH_REAL_EVIDENCE (ronda de corrección de
      // Task 11, Importante 1) y esta medición trae un informe real
      // (`evidencePath`), así que el % de cumplimiento se mueve sin que nadie
      // tenga que validarla a mano — mismo criterio que un simulacro o un
      // acta de CGRD con evidencia.
      status: "approved",
      approvedByUserId: USER_ID,
      year: PROGRAM_YEAR,
      month: 6,
      week: 2,
    })
    const [stored] = await inMemoryDb.select().from(schema.preventionExposureMeasurements)
    expect(rows[0]!.sourceId).toBe(`medicion:${stored!.id}`)
    expect(rows[0]!.evidenceStatus).toBe("provided")
  })

  /* La fuente ya está en la lista de auto-aprobación, pero el gate real sigue
   * siendo `isRealEvidence`: un folio escrito a mano no se puede abrir en una
   * fiscalización, así que no basta con que la fuente sea elegible.
   *
   * `recordExposureMeasurement` no sirve para este caso: `evidencePath` es
   * obligatorio en su schema (el informe real siempre se exige), así que la
   * única forma de ejercitar el camino sin evidencia real es llamar al
   * conector directamente, como haría un registro histórico sin archivo. */
  it("sin evidencia real —un reportReference de texto, no una ruta ni una URL— sigue quedando submitted", async () => {
    await onExposureMeasurementRecorded({
      measurementId: "expms-sin-evidencia",
      worksiteId: WS_ID,
      groupCode: "GES-01",
      agentCode: "RUIDO",
      outcome: "below_action",
      measuredOn: `${PROGRAM_YEAR}-06-10`,
      reportReference: "Folio N°123 entregado en papel",
      recordedByUserId: USER_ID,
    })

    const rows = await executionsFor(45)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: "submitted", approvedByUserId: null })
    expect(rows[0]!.evidenceStatus).not.toBe("provided")
  })

  it("ancla la fecha civil al mediodía para no caer en el mes anterior", async () => {
    // Con `T00:00:00Z` el 1 de marzo es el 28 de febrero a las 21:00 en Chile, y
    // la medición quedaría archivada en febrero semana 4.
    await recordExposureMeasurement(measurement({ measuredOn: `${PROGRAM_YEAR}-03-01` }), access)

    const rows = await executionsFor(45)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ month: 3, week: 1 })
  })

  /* Antes este caso afirmaba que sin informe la N°45 acreditaba con un rótulo
   * sintético. Ya no hay "sin informe": el archivo es obligatorio, y lo que se
   * acredita es su ruta. Un folio escrito a mano no se puede abrir en una
   * fiscalización. */
  it("acredita con la ruta del informe y no con un rótulo sintético", async () => {
    await recordExposureMeasurement(measurement(), access)

    const rows = await executionsFor(45)
    /* El motor guarda una ruta `storage/` en `evidenceUrl` y deja `evidenceText`
     * nulo: es la señal de que acreditó con un artefacto real y no con una
     * glosa. Antes pasaba por el camino contrario, con el rótulo sintético. */
    expect(rows[0]!.evidenceUrl).toBe(EVIDENCE_PATH)
    expect(rows[0]!.evidenceText).toBeNull()
  })

  it("guarda la evidencia con su checksum calculado en servidor", async () => {
    const created = await recordExposureMeasurement(measurement(), access)
    const [evidence] = await inMemoryDb.select().from(schema.preventionHygieneMeasurementEvidence)
    expect(evidence).toMatchObject({
      measurementId: created.measurement.id,
      storagePath: EVIDENCE_PATH,
      state: "active",
    })
    expect(evidence!.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it("una ruta que no existe en disco no registra la medición", async () => {
    await expect(recordExposureMeasurement(
      measurement({ evidencePath: "storage/hygiene-evidence/no-existe.pdf" }),
      access,
    )).rejects.toThrow(/informe/i)
    expect(await executionsFor(45)).toHaveLength(0)
  })

  it("cuenta dos mediciones del mismo mes como dos ejecuciones independientes", async () => {
    await recordExposureMeasurement(measurement({ measuredOn: `${PROGRAM_YEAR}-06-10` }), access)
    await recordExposureMeasurement(measurement({
      measuredOn: `${PROGRAM_YEAR}-06-11`,
      value: 90,
      evidencePath: await anotherEvidenceFile(),
    }), access)

    const rows = await executionsFor(45)
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.sourceId)).size).toBe(2)
  })
})

// ── N°45: la casilla anual del programa ───────────────────────────────────────

/*
 * La casilla es lo que el programa espera antes de que pase nada: una
 * evaluación cuantitativa por faena y año, en febrero semana 2. La primera
 * medición del año la cumple en la misma transacción, y la acreditación cae en
 * esa celda y no en el mes en que llegó el informe (el mismo criterio que
 * simulacros, CGRD y alcotest). Sin casilla —faena anterior a la
 * pre-generación, o segunda medición del año— la medición se acredita por su
 * fecha, como siempre.
 */
describe("N°45 — la casilla anual del programa", () => {
  async function hygieneSlot() {
    const [slot] = await inMemoryDb.select().from(schema.preventionHygieneMeasurementSlots)
      .where(eq(schema.preventionHygieneMeasurementSlots.worksiteId, WS_ID))
    return slot!
  }

  /** La celda de la N°45 que declara el programa: sin planificado, el PDTP no
   *  admite un «no aplica» sobre ella. */
  async function planCell45() {
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: "sched-45", activityId: activityId(45), year: PROGRAM_YEAR, month: 2, week: 2,
      plannedQuantity: 1, sourceColumn: "O",
    })
  }

  beforeEach(async () => {
    await ensureHygieneMeasurementSlotsForWorksiteTx(
      inMemoryDb as unknown as Parameters<typeof ensureHygieneMeasurementSlotsForWorksiteTx>[0],
      WS_ID,
      PROGRAM_YEAR,
    )
  })

  it("la primera medición del año cumple la casilla y acredita febrero semana 2, no el mes del informe", async () => {
    const created = await recordExposureMeasurement(measurement({ measuredOn: `${PROGRAM_YEAR}-06-10` }), access)

    expect(await hygieneSlot()).toMatchObject({
      status: "completed",
      measurementId: created.measurement.id,
      completedByUserId: USER_ID,
      version: 2,
    })
    const rows = await executionsFor(45)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ month: 2, week: 2, evidenceUrl: EVIDENCE_PATH })
  })

  it("la segunda medición del año no toca la casilla y se acredita por su propia fecha", async () => {
    const first = await recordExposureMeasurement(measurement({ measuredOn: `${PROGRAM_YEAR}-03-10` }), access)
    await recordExposureMeasurement(measurement({
      measuredOn: `${PROGRAM_YEAR}-07-15`,
      evidencePath: await anotherEvidenceFile(),
    }), access)

    expect(await hygieneSlot()).toMatchObject({ status: "completed", measurementId: first.measurement.id })
    const rows = await executionsFor(45)
    expect(rows.map((row) => `${row.month}-${row.week}`).sort()).toEqual(["2-2", "7-3"])
  })

  it("una medición de otro año no cumple la casilla de este", async () => {
    await recordExposureMeasurement(measurement({ measuredOn: `${PROGRAM_YEAR - 1}-12-10` }), access)
    expect(await hygieneSlot()).toMatchObject({ status: "pending", measurementId: null })
  })

  it("declarar «no aplica» exige motivo y escribe el desvío en la celda de la N°45", async () => {
    await planCell45()
    const slot = await hygieneSlot()

    await expect(recordHygieneMeasurementSlotStatus({
      slotId: slot.id, expectedVersion: slot.version, status: "not_applicable", notApplicableReason: "corto",
    }, access)).rejects.toThrow(/al menos 10 caracteres/)

    const reason = "La faena no tiene agentes con límite permisible que medir."
    const updated = await recordHygieneMeasurementSlotStatus({
      slotId: slot.id, expectedVersion: slot.version, status: "not_applicable", notApplicableReason: reason,
    }, access)
    expect(updated).toMatchObject({ status: "not_applicable", notApplicableReason: reason, notApplicableByUserId: USER_ID })

    const deviations = await inMemoryDb.select().from(schema.pdtpExecutionDeviations)
      .where(eq(schema.pdtpExecutionDeviations.activityId, activityId(45)))
    expect(deviations).toHaveLength(1)
    expect(deviations[0]).toMatchObject({
      worksiteId: WS_ID, year: PROGRAM_YEAR, month: 2, week: 2,
      kind: "not_applicable", reason, status: "active", createdByUserId: USER_ID,
    })
  })

  it("la evidencia gana: una medición cumple la casilla aunque estuviera declarada no aplicable", async () => {
    await planCell45()
    const slot = await hygieneSlot()
    await recordHygieneMeasurementSlotStatus({
      slotId: slot.id, expectedVersion: slot.version, status: "not_applicable",
      notApplicableReason: "Se creyó que la faena no tenía exposición.",
    }, access)

    const created = await recordExposureMeasurement(measurement(), access)

    expect(await hygieneSlot()).toMatchObject({
      status: "completed", measurementId: created.measurement.id,
      notApplicableAt: null, notApplicableByUserId: null, notApplicableReason: null,
    })
    // El motor retira el desvío de la celda que acredita: la casilla y el PDTP
    // quedan diciendo lo mismo.
    const [deviation] = await inMemoryDb.select().from(schema.pdtpExecutionDeviations)
      .where(eq(schema.pdtpExecutionDeviations.activityId, activityId(45)))
    expect(deviation!.status).toBe("withdrawn")
    expect((await executionsFor(45))[0]).toMatchObject({ month: 2, week: 2 })
  })

  it("una casilla cumplida no se desmarca por la vía de la casilla", async () => {
    await recordExposureMeasurement(measurement(), access)
    const slot = await hygieneSlot()

    await expect(recordHygieneMeasurementSlotStatus({
      slotId: slot.id, expectedVersion: slot.version, status: "not_completed",
    }, access)).rejects.toThrow(/cumplida por una medición/)
  })

  it("sin permiso de medición, o fuera del alcance, la casilla no se toca", async () => {
    const slot = await hygieneSlot()
    const input = { slotId: slot.id, expectedVersion: slot.version, status: "not_completed" }

    await expect(recordHygieneMeasurementSlotStatus(input, { ...access, permissions: ["prevention:hygiene:assess"] }))
      .rejects.toThrow(/fuera de alcance/)
    await expect(recordHygieneMeasurementSlotStatus(input, { ...access, scope: { mode: "some", ids: [OTHER_WS_ID] } }))
      .rejects.toThrow(/fuera de alcance/)
    expect(await hygieneSlot()).toMatchObject({ status: "pending", version: 1 })
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

// ── N°50: la exención exige motivo y descuenta del padrón ─────────────────────

/** Tres personas activas en el GES, que pasa a exigir vigilancia. */
async function seedExposedGroup() {
  const now = new Date().toISOString()
  await inMemoryDb.update(schema.preventionExposureGroups)
    .set({ surveillanceRequired: true, surveillanceReason: "Medición sobre el nivel de acción de ruido." })
    .where(eq(schema.preventionExposureGroups.id, GROUP_ID))
  await inMemoryDb.insert(schema.workers).values([1, 2, 3].map((n) => ({
    id: `wk-${n}`, rut: `${n}${n}${n}${n}${n}${n}${n}${n}-${n}`, firstName: "Trabajador", lastName: `N${n}`,
    worksiteId: WS_ID, isActive: true, createdAt: now,
  })))
  await inMemoryDb.insert(schema.preventionExposureGroupMembers).values([1, 2, 3].map((n) => ({
    id: `expgm-${n}`, groupId: GROUP_ID, workerId: `wk-${n}`, joinedOn: `${PROGRAM_YEAR}-01-02`,
  })))
}

const padron = () => resolvePdtpSubjectCount("expuestos_ges", WS_ID, { year: PROGRAM_YEAR, month: 2 })

describe("N°50 — eximir exige motivo y saca a la persona del padrón de expuestos", () => {
  beforeEach(async () => {
    await seedExposedGroup()
    for (const n of [1, 2, 3]) await seedEnrollment(`surven-${n}`, `wk-${n}`, `${PROGRAM_YEAR}-06-30`)
  })

  it("eximir sin un motivo de al menos diez caracteres se rechaza, y con él se guarda", async () => {
    await expect(recordSurveillanceOutcome({ enrollmentId: "surven-1", status: "exempt" }, access))
      .rejects.toThrow(/al menos 10 caracteres/)
    // Cinco alcanzan para una ausencia, no para una exención.
    await expect(recordSurveillanceOutcome({ enrollmentId: "surven-1", status: "exempt", absenceReason: "Licencia" }, access))
      .rejects.toThrow(/al menos 10 caracteres/)

    const reason = "Control vigente realizado por la mutual del empleador anterior."
    const updated = await recordSurveillanceOutcome({ enrollmentId: "surven-1", status: "exempt", absenceReason: reason }, access)
    expect(updated).toMatchObject({ status: "exempt", absenceReason: reason })
  })

  it("la base rechaza una exención sin motivo aunque se salte el servicio", async () => {
    await expect(inMemoryDb.update(schema.preventionSurveillanceEnrollments)
      .set({ status: "exempt", absenceReason: null })
      .where(eq(schema.preventionSurveillanceEnrollments.id, "surven-1"))).rejects.toThrow()
  })

  /* Ronda 2/5, punto 2 del pedido de la controladora: el ajuste de
   * "posterior"/"prematuro" en `currentSurveillanceCycle` no puede cambiar
   * ningún resultado observable del padrón para `attended`, porque
   * `countExpuestosGes` sólo descuenta por `exempt` — un `attended` vigente
   * ya contaba antes de este cambio (es "no exento") y un `pending` recién
   * abierto por su renovación también cuenta ("no exento" también). Se
   * verifica con el mismo test antes y después de la renovación, no se
   * asume. */
  it("attended no cambia el padrón, ni antes ni después de que se abra su ciclo siguiente", async () => {
    expect(await padron()).toBe(3)

    await recordSurveillanceOutcome({ enrollmentId: "surven-1", status: "attended", attendedOn: `${PROGRAM_YEAR}-06-12` }, access)

    // El ciclo asistido sigue siendo el vigente (su sucesor `pending` es
    // "prematuro"), pero como `attended` tampoco es `exempt`, el resultado
    // del padrón es el mismo que si el sucesor ya fuera el vigente.
    expect(await padron()).toBe(3)
    const [renewed] = await inMemoryDb.select().from(schema.preventionSurveillanceEnrollments)
      .where(eq(schema.preventionSurveillanceEnrollments.renewedFromEnrollmentId, "surven-1"))
    expect(renewed).toMatchObject({ status: "pending" })
  })

  /* Ronda de corrección de Task 11, Importante 3 (ronda 2/5): eximir ya no
   * deja a la persona fuera del padrón para siempre — abre sola el ciclo
   * siguiente (`syncSurveillanceRenewalTx`, el mismo mecanismo que ya abría
   * `attended`) — pero tampoco vacía de sentido la exención: mientras ese
   * ciclo siguiente siga `pending` y no venza, sigue siendo la exención la
   * que manda, así que el padrón SÍ baja de inmediato. Sólo cuando el ciclo
   * siguiente efectivamente llega a su fecha (o alguien actúa sobre él) la
   * persona vuelve a contar — ver el criterio de "posterior"/"prematuro" en
   * `currentSurveillanceCycle` (`lib/services/pdtp/subject-registry.ts`). */
  it("eximir con motivo real baja el padrón mientras el ciclo renovado no vence, y sube cuando vence", async () => {
    expect(await padron()).toBe(3)

    await recordSurveillanceOutcome({
      enrollmentId: "surven-1", status: "exempt",
      absenceReason: "Contraindicación médica documentada para el examen.",
    }, access)

    // El ciclo pendiente recién abierto vence en más de un año: mientras no
    // llegue esa fecha, no desplaza a la exención como "vigente".
    expect(await padron()).toBe(2)
    const [renewed] = await inMemoryDb.select().from(schema.preventionSurveillanceEnrollments)
      .where(eq(schema.preventionSurveillanceEnrollments.renewedFromEnrollmentId, "surven-1"))
    expect(renewed).toMatchObject({
      status: "pending", enrolledOn: `${PROGRAM_YEAR}-06-30`, dueOn: `${PROGRAM_YEAR + 1}-06-30`,
    })

    // Una vez que el ciclo pendiente vence, pasa a ser el vigente y la
    // persona vuelve a contar: la exención acotó exactamente ese período, no
    // más. Se corre el vencimiento directo en base a "hoy" —posterior al
    // vencimiento original (`${PROGRAM_YEAR}-06-30`) y ya cumplido— en vez de
    // mockear el reloj del proceso; es el mismo patrón que ya usa el resto de
    // la plataforma para "vencidos" (`item.dueOn < todayInChile()`).
    await inMemoryDb.update(schema.preventionSurveillanceEnrollments)
      .set({ dueOn: todayInChile() })
      .where(eq(schema.preventionSurveillanceEnrollments.id, renewed!.id))
    expect(await padron()).toBe(3)
  })

  /* Una fila que nadie procesó por el servicio —el caso de una exención
   * legado (0323), o cualquier otra que la renovación automática no pudo
   * abrir— no tiene ciclo posterior, sigue vigente, y por eso sí descuenta
   * mientras su motivo sea real. Esto es lo que hace durable una exención
   * cuando corresponde: no es un camino nuevo, es el mismo que protegen la
   * 0323/0324 (Importante 2) y el describe de más abajo. */
  it("una exención sin renovación asociada —nadie la procesó por el servicio— sí descuenta, con motivo real", async () => {
    await inMemoryDb.update(schema.preventionSurveillanceEnrollments)
      .set({ status: "exempt", absenceReason: "Contraindicación médica documentada para el examen." })
      .where(eq(schema.preventionSurveillanceEnrollments.id, "surven-1"))

    expect(await padron()).toBe(2)
  })

  /* Y esa exención sin renovación sigue siendo del ciclo, no de la persona,
   * pero (ronda 2/5) sólo la supera un ciclo que YA está en efecto: uno cuyo
   * vencimiento llegó, o sobre el que alguien ya actuó. Re-matricular el
   * grupo por sí solo NO alcanza —el ciclo que crea nace `pending` y sin
   * vencer, tan "prematuro" como el de la renovación automática—, pero citar
   * a la persona para ese ciclo nuevo (una acción real sobre él) sí. */
  it("una exención sin renovación no se supera con sólo re-matricular; sí con una acción sobre el ciclo nuevo", async () => {
    await inMemoryDb.update(schema.preventionSurveillanceEnrollments)
      .set({ status: "exempt", absenceReason: "Contraindicación médica documentada para el examen." })
      .where(eq(schema.preventionSurveillanceEnrollments.id, "surven-1"))
    expect(await padron()).toBe(2)

    const { dueOn } = await enrollGroupInSurveillance({ programId: SURV_PROGRAM_ID, groupId: GROUP_ID }, access)
    expect(await padron()).toBe(2)

    const [created] = await inMemoryDb.select().from(schema.preventionSurveillanceEnrollments)
      .where(and(
        eq(schema.preventionSurveillanceEnrollments.workerId, "wk-1"),
        eq(schema.preventionSurveillanceEnrollments.dueOn, dueOn),
      ))
    await recordSurveillanceOutcome({ enrollmentId: created!.id, status: "summoned" }, access)

    expect(await padron()).toBe(3)
  })

  /* Lo que cuenta es el ciclo más reciente, no cualquiera: un control asistido
   * del año pasado no deja a la persona en el padrón si el ciclo de este año
   * quedó exento y nada lo superó todavía. Se marca la exención directo en
   * base —sin pasar por el servicio— para aislar "cuál ciclo es el vigente"
   * de la renovación automática, que abriría un tercer ciclo y volvería a
   * superar a éste (ya cubierto arriba). */
  it("eximida en el ciclo más reciente descuenta aunque el anterior se haya controlado", async () => {
    await recordSurveillanceOutcome({ enrollmentId: "surven-1", status: "attended", attendedOn: `${PROGRAM_YEAR}-06-12` }, access)
    const [next] = await inMemoryDb.select().from(schema.preventionSurveillanceEnrollments)
      .where(eq(schema.preventionSurveillanceEnrollments.renewedFromEnrollmentId, "surven-1"))
    await inMemoryDb.update(schema.preventionSurveillanceEnrollments)
      .set({ status: "exempt", absenceReason: "Contraindicación médica documentada para el examen." })
      .where(eq(schema.preventionSurveillanceEnrollments.id, next!.id))

    expect(await padron()).toBe(2)
  })

  it("eximida en un programa pero pendiente en otro del mismo GES, sigue en el padrón", async () => {
    await inMemoryDb.insert(schema.preventionSurveillancePrograms).values({
      id: "survpr-hyg-2", code: "SURV-02", name: "Vigilancia complementaria", protocol: "prexor",
      agentId: AGENT_ID, worksiteId: WS_ID, periodicityMonths: 12,
      legalBasis: "Res. Ex. 1433/2022 MINSAL", status: "active", createdByUserId: USER_ID,
    })
    await inMemoryDb.insert(schema.preventionSurveillanceEnrollments).values({
      id: "surven-1-otro", programId: "survpr-hyg-2", workerId: "wk-1", groupId: GROUP_ID,
      enrolledOn: `${PROGRAM_YEAR}-01-05`, dueOn: `${PROGRAM_YEAR}-06-30`, status: "pending",
    })
    await recordSurveillanceOutcome({
      enrollmentId: "surven-1", status: "exempt",
      absenceReason: "Contraindicación médica documentada para el examen.",
    }, access)

    expect(await padron()).toBe(3)
  })

  it("la exención de un programa suspendido no descuenta", async () => {
    await recordSurveillanceOutcome({
      enrollmentId: "surven-1", status: "exempt",
      absenceReason: "Contraindicación médica documentada para el examen.",
    }, access)
    await inMemoryDb.update(schema.preventionSurveillancePrograms)
      .set({ status: "suspended" })
      .where(eq(schema.preventionSurveillancePrograms.id, SURV_PROGRAM_ID))

    expect(await padron()).toBe(3)
  })

  it("con el padrón descontado, controlar a los demás completa la cobertura", async () => {
    await inMemoryDb.update(schema.pdtpActivities)
      .set({ indicatorMode: "coverage", subjectSource: "expuestos_ges" })
      .where(eq(schema.pdtpActivities.id, activityId(50)))
    await inMemoryDb.insert(schema.pdtpActivitySchedule).values({
      id: "sched-50", activityId: activityId(50), year: PROGRAM_YEAR, month: 6, week: 2,
      plannedQuantity: 1, sourceColumn: "T",
    })
    /* Directo en base, sin pasar por el servicio: si pasara por
     * `recordSurveillanceOutcome`, la renovación automática (Importante 3) le
     * abriría a wk-3 el ciclo siguiente y volvería a contarla, cambiando el
     * padrón que este test mide (`planned` dejaría de ser 2). */
    await inMemoryDb.update(schema.preventionSurveillanceEnrollments)
      .set({ status: "exempt", absenceReason: "Contraindicación médica documentada para el examen." })
      .where(eq(schema.preventionSurveillanceEnrollments.id, "surven-3"))
    for (const enrollmentId of ["surven-1", "surven-2"]) {
      await recordSurveillanceOutcome({ enrollmentId, status: "attended", attendedOn: `${PROGRAM_YEAR}-06-12` }, access)
      await inMemoryDb.update(schema.pdtpExecutions)
        .set({ status: "approved", approvedByUserId: USER_ID, approvedAt: new Date().toISOString() })
        .where(eq(schema.pdtpExecutions.sourceId, `vigilancia:${enrollmentId}`))
    }

    const indicators = await getPdtpComplianceIndicators(PROGRAM_ID, WS_ID)
    expect(indicators!.annual.planned).toBe(2)
    expect(indicators!.annual.executed).toBe(2)
  })
})

// ── N°50: la exención legado con motivo placeholder no descuenta del padrón ───

/*
 * Ronda de corrección de Task 11, Importante 2. La migración 0323 marcó las
 * exenciones previas a exigir motivo con un texto placeholder ("no consta por
 * qué se eximió"). Esa fila no es una justificación clínica, es la ausencia de
 * una: contarla como descuento infla la cobertura sin evidencia. Se inserta
 * directo en base —sin pasar por el servicio, que ya no deja guardar el
 * placeholder como motivo nuevo— para simular exactamente la fila que dejó la
 * migración.
 */
describe("N°50 — la exención legado con motivo placeholder no descuenta del padrón", () => {
  beforeEach(async () => {
    await seedExposedGroup()
    for (const n of [1, 2, 3]) await seedEnrollment(`surven-${n}`, `wk-${n}`, `${PROGRAM_YEAR}-06-30`)
  })

  it("una exención con el motivo placeholder de la migración 0323 sigue contando en el padrón", async () => {
    await inMemoryDb.update(schema.preventionSurveillanceEnrollments)
      .set({ status: "exempt", absenceReason: LEGACY_SURVEILLANCE_EXEMPT_REASON_PLACEHOLDER })
      .where(eq(schema.preventionSurveillanceEnrollments.id, "surven-1"))

    expect(await padron()).toBe(3)
  })

  it("la misma exención con un motivo real sí descuenta", async () => {
    await inMemoryDb.update(schema.preventionSurveillanceEnrollments)
      .set({ status: "exempt", absenceReason: "Contraindicación médica documentada para el examen." })
      .where(eq(schema.preventionSurveillanceEnrollments.id, "surven-1"))

    expect(await padron()).toBe(2)
  })
})

// ── N°50: el ciclo siguiente se abre solo ─────────────────────────────────────

describe("N°50 — registrar la asistencia abre el ciclo siguiente", () => {
  beforeEach(async () => {
    await seedExposedGroup()
    await seedEnrollment("surven-1", "wk-1", `${PROGRAM_YEAR}-06-30`)
  })

  async function enrollmentsOf(workerId: string) {
    const rows = await inMemoryDb.select().from(schema.preventionSurveillanceEnrollments)
      .where(eq(schema.preventionSurveillanceEnrollments.workerId, workerId))
    return rows.sort((a, b) => a.dueOn.localeCompare(b.dueOn))
  }

  it("el ciclo siguiente vence a una periodicidad del control, no de la matrícula", async () => {
    await recordSurveillanceOutcome({ enrollmentId: "surven-1", status: "attended", attendedOn: `${PROGRAM_YEAR}-06-12` }, access)

    const rows = await enrollmentsOf("wk-1")
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({
      programId: SURV_PROGRAM_ID, groupId: GROUP_ID, status: "pending",
      enrolledOn: `${PROGRAM_YEAR}-06-12`, dueOn: `${PROGRAM_YEAR + 1}-06-12`,
      renewedFromEnrollmentId: "surven-1",
    })
  })

  /* Encontrado en el navegador: matricular hoy (vence en un año) y controlar hoy
   * mismo da un ciclo siguiente con el MISMO vencimiento que el actual, y el
   * índice único (programa, persona, vencimiento) descartaba la renovación en
   * silencio: la persona quedaba sin ciclo abierto, que es el defecto que la
   * renovación existe para cerrar. */
  it("controlar el mismo día de la matrícula igual abre el ciclo siguiente", async () => {
    await inMemoryDb.update(schema.preventionSurveillanceEnrollments)
      .set({ enrolledOn: `${PROGRAM_YEAR}-06-12`, dueOn: `${PROGRAM_YEAR + 1}-06-12` })
      .where(eq(schema.preventionSurveillanceEnrollments.id, "surven-1"))

    await recordSurveillanceOutcome({ enrollmentId: "surven-1", status: "attended", attendedOn: `${PROGRAM_YEAR}-06-12` }, access)

    const rows = await enrollmentsOf("wk-1")
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({
      status: "pending", renewedFromEnrollmentId: "surven-1", dueOn: `${PROGRAM_YEAR + 1}-06-13`,
    })
  })

  it("repetir el registro no duplica el ciclo, y corregir la fecha mueve el que no se tocó", async () => {
    await recordSurveillanceOutcome({ enrollmentId: "surven-1", status: "attended", attendedOn: `${PROGRAM_YEAR}-06-12` }, access)
    await recordSurveillanceOutcome({ enrollmentId: "surven-1", status: "attended", attendedOn: `${PROGRAM_YEAR}-06-12` }, access)
    expect(await enrollmentsOf("wk-1")).toHaveLength(2)

    await recordSurveillanceOutcome({ enrollmentId: "surven-1", status: "attended", attendedOn: `${PROGRAM_YEAR}-06-15` }, access)
    const rows = await enrollmentsOf("wk-1")
    expect(rows.map((row) => row.dueOn)).toEqual([`${PROGRAM_YEAR}-06-30`, `${PROGRAM_YEAR + 1}-06-15`])
  })

  it("si la asistencia se corrige, el ciclo que abrió se retira mientras nadie lo haya tocado", async () => {
    await recordSurveillanceOutcome({ enrollmentId: "surven-1", status: "attended", attendedOn: `${PROGRAM_YEAR}-06-12` }, access)
    await recordSurveillanceOutcome({
      enrollmentId: "surven-1", status: "absent", absenceReason: "Se corrigió: nunca asistió al control.",
    }, access)

    const rows = await enrollmentsOf("wk-1")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: "surven-1", status: "absent" })
  })

  it("un ciclo siguiente que ya avanzó no se borra al corregir el anterior", async () => {
    await recordSurveillanceOutcome({ enrollmentId: "surven-1", status: "attended", attendedOn: `${PROGRAM_YEAR}-06-12` }, access)
    const [, next] = await enrollmentsOf("wk-1")
    await recordSurveillanceOutcome({ enrollmentId: next!.id, status: "summoned" }, access)

    await recordSurveillanceOutcome({
      enrollmentId: "surven-1", status: "absent", absenceReason: "Se corrigió: nunca asistió al control.",
    }, access)

    const rows = await enrollmentsOf("wk-1")
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ id: next!.id, status: "summoned" })
  })

  it("no se renueva a quien ya no está en el GES ni en un programa suspendido", async () => {
    await inMemoryDb.update(schema.preventionExposureGroupMembers)
      .set({ leftOn: `${PROGRAM_YEAR}-05-01` })
      .where(eq(schema.preventionExposureGroupMembers.workerId, "wk-1"))
    await recordSurveillanceOutcome({ enrollmentId: "surven-1", status: "attended", attendedOn: `${PROGRAM_YEAR}-06-12` }, access)
    expect(await enrollmentsOf("wk-1")).toHaveLength(1)

    await seedEnrollment("surven-2", "wk-2", `${PROGRAM_YEAR}-06-30`)
    await inMemoryDb.update(schema.preventionSurveillancePrograms)
      .set({ status: "suspended" })
      .where(eq(schema.preventionSurveillancePrograms.id, SURV_PROGRAM_ID))
    await recordSurveillanceOutcome({ enrollmentId: "surven-2", status: "attended", attendedOn: `${PROGRAM_YEAR}-06-12` }, access)
    expect(await enrollmentsOf("wk-2")).toHaveLength(1)
  })

  /* Antes de la renovación, volver a matricular el grupo era la única forma de
   * abrir el ciclo siguiente. Quien lo siga haciendo no debe dejar a una
   * persona con dos ciclos abiertos a la vez. */
  it("matricular el grupo no le abre un segundo ciclo a quien ya tiene uno abierto", async () => {
    await recordSurveillanceOutcome({ enrollmentId: "surven-1", status: "attended", attendedOn: `${PROGRAM_YEAR}-06-12` }, access)

    const result = await enrollGroupInSurveillance({
      programId: SURV_PROGRAM_ID, groupId: GROUP_ID, startingOn: `${PROGRAM_YEAR}-07-01`,
    }, access)
    expect(result).toMatchObject({ enrolled: 2, total: 3 })
    expect(await enrollmentsOf("wk-1")).toHaveLength(2)
    expect(await enrollmentsOf("wk-2")).toHaveLength(1)
  })

  it("la cobertura del programa cuenta personas, no ciclos", async () => {
    await recordSurveillanceOutcome({ enrollmentId: "surven-1", status: "attended", attendedOn: `${PROGRAM_YEAR}-06-12` }, access)

    const [program] = await listSurveillancePrograms({ ...access, permissions: ["prevention:hygiene:view"] })
    expect(program).toMatchObject({ enrolled: 1, attended: 1, overdue: 0 })
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
