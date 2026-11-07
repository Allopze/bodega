/**
 * UX-01: la lista de capacitación paginada en la base.
 *
 * `/prevencion/capacitacion` pintaba las ~3.900 ocurrencias del año (30 MB de
 * HTML). `listTrainingOccurrencesPage` trae sólo la página pedida, y lo que se
 * afirma aquí es lo que una página no puede equivocar sin que nadie lo note:
 * que cuente las MISMAS casillas que el calendario y que la lista completa
 * (que sigue alimentando el Excel y el tablero), que el total y los contadores
 * salgan de la base ya filtrados, que paginar no repita ni salte filas, y que
 * las pendientes lleguen por urgencia con el mismo criterio que el calendario.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq, notLike } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { monthPhase } from "@/lib/prevention/slot-compliance-calendar"
import { isPdtpPeriodOnOrAfterActivationPeriod, type PdtpPeriod } from "@/lib/services/pdtp/period"

const pg = new PGlite()
const pgLiteDb = drizzle(pg, { schema })
const inMemoryDb = pgLiteDb as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const {
  countTrainingOccurrencesByStatus,
  ensurePreventionTrainingOccurrencesForWorksiteTx,
  listTrainingComplianceSlots,
  listTrainingOccurrences,
  listTrainingOccurrencesPage,
} = await import("@/lib/services/prevention-training-occurrences")

const YEAR = 2026
const USER_ID = "page-user"
const WS_A = "page-ws-a"
const WS_B = "page-ws-b"
const WS_INACTIVE = "page-ws-inactive"
/** Una casilla por mes de cada faena activa: 390 por faena, así que 3 faenas son 1.170 casillas. */
const PER_WORKSITE = 390

const ALL: WorksiteScope = { mode: "all", ids: [] }
const only = (...ids: string[]): WorksiteScope => ({ mode: "some", ids })
const access = (scope: WorksiteScope, permissions: readonly string[] = ["prevention:training:view"]) => ({
  userId: USER_ID,
  scope,
  permissions,
})

/** Hoy: mayo de 2026, semana 2. Los meses 1–4 están vencidos; mayo es el mes en curso. */
const TODAY: PdtpPeriod = { year: YEAR, month: 5, week: 2 }
/** Faena Alfa se incorporó en marzo, semana 3: marzo semanas 1–2 y enero–febrero no se le exigían. */
const ACTIVATION_A: PdtpPeriod = { year: YEAR, month: 3, week: 3 }
const ACTIVATION = { [WS_A]: ACTIVATION_A, [WS_B]: null } as Record<string, PdtpPeriod | null>

const BIG = 100_000

function pageOf(overrides: Partial<Parameters<typeof listTrainingOccurrencesPage>[1]> = {}, scope: WorksiteScope = ALL) {
  return listTrainingOccurrencesPage(access(scope), {
    year: YEAR,
    activationByWorksite: ACTIVATION,
    today: TODAY,
    limit: BIG,
    offset: 0,
    ...overrides,
  })
}

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

beforeEach(async () => {
  await inMemoryDb.delete(schema.preventionTrainingOccurrenceEvidence)
  await inMemoryDb.delete(schema.preventionTrainingOccurrences)
  await inMemoryDb.delete(schema.preventionTrainingCatalogItems)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  await inMemoryDb.insert(schema.users).values({
    id: USER_ID,
    name: "Prevencionista Página",
    email: "page@example.test",
    hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena Alfa", code: "PAG-A", isActive: true },
    { id: WS_B, name: "Faena Beta", code: "PAG-B", isActive: true },
    { id: WS_INACTIVE, name: "Faena Cerrada", code: "PAG-X", isActive: false },
  ])
})

async function seedTraining(...worksiteIds: string[]) {
  for (const id of worksiteIds) await ensurePreventionTrainingOccurrencesForWorksiteTx(inMemoryDb, id, YEAR)
}

