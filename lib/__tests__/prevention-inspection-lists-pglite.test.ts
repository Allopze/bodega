/**
 * La bandeja de inspecciones: los KPI y la lista cuentan lo mismo (P1-9).
 *
 * Tres defectos que la pantalla mostraba juntos:
 *
 * 1. El resumen se calculaba con el estado y la vista de la lista, así que
 *    `?estado=completed` dejaba el tile «Pendientes de revisión» en 0 sobre una
 *    lista con filas. Los KPI acotan el UNIVERSO (alcance, tipo, faena,
 *    responsable, rango, búsqueda) y no el subconjunto (estado, vista).
 * 2. El tile excluía lo que el propio usuario ejecutó (I-30) y la vista
 *    `pending_review` no: el tile decía 3 y la lista que abría traía 4.
 * 3. `total` también maneja `totalPages` y la paginación. Si se le quita el
 *    estado para arreglar (1), la pantalla pagina filas que la lista no trae.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import type { WorksiteScope } from "@/lib/auth/scope"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

const service = await import("@/lib/services/prevention-inspections")

const YO = "user-lists-yo"
const OTRO = "user-lists-otro"
const WS_A = "ws-lists-a"
const WS_B = "ws-lists-b"

const TPL_PLATAFORMA = "tpl-lists-plataforma"
const TPL_DECLARADA = "tpl-lists-declarada"
const TPL_AUDITORIA = "tpl-lists-auditoria"

const VIEW = "prevention:inspections:view"
const REVIEW = "prevention:inspections:review"

const ALL: WorksiteScope = { mode: "all", ids: [] }
const ONLY_A: WorksiteScope = { mode: "some", ids: [WS_A] }

const accessOf = (permissions: string[], scope: WorksiteScope = ALL) => ({ userId: YO, scope, permissions })
/** Quien revisa: puede abrir y cerrar lo que otros ejecutaron. */
const REVISOR = accessOf([VIEW, REVIEW])
/** Quien sólo mira: no hay «para mí», son las que esperan a Prevención. */
const SOLO_LECTURA = accessOf([VIEW])

const RUN = {
  planificadaVencida: "run-lists-planificada-vencida",
  enCurso: "run-lists-en-curso",
  completadaPropia: "run-lists-completada-propia",
  completadaDeOtro: "run-lists-completada-de-otro",
  completadaDeclarada: "run-lists-completada-declarada",
  completadaSinEjecutor: "run-lists-completada-sin-ejecutor",
  completadaOtraFaena: "run-lists-completada-otra-faena",
  revisada: "run-lists-revisada",
  cancelada: "run-lists-cancelada",
  auditoria: "run-lists-auditoria",
} as const

const KPI_KEYS = ["pendingReview", "withOpenFindings", "withCriticalFindings", "overdueRuns"] as const

function kpisOf(summary: Awaited<ReturnType<typeof service.summarizeInspectionRuns>>) {
  return Object.fromEntries(KPI_KEYS.map((key) => [key, summary[key]]))
}

type Filter = NonNullable<Parameters<typeof service.listInspectionRuns>[1]>

async function idsOf(access: ReturnType<typeof accessOf>, filter: Filter = {}) {
  // Sin paginar de verdad: la página por defecto es de 50 y acá hay diez filas.
  const rows = await service.listInspectionRuns(access, filter, { limit: 1000 })
  return rows.map((row) => row.run.id).sort()
}

async function seedTemplate(id: string, over: Partial<typeof schema.preventionInspectionTemplates.$inferInsert> = {}) {
  await testDb.insert(schema.preventionInspectionTemplates).values({
    id,
    code: id,
    versionLabel: "01",
    name: `Plantilla ${id}`,
    kind: "inspection",
    definitionSnapshot: {},
    contentHash: id.padEnd(64, "0").slice(0, 64),
    status: "approved",
    authorUserId: OTRO,
    approvedByUserId: OTRO,
    approvedAt: "2026-09-01T12:00:00.000Z",
    ...over,
  })
}

async function seedRun(id: string, templateId: string, over: Partial<typeof schema.preventionInspectionRuns.$inferInsert> = {}) {
  await testDb.insert(schema.preventionInspectionRuns).values({
    id,
    code: id.toUpperCase(),
    templateId,
    worksiteId: WS_A,
    createdByUserId: OTRO,
    ...over,
  })
}

