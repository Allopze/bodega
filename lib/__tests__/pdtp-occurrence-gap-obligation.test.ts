/**
 * lib/__tests__/pdtp-occurrence-gap-obligation.test.ts
 *
 * N°57: la ocurrencia incumplida abre el compromiso, y marcarla hecha lo cierra.
 *
 * Reemplaza al test de brecha de competencia por persona, retirado con el
 * modelo por trabajador el 2026-09-19. La unidad de la obligación pasó a ser la
 * ocurrencia —ítem del catálogo × faena × año × slot—, que es la misma unidad
 * en la que el operador declara "se hizo / no se hizo".
 *
 * Los dos hechos que abren son distintos y ambos importan: la ocurrencia
 * declarada `not_completed` abre de inmediato —es una afirmación explícita de
 * incumplimiento—, y la que sigue `pending` abre recién cuando vence su mes. Si
 * el barrido confundiera los dos, una actividad programada para diciembre
 * aparecería incumplida en marzo.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
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
const { PREDEFINED_TRAINING_CATALOG_VERSION } = await import("@/lib/prevention/training-occurrences-catalog")
const {
  sweepTrainingOccurrenceObligations,
  onTrainingOccurrenceCompleted,
  occurrenceSubjectKey,
} = await import("@/lib/services/pdtp-adapters/occurrence-gap-connector")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const TODAY = chileDateParts()
const PROGRAM_YEAR = TODAY.year
const PROGRAM_ID = "pdtp-occ-v1"
const USER_ID = "user-occ-1"
const WS_ID = "ws-occ-1"
const ITEM_ID = "cat-occ-57"
const OTHER_ITEM_ID = "cat-occ-54"
const ACTIVITY_ID = `${PROGRAM_ID}-a-057`

async function obligations() {
  return inMemoryDb.select().from(schema.pdtpObligations)
}

/**
 * Un mes ya vencido dentro del año en curso, y uno que todavía no vence.
 *
 * En enero no existe un mes anterior en el mismo año, así que el caso "vencida"
 * se construye con el año pasado. Fijar un mes literal haría que la suite
 * pasara o fallara según la fecha de la corrida, que es la clase de test que
 * después nadie confía.
 */
const PAST = TODAY.month > 1
  ? { year: PROGRAM_YEAR, month: TODAY.month - 1 }
  : { year: PROGRAM_YEAR - 1, month: 12 }
const FUTURE = TODAY.month < 12
  ? { year: PROGRAM_YEAR, month: TODAY.month + 1 }
  : { year: PROGRAM_YEAR + 1, month: 1 }

