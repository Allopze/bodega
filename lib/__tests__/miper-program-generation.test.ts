/**
 * Generación del Programa de Trabajo desde las medidas del MIPER (F2, Task 4):
 * el sistema propone agrupaciones y la persona decide crear, asociar o dejar
 * sin actividad. La regla dura: una fila Intolerable o Importante no puede
 * quedar sin actividad (§7.3).
 */
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

const { createMiper } = await import("@/lib/services/miper/matrices")
const entries = await import("@/lib/services/miper/entries")
const program = await import("@/lib/services/miper/program")

const WS = "ws-gen"
const scope = { mode: "some" as const, ids: [WS] }
const editor = { userId: "u-gen", scope, permissions: ["prevention:risk:view", "prevention:risk:edit"] }

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: WS, name: "Faena Generación", code: "GEN" })
  await testDb.insert(schema.users).values({ id: "u-gen", name: "Prevencionista", email: "gen@gen.cl", hashedPassword: "x", isActive: true })
}, 60_000)

/** MIPER del período con una medida por fila; la banda sale de P×C. */
async function matrixWithMeasures(period: number, rows: Array<{ p: number; c: number; description: string }>) {
  const { id } = await createMiper({ worksiteId: WS, period, revisionReason: `Período ${period} para probar la generación.` }, editor)
  const controls: Array<{ entryId: string; controlId: string }> = []
  for (const row of rows) {
    const entry = await entries.saveMiperEntry({ matrixId: id, values: { hazard: `Peligro: ${row.description}`, probability: row.p, consequence: row.c } }, editor)
    const control = await entries.saveMiperControl({
      matrixId: id, entryId: entry.id,
      values: { hierarchy: "administrative", description: row.description, responsibleName: "Supervisor", dueDate: `${period}-06-30` },
    }, editor)
    controls.push({ entryId: entry.id, controlId: control.id })
  }
  return { matrixId: id, controls }
}

const programOf = async (matrixId: string) => (await testDb.select().from(schema.preventionRiskPrograms).where(eq(schema.preventionRiskPrograms.matrixId, matrixId)))[0]!
const actionsOf = (programId: string) => testDb.select().from(schema.preventionRiskProgramActions).where(eq(schema.preventionRiskProgramActions.programId, programId))
const linksOf = (actionId: string) => testDb.select().from(schema.preventionRiskProgramActionControls).where(eq(schema.preventionRiskProgramActionControls.actionId, actionId))

