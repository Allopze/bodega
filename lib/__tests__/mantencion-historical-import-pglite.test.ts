import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import ExcelJS from "exceljs"
import path from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import type { MantViewer } from "@/lib/services/mantencion/access"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __historicalDb?: DB }
testGlobal.__historicalDb = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__historicalDb } }))

const { previewHistoricalImport, commitHistoricalImport, listHistoricalRecords, getHistoricalRecord, linkHistoricalRecord } = await import("@/lib/services/mantencion/historical-import")
const actor = { userId: "jefe-historical", email: "jefe@example.test" }
const jefe: MantViewer = { userId: actor.userId, email: actor.email, permissions: ["mant:records:view_all"], worksiteIds: [], isGlobal: true }
const supervisor: MantViewer = { userId: "sup", email: null, permissions: ["mant:records:view_worksite"], worksiteIds: ["bio"], isGlobal: false }
const mechanic: MantViewer = { userId: "mec", email: null, permissions: ["mant:records:view_own"], worksiteIds: [], isGlobal: false }
const headers = ["Marca temporal", "Dirección de correo electrónico", "Puntuación", "FAENA", "Orden de trabajo", "TIPO DE ACCION", "ACEITE", "TIPO DE TRABAJO", "QUIEN", "EXTERNO", "CONDUCTOR", "Equipo", "ODOMETRO U HOROMETRO", "TRABAJO REALIZADO", "REPUESTOS", "FECHA INGRESO EQUIPO TALLER", "FECHA SALIDA TALLER", "HORAS TRABAJADAS", "FOTOGRAFIA"]
function makeRow(time: string, site: string, equipment: string, description = "Trabajo histórico") {
  return [time, "taller@example.test", 0, site, "123", "ACCION CORRECTIVA", "", "MECANICO", "Mecánico", "", "", equipment, 0, description, "", "18/08/2025", "19/08/2025", 2, ""]
}
async function workbook(rows: unknown[][]) {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet("BIODIVERSA")
  sheet.addRow(headers); rows.forEach((row) => sheet.addRow(row))
  return await book.xlsx.writeBuffer() as ArrayBuffer
}
const sourceRows = [makeRow("19/08/2025 10:00:00", "BIODIVERSA", "KA-1 / BCDF-12"), makeRow("19/08/2025 11:00:00", "ARAUCO", "KA-9 / LPRS-56"), makeRow("19/08/2025 12:00:00", "SANTA FE", "KA-1 / GHJK-34")]
let source: ArrayBuffer

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values({ id: actor.userId, name: "Jefatura", email: actor.email, hashedPassword: "hash" })
  await testDb.insert(schema.worksites).values([{ id: "bio", code: "BIO-H", name: "Biodiversa" }, { id: "santa", code: "STA-H", name: "Santa Fe" }])
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "type-h", slug: "type-h", name: "Camión", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" })
  await testDb.insert(schema.fuelVehicles).values([
    { id: "v1", code: "KA-1", plate: "BCDF12", type: "Camión", equipmentTypeId: "type-h", worksiteId: "bio" },
    { id: "v2", code: "KA-2", plate: "GHJK34", type: "Camión", equipmentTypeId: "type-h", worksiteId: "santa" },
  ])
  source = await workbook(sourceRows)
}, 120_000)