/** Marca las primeras `count` casillas pendientes de la faena como `status`, cumpliendo los CHECK de la tabla. */
async function setStatus(worksiteId: string, status: "completed" | "not_completed" | "not_applicable", count: number) {
  const rows = await inMemoryDb.select({ id: schema.preventionTrainingOccurrences.id })
    .from(schema.preventionTrainingOccurrences)
    .where(and(
      eq(schema.preventionTrainingOccurrences.worksiteId, worksiteId),
      eq(schema.preventionTrainingOccurrences.status, "pending"),
      // Las filas que `seedObsoleteRows` agrega a mano no son parte de la siembra.
      notLike(schema.preventionTrainingOccurrences.id, "occ-%"),
    ))
    .orderBy(schema.preventionTrainingOccurrences.id)
    .limit(count)
  const now = new Date().toISOString()
  for (const { id } of rows) {
    await inMemoryDb.update(schema.preventionTrainingOccurrences)
      .set(
        status === "completed"
          ? { status, completedAt: now, completedByUserId: USER_ID }
          : status === "not_applicable"
            ? { status, notApplicableAt: now, notApplicableByUserId: USER_ID, notApplicableReason: "No corresponde en esta faena." }
            : { status },
      )
      .where(eq(schema.preventionTrainingOccurrences.id, id))
  }
  return rows.map((row) => row.id)
}

/** Una casilla pendiente que el catálogo vigente ya no pide, y una con historia, ambas en la faena. */
async function seedObsoleteRows(worksiteId: string) {
  const [any] = await inMemoryDb.select({ catalogItemId: schema.preventionTrainingOccurrences.catalogItemId })
    .from(schema.preventionTrainingOccurrences)
    .where(eq(schema.preventionTrainingOccurrences.slotKey, "m09-w4")).limit(1)
  await inMemoryDb.insert(schema.preventionTrainingOccurrences).values([
    {
      id: "occ-obsoleta-pendiente", catalogItemId: any!.catalogItemId, worksiteId, year: YEAR,
      slotKey: "m03-w2", scheduledMonth: 3, scheduledWeek: 2, status: "pending", version: 1,
    },
    {
      id: "occ-obsoleta-historia", catalogItemId: any!.catalogItemId, worksiteId, year: YEAR,
      slotKey: "m04-w3", scheduledMonth: 4, scheduledWeek: 3, status: "not_applicable", version: 1,
      notApplicableReason: "Se reemplazó por la del catálogo alineado.", notApplicableAt: new Date().toISOString(), notApplicableByUserId: USER_ID,
    },
  ] as (typeof schema.preventionTrainingOccurrences.$inferInsert)[])
}