async function seedFinding(runId: string, criticality: "medium" | "high") {
  await testDb.insert(schema.preventionInspectionFindings).values({
    id: `finding-${runId}`,
    runId,
    description: "Extintor sin sello de seguridad",
    criticality,
    status: "open",
  })
}

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values([
    { id: YO, name: "Yo Revisor", email: "yo@lists.cl", hashedPassword: "x", isActive: true },
    { id: OTRO, name: "Otro Ejecutor", email: "otro@lists.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.worksites).values([
    { id: WS_A, name: "Faena A", code: "LST-A", isActive: true },
    { id: WS_B, name: "Faena B", code: "LST-B", isActive: true },
  ])
  await seedTemplate(TPL_PLATAFORMA)
  // La persona que ejecutó está nombrada dentro del formulario: `executedByUserId`
  // es quien transcribió y no hay conflicto de independencia (D04).
  await seedTemplate(TPL_DECLARADA, { executorOfRecord: "declared_in_form" })
  await seedTemplate(TPL_AUDITORIA, { kind: "audit" })

  const ejecutada = { executedAt: "2026-09-20T12:00:00.000Z" }
  // Vencida: planificada con fecha pasada. Es la única planificada, a propósito:
  // con `status: "planned"` el total de la lista tiene que ser exactamente 1.
  await seedRun(RUN.planificadaVencida, TPL_PLATAFORMA, { status: "planned", scheduledFor: "2020-01-01" })
  await seedRun(RUN.enCurso, TPL_PLATAFORMA, { status: "in_progress" })
  // Ejecutada por quien mira: no puede revisarla (assessRunReview).
  await seedRun(RUN.completadaPropia, TPL_PLATAFORMA, { status: "completed", executedByUserId: YO, ...ejecutada })
  await seedRun(RUN.completadaDeOtro, TPL_PLATAFORMA, { status: "completed", executedByUserId: OTRO, ...ejecutada })
  // Misma persona que arriba, pero la plantilla declara al ejecutante en el formulario.
  await seedRun(RUN.completadaDeclarada, TPL_DECLARADA, { status: "completed", executedByUserId: YO, ...ejecutada })
  // Heredada sin ejecutor registrado: `<>` con NULL no es verdadero, `IS DISTINCT FROM` sí.
  await seedRun(RUN.completadaSinEjecutor, TPL_PLATAFORMA, { status: "completed", executedByUserId: null, ...ejecutada })
  await seedRun(RUN.completadaOtraFaena, TPL_PLATAFORMA, { status: "completed", executedByUserId: OTRO, worksiteId: WS_B, ...ejecutada })
  await seedRun(RUN.revisada, TPL_PLATAFORMA, {
    status: "reviewed", executedByUserId: OTRO, ...ejecutada,
    reviewedByUserId: YO, reviewedAt: "2026-09-21T12:00:00.000Z",
  })
  await seedRun(RUN.cancelada, TPL_PLATAFORMA, {
    status: "cancelled", cancelledByUserId: YO, cancelledAt: "2026-09-21T12:00:00.000Z",
    cancellationReason: "Se programó en la faena equivocada",
  })
  await seedRun(RUN.auditoria, TPL_AUDITORIA, {
    status: "reviewed", executedByUserId: OTRO, ...ejecutada,
    reviewedByUserId: YO, reviewedAt: "2026-09-21T12:00:00.000Z",
  })

  await seedFinding(RUN.completadaDeOtro, "high")
  await seedFinding(RUN.completadaDeclarada, "medium")
})

