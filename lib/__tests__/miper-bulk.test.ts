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
const auditCount = async (matrix = matrixId) => (await testDb.select({ id: schema.auditLog.id }).from(schema.auditLog).where(eq(schema.auditLog.entityId, matrix))).length
/** La marca `updated_at` de la matriz, que la bandeja usa para «cambios sin enviar». */
const matrixUpdatedAt = async () => (await testDb.select({ updatedAt: schema.preventionRiskMatrices.updatedAt }).from(schema.preventionRiskMatrices).where(eq(schema.preventionRiskMatrices.id, matrixId)))[0]!.updatedAt
const controlsOf = (entryIds: string[]) => testDb.select().from(schema.preventionRiskControls).where(inArray(schema.preventionRiskControls.riskEntryId, entryIds)).orderBy(asc(schema.preventionRiskControls.id))
const entriesOf = (entryIds: string[]) => testDb.select().from(schema.preventionRiskEntries).where(inArray(schema.preventionRiskEntries.id, entryIds)).orderBy(asc(schema.preventionRiskEntries.rowNumber))
const MEASURE = { hierarchy: "administrative" as const, description: "Charla de trasvasije seguro", responsibleUserId: "u-a", isExisting: false, dueDate: "2026-12-31" }

describe("acciones masivas de la MIPER (Fase D)", () => {
  it("criterio D: una medida se aplica a 40 riesgos en una sola operación; nace propuesta, con su historial por riesgo", async () => {
    const items = await seedEntries("cuarenta", 40)
    const before = await auditCount()
    const touched = await matrixUpdatedAt()
    const result = await bulk.bulkAddMiperControl({ matrixId, items, values: MEASURE }, author)
    expect(result.controls).toHaveLength(40)
    const created = await controlsOf(items.map((item) => item.entryId))
    expect(created).toHaveLength(40)
    // Una sola marca en la matriz, con la hora de las escrituras del lote.
    expect(new Set(created.map((control) => control.updatedAt)).size).toBe(1)
    expect(await matrixUpdatedAt()).toBe(created[0]!.updatedAt)
    expect(created[0]!.updatedAt).not.toBe(touched)
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
    const touched = await matrixUpdatedAt()
    await expect(bulk.bulkAddMiperControl({ matrixId, items, values: MEASURE }, author))
      .rejects.toThrow("1 riesgo cambió mientras editabas; recarga la matriz para ver los cambios de la otra persona.")
    await expect(bulk.bulkPatchMiperEntries({ matrixId, items, values: { controlledStatus: "yes", position: "Bodeguero" } }, author))
      .rejects.toThrow("1 riesgo cambió mientras editabas")
    expect(await controlsOf(items.map((item) => item.entryId))).toEqual([])
    const rows = await entriesOf(items.map((item) => item.entryId))
    expect(rows.filter((row) => row.controlledStatus === "yes" || row.positionId !== null)).toEqual([])
    expect(rows.find((row) => row.id === "vieja-17")!.version).toBe(2)
    // Los otros 39 siguen en la versión que vio la persona.
    expect(rows.filter((row) => row.version !== 1).map((row) => row.id)).toEqual(["vieja-17"])
    expect(await auditCount()).toBe(before)
    expect(await matrixUpdatedAt()).toBe(touched)
  })

  it("alcance: otra faena, sólo lectura y un riesgo o una medida de otra MIPER se rechazan sin escribir nada", async () => {
    const items = await seedEntries("alcance", 2)
    const other = (await createMiper({ worksiteId: "ws-b", period: 2027, revisionReason: "Otra MIPER de la misma faena." }, author)).id
    const [foreign] = await seedEntries("ajena", 1, other)
    const spillTray = { hierarchy: "engineering" as const, description: "Bandeja antiderrames", responsibleName: "Bodeguero", dueDate: "2026-11-30" }
    const own = await entries.saveMiperControl({ matrixId, entryId: items[0]!.entryId, values: spillTray }, author)
    const alien = await entries.saveMiperControl({ matrixId: other, entryId: foreign!.entryId, values: spillTray }, author)
    const ownItems = [{ controlId: own.id, expectedVersion: 1 }]
    const patch = { dueDate: "2027-06-30" }
    const before = await auditCount()
    const otherBefore = await auditCount(other)
    await expect(bulk.bulkPatchMiperEntries({ matrixId, items, values: { controlledStatus: "yes" } }, outsider)).rejects.toThrow(OUT_OF_SCOPE)
    await expect(bulk.bulkAddMiperControl({ matrixId, items, values: MEASURE }, viewer)).rejects.toThrow(OUT_OF_SCOPE)
    await expect(bulk.bulkUpdateMiperControls({ matrixId, items: ownItems, patch }, outsider)).rejects.toThrow(OUT_OF_SCOPE)
    await expect(bulk.bulkUpdateMiperControls({ matrixId, items: ownItems, patch }, viewer)).rejects.toThrow(OUT_OF_SCOPE)
    await expect(bulk.bulkPatchMiperEntries({ matrixId, items: [...items, foreign!], values: { controlledStatus: "yes" } }, author))
      .rejects.toThrow("1 riesgo no existe en esta MIPER; recarga la matriz.")
    await expect(bulk.bulkAddMiperControl({ matrixId, items: [...items, foreign!], values: MEASURE }, author))
      .rejects.toThrow("1 riesgo no existe en esta MIPER; recarga la matriz.")
    await expect(bulk.bulkUpdateMiperControls({ matrixId, items: [...ownItems, { controlId: alien.id, expectedVersion: 1 }], patch }, author))
      .rejects.toThrow("1 medida no existe en esta MIPER; recarga la matriz.")
    expect((await entriesOf([...items, foreign!].map((item) => item.entryId))).map((row) => [row.controlledStatus, row.version])).toEqual([["no", 1], ["no", 1], ["no", 1]])
    // Sólo las dos medidas de la preparación, intactas: ninguna nueva y ningún plazo cambiado.
    expect(Object.fromEntries((await controlsOf([...items, foreign!].map((item) => item.entryId))).map((row) => [row.id, [row.dueDate, row.version]])))
      .toEqual({ [own.id]: ["2026-11-30", 1], [alien.id]: ["2026-11-30", 1] })
    expect(await auditCount()).toBe(before)
    expect(await auditCount(other)).toBe(otherBefore)
  })

  it("una MIPER de la metodología anterior o reemplazada no admite cambios en lote", async () => {
    // MIPER propias: la de las demás pruebas sigue editable.
    const legacy = (await createMiper({ worksiteId: "ws-b", period: 2024, revisionReason: "MIPER de la metodología anterior." }, author)).id
    const superseded = (await createMiper({ worksiteId: "ws-b", period: 2023, revisionReason: "MIPER ya reemplazada por otra." }, author)).id
    await testDb.update(schema.preventionRiskMatrices).set({ isLegacy: true }).where(eq(schema.preventionRiskMatrices.id, legacy))
    await testDb.update(schema.preventionRiskMatrices).set({ status: "superseded", reviewedByUserId: "u-a", approvedByUserId: "u-x" }).where(eq(schema.preventionRiskMatrices.id, superseded))
    const legacyItems = await seedEntries("legacy", 1, legacy)
    const supersededItems = await seedEntries("reemplazada", 1, superseded)
    // Sembradas directo: el editor ya no deja agregar medidas a estas MIPER.
    await testDb.insert(schema.preventionRiskControls).values([
      { id: "legacy-control", riskEntryId: legacyItems[0]!.entryId, hierarchy: "administrative", description: "Procedimiento escrito", dueDate: "2026-11-30" },
      { id: "reemplazada-control", riskEntryId: supersededItems[0]!.entryId, hierarchy: "administrative", description: "Procedimiento escrito", dueDate: "2026-11-30" },
    ])
    await expect(bulk.bulkPatchMiperEntries({ matrixId: legacy, items: legacyItems, values: { controlledStatus: "yes" } }, author)).rejects.toThrow(/solo lectura/)
    await expect(bulk.bulkAddMiperControl({ matrixId: legacy, items: legacyItems, values: MEASURE }, author)).rejects.toThrow(/solo lectura/)
    await expect(bulk.bulkPatchMiperEntries({ matrixId: superseded, items: supersededItems, values: { controlledStatus: "yes" } }, author)).rejects.toThrow(/reemplazada/)
    await expect(bulk.bulkAddMiperControl({ matrixId: superseded, items: supersededItems, values: MEASURE }, author)).rejects.toThrow(/reemplazada/)
    await expect(bulk.bulkUpdateMiperControls({ matrixId: legacy, items: [{ controlId: "legacy-control", expectedVersion: 1 }], patch: { dueDate: "2027-06-30" } }, author)).rejects.toThrow(/solo lectura/)
    await expect(bulk.bulkUpdateMiperControls({ matrixId: superseded, items: [{ controlId: "reemplazada-control", expectedVersion: 1 }], patch: { dueDate: "2027-06-30" } }, author)).rejects.toThrow(/reemplazada/)
    expect((await controlsOf([...legacyItems, ...supersededItems].map((item) => item.entryId))).map((row) => [row.id, row.dueDate, row.version]))
      .toEqual([["legacy-control", "2026-11-30", 1], ["reemplazada-control", "2026-11-30", 1]])
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
    await expect(bulk.bulkPatchMiperEntries({ matrixId, items, values: { probability: 4 } }, author))
      .rejects.toMatchObject({ issues: [{ code: "unrecognized_keys", keys: ["probability"], path: ["values"] }] })
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

    // A la existente D5 le vacía el plazo y no le queda nada que cambiar: no se escribe, no sube de
    // versión (no hace chocar a quien la edita) y no viene en el resultado.
    const first = await bulk.bulkUpdateMiperControls({ matrixId, items, patch: { dueDate: "2027-01-15" } }, author)
    expect(first.controls).toEqual([{ id: pending.id, version: 2 }])
    let rows = await stored()
    expect(rows.pending).toMatchObject({ dueDate: "2027-01-15", isExisting: false, responsibleSnapshot: "Supervisor de turno", version: 2 })
    expect(rows.existing).toMatchObject({ dueDate: null, isExisting: true, verificationFrequency: "Trimestral", responsibleSnapshot: "Bodeguero", version: 1 })

    await bulk.bulkUpdateMiperControls({ matrixId, items: [{ controlId: pending.id, expectedVersion: 2 }], patch: { isExisting: true, verificationFrequency: " Semestral " } }, author)
    await bulk.bulkUpdateMiperControls({ matrixId, items: [{ controlId: existing.id, expectedVersion: 1 }], patch: { isExisting: false, dueDate: "2027-02-28" } }, author)
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
    // La existente sólo tiene la entrada de cuando pasó a «por implementar».
    expect(log.map((row) => JSON.parse(row.newState ?? "{}") as Record<string, unknown>).filter((after) => after.objectId === existing.id)).toHaveLength(1)
  })

  it("fechas de calendario, personas activas y versiones de medidas también abortan todo el lote", async () => {
    const [a, b] = await seedEntries("reglas", 2)
    const first = await entries.saveMiperControl({ matrixId, entryId: a!.entryId, values: { hierarchy: "administrative", description: "Hoja de seguridad a la vista", responsibleName: "Bodeguero", dueDate: "2026-11-30" } }, author)
    const second = await entries.saveMiperControl({ matrixId, entryId: b!.entryId, values: { hierarchy: "administrative", description: "Hoja de seguridad a la vista", responsibleName: "Bodeguero", dueDate: "2026-11-30" } }, author)
    const items = [{ controlId: first.id, expectedVersion: 1 }, { controlId: second.id, expectedVersion: 1 }]
    const before = await auditCount()
    await expect(bulk.bulkUpdateMiperControls({ matrixId, items, patch: { dueDate: "2026-02-31" } }, author))
      .rejects.toMatchObject({ issues: [{ path: ["patch", "dueDate"], message: "Fecha inválida" }] })
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

  it("lo que el lote ya escribió se deshace si algo falla después: ni la actividad nueva en el diccionario, ni cambios, ni marca", async () => {
    await testDb.insert(schema.preventionRiskFactors).values({ id: "factor-baja", code: "factor_baja", name: "Factor dado de baja", isActive: false })
    const items = await seedEntries("deshacer", 2)
    const before = await auditCount()
    const touched = await matrixUpdatedAt()
    // `toColumns` resuelve primero la actividad (la inserta en el diccionario) y recién después rechaza el factor inactivo.
    await expect(bulk.bulkPatchMiperEntries({ matrixId, items, values: { activity: "Limpieza de derrames", riskFactorId: "factor-baja" } }, author))
      .rejects.toThrow("El factor de riesgo no existe o está desactivado en el catálogo.")
    expect(await testDb.select().from(schema.preventionRiskProcesses).where(eq(schema.preventionRiskProcesses.name, "Limpieza de derrames"))).toEqual([])
    expect((await entriesOf(items.map((item) => item.entryId))).map((row) => [row.version, row.processId, row.riskFactorId])).toEqual([[1, null, null], [1, null, null]])
    expect(await auditCount()).toBe(before)
    expect(await matrixUpdatedAt()).toBe(touched)
  })

  it("un elemento que ya está como lo pide el lote no se escribe: ni versión, ni historial, ni marca en la matriz", async () => {
    const [already, other] = await seedEntries("igual", 2)
    // El riesgo 1 ya está «Sí» controlado (escrito directo, sin subir la versión).
    await testDb.update(schema.preventionRiskEntries).set({ controlledStatus: "yes" }).where(eq(schema.preventionRiskEntries.id, already!.entryId))
    const existing = await entries.saveMiperControl({ matrixId, entryId: other!.entryId, values: { hierarchy: "ppe", description: "Guantes de nitrilo", responsibleName: "Bodeguero", isExisting: true, verificationFrequency: "Mensual" } }, author)
    const before = await auditCount()
    const touched = await matrixUpdatedAt()

    // Nada cambia: «Sí» a un riesgo que ya lo es; un plazo a una existente (D5 lo vacía) con el responsable que ya tiene.
    expect(await bulk.bulkPatchMiperEntries({ matrixId, items: [already!], values: { controlledStatus: "yes" } }, author)).toEqual({ entries: [] })
    expect(await bulk.bulkUpdateMiperControls({ matrixId, items: [{ controlId: existing.id, expectedVersion: 1 }], patch: { dueDate: "2027-03-31", responsible: { kind: "text", name: "Bodeguero" } } }, author))
      .toEqual({ controls: [] })
    expect((await entriesOf([already!.entryId]))[0]!.version).toBe(1)
    expect((await controlsOf([other!.entryId]))[0]).toMatchObject({ version: 1, dueDate: null, responsibleSnapshot: "Bodeguero" })
    expect(await auditCount()).toBe(before)
    expect(await matrixUpdatedAt()).toBe(touched)

    // Mezclado: se escribe y se devuelve sólo el que cambia; el otro conserva su versión y no deja historial.
    const mixed = await bulk.bulkPatchMiperEntries({ matrixId, items: [already!, other!], values: { controlledStatus: "yes" } }, author)
    expect(mixed.entries).toEqual([{ id: other!.entryId, version: 2 }])
    expect((await entriesOf([already!.entryId, other!.entryId])).map((row) => [row.version, row.controlledStatus])).toEqual([[1, "yes"], [2, "yes"]])
    expect(await auditCount()).toBe(before + 1)
    expect(await matrixUpdatedAt()).not.toBe(touched)
  })

  it("los riesgos del lote quedan bloqueados desde que se leen: verificar un control sube su versión sin bloquear la matriz", async () => {
    // `verifyRiskControl` sube la versión del riesgo SIN `lockMatrix`: bloquear la matriz no alcanza.
    // La sonda corre al empezar la primera escritura del lote (el puesto nuevo en el diccionario; la
    // medida nueva) y anota si ESTA transacción ya tiene bloqueados (`FOR UPDATE`) los riesgos del
    // lote: un riesgo bloqueado lleva en `xmax` el id de la transacción que lo bloqueó.
    await pg.exec(`
      CREATE TABLE bulk_lock_probe (locked boolean);
      CREATE FUNCTION bulk_lock_probe_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO bulk_lock_probe SELECT bool_and(xmax::text::bigint = txid_current() % 4294967296) FROM prevention_risk_entries WHERE id LIKE 'cerrojo-%';
        RETURN NULL;
      END $$;
      CREATE TRIGGER bulk_lock_probe BEFORE INSERT ON prevention_risk_positions FOR EACH STATEMENT EXECUTE FUNCTION bulk_lock_probe_fn();
      CREATE TRIGGER bulk_lock_probe BEFORE INSERT ON prevention_risk_controls FOR EACH STATEMENT EXECUTE FUNCTION bulk_lock_probe_fn();
    `)
    try {
      const items = await seedEntries("cerrojo", 3)
      await bulk.bulkPatchMiperEntries({ matrixId, items, values: { position: "Operador de trasvasije" } }, author)
      await bulk.bulkAddMiperControl({ matrixId, items: items.map((item) => ({ ...item, expectedVersion: 2 })), values: MEASURE }, author)
      expect((await pg.query<{ locked: boolean }>("SELECT locked FROM bulk_lock_probe")).rows.map((row) => row.locked)).toEqual([true, true])
    } finally {
      await pg.exec(`
        DROP TRIGGER bulk_lock_probe ON prevention_risk_positions;
        DROP TRIGGER bulk_lock_probe ON prevention_risk_controls;
        DROP FUNCTION bulk_lock_probe_fn();
        DROP TABLE bulk_lock_probe;
      `)
    }
  })

  it("una medida que cambia a mitad del lote lo aborta entero, también lo ya escrito: el guardado exige su versión", async () => {
    // `verifyRiskControl` sube la versión de una medida sin bloquear la matriz. Acá lo hace un trigger
    // en cuanto el lote escribe su primera entrada de historial: la medida 1 ya quedó guardada y la 2
    // cambió después de que el lote la leyó.
    const [a, b] = await seedEntries("carrera", 2)
    await testDb.insert(schema.preventionRiskControls).values([a!, b!].map((item, index) => ({
      id: `carrera-control-${index + 1}`, riskEntryId: item.entryId, hierarchy: "administrative", description: "Ducha de emergencia operativa", responsibleSnapshot: "Bodeguero", dueDate: "2026-11-30",
    })))
    const before = await auditCount()
    await pg.exec(`
      CREATE FUNCTION bulk_race_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        UPDATE prevention_risk_controls SET version = version + 1 WHERE id = 'carrera-control-2';
        RETURN NULL;
      END $$;
      CREATE TRIGGER bulk_race AFTER INSERT ON audit_log FOR EACH ROW WHEN (NEW.reason = 'Edición masiva') EXECUTE FUNCTION bulk_race_fn();
    `)
    try {
      await expect(bulk.bulkUpdateMiperControls({ matrixId, items: [{ controlId: "carrera-control-1", expectedVersion: 1 }, { controlId: "carrera-control-2", expectedVersion: 1 }], patch: { dueDate: "2027-04-30" } }, author))
        .rejects.toThrow("1 medida cambió mientras editabas; recarga la matriz para ver los cambios de la otra persona.")
    } finally {
      await pg.exec(`DROP TRIGGER bulk_race ON audit_log; DROP FUNCTION bulk_race_fn();`)
    }
    expect((await controlsOf([a!.entryId, b!.entryId])).map((row) => [row.id, row.dueDate, row.version]))
      .toEqual([["carrera-control-1", "2026-11-30", 1], ["carrera-control-2", "2026-11-30", 1]])
    expect(await auditCount()).toBe(before)
  })
})