describe("listTrainingOccurrencesPage: paridad con el calendario y con la lista completa", () => {
  it("cuenta las mismas casillas que el calendario y que la lista completa, en total y faena por faena", async () => {
    await seedTraining(WS_A, WS_B)
    const page = await pageOf({ status: "all" })
    const slots = await listTrainingComplianceSlots(access(ALL), { year: YEAR })
    const list = await listTrainingOccurrences(access(ALL), { year: YEAR })

    expect(page.total).toBe(2 * PER_WORKSITE)
    expect(page.rows).toHaveLength(page.total)
    expect(slots).toHaveLength(page.total)
    expect(list).toHaveLength(page.total)
    for (const id of [WS_A, WS_B]) {
      const own = await pageOf({ status: "all", worksiteId: id })
      expect(own.total).toBe(slots.filter((slot) => slot.worksiteId === id).length)
      expect(own.total).toBe(list.filter((row) => row.worksiteId === id).length)
    }
  })

  it("devuelve las mismas filas que la lista completa, con su evidencia", async () => {
    await seedTraining(WS_A)
    const [first] = await inMemoryDb.select({ id: schema.preventionTrainingOccurrences.id })
      .from(schema.preventionTrainingOccurrences).orderBy(schema.preventionTrainingOccurrences.id).limit(1)
    await inMemoryDb.insert(schema.preventionTrainingOccurrenceEvidence).values({
      id: "page-evidence-1", occurrenceId: first!.id, fileName: "acta.pdf",
      storagePath: "storage/prevention-training-evidence/page-acta.pdf", mimeType: "application/pdf",
      fileSizeBytes: 128, sha256: "b".repeat(64), state: "active", uploadedByUserId: USER_ID,
    })

    const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id))
    const page = await pageOf({ status: "all" })
    const list = await listTrainingOccurrences(access(ALL), { year: YEAR })
    expect(byId(page.rows)).toEqual(byId(list))
    expect(page.rows.find((row) => row.id === first!.id)?.evidence).toHaveLength(1)
  })

  it("no ofrece la casilla pendiente que el catálogo ya no pide, pero sí la que tiene historia", async () => {
    await seedTraining(WS_A)
    await seedObsoleteRows(WS_A)

    const page = await pageOf({ status: "all" })
    const slots = await listTrainingComplianceSlots(access(ALL), { year: YEAR })
    const list = await listTrainingOccurrences(access(ALL), { year: YEAR })

    const ids = new Set(page.rows.map((row) => row.id))
    expect(ids.has("occ-obsoleta-pendiente")).toBe(false)
    expect(ids.has("occ-obsoleta-historia")).toBe(true)
    expect(page.total).toBe(PER_WORKSITE + 1)
    expect(slots).toHaveLength(page.total)
    expect(list).toHaveLength(page.total)
    // El contador de pendientes tampoco ve la obsoleta.
    expect(page.counts.pending).toBe(PER_WORKSITE)
    expect(page.counts.not_applicable).toBe(1)
  })

  it("trata las faenas inactivas como la lista: fuera salvo que se pidan, y siempre dentro del alcance", async () => {
    await seedTraining(WS_A, WS_INACTIVE)
    expect((await pageOf()).total).toBe(PER_WORKSITE)
    expect((await pageOf({ worksiteId: WS_INACTIVE })).total).toBe(0)
    expect((await pageOf({ worksiteId: WS_INACTIVE, includeInactiveWorksites: true })).total).toBe(PER_WORKSITE)
    expect((await pageOf({ includeInactiveWorksites: true })).total).toBe(2 * PER_WORKSITE)
    // Pedir una faena inactiva fuera del alcance no la revela.
    expect((await pageOf({ worksiteId: WS_INACTIVE, includeInactiveWorksites: true }, only(WS_A))).total).toBe(0)
  })

  it("respeta el permiso y el alcance, y un año sin catálogo no devuelve nada", async () => {
    await seedTraining(WS_A, WS_B)
    expect(new Set((await pageOf({}, only(WS_B))).rows.map((row) => row.worksiteId))).toEqual(new Set([WS_B]))
    const nothing = { rows: [], total: 0, counts: { all: 0, pending: 0, completed: 0, not_completed: 0, not_applicable: 0 } }
    expect(await pageOf({}, { mode: "none", ids: [] })).toEqual(nothing)
    expect(await pageOf({}, only())).toEqual(nothing)
    expect(await pageOf({ year: 1999 })).toEqual(nothing)
    await expect(listTrainingOccurrencesPage(access(ALL, []), {
      year: YEAR, activationByWorksite: ACTIVATION, today: TODAY, limit: 10, offset: 0,
    })).rejects.toThrow(/fuera de alcance/)
  })
})