describe("generación del programa desde el MIPER", () => {
  it("no vuelve a proponer las medidas ya vinculadas y agrupa las casi idénticas", async () => {
    const { matrixId, controls } = await matrixWithMeasures(2041, [
      { p: 1, c: 2, description: "Colocar topes de descarga" },
      { p: 1, c: 2, description: "colocar topes de descarga en la pendiente" },
      { p: 1, c: 1, description: "Capacitar en izaje" },
    ])
    const proposed = await program.proposeProgramActions({ matrixId }, editor)
    expect(proposed.measures.map((row) => row.controlId).sort()).toEqual(controls.map((row) => row.controlId).sort())
    expect(proposed.measures.every((row) => row.linkedActionId === null)).toBe(true)
    const group = proposed.groups.find((item) => item.measures.length === 2)
    expect(group?.measures.sort()).toEqual([controls[0]!.controlId, controls[1]!.controlId].sort())
    expect(proposed.groups.find((item) => item.measures.includes(controls[2]!.controlId))?.measures).toHaveLength(1)

    await program.applyProgramGeneration({
      matrixId,
      decisions: [{ controlIds: [controls[0]!.controlId], decision: "create", description: "Colocar topes de descarga", scheduleKind: "once", startsOn: "2041-03-01" }],
    }, editor)
    const after = await program.proposeProgramActions({ matrixId }, editor)
    expect(after.measures.map((row) => row.controlId)).not.toContain(controls[0]!.controlId)
    expect(after.measures).toHaveLength(2)
  })

  it("dejar sin actividad una fila Intolerable o Importante es rechazado con mensaje accionable", async () => {
    const { matrixId, controls } = await matrixWithMeasures(2042, [
      { p: 4, c: 4, description: "Trabajo en altura sin baranda" },
      { p: 2, c: 4, description: "Operación de grúa sin señalero" },
    ])
    await expect(program.applyProgramGeneration({ matrixId, decisions: [{ controlIds: [controls[0]!.controlId], decision: "leave" }] }, editor))
      .rejects.toThrow(/riesgo Intolerable.*no puede quedar sin una actividad/)
    await expect(program.applyProgramGeneration({ matrixId, decisions: [{ controlIds: [controls[1]!.controlId], decision: "leave" }] }, editor))
      .rejects.toThrow(/riesgo Importante/)
    // Nada se aplicó: las dos medidas siguen sin actividad y sin vínculo.
    expect((await program.proposeProgramActions({ matrixId }, editor)).measures).toHaveLength(2)

    const tolerable = await matrixWithMeasures(2043, [{ p: 1, c: 1, description: "Orden y aseo del patio" }])
    await expect(program.applyProgramGeneration({ matrixId: tolerable.matrixId, decisions: [{ controlIds: [tolerable.controls[0]!.controlId], decision: "leave" }] }, editor))
      .resolves.toEqual({ created: 0, linked: 0, left: 1 })
  })

  it("crear respeta el correlativo, asociar reutiliza la actividad y aplicar dos veces no duplica", async () => {
    const { matrixId, controls } = await matrixWithMeasures(2044, [
      { p: 1, c: 2, description: "Instalar baranda" },
      { p: 2, c: 2, description: "Señalizar la zona" },
      { p: 1, c: 1, description: "Charla de cinco minutos" },
    ])
    const created = await program.applyProgramGeneration({
      matrixId,
      decisions: [{ controlIds: [controls[0]!.controlId], decision: "create", description: "Instalar baranda protectora", scheduleKind: "quarterly", startsOn: "2044-01-01" }],
    }, editor)
    expect(created).toEqual({ created: 1, linked: 0, left: 0 })

    const programRow = await programOf(matrixId)
    const [firstAction] = await actionsOf(programRow.id)
    expect(firstAction!.actionNumber).toBe(1)

    // Asociar una segunda medida a la actividad existente: N:M, sin duplicarla.
    const linked = await program.applyProgramGeneration({
      matrixId,
      decisions: [{ controlIds: [controls[1]!.controlId], decision: "link", actionId: firstAction!.id }],
    }, editor)
    expect(linked).toEqual({ created: 0, linked: 1, left: 0 })
    expect((await linksOf(firstAction!.id)).map((row) => row.controlId).sort())
      .toEqual([controls[0]!.controlId, controls[1]!.controlId].sort())

    // Una tercera medida abre la actividad N° 2.
    const second = await program.applyProgramGeneration({
      matrixId,
      decisions: [{ controlIds: [controls[2]!.controlId], decision: "create", description: "Charla de seguridad de cinco minutos", scheduleKind: "once", startsOn: "2044-02-01" }],
    }, editor)
    expect(second.created).toBe(1)
    expect((await actionsOf(programRow.id)).map((row) => row.actionNumber).sort()).toEqual([1, 2])

    // Reaplicar las mismas decisiones no crea vínculos ni actividades nuevas.
    const again = await program.applyProgramGeneration({
      matrixId,
      decisions: [
        { controlIds: [controls[0]!.controlId], decision: "create", description: "Instalar baranda protectora", scheduleKind: "quarterly", startsOn: "2044-01-01" },
        { controlIds: [controls[1]!.controlId], decision: "link", actionId: firstAction!.id },
        { controlIds: [controls[2]!.controlId], decision: "create", description: "Charla de seguridad de cinco minutos", scheduleKind: "once", startsOn: "2044-02-01" },
      ],
    }, editor)
    expect(again).toEqual({ created: 0, linked: 0, left: 0 })
    expect(await actionsOf(programRow.id)).toHaveLength(2)
    expect(await linksOf(firstAction!.id)).toHaveLength(2)
  })

  it("un MIPER en borrador crea actividades pero ninguna ocurrencia", async () => {
    const { matrixId, controls } = await matrixWithMeasures(2045, [{ p: 1, c: 2, description: "Inspección semanal" }])
    await program.applyProgramGeneration({
      matrixId,
      decisions: [{ controlIds: [controls[0]!.controlId], decision: "create", description: "Inspección semanal de andamios", scheduleKind: "monthly", startsOn: "2045-03-01" }],
    }, editor)
    const [action] = await actionsOf((await programOf(matrixId)).id)
    expect(action).toBeDefined()
    expect(await testDb.select().from(schema.preventionRiskProgramOccurrences).where(eq(schema.preventionRiskProgramOccurrences.actionId, action!.id))).toHaveLength(0)
  })
})
