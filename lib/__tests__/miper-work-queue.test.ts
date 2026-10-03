/**
 * El tipo MIPER en la cola «Mi trabajo» y en la atención de Prevención
 * (§9.1 y Task 4 del plan F3).
 *
 * Dos hechos del mismo instrumento, con permisos distintos:
 *
 *  · una **ocurrencia** del Programa de Trabajo que debe trabajo —pendiente con
 *    vencimiento pasado o «No se hizo»— la registra quien tiene
 *    `prevention:risk:program:execute` sobre la faena, o el responsable NOMINAL
 *    de esa actividad, que para registrarla sólo necesita `prevention:risk:view`
 *    (`requireExecute` en lib/services/miper/program-execution.ts);
 *  · una **matriz** esperando firma la ve quien revisa técnicamente
 *    (`prevention:risk:review`) o quien aprueba como Legal y RRHH
 *    (`prevention:risk:approve_legal`), cada uno en su etapa.
 *
 * El vencimiento se **deriva** de `due_on` contra el día civil chileno: no hay
 * ninguna columna de avance que leer (`programProgress`,
 * lib/prevention/miper/progress.ts).
 *
 * PGlite: una sola conexión, y los servicios de la cola leen `db` global.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

import {
  getOperationalWorkCount, getOperationalWorkQueue, parseOperationalQueueFilters,
} from "@/lib/services/operational-work-queue"
import { getPreventionAttention } from "@/lib/services/prevention-attention"
import { buildMiperSnapshots } from "@/lib/services/miper/snapshots"
import { checkMiperCompleteness } from "@/lib/prevention/miper/completeness"

const WS_IN = "ws-miper-in"
const WS_OUT = "ws-miper-out"

function makeSession(userId: string, permissions: string[], worksiteIds: string[] = [WS_IN]): Session {
  return {
    expires: "2099-01-01T00:00:00.000Z",
    user: {
      id: userId, name: userId, email: `${userId}@miper.cl`, roles: [], permissions,
      worksiteIds, primaryWorksiteId: worksiteIds[0] ?? null, avatarColor: null, isActive: true,
    },
  } as Session
}

const exec = () => makeSession("u-exec", ["prevention:risk:view", "prevention:risk:program:execute"])
const nominal = () => makeSession("u-nominal", ["prevention:risk:view"])
const reviewer = () => makeSession("u-review", ["prevention:risk:view", "prevention:risk:review"])
const legal = () => makeSession("u-legal", ["prevention:risk:view", "prevention:risk:approve_legal"])
const nobody = () => makeSession("u-nobody", ["prevention:risk:view"])

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([
    { id: WS_IN, name: "Faena en alcance", code: "MIPER-IN" },
    { id: WS_OUT, name: "Faena fuera", code: "MIPER-OUT" },
  ])
  await testDb.insert(schema.users).values([
    { id: "u-exec", name: "Prevencionista de faena", email: "exec@miper.cl", hashedPassword: "x", isActive: true },
    { id: "u-nominal", name: "Persona nominal", email: "nominal@miper.cl", hashedPassword: "x", isActive: true },
    { id: "u-other", name: "Otra responsable", email: "other@miper.cl", hashedPassword: "x", isActive: true },
    { id: "u-review", name: "Jefatura de Prevención", email: "review@miper.cl", hashedPassword: "x", isActive: true },
    { id: "u-legal", name: "Legal y RRHH", email: "legal@miper.cl", hashedPassword: "x", isActive: true },
    { id: "u-nobody", name: "Sólo lectura", email: "nobody@miper.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.preventionRiskMethodologies).values({
    id: "m-miper", code: "RE-04-CHOME", name: "RE-04", versionLabel: "REV-2026", kind: "primary",
    authoritySource: "RE-04", createdByUserId: "u-exec",
  })

  const matrix = (over: Partial<typeof schema.preventionRiskMatrices.$inferInsert> & { id: string; worksiteId: string; matrixVersion: number; title: string }) => ({
    methodologyId: "m-miper", methodologySnapshot: {}, revisionReason: "Elaboración inicial.",
    participationSummary: "", consultationEvidenceReference: "", createdByUserId: "u-exec", ...over,
  })

  await testDb.insert(schema.preventionRiskMatrices).values([
    // Vigente con programa y ocurrencias.
    matrix({
      id: "mx-in", worksiteId: WS_IN, matrixVersion: 1, title: "MIPER 2026", period: 2026,
      status: "published", reviewState: "none", reviewedByUserId: "u-exec", approvedByUserId: "u-exec",
      publishedByUserId: "u-exec", publishedAt: new Date().toISOString(),
    }),
    // Esperando la revisión técnica de la Jefatura.
    matrix({ id: "mx-review", worksiteId: WS_IN, matrixVersion: 2, title: "MIPER 2025", period: 2025, status: "draft", reviewState: "in_review" }),
    // Esperando la firma de Legal y RRHH.
    matrix({ id: "mx-legal", worksiteId: WS_IN, matrixVersion: 3, title: "MIPER 2027", period: 2027, status: "draft", reviewState: "pending_approval" }),
    // La misma etapa en otra faena: no debe cruzar el alcance.
    matrix({ id: "mx-out", worksiteId: WS_OUT, matrixVersion: 1, title: "MIPER 2026 externa", period: 2026, status: "draft", reviewState: "in_review" }),
  ])

  await testDb.insert(schema.preventionRiskPrograms).values([
    { id: "prog-in", matrixId: "mx-in", worksiteId: WS_IN, period: 2026, createdByUserId: "u-exec" },
    { id: "prog-out", matrixId: "mx-out", worksiteId: WS_OUT, period: 2026, createdByUserId: "u-exec" },
  ])
  await testDb.insert(schema.preventionRiskProgramActions).values([
    {
      id: "act-nominal", programId: "prog-in", actionNumber: 1, description: "Inspección mensual de extintores",
      scheduleKind: "monthly", startsOn: "2026-01-01", responsibleUserId: "u-nominal",
      responsibleSnapshot: "Persona nominal", createdByUserId: "u-exec",
    },
    {
      id: "act-team", programId: "prog-in", actionNumber: 2, description: "Charla de cinco minutos",
      scheduleKind: "monthly", startsOn: "2026-01-01", responsibleUserId: "u-other",
      responsibleSnapshot: "Otra responsable", createdByUserId: "u-exec",
    },
    {
      id: "act-out", programId: "prog-out", actionNumber: 1, description: "Actividad de la otra faena",
      scheduleKind: "monthly", startsOn: "2026-01-01", createdByUserId: "u-exec",
    },
  ])
  await testDb.insert(schema.preventionRiskProgramOccurrences).values([
    { id: "occ-overdue", actionId: "act-nominal", dueOn: "2020-01-31", outcome: "pending" },
    { id: "occ-future", actionId: "act-nominal", dueOn: "2999-12-31", outcome: "pending" },
    { id: "occ-notdone", actionId: "act-team", dueOn: "2020-06-30", outcome: "not_done" },
    { id: "occ-super", actionId: "act-team", dueOn: "2020-03-31", outcome: "superseded" },
    { id: "occ-out", actionId: "act-out", dueOn: "2020-01-31", outcome: "pending" },
  ])

  await testDb.insert(schema.preventionRiskEntries).values([
    // Intolerable (4×4) SIN ninguna medida completa → aparece.
    { id: "entry-intol", matrixId: "mx-in", rowNumber: 1, hazardCode: "FIS-01", risk: "Caída de altura", probability: 4, consequence: 4, controlledStatus: "no" },
    // Intolerable con una medida con responsable y plazo → no aparece.
    { id: "entry-intol-ok", matrixId: "mx-in", rowNumber: 2, hazardCode: "FIS-02", risk: "Atrapamiento", probability: 4, consequence: 4, controlledStatus: "partial" },
    // Importante (4×2) cuya única medida no tiene plazo → aparece igual.
    { id: "entry-important", matrixId: "mx-in", rowNumber: 3, hazardCode: "QUI-01", risk: "Exposición a solvente", probability: 4, consequence: 2, controlledStatus: "partial" },
  ])
  await testDb.insert(schema.preventionRiskControls).values([
    { id: "ctl-ok", riskEntryId: "entry-intol-ok", description: "Baranda perimetral certificada", hierarchy: "engineering", responsibleUserId: "u-exec", dueDate: "2026-06-30" },
    { id: "ctl-no-due", riskEntryId: "entry-important", description: "Ventilación forzada del área", hierarchy: "engineering", responsibleUserId: "u-exec" },
  ])
}, 60_000)

afterAll(async () => { await pg.close() })

describe("atención de Prevención — tipo MIPER", () => {
  it("emite lo que espera firma, la ocurrencia vencida y la banda sin medida", async () => {
    const items = await getPreventionAttention({
      worksiteIds: [WS_IN], includeActions: false, includeEvaluations: false, includePpa: false, includeMiper: true,
    })
    const miper = items.filter((item) => item.kind === "miper")

    // Lo que espera firma: las dos etapas, cada una con su destino.
    expect(miper.find((item) => item.id === "miper_review:mx-review")!.href).toBe("/prevencion/miper/mx-review?tab=revision")
    expect(miper.find((item) => item.id === "miper_review:mx-legal")!.href).toBe("/prevencion/miper/mx-legal?tab=revision")

    // La ocurrencia pendiente con vencimiento pasado; la futura no.
    expect(miper.find((item) => item.id === "miper_occurrence:occ-overdue")).toMatchObject({
      tone: "danger", dueDate: "2020-01-31", worksiteName: "Faena en alcance",
      href: "/prevencion/miper/mx-in?tab=programa&ocurrencia=occ-overdue",
    })
    expect(miper.some((item) => item.id === "miper_occurrence:occ-future")).toBe(false)

    // Intolerable sin medida completa e Importante con medida sin plazo.
    expect(miper.find((item) => item.id === "miper_entry:entry-intol")!.tone).toBe("danger")
    expect(miper.some((item) => item.id === "miper_entry:entry-important")).toBe(true)
    // Con responsable y plazo, la banda queda cubierta.
    expect(miper.some((item) => item.id === "miper_entry:entry-intol-ok")).toBe(false)
  })

  it("no cruza el alcance de faena", async () => {
    const items = await getPreventionAttention({
      worksiteIds: [WS_IN], includeActions: false, includeEvaluations: false, includePpa: false, includeMiper: true,
    })
    expect(items.some((item) => item.worksiteName === "Faena fuera")).toBe(false)
  })

  it("con la fuente apagada no agrega nada", async () => {
    const items = await getPreventionAttention({
      worksiteIds: [WS_IN], includeActions: false, includeEvaluations: false, includePpa: false,
    })
    expect(items.some((item) => item.kind === "miper")).toBe(false)
  })
  it("la banda sin medida usa la regla de la completitud: cuenta un responsable escrito y no cuenta una medida existente (Fase C)", async () => {
    await testDb.insert(schema.preventionRiskEntries).values([
      // Intolerable cuya única medida YA EXISTE: no hay nada por implementar con responsable y plazo → aparece.
      { id: "entry-intol-existente", matrixId: "mx-in", rowNumber: 4, hazardCode: "FIS-03", risk: "Caída desde la batea", probability: 4, consequence: 4, controlledStatus: "partial" },
      // Importante no controlado con una medida por implementar de responsable ESCRITO y plazo → no aparece.
      { id: "entry-imp-texto", matrixId: "mx-in", rowNumber: 5, hazardCode: "QUI-02", risk: "Inhalación de polvo", probability: 4, consequence: 2, controlledStatus: "no" },
      // Importante «Sí, controlado» con una medida existente: la completitud no le pide más → no aparece.
      { id: "entry-imp-controlado", matrixId: "mx-in", rowNumber: 6, hazardCode: "ERG-01", risk: "Sobreesfuerzo", probability: 4, consequence: 2, controlledStatus: "yes" },
      // Intolerable «Sí, controlado» con sólo medidas existentes: la parte `important` del OR no lo excusa → aparece.
      { id: "entry-intol-yes", matrixId: "mx-in", rowNumber: 7, hazardCode: "FIS-04", risk: "Atropello", probability: 4, consequence: 4, controlledStatus: "yes" },
      // Intolerable cuya única medida por implementar fue retirada → no cuenta → aparece.
      { id: "entry-intol-retirada", matrixId: "mx-in", rowNumber: 8, hazardCode: "FIS-05", risk: "Golpe por vehículo", probability: 4, consequence: 4, controlledStatus: "partial" },
    ])
    await testDb.insert(schema.preventionRiskControls).values([
      { id: "ctl-existente", riskEntryId: "entry-intol-existente", description: "Barandas en la batea", hierarchy: "engineering", isExisting: true, verificationFrequency: "Trimestral", responsibleSnapshot: "Supervisor de turno", dueDate: "2026-12-31" },
      { id: "ctl-intol-yes", riskEntryId: "entry-intol-yes", description: "Enclavamiento de la batea", hierarchy: "engineering", isExisting: true, verificationFrequency: "Mensual", responsibleSnapshot: "Supervisor de turno", dueDate: "2026-12-31" },
      { id: "ctl-retirada", riskEntryId: "entry-intol-retirada", description: "Cierre perimetral", hierarchy: "engineering", status: "retired", responsibleSnapshot: "Jefe de faena", dueDate: "2026-12-31" },
      { id: "ctl-texto", riskEntryId: "entry-imp-texto", description: "Humectación del área", hierarchy: "engineering", responsibleSnapshot: "Jefe de faena", dueDate: "2026-12-31" },
      { id: "ctl-controlado", riskEntryId: "entry-imp-controlado", description: "Pausas activas", hierarchy: "administrative", isExisting: true, verificationFrequency: "Mensual", responsibleSnapshot: "Supervisor de turno" },
    ])
    const items = await getPreventionAttention({
      worksiteIds: [WS_IN], includeActions: false, includeEvaluations: false, includePpa: false, includeMiper: true, limit: 50,
    })
    const ids = items.filter((item) => item.kind === "miper").map((item) => item.id)
    expect(ids).toContain("miper_entry:entry-intol-existente")
    expect(ids).toContain("miper_entry:entry-intol-yes")
    expect(ids).toContain("miper_entry:entry-intol-retirada")
    expect(ids).not.toContain("miper_entry:entry-imp-texto")
    expect(ids).not.toContain("miper_entry:entry-imp-controlado")
    expect(items.find((item) => item.id === "miper_entry:entry-intol-existente")!.title).toBe("Riesgo Intolerable sin medida por implementar con responsable y plazo")
    // Lo de antes no cambia: el Intolerable sin medidas y el Importante cuya medida no tiene plazo siguen.
    expect(ids).toEqual(expect.arrayContaining(["miper_entry:entry-intol", "miper_entry:entry-important"]))
  })

  it("paridad: «Atención requerida» lista exactamente las filas graves que la completitud rechaza por la regla crítica", async () => {
    const snapshot = (await buildMiperSnapshots(testDb, ["mx-in"])).get("mx-in")!
    const graves = new Set(snapshot.entries.filter((e) => e.classification === "important" || e.classification === "intolerable").map((e) => e.id))
    // La regla crítica emite `dueDate` (hay medidas pero ninguna por implementar con responsable y plazo)
    // o `controls` (no hay ninguna medida), siempre a nivel de fila.
    const rejected = new Set(checkMiperCompleteness(snapshot)
      .filter((i) => i.severity === "error" && i.scope === "entry" && i.entryId && graves.has(i.entryId) && (i.field === "dueDate" || i.field === "controls"))
      .map((i) => i.entryId!))
    const items = await getPreventionAttention({
      worksiteIds: [WS_IN], includeActions: false, includeEvaluations: false, includePpa: false, includeMiper: true, limit: 50,
    })
    const listed = new Set(items.filter((item) => item.id.startsWith("miper_entry:")).map((item) => item.id.slice("miper_entry:".length)))
    expect(rejected.size).toBeGreaterThan(0)
    expect([...listed].sort()).toEqual([...rejected].sort())
  })
})

describe("cola «Mi trabajo» — ramas MIPER", () => {
  it("quien ejecuta el programa recibe las ocurrencias que deben trabajo", async () => {
    const queue = await getOperationalWorkQueue(exec(), { module: "miper" })
    expect(queue.items.every((item) => item.module === "miper")).toBe(true)
    expect(queue.items.some((item) => item.sourceType === "miper_occurrence")).toBe(true)
    // Vencida y «No se hizo»; ni la futura ni la reemplazada.
    expect(queue.items.map((item) => item.sourceId).sort()).toEqual(["occ-notdone", "occ-overdue"])

    const overdue = queue.items.find((item) => item.sourceId === "occ-overdue")!
    expect(overdue).toMatchObject({
      sourceType: "miper_occurrence", code: "N°1", statusLabel: "Vencida", ctaLabel: "Registrar ejecución",
      href: "/prevencion/miper/mx-in?tab=programa&ocurrencia=occ-overdue",
      sourceDueAt: "2020-01-31",
      assignee: { userId: "u-nominal", name: "Persona nominal" },
    })
    expect(queue.items.find((item) => item.sourceId === "occ-notdone")!.statusLabel).toBe("No se hizo")
  })

  it("el contador del badge dice lo mismo que la cola", async () => {
    const queue = await getOperationalWorkQueue(exec(), { module: "miper" })
    expect(queue.items).toHaveLength(2)
    expect(await getOperationalWorkCount(exec())).toBe(2)
  })

  it("el responsable nominal registra con risk:view y sólo ve lo suyo", async () => {
    const queue = await getOperationalWorkQueue(nominal(), { module: "miper" })
    expect(queue.items.map((item) => item.sourceId)).toEqual(["occ-overdue"])
  })

  it("quien sólo mira la matriz no recibe ocurrencias ajenas", async () => {
    const queue = await getOperationalWorkQueue(nobody(), { module: "miper" })
    expect(queue.items.filter((item) => item.sourceType === "miper_occurrence")).toEqual([])
  })

  it("sin ningún permiso del instrumento no hay rama MIPER", async () => {
    const outsider = makeSession("u-nobody", ["prevention:pdtp:view"])
    const queue = await getOperationalWorkQueue(outsider, { module: "miper" })
    expect(queue.items).toEqual([])
  })

  it("la revisión técnica y la firma de Legal y RRHH son etapas distintas", async () => {
    const review = await getOperationalWorkQueue(reviewer(), { module: "miper" })
    expect(review.items.map((item) => ({ type: item.sourceType, id: item.sourceId, cta: item.ctaLabel })))
      .toEqual([{ type: "miper_review", id: "mx-review", cta: "Revisar" }])

    const legalQueue = await getOperationalWorkQueue(legal(), { module: "miper" })
    expect(legalQueue.items.map((item) => ({ type: item.sourceType, id: item.sourceId, cta: item.ctaLabel })))
      .toEqual([{ type: "miper_review", id: "mx-legal", cta: "Firmar" }])

    const legalItem = legalQueue.items[0]!
    expect(legalItem.href).toBe("/prevencion/miper/mx-legal?tab=revision")
    expect(legalItem.statusLabel).toBe("Pendiente de firma de Legal y RRHH")
  })

  it("el alcance por faena manda sobre el permiso del programa", async () => {
    const out = makeSession("u-exec", ["prevention:risk:view", "prevention:risk:program:execute"], [WS_OUT])
    const queue = await getOperationalWorkQueue(out, { module: "miper" })
    expect(queue.items.map((item) => item.sourceId)).toEqual(["occ-out"])
  })

  it("el filtro de módulo acepta «miper»", () => {
    expect(parseOperationalQueueFilters({ module: "miper" }).module).toBe("miper")
  })

  it("quien envió la ronda no la recibe para revisar ni firmar aunque tenga el permiso (como miperInboxReason)", async () => {
    // Una MIPER enviada por quien además revisa y firma: el servicio se la rechazaría (assertNotSubmitter).
    // Se siembra aquí, al final, para no cambiar lo que ven las pruebas anteriores.
    await testDb.insert(schema.users).values({ id: "u-dual", name: "Edita, revisa y firma", email: "dual@miper.cl", hashedPassword: "x", isActive: true })
    await testDb.insert(schema.preventionRiskMatrices).values({
      id: "mx-own", worksiteId: WS_IN, matrixVersion: 4, title: "MIPER 2028", period: 2028, status: "draft", reviewState: "in_review",
      methodologyId: "m-miper", methodologySnapshot: {}, revisionReason: "Elaboración inicial.",
      participationSummary: "", consultationEvidenceReference: "", createdByUserId: "u-dual",
    })
    await testDb.insert(schema.preventionRiskReviewRounds).values({
      id: "round-own", matrixId: "mx-own", roundNumber: 1, stage: "technical",
      snapshot: { header: {}, entries: [] }, snapshotSha256: "d".repeat(64), submittedByUserId: "u-dual",
    })

    const dual = makeSession("u-dual", ["prevention:risk:view", "prevention:risk:edit", "prevention:risk:review", "prevention:risk:approve_legal"])
    const own = await getOperationalWorkQueue(dual, { module: "miper" })
    expect(own.items.map((item) => item.sourceId).sort()).toEqual(["mx-legal", "mx-review"])
    // El contador del badge dice lo mismo que la cola.
    expect(await getOperationalWorkCount(dual)).toBe(own.items.length)

    // Quien no la envió sí la recibe.
    const review = await getOperationalWorkQueue(reviewer(), { module: "miper" })
    expect(review.items.map((item) => item.sourceId).sort()).toEqual(["mx-own", "mx-review"])
  })
})