describe("listTrainingOccurrencesPage: contadores y filtro de estado", () => {
  it("los contadores suman el total, no dependen del filtro de estado, y cada estado devuelve sólo lo suyo", async () => {
    await seedTraining(WS_A, WS_B)
    await setStatus(WS_A, "completed", 7)
    await setStatus(WS_B, "not_completed", 5)
    // Las dos últimas por id de la faena Beta pasan a «no aplica».
    const lastB = await inMemoryDb.select({ id: schema.preventionTrainingOccurrences.id })
      .from(schema.preventionTrainingOccurrences)
      .where(and(
        eq(schema.preventionTrainingOccurrences.worksiteId, WS_B),
        eq(schema.preventionTrainingOccurrences.status, "pending"),
      ))
      .orderBy(schema.preventionTrainingOccurrences.id)
      .offset(PER_WORKSITE - 5 - 3)
    const now = new Date().toISOString()
    for (const { id } of lastB) {
      await inMemoryDb.update(schema.preventionTrainingOccurrences)
        .set({ status: "not_applicable", notApplicableAt: now, notApplicableByUserId: USER_ID, notApplicableReason: "No corresponde en esta faena." })
        .where(eq(schema.preventionTrainingOccurrences.id, id))
    }

    const all = await pageOf({ status: "all" })
    expect(all.counts).toEqual({
      all: 2 * PER_WORKSITE,
      completed: 7,
      not_completed: 5,
      not_applicable: 3,
      pending: 2 * PER_WORKSITE - 7 - 5 - 3,
    })
    expect(all.counts.pending + all.counts.completed + all.counts.not_completed + all.counts.not_applicable).toBe(all.counts.all)
    expect(all.total).toBe(all.counts.all)

    for (const status of ["pending", "completed", "not_completed", "not_applicable"] as const) {
      const filtered = await pageOf({ status })
      expect(filtered.total).toBe(all.counts[status])
      expect(filtered.rows).toHaveLength(all.counts[status])
      expect(filtered.rows.every((row) => row.status === status)).toBe(true)
      // Elegir una pestaña no cambia lo que cuentan las otras.
      expect(filtered.counts).toEqual(all.counts)
    }
  })

  it("`status` omitido es «todas»", async () => {
    await seedTraining(WS_A)
    await setStatus(WS_A, "completed", 2)
    const omitted = await pageOf()
    expect(omitted.total).toBe(PER_WORKSITE)
    expect(omitted.rows).toHaveLength(PER_WORKSITE)
  })

  it("el mes y el texto estrechan las filas y los contadores a la vez", async () => {
    await seedTraining(WS_A, WS_B)
    const full = await pageOf({ status: "all" })
    const march = await pageOf({ status: "all", month: 3 })
    expect(march.rows.length).toBeGreaterThan(0)
    expect(march.rows.length).toBeLessThan(full.rows.length)
    expect(march.rows.every((row) => row.scheduledMonth === 3)).toBe(true)
    expect(march.total).toBe(full.rows.filter((row) => row.scheduledMonth === 3).length)
    expect(march.counts.all).toBe(march.total)

    const code = full.rows[0]!.code
    const byCode = await pageOf({ status: "all", search: code.toLowerCase() })
    const needle = code.toLowerCase()
    expect(byCode.total).toBe(full.rows.filter((row) => [row.code, row.title, row.worksiteName, row.audience]
      .some((value) => value.toLowerCase().includes(needle))).length)
    expect(byCode.total).toBeGreaterThan(0)
    expect(byCode.total).toBeLessThan(full.total)
    expect(byCode.counts.all).toBe(byCode.total)

    const byWorksite = await pageOf({ status: "all", search: "beta" })
    expect(byWorksite.total).toBe(PER_WORKSITE)
    expect(byWorksite.rows.every((row) => row.worksiteId === WS_B)).toBe(true)

    // Un texto con comodines se busca literal, no como patrón.
    expect((await pageOf({ search: "%" })).total).toBe(0)
    expect((await pageOf({ search: "zzz-no-existe" })).total).toBe(0)
  })
})

describe("listTrainingOccurrencesPage: paginación", () => {
  it("las páginas no repiten ni se saltan filas y reproducen el orden de una sola página", async () => {
    await seedTraining(WS_A, WS_B)
    await setStatus(WS_A, "completed", 11)
    for (const status of ["all", "pending"] as const) {
      const whole = await pageOf({ status })
      const limit = 97
      const seen: string[] = []
      for (let offset = 0; offset < whole.total; offset += limit) {
        const page = await pageOf({ status, limit, offset })
        expect(page.total).toBe(whole.total)
        expect(page.rows).toHaveLength(Math.min(limit, whole.total - offset))
        seen.push(...page.rows.map((row) => row.id))
      }
      expect(new Set(seen).size).toBe(seen.length)
      expect(seen).toEqual(whole.rows.map((row) => row.id))
    }
  })

  it("un `offset` pasado el final devuelve cero filas pero conserva el total y los contadores", async () => {
    await seedTraining(WS_A)
    const beyond = await pageOf({ status: "pending", limit: 50, offset: 100_000 })
    expect(beyond.rows).toEqual([])
    expect(beyond.total).toBe(PER_WORKSITE)
    expect(beyond.counts.all).toBe(PER_WORKSITE)
  })

  it("trae la evidencia sólo de las filas de la página", async () => {
    await seedTraining(WS_A)
    const first = (await pageOf({ status: "all", limit: 5, offset: 0 })).rows
    const last = (await pageOf({ status: "all", limit: 5, offset: PER_WORKSITE - 5 })).rows
    await inMemoryDb.insert(schema.preventionTrainingOccurrenceEvidence).values([
      { id: "page-ev-first", occurrenceId: first[0]!.id, fileName: "a.pdf", storagePath: "storage/prevention-training-evidence/page-a.pdf", mimeType: "application/pdf", fileSizeBytes: 1, sha256: "c".repeat(64), state: "active", uploadedByUserId: USER_ID },
      { id: "page-ev-last", occurrenceId: last[4]!.id, fileName: "b.pdf", storagePath: "storage/prevention-training-evidence/page-b.pdf", mimeType: "application/pdf", fileSizeBytes: 1, sha256: "d".repeat(64), state: "active", uploadedByUserId: USER_ID },
    ])
    const firstAgain = (await pageOf({ status: "all", limit: 5, offset: 0 })).rows
    const lastAgain = (await pageOf({ status: "all", limit: 5, offset: PER_WORKSITE - 5 })).rows
    expect(firstAgain.flatMap((row) => row.evidence.map((item) => item.id))).toEqual(["page-ev-first"])
    expect(lastAgain.flatMap((row) => row.evidence.map((item) => item.id))).toEqual(["page-ev-last"])
  })
})

