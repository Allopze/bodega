import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const matrices = await import("@/lib/services/miper/matrices")
const { buildMiperSnapshot } = await import("@/lib/services/miper/snapshots")

const scopeA = { mode: "some" as const, ids: ["ws-a"] }
const author = { userId: "u-author", scope: scopeA, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const outsider = { userId: "u-out", scope: { mode: "some" as const, ids: ["ws-b"] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] }

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([{ id: "ws-a", name: "Faena A", code: "A", commune: "Cabrero" }, { id: "ws-b", name: "Faena B", code: "B" }])
  await testDb.insert(schema.users).values([
    { id: "u-author", name: "Autora", email: "a@m.cl", hashedPassword: "x", isActive: true },
    { id: "u-out", name: "Externa", email: "o@m.cl", hashedPassword: "x", isActive: true },
  ])
}, 60_000)

describe("crear MIPER", () => {
  it("crea un borrador por faena y período con el encabezado prellenado", async () => {
    const { id } = await matrices.createMiper({ worksiteId: "ws-a", period: 2026, revisionReason: "Elaboración inicial del período 2026." }, author)
    const [row] = await testDb.select().from(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, id))
    expect(row).toMatchObject({ status: "draft", reviewState: "none", period: 2026, isLegacy: false, worksiteName: "Faena A", companyCommune: "Cabrero", iperCode: "RE-04" })
    expect(row!.elaboratedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await expect(matrices.createMiper({ worksiteId: "ws-a", period: 2026, revisionReason: "Segundo intento del mismo período." }, author)).rejects.toThrow(/Ya existe un MIPER del período 2026/)
  })
  it("no crea fuera del alcance de faenas", async () => {
    await expect(matrices.createMiper({ worksiteId: "ws-a", period: 2027, revisionReason: "Intento desde otra faena." }, outsider)).rejects.toThrow(/fuera de alcance/)
  })
  it("un período nuevo copia filas y medidas de la vigente con ids nuevos", async () => {
    // Fuente sembrada directo en la base: esta prueba no depende del servicio de filas (Task 9).
    const { id: source } = await matrices.createMiper({ worksiteId: "ws-a", period: 2025, revisionReason: "Período anterior para copiar." }, author)
    await testDb.insert(schema.preventionRiskEntries).values({ id: "src-e1", matrixId: source, rowNumber: 1, hazardCode: "R-src", hazard: "Camión", probability: 2, consequence: 4 })
    await testDb.insert(schema.preventionRiskControls).values({ id: "src-c1", riskEntryId: "src-e1", description: "Procedimiento de carga", hierarchy: "administrative", responsibleSnapshot: "Supervisor", dueDate: "2026-12-31", status: "verified", effectivenessStatus: "effective" })
    await testDb.update(schema.preventionRiskMatrices).set({ status: "published", reviewedByUserId: "u-author", approvedByUserId: "u-out" }).where(eq(schema.preventionRiskMatrices.id, source))
    const { id: copy } = await matrices.createMiper({ worksiteId: "ws-a", period: 2028, sourceMatrixId: source, revisionReason: "Renovación anual del período 2028." }, author)
    const copied = await testDb.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.matrixId, copy))
    expect(copied).toHaveLength(1)
    expect(copied[0]!.id).not.toBe("src-e1")
    expect(copied[0]).toMatchObject({ probability: 2, consequence: 4, classification: "important", rowNumber: 1 })
    const controls = await testDb.select().from(schema.preventionRiskControls).where(eq(schema.preventionRiskControls.riskEntryId, copied[0]!.id))
    expect(controls).toEqual([expect.objectContaining({ description: "Procedimiento de carga", status: "implemented", effectivenessStatus: "not_assessed" })])
  })
  it("la copia al período siguiente conserva el orden de las medidas de cada riesgo", async () => {
    // Faena propia: la vigente de «ws-a» ya la publicó la prueba anterior.
    await testDb.insert(schema.worksites).values({ id: "ws-orden", name: "Faena Orden", code: "ORD" })
    const editor = { ...author, scope: { mode: "some" as const, ids: ["ws-orden"] } }
    const { id: source } = await matrices.createMiper({ worksiteId: "ws-orden", period: 2026, revisionReason: "Período con medidas en orden." }, editor)
    await testDb.insert(schema.preventionRiskEntries).values({ id: "ord-e1", matrixId: source, rowNumber: 1, hazardCode: "R-ord", hazard: "Ruido", probability: 2, consequence: 2 })
    // El orden de la foto es `created_at, id`. Los ids van al revés de ese orden y se insertan
    // desordenados: ni el id ni el orden físico de las filas lo reproducen por casualidad.
    const order = ["Encierro acústico", "Mantención del silenciador", "Rotación de turnos", "Pausas de recuperación", "Audiometría anual", "Protector auditivo"]
    const sourceControls = order.map((description, index) => ({
      id: `ord-c${order.length - index}`, riskEntryId: "ord-e1", description, hierarchy: "administrative" as const,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(), updatedAt: "2026-01-01T00:00:00.000Z",
    }))
    await testDb.insert(schema.preventionRiskControls).values([3, 0, 5, 1, 4, 2].map((index) => sourceControls[index]!))
    expect((await buildMiperSnapshot(testDb, source)).entries[0]!.controls.map((control) => control.description)).toEqual(order)
    await testDb.update(schema.preventionRiskMatrices).set({ status: "published", reviewedByUserId: "u-author", approvedByUserId: "u-out" }).where(eq(schema.preventionRiskMatrices.id, source))

    const { id: copy } = await matrices.createMiper({ worksiteId: "ws-orden", period: 2027, sourceMatrixId: source, revisionReason: "Renovación que copia las medidas." }, editor)
    expect((await buildMiperSnapshot(testDb, copy)).entries[0]!.controls.map((control) => control.description)).toEqual(order)
  })
})

describe("encabezado y descarte", () => {
  it("guarda el encabezado con control de versión y rechaza incoherencias", async () => {
    const { id } = await matrices.createMiper({ worksiteId: "ws-a", period: 2030, revisionReason: "Período para probar el encabezado." }, author)
    const header = {
      matrixId: id, expectedVersion: 1, iperCode: "RE-04", elaboratedOn: "2030-01-10", updatedOn: "2030-02-01",
      companyName: "Chome", companyRut: "78.023.530-6", companyAddress: "Lagart 175", companyCommune: "Cabrero", economicActivity: "Transporte",
      adherentNumber: "252086", worksiteName: "Faena A", siteRepresentativeUserId: null, siteRepresentativeName: "Juan Pérez",
      headcountTotal: 3, headcountMale: 2, headcountFemale: 1, headcountOther: 0, participationSummary: "", consultationEvidenceReference: "",
    }
    expect(await matrices.updateMiperHeader(header, author)).toEqual({ version: 2 })
    await expect(matrices.updateMiperHeader(header, author)).rejects.toThrow(/cambió mientras/)
    await expect(matrices.updateMiperHeader({ ...header, expectedVersion: 2, headcountMale: 5 }, author)).rejects.toThrow()
  })
  it("descarta un borrador nunca enviado", async () => {
    const { id } = await matrices.createMiper({ worksiteId: "ws-a", period: 2031, revisionReason: "Borrador que se descartará." }, author)
    await matrices.discardMiperDraft({ matrixId: id, expectedVersion: 1, reason: "Creado por error en otro período." }, author)
    expect(await testDb.select().from(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, id))).toHaveLength(0)
  })
})
