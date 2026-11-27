import { readFile } from "node:fs/promises"
import path from "node:path"
import ExcelJS from "exceljs"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { asc, eq } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import * as schema from "@/db/schema"
import type { Tx } from "@/db"
import { chileLocalDateTimeToUtc } from "@/lib/utils"
import { parseCargoTable } from "@/lib/services/mantencion/parts-notes/import/cargos"
import { buildReportWorkbook, REPORT_SHEETS } from "@/lib/services/mantencion/parts-notes/import/report"
import { deriveNoteStatusTx, recalcNoteStatusTx } from "@/lib/services/mantencion/parts-notes/status"
import type { PlannedNote } from "@/lib/services/mantencion/parts-notes/import/types"
import {
  IDS, NOW, eventsOf, expectInvariant, itemRow, noteRow, pg, resetState, setupDatabase, testDb,
} from "./np-transiciones-fixtures"

vi.mock("@/db", () => ({
  get db() { return (globalThis as { __db?: unknown }).__db },
  get Tx() { return undefined },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/email/smtp", () => ({
  sendEmail: vi.fn(async () => undefined),
  sendBatchEmails: vi.fn(async () => undefined),
  getAppBaseUrl: () => "http://localhost",
}))

const { runNoteImport } = await import("@/lib/services/mantencion/parts-notes/import/run")
const { applyPlannedNotes } = await import("@/lib/services/mantencion/parts-notes/import/apply")

/**
 * Importación de las notas de CHOME ERP (ADR 0001, 2026-11-27) contra Postgres de verdad: la simulación no escribe, la
 * aplicación crea nota, líneas, evento `migrada` único y auditoría, la segunda pasada no duplica, los cargos se
 * normalizan, las notas de prueba se excluyen y el estado importado es el del último evento y no lo toca ningún recálculo.
 * Todos los datos son inventados.
 */

const actor = { userId: IDS.jefe, email: "u-jefe@chome.test" }
const cargos = parseCargoTable({ alias: { TALLER: { centro: "Taller Biodiversa" }, "CR43-51-52": { revisar: true }, "GRUA UNO": { equipo: "KA 135" } } })

const run = (notas: unknown[], apply = true) => runNoteImport(testDb, { notas }, { apply, actor, cargos })
const line = (articulo: string, extra: Record<string, unknown> = {}) => ({ articulo, codigo: null, cargo: null, cantidad: 1, proveedor: null, ...extra })
function erpNote(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id, fecha: "2026-05-02T10:15:00", solicitante: "Persona Sin Usuario", usuario: null, faena: "Biodiversa", urgente: false,
    observacion: null, estado: "Enviada", motivo: null, items: [line("Aceite raro")], ...overrides,
  }
}
const byRef = async (externalRef: string) => {
  const [row] = await testDb.select().from(schema.mantPartsNotes).where(eq(schema.mantPartsNotes.externalRef, externalRef))
  return row!
}
const linesOf = (noteId: string) => testDb.select().from(schema.mantPartsNoteItems).where(eq(schema.mantPartsNoteItems.noteId, noteId)).orderBy(asc(schema.mantPartsNoteItems.sortOrder))
const count = async (table: PgTable) => (await testDb.select().from(table)).length