describe("listTrainingOccurrencesPage: orden por urgencia de las pendientes", () => {
  /** El cubo con el criterio del calendario: `monthPhase` y la regla de activación, no una copia del SQL. */
  function bucketOf(row: { worksiteId: string; scheduledMonth: number | null; scheduledWeek: number | null }): number {
    if (row.scheduledMonth === null || row.scheduledWeek === null) return 3
    const activation = ACTIVATION[row.worksiteId] ?? null
    if (activation && !isPdtpPeriodOnOrAfterActivationPeriod({ year: YEAR, month: row.scheduledMonth, week: row.scheduledWeek }, activation)) return 3
    const phase = monthPhase(YEAR, row.scheduledMonth, TODAY)
    return phase === "past" ? 0 : phase === "current" ? 1 : 2
  }

  it("llega vencida y exigible, luego este mes, luego futura, y al final lo que aún no se exige", async () => {
    await seedTraining(WS_A, WS_B)
    const { rows, total } = await pageOf({ status: "pending" })
    expect(rows).toHaveLength(total)

    const buckets = rows.map(bucketOf)
    // Los cuatro cubos existen con este calendario y esta activación.
    expect(new Set(buckets)).toEqual(new Set([0, 1, 2, 3]))
    for (let index = 1; index < buckets.length; index += 1) {
      expect(buckets[index]!).toBeGreaterThanOrEqual(buckets[index - 1]!)
    }

    // Dentro de cada cubo, lo más antiguo primero.
    for (const bucket of [0, 1, 2]) {
      const months = rows.filter((row) => bucketOf(row) === bucket).map((row) => row.scheduledMonth!)
      expect(months).toEqual([...months].sort((a, b) => a - b))
    }
    // La deuda abarca enero–abril de Beta (sin activación) y abril de Alfa; marzo semanas 1–2 de Alfa es «aún no exigible».
    const overdue = rows.filter((row) => bucketOf(row) === 0)
    expect(overdue.every((row) => row.scheduledMonth! <= 4)).toBe(true)
    expect(overdue.some((row) => row.worksiteId === WS_B && row.scheduledMonth === 1)).toBe(true)
    expect(overdue.some((row) => row.worksiteId === WS_A && row.scheduledMonth === 1)).toBe(false)
    expect(overdue.some((row) => row.worksiteId === WS_A && row.scheduledMonth === 3 && row.scheduledWeek! <= 2)).toBe(false)
    expect(overdue.some((row) => row.worksiteId === WS_A && row.scheduledMonth === 3 && row.scheduledWeek! >= 3)).toBe(true)
    // El mes en curso no se mezcla con la deuda, ni siquiera la semana ya pasada de mayo.
    expect(rows.filter((row) => bucketOf(row) === 1).every((row) => row.scheduledMonth === 5)).toBe(true)
    expect(rows.filter((row) => bucketOf(row) === 2).every((row) => row.scheduledMonth! >= 6)).toBe(true)
  })

  it("un año ya terminado deja todo lo exigible como vencido, y uno futuro como futuro", async () => {
    await seedTraining(WS_A, WS_B)
    // Mirado desde 2027, el programa 2026 está entero en el pasado: lo único que no vence es lo que aún no se exige
    // (anterior a la activación de Alfa, o sin mes programado), y eso va al final.
    const closed = await pageOf({ status: "pending", today: { year: 2027, month: 2, week: 1 } })
    const notExigible = closed.rows.filter((row) => row.scheduledMonth === null
      || (row.worksiteId === WS_A
        && !isPdtpPeriodOnOrAfterActivationPeriod({ year: YEAR, month: row.scheduledMonth, week: row.scheduledWeek! }, ACTIVATION_A)))
    expect(notExigible.length).toBeGreaterThan(0)
    const tail = closed.rows.slice(closed.rows.length - notExigible.length)
    expect(new Set(tail.map((row) => row.id))).toEqual(new Set(notExigible.map((row) => row.id)))
    expect(closed.rows[0]!.scheduledMonth).toBe(1)

    // Mirado desde 2025, todo es futuro: el orden es el calendario (mes, semana).
    const future = await pageOf({ status: "pending", today: { year: 2025, month: 12, week: 4 }, activationByWorksite: {} })
    const months = future.rows.map((row) => row.scheduledMonth ?? 99)
    expect(months).toEqual([...months].sort((a, b) => a - b))
  })

  it("las casillas sin mes programado van al final, en cualquier vista", async () => {
    await seedTraining(WS_B)
    for (const status of ["all", "pending"] as const) {
      const { rows } = await pageOf({ status })
      const withoutMonth = rows.map((row) => row.scheduledMonth === null)
      expect(withoutMonth.some(Boolean)).toBe(true)
      expect(withoutMonth).toEqual([...withoutMonth].sort((x, y) => Number(x) - Number(y)))
    }
  })

  it("con otro estado el orden es el del calendario, sin cubos", async () => {
    await seedTraining(WS_A, WS_B)
    await setStatus(WS_A, "completed", 40)
    const { rows } = await pageOf({ status: "completed" })
    const keys = rows.map((row) => [row.scheduledMonth ?? 99, row.scheduledWeek ?? 99])
    expect(keys).toEqual([...keys].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!))
  })
})