describe.sequential("importación histórica de mantención", () => {
  it("previsualiza sin escribir y conserva los trabajos no conciliados", async () => {
    const result = await previewHistoricalImport(source)
    expect(result).toMatchObject({ ok: true, data: { summary: { total: 3, created: 3, linked: 1, unmatched: 1, conflicts: 1, unresolvedWorksites: 1 } } })
    expect(await testDb.select().from(schema.mantHistoricalRecords)).toHaveLength(0)
  })

  it("importa transaccionalmente con auditoría y vuelve a importar sin duplicar", async () => {
    expect(await commitHistoricalImport(actor, source, "historial.xlsx")).toMatchObject({ ok: true, data: { created: 3 } })
    expect(await testDb.select().from(schema.mantHistoricalRecords)).toHaveLength(3)
    expect(await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_historical_import"))).toHaveLength(1)
    expect(await commitHistoricalImport(actor, source, "historial.xlsx")).toMatchObject({ ok: true, data: { created: 0, unchanged: 3 } })
    expect(await testDb.select().from(schema.mantRecords)).toHaveLength(0)
  })

  it("no conserva fotos ni trata como cambios sus enlaces al reimportar", async () => {
    const changedPhotos = sourceRows.map((row, index) => row.map((value, cell) => cell === 18 ? `https://drive.google.com/qa-${index}` : value))
    const revised = await workbook(changedPhotos)
    expect(await commitHistoricalImport(actor, revised, "historial.xlsx")).toMatchObject({ ok: true, data: { created: 0, unchanged: 3 } })
    const stored = await testDb.select().from(schema.mantHistoricalRecords)
    expect(stored.every((record) => record.fields.every((field) => field.header !== "FOTOGRAFIA"))).toBe(true)
  })

  it("reimporta sin duplicar si la hora cambia o falta en la misma fila de origen", async () => {
    const changedTime = sourceRows.map((row, index) => row.map((value, cell) => cell === 0 && index === 0 ? "19/08/2025 18:35:12" : cell === 0 && index === 1 ? "19/08/2025" : value))
    const revised = await workbook(changedTime)
    expect(await previewHistoricalImport(revised, "historial.xlsx")).toMatchObject({ ok: true, data: { summary: { created: 0, unchanged: 3 } } })
    expect(await commitHistoricalImport(actor, revised, "historial.xlsx")).toMatchObject({ ok: true, data: { created: 0, unchanged: 3 } })
    const stored = await testDb.select().from(schema.mantHistoricalRecords)
    expect(stored).toHaveLength(3)
    expect(stored.every((record) => record.submittedAt === "2025-08-19")).toBe(true)
    expect(stored.every((record) => record.fields.find((field) => field.header === "Fecha de envío")?.value === "2025-08-19")).toBe(true)
  })

  it("detiene una posible repetición si cambió la hora y no se puede verificar el origen", async () => {
    const rowWithDifferentTime = sourceRows[0]!.map((value, cell) => cell === 0 ? "19/08/2025 17:00:00" : value)
    const revised = await workbook([rowWithDifferentTime])
    expect(await previewHistoricalImport(revised, "otra-planilla.xlsx")).toMatchObject({ ok: false, message: expect.stringMatching(/posible|coincide/i) })
    expect(await commitHistoricalImport(actor, revised, "otra-planilla.xlsx")).toMatchObject({ ok: false })
    expect(await testDb.select().from(schema.mantHistoricalRecords)).toHaveLength(3)
  })

  it("detecta una edición del contenido aunque la hora también haya cambiado", async () => {
    const changed = await workbook([makeRow("19/08/2025 16:20:00", "BIODIVERSA", "KA-1 / BCDF-12", "Descripción editada")])
    expect(await previewHistoricalImport(changed, "historial.xlsx")).toMatchObject({ ok: false, message: expect.stringMatching(/contenido diferente/i) })
    expect(await commitHistoricalImport(actor, changed, "historial.xlsx")).toMatchObject({ ok: false })
    expect(await testDb.select().from(schema.mantHistoricalRecords)).toHaveLength(3)
  })

  it("protege los antecedentes y el alcance por faena, incluso ante acceso directo", async () => {
    const global = await listHistoricalRecords(jefe, {})
    const local = await listHistoricalRecords(supervisor, {})
    const own = await listHistoricalRecords(mechanic, {})
    expect(global.total).toBe(3); expect(local.total).toBe(1); expect(own.total).toBe(0)
    expect((await listHistoricalRecords(jefe, { pending: "equipment" })).total).toBe(2)
    expect((await listHistoricalRecords(jefe, { pending: "worksite" })).total).toBe(1)
    expect((await listHistoricalRecords(supervisor, { pending: "worksite" })).total).toBe(0)
    expect(await listHistoricalRecords(jefe, { search: "KA-1", page: 999 })).toMatchObject({ total: 2, page: 1 })
    const foreign = global.rows.find((r) => r.worksiteText === "SANTA FE")!
    expect(await getHistoricalRecord(supervisor, foreign.sourceKey)).toBeNull()
    expect(await getHistoricalRecord(jefe, foreign.sourceKey)).toMatchObject({ equipmentText: "KA-1 / GHJK-34" })
  })

  it("rechaza cambios a una respuesta ya importada sin guardar el resto del archivo", async () => {
    const altered = await workbook([makeRow("19/08/2025 10:00:00", "BIODIVERSA", "KA-1 / BCDF-12", "Cambiado"), makeRow("20/08/2025 10:00:00", "BIODIVERSA", "KA-1 / BCDF-12")])
    expect(await previewHistoricalImport(altered)).toMatchObject({ ok: false })
    expect(await commitHistoricalImport(actor, altered, "otro.xlsx")).toMatchObject({ ok: false })
    expect(await testDb.select().from(schema.mantHistoricalRecords)).toHaveLength(3)
  })

  it("al reimportar vincula un equipo pendiente sin alterar su contenido", async () => {
    await testDb.insert(schema.fuelVehicles).values({ id: "v9", code: "KA-9", plate: "LPRS56", type: "Camión", equipmentTypeId: "type-h", worksiteId: "bio" })
    expect(await commitHistoricalImport(actor, source, "historial.xlsx")).toMatchObject({ ok: true, data: { created: 0, relinked: 1 } })
    const rows = await testDb.select().from(schema.mantHistoricalRecords).where(eq(schema.mantHistoricalRecords.vehicleId, "v9"))
    expect(rows).toHaveLength(1); expect(rows[0]?.worksiteId).toBeNull()
    expect(await testDb.select().from(schema.mantRecords)).toHaveLength(0)
  })

  it("permite resolver explícitamente un conflicto y registra quién lo hizo", async () => {
    const conflict = (await listHistoricalRecords(jefe, {})).rows.find((row) => row.equipmentMatch === "conflict")!
    expect(await linkHistoricalRecord(actor, conflict.sourceKey, { vehicleId: "v2" })).toMatchObject({ ok: true })
    expect(await getHistoricalRecord(jefe, conflict.sourceKey)).toMatchObject({ vehicleId: "v2", equipmentMatch: "linked" })
    expect(await linkHistoricalRecord(actor, conflict.sourceKey, { vehicleId: "v1" })).toMatchObject({ ok: false })
    expect(await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_historical_record"))).toHaveLength(1)
  })

  it("no guarda parcialmente una resolución con un identificador inexistente", async () => {
    const pending = (await listHistoricalRecords(jefe, {})).rows.find((row) => row.worksiteText === "ARAUCO")!
    expect(await linkHistoricalRecord(actor, pending.sourceKey, { worksiteId: "missing" })).toMatchObject({ ok: false })
    expect(await getHistoricalRecord(jefe, pending.sourceKey)).toMatchObject({ worksiteId: null })
  })
})