/** Un conjunto que toca todos los estados, los calces y las exclusiones. */
const sample = () => [
  erpNote(100, { fecha: "2026-05-02T10:15:00", solicitante: "Javier Roa", urgente: true, observacion: "Camión detenido", items: [
    line("Filtro de aceite", { codigo: "FA-100", cargo: "KA 135", cantidad: 2, proveedor: "Repuestos Tr" }),
    line("Aceite raro", { cargo: "TALLER", cantidad: 3, proveedor: "Proveedor Nuevo" }),
  ] }),
  erpNote(101, { fecha: "2026-05-03T08:30:00", usuario: "pexterno", estado: "Aceptada", items: [line("Disco de corte", { cargo: "CR43-51-52", cantidad: 10 })] }),
  erpNote(102, { fecha: "2026-05-10T16:45:00", faena: "Cholguan Norte", estado: "En espera", motivo: "Esperando cotización", items: [line("Correa alternador", { cargo: "ka200" })] }),
  erpNote(103, { fecha: "2026-05-12T09:00:00", estado: "Rechazada", motivo: "Pedido duplicado", items: [line("Guantes de cuero", { cantidad: 6 })] }),
  erpNote(104, { fecha: "2026-06-01T11:20:00", estado: "Cerrada", observacion: "Llegó completo", items: [line("Manguera 3/4", { cargo: "Grua uno", cantidad: 3 }), line("Abrazadera", { cargo: "KA 777" })] }),
  erpNote(105, { fecha: "2026-06-06T12:00:00", solicitante: "Admin", usuario: "admin", observacion: "prueba TEST", items: [line("Articulo test")] }),
  erpNote(106, { fecha: "2026-06-07T12:00:00", faena: "Pacífico", items: [line("Lámpara")] }),
  erpNote(107, { fecha: "no es una fecha" }),
]

beforeAll(async () => {
  await setupDatabase()
  await testDb.insert(schema.products).values([
    { id: "p-imp-filtro", sku: "REP-IMP-1", name: "Filtro de aceite", categoryId: "cat-tr", unitOfMeasure: "unidad", isSparePart: true, partNumber: "FA-100", isActive: true, createdAt: NOW, updatedAt: NOW },
    { id: "p-imp-guantes", sku: "EPP-IMP-1", name: "Guantes de cuero", categoryId: "cat-tr", unitOfMeasure: "par", isSparePart: false, isActive: true, createdAt: NOW, updatedAt: NOW },
  ])
  await testDb.insert(schema.worksiteAliases).values({ id: "wa-imp-1", worksiteId: IDS.wsCho, aliasText: "Cholguan Norte", aliasKey: "cholguan norte" })
}, 120_000)

beforeEach(resetState)