describe("countTrainingOccurrencesByStatus", () => {
  it("da los mismos contadores que la lista completa, sin traer filas", async () => {
    await seedTraining(WS_A, WS_B, WS_INACTIVE)
    await seedObsoleteRows(WS_A)
    await setStatus(WS_A, "completed", 4)
    await setStatus(WS_B, "not_completed", 6)

    const counts = await countTrainingOccurrencesByStatus(access(ALL), { year: YEAR })
    const list = await listTrainingOccurrences(access(ALL), { year: YEAR })
    expect(counts.all).toBe(list.length)
    for (const status of ["pending", "completed", "not_completed", "not_applicable"] as const) {
      expect(counts[status]).toBe(list.filter((row) => row.status === status).length)
    }
    expect(counts).toEqual((await pageOf({ status: "all" })).counts)

    // Por faena, incluida una inactiva elegida a propósito.
    expect((await countTrainingOccurrencesByStatus(access(ALL), { year: YEAR, worksiteId: WS_B })).not_completed).toBe(6)
    expect((await countTrainingOccurrencesByStatus(access(ALL), { year: YEAR, worksiteId: WS_INACTIVE })).all).toBe(0)
    expect((await countTrainingOccurrencesByStatus(access(ALL), { year: YEAR, worksiteId: WS_INACTIVE, includeInactiveWorksites: true })).all).toBe(PER_WORKSITE)
  })

  it("respeta el permiso, el alcance y el año", async () => {
    await seedTraining(WS_A, WS_B)
    expect((await countTrainingOccurrencesByStatus(access(only(WS_B)), { year: YEAR })).all).toBe(PER_WORKSITE)
    const zero = { all: 0, pending: 0, completed: 0, not_completed: 0, not_applicable: 0 }
    expect(await countTrainingOccurrencesByStatus(access({ mode: "none", ids: [] }), { year: YEAR })).toEqual(zero)
    expect(await countTrainingOccurrencesByStatus(access(ALL), { year: 1999 })).toEqual(zero)
    await expect(countTrainingOccurrencesByStatus(access(ALL, []), { year: YEAR })).rejects.toThrow(/fuera de alcance/)
  })
})
