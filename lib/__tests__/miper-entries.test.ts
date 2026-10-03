import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { asc, eq } from "drizzle-orm"
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
const svc = await import("@/lib/services/miper/entries")
const { buildMiperSnapshot } = await import("@/lib/services/miper/snapshots")

const author = { userId: "u-a", scope: { mode: "some" as const, ids: ["ws-e"] }, permissions: ["prevention:risk:view", "prevention:risk:edit"] }
let matrixId = ""

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.worksites).values({ id: "ws-e", name: "Faena E", code: "E" })
  await testDb.insert(schema.users).values([
    { id: "u-a", name: "Autora", email: "a@e.cl", hashedPassword: "x", isActive: true },
    { id: "u-inactive", name: "Inactiva", email: "i@e.cl", hashedPassword: "x", isActive: false },
  ])
  matrixId = (await createMiper({ worksiteId: "ws-e", period: 2026, revisionReason: "Período para probar filas." }, author)).id
}, 60_000)

const rows = () => testDb.select().from(schema.preventionRiskEntries).where(eq(schema.preventionRiskEntries.matrixId, matrixId)).orderBy(asc(schema.preventionRiskEntries.rowNumber))

describe("filas de la matriz", () => {
  it("crea una fila incompleta, la completa y la clasificación se calcula", async () => {
    const created = await svc.saveMiperEntry({ matrixId, values: { activity: "Transporte de lodo", task: "Descarga" } }, author)
    expect(created).toMatchObject({ rowNumber: 1, version: 1, classification: null })
    const updated = await svc.saveMiperEntry({ matrixId, entryId: created.id, expectedVersion: 1, values: { probability: 4, consequence: 4, hazard: "Volcamiento" } }, author)
    expect(updated).toMatchObject({ version: 2, magnitude: 16, classification: "intolerable" })
  })

  it("rechaza una edición con versión vieja (dos pestañas sobre la misma fila)", async () => {
    const [first] = await rows()
    await expect(svc.saveMiperEntry({ matrixId, entryId: first!.id, expectedVersion: 1, values: { risk: "Otro" } }, author)).rejects.toThrow("La fila cambió mientras la editabas. Recarga el riesgo para ver el cambio de la otra persona.")
  })

  it("insertar debajo renumera las siguientes; duplicar copia fila y medidas; eliminar compacta", async () => {
    const second = await svc.saveMiperEntry({ matrixId, values: { hazard: "Segunda" } }, author)
    expect(second.rowNumber).toBe(2)
    const between = await svc.saveMiperEntry({ matrixId, insertAfterRowNumber: 1, values: { hazard: "Entre medio" } }, author)
    expect(between.rowNumber).toBe(2)
    expect((await rows()).map((r) => r.hazard)).toEqual(["Volcamiento", "Entre medio", "Segunda"])

    const [first] = await rows()
    await svc.saveMiperControl({ matrixId, entryId: first!.id, values: { hierarchy: "engineering", description: "Topes de descarga", responsibleName: "Supervisor", dueDate: "2026-11-30" } }, author)
    const dup = await svc.duplicateMiperEntry({ matrixId, entryId: first!.id }, author)
    expect(dup.rowNumber).toBe(2)
    const dupControls = await testDb.select().from(schema.preventionRiskControls).where(eq(schema.preventionRiskControls.riskEntryId, dup.id))
    expect(dupControls.map((c) => c.description)).toEqual(["Topes de descarga"])

    const target = (await rows())[1]!
    await svc.deleteMiperEntry({ matrixId, entryId: target.id, expectedVersion: target.version }, author)
    expect((await rows()).map((r) => r.rowNumber)).toEqual([1, 2, 3])
  })

  it("medidas: responsable activo, versión y borrado", async () => {
    const [first] = await rows()
    await expect(svc.saveMiperControl({ matrixId, entryId: first!.id, values: { hierarchy: "ppe", description: "Casco", responsibleUserId: "u-inactive", dueDate: "2026-11-30" } }, author)).rejects.toThrow(/inactiva/)
    const control = await svc.saveMiperControl({ matrixId, entryId: first!.id, values: { hierarchy: "ppe", description: "Casco", responsibleUserId: "u-a", dueDate: "2026-11-30" } }, author)
    const [row] = await testDb.select().from(schema.preventionRiskControls).where(eq(schema.preventionRiskControls.id, control.id))
    expect(row!.responsibleSnapshot).toBe("Autora")
    const edited = await svc.saveMiperControl({ matrixId, entryId: first!.id, controlId: control.id, expectedVersion: 1, values: { hierarchy: "ppe", description: "Casco y barbiquejo", responsibleUserId: "u-a", dueDate: "2026-11-30" } }, author)
    expect(edited.version).toBe(2)
    // Una edición con la versión vieja: el mensaje nombra el gesto del editor, «Recargar riesgo» (A2, fila 4).
    await expect(svc.saveMiperControl({ matrixId, entryId: first!.id, controlId: control.id, expectedVersion: 1, values: { hierarchy: "ppe", description: "Casco", responsibleUserId: "u-a", dueDate: "2026-11-30" } }, author))
      .rejects.toThrow("La medida cambió mientras la editabas. Recarga el riesgo para ver el cambio de la otra persona.")
    await svc.deleteMiperControl({ matrixId, controlId: control.id, expectedVersion: 2 }, author)
    expect(await testDb.select().from(schema.preventionRiskControls).where(eq(schema.preventionRiskControls.id, control.id))).toHaveLength(0)
  })

  it("una matriz legacy no admite cambios", async () => {
    await testDb.update(schema.preventionRiskMatrices).set({ isLegacy: true }).where(eq(schema.preventionRiskMatrices.id, matrixId))
    await expect(svc.saveMiperEntry({ matrixId, values: { hazard: "x" } }, author)).rejects.toThrow(/solo lectura/)
    await testDb.update(schema.preventionRiskMatrices).set({ isLegacy: false }).where(eq(schema.preventionRiskMatrices.id, matrixId))
  })

  it("medida existente (D5): guarda la frecuencia y no el plazo; editarla sin decirlo la conserva; el historial lleva antes y después", async () => {
    const entry = await svc.saveMiperEntry({ matrixId, values: { hazard: "Caída al mismo nivel", probability: 2, consequence: 2 } }, author)
    const created = await svc.saveMiperControl({ matrixId, entryId: entry.id, values: {
      hierarchy: "administrative", description: "Charla de inicio de turno", responsibleName: "Supervisor de turno",
      isExisting: true, verificationFrequency: " Trimestral ", dueDate: "2026-12-31",
    } }, author)
    const stored = async () => (await testDb.select().from(schema.preventionRiskControls).where(eq(schema.preventionRiskControls.id, created.id)))[0]!
    // Una existente no lleva plazo aunque el pedido lo traiga: se verifica con su frecuencia.
    expect(await stored()).toMatchObject({ isExisting: true, verificationFrequency: "Trimestral", dueDate: null, status: "proposed" })

    // Un llamador que no manda «¿ya está implementada?» ni la frecuencia no la convierte en pendiente.
    await svc.saveMiperControl({ matrixId, entryId: entry.id, controlId: created.id, expectedVersion: 1, values: {
      hierarchy: "administrative", description: "Charla de inicio de turno firmada", responsibleName: "Supervisor de turno",
    } }, author)
    expect(await stored()).toMatchObject({ isExisting: true, verificationFrequency: "Trimestral", dueDate: null, version: 2 })
    // La foto viva copia los valores reales de la medida existente, no los de por defecto.
    const existingControl = (await buildMiperSnapshot(testDb, matrixId)).entries.find((item) => item.id === entry.id)!.controls[0]!
    expect(existingControl).toMatchObject({ isExisting: true, verificationFrequency: "Trimestral", dueDate: null })

    // Pasarla a «por implementar»: lleva plazo y pierde la frecuencia.
    await svc.saveMiperControl({ matrixId, entryId: entry.id, controlId: created.id, expectedVersion: 2, values: {
      hierarchy: "administrative", description: "Charla de inicio de turno firmada", responsibleName: "Supervisor de turno",
      isExisting: false, verificationFrequency: "Trimestral", dueDate: "2026-11-30",
    } }, author)
    expect(await stored()).toMatchObject({ isExisting: false, verificationFrequency: null, dueDate: "2026-11-30", version: 3 })

    const log = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, matrixId))
    const states = log
      .map((row) => ({ before: JSON.parse(row.oldState ?? "{}") as Record<string, unknown>, after: JSON.parse(row.newState ?? "{}") as Record<string, unknown> }))
      .filter(({ after }) => after.objectId === created.id)
    expect(states.find(({ after }) => after.changeType === "control_created")!.after).toMatchObject({ isExisting: true, verificationFrequency: "Trimestral", dueDate: null })
    const toPending = states.find(({ after }) => after.changeType === "control_updated" && after.isExisting === false)!
    expect(toPending.before).toMatchObject({ isExisting: true, verificationFrequency: "Trimestral", dueDate: null })
    expect(toPending.after).toMatchObject({ isExisting: false, verificationFrequency: null, dueDate: "2026-11-30" })

    // La foto viva lleva las dos claves, al final de la medida.
    const control = (await buildMiperSnapshot(testDb, matrixId)).entries.find((item) => item.id === entry.id)!.controls[0]!
    expect(control).toMatchObject({ isExisting: false, verificationFrequency: null, dueDate: "2026-11-30" })
    expect(Object.keys(control).slice(-2)).toEqual(["isExisting", "verificationFrequency"])
  })

  it("duplicar un riesgo conserva el orden de sus medidas (arrastre de la Fase C)", async () => {
    const entry = await svc.saveMiperEntry({ matrixId, values: { hazard: "Ruido de chancado", probability: 2, consequence: 2 } }, author)
    // El orden de la foto es `created_at, id`. Los ids van al revés de ese orden y se insertan
    // desordenados: ni el id ni el orden físico de las filas lo reproducen por casualidad.
    const order = ["Encierro acústico", "Mantención del silenciador", "Rotación de turnos", "Pausas de recuperación", "Audiometría anual", "Protector auditivo"]
    const controls = order.map((description, index) => ({
      id: `dup-c${order.length - index}`, riskEntryId: entry.id, description, hierarchy: "administrative" as const,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(), updatedAt: "2026-01-01T00:00:00.000Z",
    }))
    await testDb.insert(schema.preventionRiskControls).values([3, 0, 5, 1, 4, 2].map((index) => controls[index]!))
    const descriptionsOf = async (entryId: string) => (await buildMiperSnapshot(testDb, matrixId)).entries.find((item) => item.id === entryId)!.controls.map((control) => control.description)
    expect(await descriptionsOf(entry.id)).toEqual(order)
    const dup = await svc.duplicateMiperEntry({ matrixId, entryId: entry.id }, author)
    expect(await descriptionsOf(dup.id)).toEqual(order)
  })
})
