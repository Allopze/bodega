import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import type { MiperAccess } from "@/lib/services/miper/shared"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { createMiper } = await import("@/lib/services/miper/matrices")
const { saveMiperEntry } = await import("@/lib/services/miper/entries")
const q = await import("@/lib/services/miper/queries")
const { listMiperPortfolio } = await import("@/lib/services/miper/portfolio")

const author = { userId: "u-q", scope: { mode: "some" as const, ids: ["ws-q"] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const jefa = { userId: "u-j", scope: { mode: "all" as const, ids: [] as [] }, permissions: ["prevention:risk:view", "prevention:risk:review"] }
const outsider = { userId: "u-o", scope: { mode: "some" as const, ids: ["ws-other"] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
let matrixId = ""

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([{ id: "ws-q", name: "Faena Q", code: "Q" }, { id: "ws-other", name: "Otra", code: "O" }])
  await testDb.insert(schema.users).values([
    { id: "u-q", name: "Prevencionista Q", email: "q@q.cl", hashedPassword: "x", isActive: true },
    { id: "u-j", name: "Jefa", email: "j@q.cl", hashedPassword: "x", isActive: true },
    { id: "u-o", name: "Otra", email: "o@q.cl", hashedPassword: "x", isActive: true },
  ])
  await testDb.insert(schema.worksiteUsers).values({ userId: "u-q", worksiteId: "ws-q" })
  matrixId = (await createMiper({ worksiteId: "ws-q", period: 2026, revisionReason: "Período para probar consultas." }, author)).id
  await saveMiperEntry({ matrixId, values: { hazard: "Ruido", probability: 1, consequence: 2 } }, author)
  await saveMiperEntry({ matrixId, values: { hazard: "Volcamiento", probability: 4, consequence: 4 } }, author)
}, 60_000)

describe("consultas MIPER", () => {
  it("el espacio de trabajo trae foto, completitud, prellenado, diccionarios y responsables", async () => {
    const ws = await q.getMiperWorkspace(matrixId, author)
    expect(ws.label).toBe("Borrador")
    expect(ws.snapshot.entries.map((e) => e.classification)).toEqual(["tolerable", "intolerable"])
    expect(Object.keys(ws.entryVersions)).toHaveLength(2)
    expect(ws.completeness.some((i) => i.severity === "error")).toBe(true)
    expect(ws.riskFactors.length).toBeGreaterThan(5)
    expect(ws.responsibleOptions.map((o) => o.id)).toContain("u-q")
    expect(ws.pendingDiff.hasChanges).toBe(true)
  })
  it("fuera de alcance no se lee", async () => {
    await expect(q.getMiperWorkspace(matrixId, outsider)).rejects.toThrow(/fuera de alcance/)
  })
  it("la portada cuenta los graves de la faena y respeta el alcance", async () => {
    const { rows } = await listMiperPortfolio(author)
    expect(rows.map((row) => row.worksiteId)).toEqual(["ws-q"])
    expect(rows[0]).toMatchObject({ matrix: { id: matrixId }, intolerableCount: 1, importantCount: 0, completeness: { total: 2 } })
    // Quien no tiene la faena en su alcance ve sólo la suya, sin MIPER.
    expect((await listMiperPortfolio(outsider)).rows.map((row) => [row.worksiteId, row.matrix])).toEqual([["ws-other", null]])
  })
  it("«Requieren mi acción»: a la prevencionista, su borrador; a la Jefa, lo enviado", async () => {
    const acciones = async (access: MiperAccess) => (await listMiperPortfolio(access)).rows.find((row) => row.worksiteId === "ws-q")!.myActions
    expect((await acciones(author)).map((action) => action.reason)).toEqual(["Borrador"])
    expect(await acciones(jefa)).toEqual([])
    // Forzar el estado sin pasar por la completitud: la regla sólo mira `review_state` y la ronda.
    await testDb.update(schema.preventionRiskMatrices).set({ reviewState: "in_review" }).where(eq(schema.preventionRiskMatrices.id, matrixId))
    await testDb.insert(schema.preventionRiskReviewRounds).values({ id: "rq", matrixId, roundNumber: 1, stage: "technical", snapshot: { header: {}, entries: [] }, snapshotSha256: "c".repeat(64), submittedByUserId: "u-q" })
    expect(await acciones(jefa)).toEqual([{ matrixId, period: 2026, reason: "Pendiente de tu revisión" }])
    expect((await listMiperPortfolio(jefa)).rows.find((row) => row.worksiteId === "ws-q")!.submittedByName).toBe("Prevencionista Q")
    // «Elaboró» del espacio de trabajo (Fase B): el nombre de quien envió la ronda abierta.
    expect((await q.getMiperWorkspace(matrixId, jefa)).openRound?.submittedByName).toBe("Prevencionista Q")
  })
  it("quien envió la ronda no la ve como «Pendiente de tu revisión» aunque tenga el permiso de revisar", async () => {
    // La ronda «rq» del test anterior la envió u-q. Con el permiso de revisar sumado, «Requieren mi
    // acción» sigue sin ofrecérsela: no puede revisar lo que ella misma envió (assertNotSubmitter).
    const autoraQueRevisa = { ...author, permissions: [...author.permissions, "prevention:risk:review"] }
    expect((await listMiperPortfolio(autoraQueRevisa)).rows.find((row) => row.worksiteId === "ws-q")!.myActions).toEqual([])
  })
  it("el historial lista eventos con actor y capacidad", async () => {
    const { events } = await q.getMiperHistory(matrixId, author)
    expect(events.map((e) => e.changeType)).toEqual(expect.arrayContaining(["created", "entry_created"]))
    expect(events.find((e) => e.changeType === "created")).toMatchObject({ actorName: "Prevencionista Q", actingAs: "prevention:risk:edit" })
  })
  it("pagina de a 50 sin repetir ni saltar, también con eventos del mismo instante", async () => {
    // Una MIPER propia para no alterar los eventos de las demás pruebas.
    const own = await createMiper({ worksiteId: "ws-q", period: 2031, revisionReason: "Período para paginar la bitácora." }, author)
    // Lo que `createMiper` ya registró (más viejo que lo sembrado) cierra la última página.
    const own0 = (await q.getMiperHistory(own.id, author)).events.length
    const base = Date.UTC(2031, 0, 1, 12, 0, 0)
    // 120 eventos: 40 comparten el mismo instante (a la mitad del orden).
    const events = Array.from({ length: 120 }, (_, index) => {
      const slot = index < 40 ? index : index < 80 ? 40 : index - 39
      return { id: `hist-${String(index).padStart(3, "0")}`, action: "update", entityType: "risk_legal:risk:miper", entityId: own.id, newState: JSON.stringify({ changeType: "entry_updated" }), createdAt: new Date(base + slot * 1000).toISOString() }
    })
    await testDb.insert(schema.auditLog).values(events)
    const first = await q.getMiperHistory(own.id, author)
    expect(first.events).toHaveLength(q.MIPER_HISTORY_PAGE_SIZE)
    expect(first.nextCursor).not.toBeNull()
    const second = await q.getMiperHistory(own.id, author, { cursor: first.nextCursor })
    expect(second.events).toHaveLength(50)
    expect(second.nextCursor).not.toBeNull()
    const third = await q.getMiperHistory(own.id, author, { cursor: second.nextCursor })
    expect(third.events).toHaveLength(20 + own0)
    expect(third.nextCursor).toBeNull()
    const ids = [...first.events, ...second.events, ...third.events].map((event) => event.id)
    expect(new Set(ids).size).toBe(120 + own0)
    // Orden estable: del más nuevo al más viejo, con el id desempatando.
    expect(ids.slice(0, 120)).toEqual([...events].sort((a, b) => (a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt))).map((event) => event.id))
    expect(own0).toBeLessThanOrEqual(30)
  })
  it("un cursor ilegible se rechaza", async () => {
    await expect(q.getMiperHistory(matrixId, author, { cursor: "no-es-un-cursor" })).rejects.toThrow(/No se pudo leer la página siguiente/)
    const wrongShape = Buffer.from(JSON.stringify([1, 2])).toString("base64url")
    await expect(q.getMiperHistory(matrixId, author, { cursor: wrongShape })).rejects.toThrow(/No se pudo leer la página siguiente/)
  })
  it("el historial fuera de alcance rechaza antes de leer", async () => {
    await expect(q.getMiperHistory(matrixId, outsider)).rejects.toThrow(/fuera de alcance/)
    // Ni siquiera un cursor ilegible llega a decodificarse: manda el alcance.
    await expect(q.getMiperHistory(matrixId, outsider, { cursor: "basura" })).rejects.toThrow(/fuera de alcance/)
  })
  it("la cadena de períodos de la faena trae los otros MIPER y excluye el propio", async () => {
    // Una segunda MIPER de la misma faena, en otro período (§8.5). Se crea acá y
    // no en el `beforeAll` para no alterar el conteo de las consultas previas.
    const sibling = await createMiper({ worksiteId: "ws-q", period: 2027, revisionReason: "Período siguiente." }, author)
    const ws = await q.getMiperWorkspace(matrixId, author)
    const ids = ws.siblingMatrices.map((item) => item.id)
    expect(ids).toContain(sibling.id)
    expect(ids).not.toContain(matrixId)
    const other = ws.siblingMatrices.find((item) => item.id === sibling.id)!
    expect(other).toMatchObject({ period: 2027, label: "Borrador" })
    // Ordenadas por período descendente (otras pruebas del archivo pueden haber
    // creado MIPER de la misma faena: se afirma el orden, no la posición).
    const periods = ws.siblingMatrices.map((item) => item.period ?? 0)
    expect(periods).toEqual([...periods].sort((a, b) => b - a))
  })
})