async function seedOccurrence(input: {
  id: string
  catalogItemId?: string
  year: number
  month: number | null
  status: "pending" | "completed" | "not_completed" | "not_applicable"
  notApplicableReason?: string
}) {
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.preventionTrainingOccurrences).values({
    id: input.id,
    catalogItemId: input.catalogItemId ?? ITEM_ID,
    worksiteId: WS_ID,
    year: input.year,
    slotKey: input.month === null ? "annual" : `m${String(input.month).padStart(2, "0")}-w1`,
    scheduledMonth: input.month,
    scheduledWeek: input.month === null ? null : 1,
    status: input.status,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...(input.status === "completed" ? { completedAt: now, completedByUserId: USER_ID } : {}),
    ...(input.status === "not_applicable"
      ? {
          notApplicableAt: now,
          notApplicableByUserId: USER_ID,
          notApplicableReason: input.notApplicableReason ?? "La faena no ejecuta esta tarea.",
        }
      : {}),
  })
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpObligations)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.preventionTrainingOccurrences)
  await inMemoryDb.delete(schema.preventionTrainingCatalogItems)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Prevencionista", email: "prev-occ@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({ id: WS_ID, name: "Faena Ocurrencia", code: "FO", isActive: true })

  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} ocurrencias`,
    status: "active", appliesToAllWorksites: true, elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    activatedByUserId: USER_ID, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACTIVITY_ID, programId: PROGRAM_ID, n: 57,
    activity: "Comunicación Efectiva", program: "Capacitación",
    responsibleSlugs: ["prevencionista_faena"], responsibleDisplay: "PRF",
    scheduleMode: "on_demand", scheduleClassificationStatus: "confirmed",
    dueDays: 30, evidenceRequirement: "Evidencia de la actividad realizada.",
    indicatorMode: "closed_on_time",
    sourceSheetRow: 57, createdAt: now, updatedAt: now,
  })

  await inMemoryDb.insert(schema.preventionTrainingCatalogItems).values([
    {
      id: ITEM_ID, code: "CAP-57", title: "Comunicación efectiva",
      itemType: "course", audience: "Todo el personal",
      catalogVersion: PREDEFINED_TRAINING_CATALOG_VERSION, sourceRow: 57,
      scheduleJson: [], pdtpActivityNumbers: [57], isActive: true, sortOrder: 57,
      createdAt: now, updatedAt: now,
    },
    {
      // Un ítem cuya actividad NO se mide por plazo: no debe entrar al barrido.
      id: OTHER_ITEM_ID, code: "CAP-54", title: "Uso de extintores",
      itemType: "course", audience: "Brigada",
      catalogVersion: PREDEFINED_TRAINING_CATALOG_VERSION, sourceRow: 54,
      scheduleJson: [], pdtpActivityNumbers: [54], isActive: true, sortOrder: 54,
      createdAt: now, updatedAt: now,
    },
  ])
})

describe("sweepTrainingOccurrenceObligations", () => {
  it("sin ocurrencias incumplidas no abre nada", async () => {
    await seedOccurrence({ id: "occ-futura", year: FUTURE.year, month: FUTURE.month, status: "pending" })

    const result = await sweepTrainingOccurrenceObligations()
    expect(result.gaps).toBe(0)
    expect(result.opened).toBe(0)
    expect(await obligations()).toHaveLength(0)
  })

  it("una ocurrencia declarada no hecha abre de inmediato, sin esperar plazo", async () => {
    // El mes todavía no vence: lo que abre es la declaración, no el calendario.
    await seedOccurrence({ id: "occ-no-hecha", year: FUTURE.year, month: FUTURE.month, status: "not_completed" })

    const result = await sweepTrainingOccurrenceObligations()
    expect(result.gaps).toBe(1)
    expect(result.opened).toBe(1)

    const [obligation] = await obligations()
    expect(obligation!.activityId).toBe(ACTIVITY_ID)
    expect(obligation!.worksiteId).toBe(WS_ID)
    expect((obligation!.sourceMetadataJson as { subjectKey: string }).subjectKey)
      .toBe(occurrenceSubjectKey("occ-no-hecha"))
  })

  it("una ocurrencia pendiente abre recién cuando vence su mes", async () => {
    await seedOccurrence({ id: "occ-vencida", year: PAST.year, month: PAST.month, status: "pending" })
    await seedOccurrence({ id: "occ-a-tiempo", year: FUTURE.year, month: FUTURE.month, status: "pending" })

    const result = await sweepTrainingOccurrenceObligations()
    expect(result.gaps).toBe(1)

    const [obligation] = await obligations()
    expect((obligation!.sourceMetadataJson as { subjectKey: string }).subjectKey)
      .toBe(occurrenceSubjectKey("occ-vencida"))
  })

  it("una ocurrencia anual vence al terminar el año, no antes", async () => {
    await seedOccurrence({ id: "occ-anual-curso", year: PROGRAM_YEAR, month: null, status: "pending" })
    expect((await sweepTrainingOccurrenceObligations()).gaps).toBe(0)

    await seedOccurrence({ id: "occ-anual-pasada", year: PROGRAM_YEAR - 1, month: null, status: "pending" })
    expect((await sweepTrainingOccurrenceObligations()).gaps).toBe(1)
  })

  it("una ocurrencia ya hecha no abre nada", async () => {
    await seedOccurrence({ id: "occ-hecha", year: PAST.year, month: PAST.month, status: "completed" })

    expect((await sweepTrainingOccurrenceObligations()).gaps).toBe(0)
    expect(await obligations()).toHaveLength(0)
  })

  /* El estado "no aplica" existe justamente para esto. Si el barrido no lo
   * excluyera, una casilla declarada fuera del programa vencería igual que
   * cualquier otra y abriría un compromiso sobre algo que alguien ya resolvió
   * que no corresponde — y el estado no serviría para nada. */
  it("una ocurrencia no aplicable no abre obligación, ni siquiera vencida", async () => {
    await seedOccurrence({
      id: "occ-no-aplica",
      year: PAST.year,
      month: PAST.month,
      status: "not_applicable",
      notApplicableReason: "La faena no opera equipos de izaje.",
    })

    const result = await sweepTrainingOccurrenceObligations()
    expect(result.gaps).toBe(0)
    expect(await obligations()).toHaveLength(0)
  })

  it("un ítem cuya actividad no se mide por plazo queda fuera del barrido", async () => {
    await seedOccurrence({
      id: "occ-otra", catalogItemId: OTHER_ITEM_ID,
      year: PAST.year, month: PAST.month, status: "not_completed",
    })

    expect((await sweepTrainingOccurrenceObligations()).gaps).toBe(0)
    expect(await obligations()).toHaveLength(0)
  })

  it("es idempotente: dos corridas no abren dos compromisos por la misma ocurrencia", async () => {
    await seedOccurrence({ id: "occ-vencida", year: PAST.year, month: PAST.month, status: "pending" })

    await sweepTrainingOccurrenceObligations()
    const second = await sweepTrainingOccurrenceObligations()

    expect(second.opened).toBe(0)
    expect(second.alreadyOpen).toBe(1)
    expect(await obligations()).toHaveLength(1)
  })
})

describe("onTrainingOccurrenceCompleted", () => {
  it("reporta la obligación abierta de esa ocurrencia", async () => {
    await seedOccurrence({ id: "occ-vencida", year: PAST.year, month: PAST.month, status: "pending" })
    await sweepTrainingOccurrenceObligations()

    await onTrainingOccurrenceCompleted({
      occurrenceId: "occ-vencida",
      catalogItemId: ITEM_ID,
      worksiteId: WS_ID,
      completedAt: new Date().toISOString(),
      userId: USER_ID,
    })

    const [obligation] = await obligations()
    expect(obligation!.status).not.toBe("pending")
  })

  it("sin obligación abierta no lanza: la actividad pudo hacerse dentro de plazo", async () => {
    await expect(onTrainingOccurrenceCompleted({
      occurrenceId: "occ-inexistente",
      catalogItemId: ITEM_ID,
      worksiteId: WS_ID,
      completedAt: new Date().toISOString(),
      userId: USER_ID,
    })).resolves.toBeUndefined()
  })
})