describe("KPI de la bandeja — acotan el universo y no el subconjunto (P1-9)", () => {
  it("sin filtros: cuenta el universo completo de las diez ejecuciones", async () => {
    const summary = await service.summarizeInspectionRuns(REVISOR)
    expect(summary.total).toBe(10)
    expect(kpisOf(summary)).toEqual({
      // Ajena (otro ejecutor), declarada, sin ejecutor y la de otra faena. La
      // propia (`completadaPropia`) no cuenta: quien mira no puede revisarla.
      pendingReview: 4,
      withOpenFindings: 2,
      withCriticalFindings: 1,
      overdueRuns: 1,
    })
  })

  it("con el estado «planned» los cuatro KPI son los mismos y el total es 1", async () => {
    const sinFiltro = await service.summarizeInspectionRuns(REVISOR)
    const planificadas = await service.summarizeInspectionRuns(REVISOR, { status: "planned" })

    expect(kpisOf(planificadas)).toEqual(kpisOf(sinFiltro))
    // `total` sí lleva el estado: alimenta `totalPages` y `Pagination`.
    expect(planificadas.total).toBe(1)
    expect(await idsOf(REVISOR, { status: "planned" })).toEqual([RUN.planificadaVencida])
  })

  it.each([
    ["critical", 1],
    ["open_findings", 2],
    ["overdue", 1],
    ["pending_review", 4],
  ] as const)("con la vista %s los KPI tampoco cambian y el total es el de la lista", async (view, esperado) => {
    const sinFiltro = await service.summarizeInspectionRuns(REVISOR)
    const conVista = await service.summarizeInspectionRuns(REVISOR, { view })

    expect(kpisOf(conVista)).toEqual(kpisOf(sinFiltro))
    expect(conVista.total).toBe(esperado)
    expect((await idsOf(REVISOR, { view })).length).toBe(esperado)
  })

  it("el total siempre es el largo de la lista completa, con cualquier combinación", async () => {
    // Si `total` perdiera el estado, la paginación contaría páginas de filas
    // que la lista no trae.
    const combinaciones: Filter[] = [
      {},
      { status: "completed" },
      { status: "completed", view: "pending_review" },
      { status: "planned", view: "pending_review" },
      { view: "open_findings", worksiteId: WS_A },
      { status: "reviewed", kinds: ["audit"] },
    ]
    for (const filter of combinaciones) {
      const summary = await service.summarizeInspectionRuns(REVISOR, filter)
      expect(summary.total, JSON.stringify(filter)).toBe((await idsOf(REVISOR, filter)).length)
    }
  })

  it("siguen respetando faena y tipo: son el universo", async () => {
    const faenaB = await service.summarizeInspectionRuns(REVISOR, { worksiteId: WS_B })
    expect(faenaB.total).toBe(1)
    expect(kpisOf(faenaB)).toEqual({ pendingReview: 1, withOpenFindings: 0, withCriticalFindings: 0, overdueRuns: 0 })

    const auditorias = await service.summarizeInspectionRuns(REVISOR, { kinds: ["audit"] })
    expect(auditorias.total).toBe(1)
    expect(kpisOf(auditorias)).toEqual({ pendingReview: 0, withOpenFindings: 0, withCriticalFindings: 0, overdueRuns: 0 })
  })

  it("y el alcance del usuario: una faena fuera de su alcance no entra en ningún KPI", async () => {
    const soloA = await service.summarizeInspectionRuns(accessOf([VIEW, REVIEW], ONLY_A))
    expect(soloA.total).toBe(9)
    expect(soloA.pendingReview).toBe(3)
  })
})

describe("vista «pendientes de revisión» — la lista abre exactamente lo que el tile cuenta (P1-9)", () => {
  it("con permiso de revisión: excluye la ejecución propia e incluye declared_in_form y sin ejecutor", async () => {
    const ids = await idsOf(REVISOR, { view: "pending_review" })
    const tile = (await service.summarizeInspectionRuns(REVISOR)).pendingReview

    expect(ids).toEqual([
      RUN.completadaDeOtro,
      RUN.completadaDeclarada,
      RUN.completadaSinEjecutor,
      RUN.completadaOtraFaena,
    ].sort())
    expect(ids).not.toContain(RUN.completadaPropia)
    expect(ids.length).toBe(tile)
  })

  it("la ejecución propia sí cuenta cuando la plantilla declara al ejecutante en el formulario", async () => {
    // `completadaDeclarada` también la «ejecutó» YO, y aun así es revisable.
    const ids = await idsOf(REVISOR, { view: "pending_review" })
    expect(ids).toContain(RUN.completadaDeclarada)
  })

  it("sin permiso de revisión no hay «para mí»: son todas las completadas", async () => {
    const ids = await idsOf(SOLO_LECTURA, { view: "pending_review" })
    const tile = (await service.summarizeInspectionRuns(SOLO_LECTURA)).pendingReview

    expect(ids).toEqual([
      RUN.completadaPropia,
      RUN.completadaDeOtro,
      RUN.completadaDeclarada,
      RUN.completadaSinEjecutor,
      RUN.completadaOtraFaena,
    ].sort())
    expect(ids.length).toBe(tile)
  })

  it("el tile cuenta lo mismo bajo cualquier filtro de estado o vista", async () => {
    // El caso que la auditoría vio: `?estado=completed` dejaba el tile en 0.
    const filtros: Filter[] = [{}, { status: "completed" }, { view: "pending_review" }, { status: "planned" }]
    for (const filter of filtros) {
      const tile = (await service.summarizeInspectionRuns(REVISOR, filter)).pendingReview
      expect(tile, JSON.stringify(filter)).toBe(4)
    }
  })

  it("el Excel exporta las mismas filas que la lista de esa vista", async () => {
    // El export comparte `listFilterConditions`: arreglar la lista arregla el Excel.
    const exportadas = (await service.listAllInspectionRunsForExport(REVISOR, { view: "pending_review" }))
      .map((row) => row.run.id).sort()
    expect(exportadas).toEqual(await idsOf(REVISOR, { view: "pending_review" }))
  })
})