describe.sequential("importación de notas de CHOME ERP", () => {
  it("la simulación no escribe nada, ni siquiera un folio, y dice lo que haría", async () => {
    const result = await run(sample(), false)
    expect(result.applied).toBeNull()
    expect(result.plan.toImport).toHaveLength(5)
    expect(result.plan.excluded).toHaveLength(1)
    expect(result.plan.worksiteUnmatched).toMatchObject([{ faena: "Pacífico", notes: 1 }])
    expect(result.plan.invalid).toMatchObject([{ externalRef: "CHOME-107", position: 8 }])
    expect(await count(schema.mantPartsNotes)).toBe(0)
    expect(await count(schema.mantPartsNoteItems)).toBe(0)
    expect(await count(schema.mantPartsNoteEvents)).toBe(0)
    expect(await count(schema.auditLog)).toBe(0)
    const sequences = await pg.query<{ n: number }>("select count(*)::int as n from pg_sequences where sequencename = 'code_seq_np_2026'")
    expect(sequences.rows[0]!.n).toBe(0)
  })

  it("aplicar crea la nota, sus líneas, UN evento «migrada» y la auditoría, con la fecha y el estado de origen", async () => {
    const products = await count(schema.products)
    const suppliers = await count(schema.suppliers)
    const result = await run(sample())
    expect(result.applied!.failed).toEqual([])
    expect(result.applied!.applied.map((note) => [note.externalRef, note.code])).toEqual([
      ["CHOME-100", "NP-2026-0001"], ["CHOME-101", "NP-2026-0002"], ["CHOME-102", "NP-2026-0003"], ["CHOME-103", "NP-2026-0004"], ["CHOME-104", "NP-2026-0005"],
    ])

    const a = await byRef("CHOME-100")
    expect(a).toMatchObject({
      status: "enviada", holdReason: null, workOrderId: null, vehicleId: null, worksiteId: IDS.wsBio, urgent: true, equipmentStopped: false,
      requestedByUserId: IDS.mecBio, requestedByName: "Javier Roa", notes: "Camión detenido",
    })
    expect(new Date(a.createdAt).toISOString()).toBe(chileLocalDateTimeToUtc("2026-05-02T10:15"))
    expect(new Date(a.updatedAt).toISOString()).toBe(new Date(a.createdAt).toISOString())
    const [filter, oil] = await linesOf(a.id)
    expect(filter).toMatchObject({
      description: "Filtro de aceite", quantity: 2, productId: "p-imp-filtro", partNumber: "FA-100", chargeVehicleId: IDS.truckBio, chargeCostCenterId: null,
      chargeText: null, suggestedSupplierId: "sup-tr", supplierHint: null, resolution: "pendiente", resolvedAt: null, resolvedByUserId: null,
    })
    expect(oil).toMatchObject({ description: "Aceite raro", productId: null, chargeVehicleId: null, chargeCostCenterId: "cc-tr-bio", suggestedSupplierId: null, supplierHint: "Proveedor Nuevo" })

    const b = await byRef("CHOME-101")
    expect(b).toMatchObject({ status: "aceptada", requestedByUserId: null, requestedByName: "Persona Sin Usuario" })
    expect((await linesOf(b.id))[0]).toMatchObject({ chargeVehicleId: null, chargeCostCenterId: null, chargeText: "CR43-51-52" })

    const c = await byRef("CHOME-102")
    expect(c).toMatchObject({ status: "en_espera", holdReason: "Esperando cotización", worksiteId: IDS.wsCho })
    expect((await linesOf(c.id))[0]).toMatchObject({ chargeVehicleId: IDS.truckCho, resolution: "pendiente" })

    const d = await byRef("CHOME-103")
    expect(d.status).toBe("rechazada")
    const [rejected] = await linesOf(d.id)
    expect(rejected).toMatchObject({ resolution: "rechazada", resolutionReason: "Pedido duplicado", resolvedByUserId: actor.userId, productId: null, unitOfMeasure: "unidad" })
    expect(new Date(rejected!.resolvedAt!).toISOString()).toBe(new Date(d.createdAt).toISOString())

    const e = await byRef("CHOME-104")
    expect(e.status).toBe("cerrada")
    const closedLines = await linesOf(e.id)
    expect(closedLines.map((item) => item.resolution)).toEqual(["en_compra", "en_compra"])
    expect(closedLines[0]).toMatchObject({ chargeVehicleId: IDS.truckBio, resolvedByUserId: actor.userId })
    expect(closedLines[1]).toMatchObject({ chargeVehicleId: null, chargeText: "KA 777" })

    // Un único evento por nota: `migrada`, sin estado anterior, sin actor y con la fecha de la nota.
    for (const note of await testDb.select().from(schema.mantPartsNotes)) {
      const events = await eventsOf(note.id)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ kind: "migrada", fromStatus: null, toStatus: note.status, actorUserId: null, itemId: null })
      expect(new Date(events[0]!.createdAt).toISOString()).toBe(new Date(note.createdAt).toISOString())
    }

    const audit = await testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_parts_note"))
    expect(audit).toHaveLength(5)
    expect(audit.every((row) => row.action === "create" && row.userId === actor.userId)).toBe(true)
    expect(audit.map((row) => (JSON.parse(row.newState!) as { external_ref: string }).external_ref).sort()).toEqual(["CHOME-100", "CHOME-101", "CHOME-102", "CHOME-103", "CHOME-104"])

    // Sin OT, sin reservas, sin stock, sin compras y sin maestros nuevos.
    expect(await count(schema.mantPartsAllocations)).toBe(0)
    expect(await count(schema.mantWorkOrderEvents)).toBe(0)
    expect(await count(schema.inventoryMovements)).toBe(0)
    expect(await count(schema.purchaseRequestItems)).toBe(0)
    expect(await count(schema.products)).toBe(products)
    expect(await count(schema.suppliers)).toBe(suppliers)
  })

  it("una segunda pasada no duplica: las existentes se saltan, se informan y no gastan folios", async () => {
    const first = await run(sample())
    const codes = first.applied!.applied.map((note) => note.code)
    const second = await run(sample())
    expect(second.applied!.applied).toEqual([])
    expect(second.plan.alreadyImported.map((note) => [note.externalRef, note.code, note.status])).toEqual([
      ["CHOME-100", codes[0], "enviada"], ["CHOME-101", codes[1], "aceptada"], ["CHOME-102", codes[2], "en_espera"],
      ["CHOME-103", codes[3], "rechazada"], ["CHOME-104", codes[4], "cerrada"],
    ])
    expect(await count(schema.mantPartsNotes)).toBe(5)
    expect(await count(schema.mantPartsNoteEvents)).toBe(5)
    expect(await count(schema.auditLog)).toBe(5)
    // Si la segunda pasada o la simulación hubieran gastado folios, la nota nueva no seguiría a la última.
    const next = Number(codes[4]!.slice(-4)) + 1
    const third = await run([erpNote(108, { fecha: "2026-06-10T09:00:00" })])
    expect(third.applied!.applied.map((note) => note.code)).toEqual([`NP-2026-${String(next).padStart(4, "0")}`])
  })

  it("la nota tomada por otra corrida entre la simulación y la escritura se salta sin duplicar", async () => {
    const first = await run([erpNote(110)], false)
    await run([erpNote(110)])
    const raced = await applyPlannedNotes(testDb, first.plan.toImport, actor)
    expect(raced.applied).toEqual([])
    expect(raced.alreadyThere).toMatchObject([{ externalRef: "CHOME-110" }])
    expect(await count(schema.mantPartsNotes)).toBe(1)
  })

  it("normaliza los cargos: KA 135, KA135 y ka-135 son el mismo equipo; el alias de centro sólo vale en su faena", async () => {
    const result = await run([
      erpNote(200, { items: [line("A", { cargo: "KA 135" }), line("B", { cargo: "KA135" }), line("C", { cargo: "ka-135" }), line("D", { cargo: "rbyd 98" }), line("E", { cargo: "GRUA UNO" }), line("F", { cargo: "taller" })] }),
      erpNote(201, { faena: "Cholguán", items: [line("G", { cargo: "TALLER" }), line("H", { cargo: "KA 135" }), line("I", { cargo: "CR43-51-52" })] }),
    ])
    const [bio, cho] = [await byRef("CHOME-200"), await byRef("CHOME-201")]
    expect((await linesOf(bio.id)).map((item) => [item.chargeVehicleId, item.chargeCostCenterId, item.chargeText])).toEqual([
      [IDS.truckBio, null, null], [IDS.truckBio, null, null], [IDS.truckBio, null, null], [IDS.truckBio, null, null], [IDS.truckBio, null, null], [null, "cc-tr-bio", null],
    ])
    // En Cholguán «TALLER» apunta a «Taller Biodiversa», que no es de esa faena: queda como texto. Y KA 135 es de Biodiversa, no de Cholguán, pero un cargo histórico conserva el equipo.
    expect((await linesOf(cho.id)).map((item) => [item.chargeVehicleId, item.chargeCostCenterId, item.chargeText])).toEqual([
      [null, null, "TALLER"], [IDS.truckBio, null, null], [null, null, "CR43-51-52"],
    ])
    expect(result.plan.pendingCharges.map((item) => [item.externalRef, item.cargo])).toEqual([["CHOME-201", "TALLER"], ["CHOME-201", "CR43-51-52"]])
  })

  it("excluye las notas de prueba (admin con «test») y las informa; no toca las reales de admin ni las con «test» de otros", async () => {
    const result = await run([
      erpNote(300, { solicitante: "Admin", observacion: "Nota de TEST" }),
      erpNote(301, { usuario: "admin", items: [line("articulo test")] }),
      erpNote(302, { solicitante: "Admin", observacion: "Pedido real de repuestos" }),
      erpNote(303, { solicitante: "Persona Real", observacion: "test de impresoras" }),
    ])
    expect(result.plan.excluded.map((item) => item.externalRef)).toEqual(["CHOME-300", "CHOME-301"])
    expect(result.applied!.applied.map((note) => note.externalRef)).toEqual(["CHOME-302", "CHOME-303"])
    expect(await count(schema.mantPartsNotes)).toBe(2)
  })

  it("el estado de la nota es el de su último evento y ningún recálculo automático la reabre ni la cambia", async () => {
    await run(sample())
    for (const note of await testDb.select().from(schema.mantPartsNotes)) {
      const status = await expectInvariant(note.id)
      expect(status).toBe(note.status)
      const events = (await eventsOf(note.id)).length
      // El recálculo de las llegadas y recepciones (onlyIfChanged) y el derivado puro coinciden con lo importado.
      const derived = await testDb.transaction((tx) => deriveNoteStatusTx(tx as unknown as Tx, note.id, { accepted: note.status === "aceptada" }))
      if (note.status !== "en_espera") expect(derived).toBe(note.status)
      const next = await testDb.transaction((tx) => recalcNoteStatusTx(tx as unknown as Tx, note.id, { onlyIfChanged: true }))
      expect(next).toBe(note.status)
      expect((await noteRow(note.id)).status).toBe(note.status)
      expect((await eventsOf(note.id)).length).toBe(events)
    }
  })

  it("una nota que falla a mitad de escritura se deshace entera y no frena a las demás", async () => {
    const [good] = (await run([erpNote(400)], false)).plan.toImport
    const base = good!
    const broken: PlannedNote = {
      ...base, externalRef: "CHOME-401", erpId: "401",
      lines: [{ ...base.lines[0]!, chargeVehicleId: "vehiculo-que-no-existe" }],
    }
    const result = await applyPlannedNotes(testDb, [broken, base], actor)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]!.externalRef).toBe("CHOME-401")
    expect(result.applied.map((note) => note.externalRef)).toEqual(["CHOME-400"])
    expect(await testDb.select().from(schema.mantPartsNotes).where(eq(schema.mantPartsNotes.externalRef, "CHOME-401"))).toHaveLength(0)
    expect(await count(schema.mantPartsNoteEvents)).toBe(1)
  })

  it("el folio toma el año de la fecha de la nota en hora de Chile", async () => {
    const result = await run([erpNote(500, { fecha: "2031-12-31T23:30:00" }), erpNote(501, { fecha: "2032-01-01T00:30:00" })])
    expect(result.applied!.applied.map((note) => note.code)).toEqual(["NP-2031-0001", "NP-2032-0001"])
    expect(await itemRow((await linesOf((await byRef("CHOME-500")).id))[0]!.id)).toMatchObject({ resolution: "pendiente" })
  })

  it("el ejemplo y la tabla de cargos entregados se simulan contra la base y el informe Excel se escribe y se vuelve a leer", async () => {
    const readJson = async (file: string) => JSON.parse(await readFile(path.resolve(process.cwd(), file), "utf8")) as unknown
    const table = parseCargoTable(await readJson("scripts/data/chome-erp-cargos.json"))
    const result = await runNoteImport(testDb, await readJson("scripts/data/chome-erp-notas.ejemplo.json"), { apply: false, actor: null, cargos: table })
    expect(result.plan.toImport.map((note) => note.externalRef)).toEqual(["CHOME-90001", "CHOME-90002", "CHOME-90003", "CHOME-90004", "CHOME-90005"])
    expect(result.plan.excluded.map((item) => item.externalRef)).toEqual(["CHOME-90007"])
    expect(result.plan.worksiteUnmatched).toMatchObject([{ faena: "Faena Que No Existe" }])
    expect(result.plan.invalid.map((item) => item.externalRef)).toEqual(["CHOME-90008"])
    expect(await count(schema.mantPartsNotes)).toBe(0)

    const buffer = await buildReportWorkbook({ fileName: "ejemplo.json", plan: result.plan, applied: null }).xlsx.writeBuffer()
    const reread = new ExcelJS.Workbook()
    await reread.xlsx.load(buffer as ArrayBuffer)
    expect(reread.worksheets.map((sheet) => sheet.name)).toEqual(Object.values(REPORT_SHEETS))
    expect(reread.getWorksheet(REPORT_SHEETS.charges)!.rowCount).toBe(1 + result.plan.pendingCharges.length)
    expect(reread.getWorksheet(REPORT_SHEETS.articles)!.rowCount).toBeGreaterThan(1)
  })
})
