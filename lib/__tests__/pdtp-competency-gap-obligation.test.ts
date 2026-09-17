/**
 * lib/__tests__/pdtp-competency-gap-obligation.test.ts
 *
 * N°57: la brecha de competencia abre el compromiso, y la sesión lo cierra por
 * cada persona que efectivamente obtuvo la competencia.
 *
 * El caso que importa es el abanico. Con una obligación por faena, una sesión
 * que capacita a dos de tres cerraría el caso dejando a la tercera persona sin
 * competencia y sin que nada lo registre. Con una por persona, el que falta
 * sigue vencido, que es la verdad.
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
const {
  sweepCompetencyGapObligations,
  onCompetencyObtained,
} = await import("@/lib/services/pdtp-adapters/competency-gap-connector")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const PROGRAM_YEAR = chileDateParts().year
const PROGRAM_ID = "pdtp-cmp-v1"
const USER_ID = "user-cmp-1"
const WS_ID = "ws-cmp-1"
const COURSE_ID = "course-cmp-57"
const OTHER_COURSE_ID = "course-cmp-54"
const ACTIVITY_ID = `${PROGRAM_ID}-a-057`
const WORKERS = ["wk-cmp-1", "wk-cmp-2", "wk-cmp-3"]

async function obligations() {
  return inMemoryDb.select().from(schema.pdtpObligations)
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpObligations)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.preventionWorkerCompetencies)
  await inMemoryDb.delete(schema.preventionCompetencyRequirements)
  await inMemoryDb.delete(schema.preventionTrainingCourses)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Prevencionista", email: "prev-cmp@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({ id: WS_ID, name: "Faena Competencia", code: "FC", isActive: true })
  await inMemoryDb.insert(schema.workers).values(WORKERS.map((id, i) => ({
    id, firstName: "Conductor", lastName: `N°${i}`, position: "Conductor",
    worksiteId: WS_ID, isActive: true, createdAt: now,
  })))

  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} competencias`,
    status: "active", appliesToAllWorksites: true, elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    activatedByUserId: USER_ID, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACTIVITY_ID, programId: PROGRAM_ID, n: 57,
    activity: "Comunicación Efectiva", program: "Capacitación",
    responsibleSlugs: ["prevencionista_faena"], responsibleDisplay: "PRF",
    scheduleMode: "on_demand", scheduleClassificationStatus: "confirmed",
    dueDays: 30, evidenceRequirement: "Registro de asistencia de la sesión.",
    indicatorMode: "closed_on_time",
    sourceSheetRow: 57, createdAt: now, updatedAt: now,
  })

  await inMemoryDb.insert(schema.preventionTrainingCourses).values([
    {
      id: COURSE_ID, code: "PDTP-57", name: "Comunicación efectiva", kind: "practical_training",
      minimumDurationMinutes: 240, isActive: true, createdByUserId: USER_ID,
      pdtpActivityNumbers: [57], createdAt: now, updatedAt: now,
    },
    {
      // Un curso cuya actividad NO se mide por plazo: no debe entrar al barrido.
      id: OTHER_COURSE_ID, code: "PDTP-54", name: "Capacitación Extintores", kind: "practical_training",
      minimumDurationMinutes: 120, isActive: true, createdByUserId: USER_ID,
      pdtpActivityNumbers: [54], createdAt: now, updatedAt: now,
    },
  ])
  await inMemoryDb.insert(schema.preventionCompetencyRequirements).values({
    id: "req-cmp-1", courseId: COURSE_ID, scopeType: "worksite", worksiteId: WS_ID,
    enforcement: "warning", reason: "Comunicación efectiva exigida por el programa preventivo.",
    isActive: true, createdByUserId: USER_ID, createdAt: now, updatedAt: now,
  })
})

describe("sweepCompetencyGapObligations", () => {
  it("abre una obligación por persona sin la competencia", async () => {
    const result = await sweepCompetencyGapObligations()

    expect(result.gaps).toBe(3)
    expect(result.opened).toBe(3)
    const rows = await obligations()
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((r) => (r.sourceMetadataJson as Record<string, unknown>).workerId))).toEqual(new Set(WORKERS))
    expect(rows.every((r) => r.sourceType === "competencia")).toBe(true)
    expect(rows.every((r) => r.activityId === ACTIVITY_ID)).toBe(true)
  })

  it("dos barridos seguidos no duplican", async () => {
    await sweepCompetencyGapObligations()
    const second = await sweepCompetencyGapObligations()

    expect(second.opened).toBe(0)
    expect(second.alreadyOpen).toBe(3)
    expect(await obligations()).toHaveLength(3)
  })

  it("quien tiene la competencia vigente no genera brecha; si vence, sí", async () => {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionWorkerCompetencies).values({
      id: "comp-cmp-1", workerId: WORKERS[0]!, courseId: COURSE_ID,
      sourceType: "session", grantedAt: `${PROGRAM_YEAR}-01-10`,
      expiresAt: `${PROGRAM_YEAR + 5}-01-10`, status: "valid",
      createdByUserId: USER_ID, createdAt: now, updatedAt: now,
    })

    expect((await sweepCompetencyGapObligations()).opened).toBe(2)

    await inMemoryDb.update(schema.preventionWorkerCompetencies)
      .set({ status: "expired" })
      .where(eq(schema.preventionWorkerCompetencies.id, "comp-cmp-1"))

    expect((await sweepCompetencyGapObligations()).opened).toBe(1)
    expect(await obligations()).toHaveLength(3)
  })

  it("un curso cuya actividad no se mide por plazo no abre nada", async () => {
    await inMemoryDb.update(schema.preventionCompetencyRequirements)
      .set({ courseId: OTHER_COURSE_ID })
      .where(eq(schema.preventionCompetencyRequirements.id, "req-cmp-1"))

    const result = await sweepCompetencyGapObligations()

    expect(result.opened).toBe(0)
    expect(await obligations()).toHaveLength(0)
  })

  it("sin requisito cargado no hay brecha que medir", async () => {
    await inMemoryDb.delete(schema.preventionCompetencyRequirements)
    const result = await sweepCompetencyGapObligations()
    expect(result.gaps).toBe(0)
    expect(await obligations()).toHaveLength(0)
  })
})

describe("onCompetencyObtained", () => {
  it("cierra sólo las obligaciones de quienes obtuvieron la competencia", async () => {
    await sweepCompetencyGapObligations()

    await onCompetencyObtained({
      sessionId: "sess-cmp-1", worksiteId: WS_ID, courseId: COURSE_ID,
      closedAt: `${PROGRAM_YEAR}-06-20T12:00:00.000Z`,
      grantedWorkerIds: [WORKERS[0]!, WORKERS[1]!],
      userId: USER_ID,
    })

    const rows = await obligations()
    const reported = rows.filter((r) => r.status === "reported")
    const pending = rows.filter((r) => r.status === "pending")
    expect(reported).toHaveLength(2)
    expect(pending).toHaveLength(1)
    expect((pending[0]!.sourceMetadataJson as Record<string, unknown>).workerId).toBe(WORKERS[2])
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(2)
  })

  it("sin obligación previa no rompe el cierre de la sesión", async () => {
    await expect(onCompetencyObtained({
      sessionId: "sess-cmp-2", worksiteId: WS_ID, courseId: COURSE_ID,
      closedAt: `${PROGRAM_YEAR}-06-20T12:00:00.000Z`,
      grantedWorkerIds: [WORKERS[0]!],
      userId: USER_ID,
    })).resolves.toBeUndefined()

    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)
  })
})
