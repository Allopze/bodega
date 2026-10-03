/**
 * Fase D (spec §9): acciones masivas de la MIPER. Cada operación es UNA
 * transacción: una versión vieja, un elemento ajeno, un dato inválido o una
 * persona inactiva abortan todo y no queda nada escrito, ni en las tablas ni en
 * el historial. Las reglas son las del guardado de a uno: D5, fechas de
 * calendario, personas activas, diccionario de la faena y medida «propuesta».
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, asc, eq, inArray } from "drizzle-orm"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { taskKeyOf } from "@/lib/prevention/miper/matrix-tree"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))

const { createMiper } = await import("@/lib/services/miper/matrices")
const entries = await import("@/lib/services/miper/entries")
const bulk = await import("@/lib/services/miper/bulk")
const { buildMiperSnapshot } = await import("@/lib/services/miper/snapshots")

const author = { userId: "u-a", scope: { mode: "some" as const, ids: ["ws-b"] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const outsider = { userId: "u-x", scope: { mode: "some" as const, ids: ["ws-x"] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
const viewer = { userId: "u-a", scope: { mode: "some" as const, ids: ["ws-b"] }, permissions: ["prevention:risk:view"] }
const OUT_OF_SCOPE = "Registro preventivo no encontrado o fuera de alcance."
let matrixId = ""

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values([{ id: "ws-b", name: "Faena B", code: "B" }, { id: "ws-x", name: "Faena X", code: "X" }])
  await testDb.insert(schema.users).values([
    { id: "u-a", name: "Autora", email: "a@b.cl", hashedPassword: "x", isActive: true },
    { id: "u-x", name: "Externa", email: "x@b.cl", hashedPassword: "x", isActive: true },
    { id: "u-off", name: "Inactiva", email: "off@b.cl", hashedPassword: "x", isActive: false },
  ])
  matrixId = (await createMiper({ worksiteId: "ws-b", period: 2026, revisionReason: "Período para las acciones masivas." }, author)).id
}, 60_000)

let nextRow = 100
/** N riesgos Moderados, «No» controlados, sembrados directo: lo que se prueba es el lote, no el alta. */
async function seedEntries(prefix: string, count: number, matrix = matrixId) {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`, matrixId: matrix, rowNumber: nextRow++, hazardCode: `R-${prefix}-${index + 1}`,
    hazard: `Peligro ${prefix} ${index + 1}`, probability: 2, consequence: 2, controlledStatus: "no",
  }))
  await testDb.insert(schema.preventionRiskEntries).values(rows)
  return rows.map((row) => ({ entryId: row.id, expectedVersion: 1 }))
}
const auditCount = async () => (await testDb.select({ id: schema.auditLog.id }).from(schema.auditLog).where(eq(schema.auditLog.entityId, matrixId))).length
const controlsOf = (entryIds: string[]) => testDb.select().from(schema.preventionRiskControls).where(inArray(schema.preventionRiskControls.riskEntryId, entryIds)).orderBy(asc(schema.preventionRiskControls.id))
const entriesOf = (entryIds: string[]) => testDb.select().from(schema.preventionRiskEntries).where(inArray(schema.preventionRiskEntries.id, entryIds)).orderBy(asc(schema.preventionRiskEntries.rowNumber))
const MEASURE = { hierarchy: "administrative" as const, description: "Charla de trasvasije seguro", responsibleUserId: "u-a", isExisting: false, dueDate: "2026-12-31" }

describe("acciones masivas de la MIPER (Fase D)", () => {
  it("criterio D: una medida se aplica a 40 riesgos en una sola operación; nace propuesta, con su historial por riesgo", async () => {
    const items = await seedEntries("cuarenta", 40)
    const before = await auditCount()
    const result = await bulk.bulkAddMiperControl({ matrixId, items, values: MEASURE }, author)
    expect(result.controls).toHaveLength(40)
    const created = await controlsOf(items.map((item) => item.entryId))
    expect(created).toHaveLength(40)
    expect(new Set(created.map((control) => control.riskEntryId)).size).toBe(40)
    for (const control of created) {
      expect(control).toMatchObject({ description: "Charla de trasvasije seguro", hierarchy: "administrative", responsibleUserId: "u-a", responsibleSnapshot: "Autora", isExisting: false, dueDate: "2026-12-31", verificationFrequency: null, status: "proposed", version: 1 })
    }
    // Agregar una medida no cambia la versión del riesgo, igual que en el editor.
    expect((await entriesOf(items.map((item) => item.entryId))).every((entry) => entry.version === 1)).toBe(true)
    const log = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, matrixId))
    const bulkRows = log.filter((row) => row.reason === "Edición masiva" && (JSON.parse(row.newState ?? "{}") as { changeType?: string }).changeType === "control_created")
    expect(bulkRows).toHaveLength(40)
    expect(await auditCount()).toBe(before + 40)
  })

  it("una versión vieja aborta todo: ni medidas, ni cambios, ni historial", async () => {
    const items = await seedEntries("vieja", 40)
    // Otra pestaña guardó el riesgo 17 después de que la persona lo vio.
    await entries.saveMiperEntry({ matrixId, entryId: "vieja-17", expectedVersion: 1, values: { risk: "Inhalación de vapores" } }, author)
    const before = await auditCount()
    await expect(bulk.bulkAddMiperControl({ matrixId, items, values: MEASURE }, author))
      .rejects.toThrow("1 riesgo cambió mientras editabas; recarga la matriz para ver los cambios de la otra persona.")
    await expect(bulk.bulkPatchMiperEntries({ matrixId, items, values: { controlledStatus: "yes", position: "Bodeguero" } }, author))
      .rejects.toThrow("1 riesgo cambió mientras editabas")
    expect(await controlsOf(items.map((item) => item.entryId))).toEqual([])
    const rows = await entriesOf(items.map((item) => item.entryId))
    expect(rows.filter((row) => row.controlledStatus === "yes" || row.positionId !== null)).toEqual([])
    expect(rows.find((row) => row.id === "vieja-17")!.version).toBe(2)
    expect(await auditCount()).toBe(before)
  })

  it("alcance: otra faena, sólo lectura y un riesgo de otra MIPER se rechazan sin escribir nada", async () => {
    const items = await seedEntries("alcance", 2)
    const other = (await createMiper({ worksiteId: "ws-b", period: 2027, revisionReason: "Otra MIPER de la misma faena." }, author)).id
    const [foreign] = await seedEntries("ajena", 1, other)
    const before = await auditCount()
    await expect(bulk.bulkPatchMiperEntries({ matrixId, items, values: { controlledStatus: "yes" } }, outsider)).rejects.toThrow(OUT_OF_SCOPE)
    await expect(bulk.bulkAddMiperControl({ matrixId, items, values: MEASURE }, viewer)).rejects.toThrow(OUT_OF_SCOPE)
    await expect(bulk.bulkPatchMiperEntries({ matrixId, items: [...items, foreign!], values: { controlledStatus: "yes" } }, author))
      .rejects.toThrow("1 riesgo no existe en esta MIPER; recarga la matriz.")
    expect((await entriesOf([...items, foreign!].map((item) => item.entryId))).map((row) => row.controlledStatus)).toEqual(["no", "no", "no"])
    expect(await auditCount()).toBe(before)
  })

  it("una MIPER de la metodología anterior o reemplazada no admite cambios en lote", async () => {
    // MIPER propias: la de las demás pruebas sigue editable.
    const legacy = (await createMiper({ worksiteId: "ws-b", period: 2024, revisionReason: "MIPER de la metodología anterior." }, author)).id
    const superseded = (await createMiper({ worksiteId: "ws-b", period: 2023, revisionReason: "MIPER ya reemplazada por otra." }, author)).id
    await testDb.update(schema.preventionRiskMatrices).set({ isLegacy: true }).where(eq(schema.preventionRiskMatrices.id, legacy))
    await testDb.update(schema.preventionRiskMatrices).set({ status: "superseded", reviewedByUserId: "u-a", approvedByUserId: "u-x" }).where(eq(schema.preventionRiskMatrices.id, superseded))
    const legacyItems = await seedEntries("legacy", 1, legacy)
    const supersededItems = await seedEntries("reemplazada", 1, superseded)
    await expect(bulk.bulkPatchMiperEntries({ matrixId: legacy, items: legacyItems, values: { controlledStatus: "yes" } }, author)).rejects.toThrow(/solo lectura/)
    await expect(bulk.bulkAddMiperControl({ matrixId: legacy, items: legacyItems, values: MEASURE }, author)).rejects.toThrow(/solo lectura/)
    await expect(bulk.bulkPatchMiperEntries({ matrixId: superseded, items: supersededItems, values: { controlledStatus: "yes" } }, author)).rejects.toThrow(/reemplazada/)
    await expect(bulk.bulkAddMiperControl({ matrixId: superseded, items: supersededItems, values: MEASURE }, author)).rejects.toThrow(/reemplazada/)
    expect(await controlsOf([...legacyItems, ...supersededItems].map((item) => item.entryId))).toEqual([])
    expect((await entriesOf([...legacyItems, ...supersededItems].map((item) => item.entryId))).map((row) => row.controlledStatus)).toEqual(["no", "no"])
  })

  it("tope: 301 elementos se rechazan antes de abrir la transacción", async () => {
    const items = Array.from({ length: 301 }, (_, index) => ({ entryId: `cualquiera-${index}`, expectedVersion: 1 }))
    await expect(bulk.bulkPatchMiperEntries({ matrixId, items, values: { controlledStatus: "yes" } }, author)).rejects.toThrow(/hasta 300 riesgos/)
    await expect(bulk.bulkUpdateMiperControls({ matrixId, items: items.map((item, index) => ({ controlId: `c-${index}`, expectedVersion: 1 })), patch: { dueDate: "2026-12-31" } }, author))
      .rejects.toThrow(/hasta 300 medidas/)
  })

  it("contexto en lote: usa el diccionario de la faena, nunca toca P×C y deja una entrada por riesgo con el motivo «Edición masiva»", async () => {
    const items = await seedEntries("contexto", 3)
    // La faena ya tiene la actividad escrita de otra forma: se reutiliza, como en el editor.
    await entries.saveMiperEntry({ matrixId, values: { activity: "Bodega de químicos", task: "Recepción" } }, author)
    await expect(bulk.bulkPatchMiperEntries({ matrixId, items, values: { probability: 4 } }, author)).rejects.toThrow()
    const result = await bulk.bulkPatchMiperEntries({ matrixId, items, values: { activity: "BODEGA DE QUIMICOS", task: "Trasvasije de solventes", position: "Bodeguero" } }, author)
    expect(result.entries).toEqual(items.map((item) => ({ id: item.entryId, version: 2 })))
    const snapshot = (await buildMiperSnapshot(testDb, matrixId)).entries.filter((entry) => entry.id.startsWith("contexto-"))
    expect(snapshot.map((entry) => [entry.activity, entry.task, entry.position, entry.probability, entry.consequence, entry.classification])).toEqual(
      Array.from({ length: 3 }, () => ["Bodega de químicos", "Trasvasije de solventes", "Bodeguero", 2, 2, "moderate"]))
    // La clave de la tarea que calcula el cliente con lo escrito es la misma que la de los nombres del diccionario.
    expect(taskKeyOf(snapshot[0]!)).toBe(taskKeyOf({ activity: "BODEGA DE QUIMICOS", task: "Trasvasije de solventes" }))
    const log = await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, matrixId), eq(schema.auditLog.reason, "Edición masiva")))
    const mine = log.map((row) => ({ before: JSON.parse(row.oldState ?? "{}") as Record<string, unknown>, after: JSON.parse(row.newState ?? "{}") as Record<string, unknown> }))
      .filter(({ after }) => String(after.objectId).startsWith("contexto-"))
    expect(mine.map(({ after }) => [after.changeType, after.objectId]).sort()).toEqual(items.map((item) => ["entry_updated", item.entryId]))
    expect(mine[0]!.before).toMatchObject({ processId: null, taskId: null, positionId: null })
    expect(mine[0]!.after).toMatchObject({ processId: expect.any(String), taskId: expect.any(String), positionId: expect.any(String) })
  })

  it("D5 en lote: el plazo no entra a una existente, pasar a existente borra el plazo, y lo que el lote no trae se conserva", async () => {
    const [pendingEntry, existingEntry] = await seedEntries("d5", 2)
    const pending = await entries.saveMiperControl({ matrixId, entryId: pendingEntry!.entryId, values: { hierarchy: "engineering", description: "Extracción localizada", responsibleName: "Supervisor de turno", dueDate: "2026-11-30" } }, author)
    const existing = await entries.saveMiperControl({ matrixId, entryId: existingEntry!.entryId, values: { hierarchy: "ppe", description: "Respirador con filtro", responsibleName: "Bodeguero", isExisting: true, verificationFrequency: "Trimestral" } }, author)
    const items = [{ controlId: pending.id, expectedVersion: 1 }, { controlId: existing.id, expectedVersion: 1 }]
    const stored = async () => Object.fromEntries((await testDb.select().from(schema.preventionRiskControls).where(inArray(schema.preventionRiskControls.id, [pending.id, existing.id])))
      .map((row) => [row.id === pending.id ? "pending" : "existing", row]))

    await bulk.bulkUpdateMiperControls({ matrixId, items, patch: { dueDate: "2027-01-15" } }, author)
    let rows = await stored()
    expect(rows.pending).toMatchObject({ dueDate: "2027-01-15", isExisting: false, responsibleSnapshot: "Supervisor de turno", version: 2 })
    expect(rows.existing).toMatchObject({ dueDate: null, isExisting: true, verificationFrequency: "Trimestral", responsibleSnapshot: "Bodeguero", version: 2 })

    await bulk.bulkUpdateMiperControls({ matrixId, items: [{ controlId: pending.id, expectedVersion: 2 }], patch: { isExisting: true, verificationFrequency: " Semestral " } }, author)
    await bulk.bulkUpdateMiperControls({ matrixId, items: [{ controlId: existing.id, expectedVersion: 2 }], patch: { isExisting: false, dueDate: "2027-02-28" } }, author)
    rows = await stored()
    expect(rows.pending).toMatchObject({ isExisting: true, verificationFrequency: "Semestral", dueDate: null })
    expect(rows.existing).toMatchObject({ isExisting: false, verificationFrequency: null, dueDate: "2027-02-28" })

    // Una medida en lote, ya implementada: tampoco lleva plazo aunque el pedido lo traiga.
    const [extra] = await seedEntries("d5-alta", 1)
    await bulk.bulkAddMiperControl({ matrixId, items: [extra!], values: { ...MEASURE, isExisting: true, verificationFrequency: "Mensual" } }, author)
    expect((await controlsOf([extra!.entryId]))[0]).toMatchObject({ isExisting: true, verificationFrequency: "Mensual", dueDate: null, status: "proposed" })

    const log = await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, matrixId), eq(schema.auditLog.reason, "Edición masiva")))
    const toExisting = log.map((row) => ({ before: JSON.parse(row.oldState ?? "{}") as Record<string, unknown>, after: JSON.parse(row.newState ?? "{}") as Record<string, unknown> }))
      .find(({ after }) => after.objectId === pending.id && after.isExisting === true)!
    expect(toExisting.before).toMatchObject({ isExisting: false, dueDate: "2027-01-15", verificationFrequency: null })
    expect(toExisting.after).toMatchObject({ changeType: "control_updated", isExisting: true, dueDate: null, verificationFrequency: "Semestral" })
  })

  it("fechas de calendario, personas activas y versiones de medidas también abortan todo el lote", async () => {
    const [a, b] = await seedEntries("reglas", 2)
    const first = await entries.saveMiperControl({ matrixId, entryId: a!.entryId, values: { hierarchy: "administrative", description: "Hoja de seguridad a la vista", responsibleName: "Bodeguero", dueDate: "2026-11-30" } }, author)
    const second = await entries.saveMiperControl({ matrixId, entryId: b!.entryId, values: { hierarchy: "administrative", description: "Hoja de seguridad a la vista", responsibleName: "Bodeguero", dueDate: "2026-11-30" } }, author)
    const items = [{ controlId: first.id, expectedVersion: 1 }, { controlId: second.id, expectedVersion: 1 }]
    const before = await auditCount()
    await expect(bulk.bulkUpdateMiperControls({ matrixId, items, patch: { dueDate: "2026-02-31" } }, author)).rejects.toThrow()
    await expect(bulk.bulkUpdateMiperControls({ matrixId, items, patch: { responsible: { kind: "user", userId: "u-off" } } }, author)).rejects.toThrow("La persona responsable no existe o está inactiva.")
    await expect(bulk.bulkAddMiperControl({ matrixId, items: [a!, b!], values: { ...MEASURE, responsibleUserId: "u-off" } }, author)).rejects.toThrow("La persona responsable no existe o está inactiva.")
    await entries.saveMiperControl({ matrixId, entryId: b!.entryId, controlId: second.id, expectedVersion: 1, values: { hierarchy: "administrative", description: "Hoja de seguridad plastificada", responsibleName: "Bodeguero", dueDate: "2026-11-30" } }, author)
    const afterEdit = await auditCount()
    await expect(bulk.bulkUpdateMiperControls({ matrixId, items, patch: { responsible: { kind: "text", name: "Jefe de bodega" } } }, author))
      .rejects.toThrow("1 medida cambió mientras editabas; recarga la matriz para ver los cambios de la otra persona.")
    const rows = await controlsOf([a!.entryId, b!.entryId])
    expect(rows.map((row) => [row.responsibleSnapshot, row.dueDate])).toEqual([["Bodeguero", "2026-11-30"], ["Bodeguero", "2026-11-30"]])
    expect(rows.filter((row) => row.riskEntryId === a!.entryId)).toHaveLength(1)
    expect(afterEdit).toBe(before + 1)
    expect(await auditCount()).toBe(afterEdit)
  })

  it("una clave que llega sin valor (`undefined`) no es un cambio: sola se rechaza, y junto a otra no borra lo que ya había", async () => {
    // El esquema cuenta la clave presente aunque su valor sea `undefined`. Si llegara a
    // `toColumns`, `{ activity: undefined }` dejaría sin actividad a todos los riesgos.
    const [first, second] = await seedEntries("vacio", 2)
    await entries.saveMiperEntry({ matrixId, entryId: first!.entryId, expectedVersion: 1, values: { activity: "Bodega de químicos" } }, author)
    const control = await entries.saveMiperControl({ matrixId, entryId: second!.entryId, values: { hierarchy: "administrative", description: "Rotulado de envases", responsibleName: "Bodeguero", dueDate: "2026-11-30" } }, author)
    const items = [{ entryId: first!.entryId, expectedVersion: 2 }, second!]
    const before = await auditCount()
    await expect(bulk.bulkPatchMiperEntries({ matrixId, items, values: { activity: undefined } }, author))
      .rejects.toThrow("No hay cambios que aplicar a los riesgos: elige qué cambiar.")
    await expect(bulk.bulkPatchMiperEntries({ matrixId, items, values: { isRoutine: undefined, controlledStatus: undefined } }, author))
      .rejects.toThrow("No hay cambios que aplicar a los riesgos: elige qué cambiar.")
    await expect(bulk.bulkUpdateMiperControls({ matrixId, items: [{ controlId: control.id, expectedVersion: 1 }], patch: { dueDate: undefined, responsible: undefined } }, author))
      .rejects.toThrow("No hay cambios que aplicar a las medidas: elige el responsable, el plazo o si ya está implementada.")
    expect((await entriesOf([first!.entryId, second!.entryId])).map((row) => [row.version, row.processId !== null, row.controlledStatus])).toEqual([[2, true, "no"], [1, false, "no"]])
    expect((await controlsOf([second!.entryId]))[0]).toMatchObject({ version: 1, dueDate: "2026-11-30", responsibleSnapshot: "Bodeguero" })
    expect(await auditCount()).toBe(before)

    // Junto a un cambio de verdad, la clave sin valor se ignora: cambia «¿controlado?» y la actividad se conserva.
    const result = await bulk.bulkPatchMiperEntries({ matrixId, items, values: { activity: undefined, controlledStatus: "yes" } }, author)
    expect(result.entries).toEqual([{ id: first!.entryId, version: 3 }, { id: second!.entryId, version: 2 }])
    expect((await entriesOf([first!.entryId, second!.entryId])).map((row) => [row.processId !== null, row.controlledStatus])).toEqual([[true, "yes"], [false, "yes"]])
    const log = await testDb.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, matrixId), eq(schema.auditLog.reason, "Edición masiva")))
    const mine = log.map((row) => JSON.parse(row.newState ?? "{}") as Record<string, unknown>).filter((after) => String(after.objectId).startsWith("vacio-"))
    expect(mine).toHaveLength(2)
    for (const after of mine) {
      expect(after).toMatchObject({ changeType: "entry_updated", controlledStatus: "yes" })
      expect(after).not.toHaveProperty("processId")
    }
  })
})
