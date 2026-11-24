import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import ExcelJS from "exceljs"
import JSZip from "jszip"
import { createHash } from "node:crypto"
import path from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { parseConsolidatedWorkbook, stripDrawings } from "@/lib/services/mantencion/consolidated-workbook"
import { parseHistoricalWorkbook } from "@/lib/services/mantencion/historical-workbook"

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __consolidadoDb?: DB }
testGlobal.__consolidadoDb = testDb
vi.mock("@/db", () => ({ get db() { return testGlobal.__consolidadoDb } }))

const { importConsolidated, formatConsolidatedReport } = await import("@/lib/services/mantencion/consolidated-import")
const actor = { userId: "jefe-consolidado", email: "jefe@example.test" }
const MAIL = "taller@example.test"
const EXCLUDE_TESTS_SETTING = "ops.mantencion.import_exclude_test_rows"

/* ── Libro de prueba, con las columnas del consolidado real ───────────────── */

const MANT_HEADERS = ["ID_REGISTRO", "ID_EQUIPO", "PATENTE", "EQUIPO_ORIGINAL", "TIPO_EQUIPO", "FUENTE", "TALLER_REGISTRO", "MARCA_TEMPORAL", "FAENA", "FAENA_GRUPO", "CONTRATO", "OT", "TIPO_ACCION", "TIPO_TRABAJO", "CAMBIO_ACEITE", "REALIZA_RESPONSABLE", "TALLER_EXTERNO", "CONDUCTOR", "ODOMETRO_HOROMETRO", "TRABAJO_REALIZADO", "REPUESTOS", "F_INGRESO", "F_SALIDA", "DIAS_EN_TALLER", "HORAS_TRABAJADAS", "DIAS_DETENIDO", "ODO_PROX_MANTENCION", "MES", "OBS_CALIDAD", "POSIBLE_PRUEBA", "FOTO", "FOTO_STICKER", "CORREO"]
const INSP_HEADERS = ["ID_INSPECCION", "N_FORMULARIO", "MARCA_TEMPORAL", "FECHA", "MES", "EJECUTANTE", "CARGO", "FORMULARIO", "TIPO_UNIDAD", "PATENTE_ORIGINAL", "PATENTE", "ID_EQUIPO", "FAENA_GRUPO", "KM_INSPECCION", "KM_EN_CARGA_COMBUSTIBLE", "FECHA_CARGA_REF", "DIF_KM", "BUEN_ESTADO", "REGULAR", "MAL_ESTADO", "NO_TIENE", "NO_APLICA", "%_BUEN_ESTADO", "ITEMS_MAL_ESTADO", "ITEMS_REGULAR", "ITEMS_NO_TIENE", "DOCUMENTACION_OBS", "RESPALDO"]
const HALL_HEADERS = ["ID_INSPECCION", "MARCA_TEMPORAL", "MES", "EJECUTANTE", "TIPO_UNIDAD", "PATENTE", "ID_EQUIPO", "FAENA_GRUPO", "SECCION", "ITEM", "ESTADO", "NIVEL", "SEGUIMIENTO_TALLER", "OT_SIGUIENTE", "F_INGRESO_TALLER", "TRABAJO_EN_TALLER"]
const PAUTA_HEADERS = ["FORMULARIO", "ES_PRUEBA", "FECHA", "MARCA_TEMPORAL", "FAENA", "MECANICO", "PATENTE", "ID_EQUIPO", "ODOMETRO_HOROMETRO", "PAUTA", "REALIZADO", "NO_REALIZADO", "NO_APLICA", "%_CUMPLIMIENTO", "ITEMS_NO_REALIZADOS", "OBSERVACIONES", "IMG_FILTROS", "IMG_STICKER"]
const EQUIPO_HEADERS = ["ID_EQUIPO", "PATENTE", "CATEGORIA", "TIPO"]

const at = (iso: string) => new Date(`${iso}Z`)
const row = (headers: string[], values: Record<string, unknown>) => headers.map((header) => values[header] ?? null)
let counter = 0
function maint(over: Record<string, unknown> = {}): unknown[] {
  counter++
  return row(MANT_HEADERS, {
    ID_REGISTRO: `MT-${String(counter).padStart(5, "0")}`, ID_EQUIPO: "KA-1", PATENTE: "BCDF-12", EQUIPO_ORIGINAL: "KA-1", TIPO_EQUIPO: "CAMION",
    FUENTE: "Consolidado_Mantencion (form. antiguo)", TALLER_REGISTRO: "BIODIVERSA", MARCA_TEMPORAL: at(`2025-08-${String(10 + counter).padStart(2, "0")}T18:02:30.807`),
    FAENA: "BIODIVERSA", FAENA_GRUPO: "BIODIVERSA", OT: String(1000 + counter), TIPO_ACCION: "CORRECTIVA", TIPO_TRABAJO: "MECANICO, SOLDADURA",
    REALIZA_RESPONSABLE: "Mecánico de prueba", CONDUCTOR: "Conductor de prueba", ODOMETRO_HOROMETRO: 84855, TRABAJO_REALIZADO: `Trabajo ${counter}`,
    F_INGRESO: at("2025-08-18T00:00:00.000"), F_SALIDA: at("2025-08-19T00:00:00.000"), DIAS_EN_TALLER: 1, HORAS_TRABAJADAS: 4, MES: "2025-08",
    FOTO: "https://drive.google.com/open?id=foto", CORREO: MAIL, ...over,
  })
}
const stampKey = (stamp: Date, email: string) => createHash("sha256").update(`google-forms\n${stamp.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "")}\n${email}`).digest("hex")

const inspectionStamp = at("2026-07-20T20:44:16.946")
function inspection(over: Record<string, unknown> = {}): unknown[] {
  return row(INSP_HEADERS, {
    ID_INSPECCION: "IN-00001", N_FORMULARIO: 1, MARCA_TEMPORAL: inspectionStamp, FECHA: at("2026-07-20T00:00:00.000"), MES: "2026-07", EJECUTANTE: "Ejecutante de prueba",
    CARGO: "Conductor", FORMULARIO: "CAMION", TIPO_UNIDAD: "CAMION", PATENTE_ORIGINAL: "BCDF12", PATENTE: "BCDF-12", ID_EQUIPO: "KA-1", FAENA_GRUPO: "BIODIVERSA",
    KM_INSPECCION: 366028, BUEN_ESTADO: 42, REGULAR: 3, MAL_ESTADO: 4, NO_TIENE: 0, NO_APLICA: 0, RESPALDO: "https://drive.google.com/open?id=respaldo", ...over,
  })
}
const finding = (over: Record<string, unknown>) => row(HALL_HEADERS, { ID_INSPECCION: "IN-00001", MARCA_TEMPORAL: inspectionStamp, TIPO_UNIDAD: "CAMION", SECCION: "ACCESORIOS", ...over })

interface BookOptions {
  maintenance: unknown[][]; maintenanceHeaders?: string[]; inspections?: unknown[][]; findings?: unknown[][]; schedules?: unknown[][]
  withDetail?: boolean; equipment?: unknown[][]
}
async function build(options: BookOptions): Promise<ArrayBuffer> {
  const book = new ExcelJS.Workbook()
  const add = (name: string, headers: string[], rows: unknown[][]) => {
    const sheet = book.addWorksheet(name); sheet.addRow(headers); rows.forEach((r) => sheet.addRow(r)); return sheet
  }
  add("MANTENCIONES", options.maintenanceHeaders ?? MANT_HEADERS, options.maintenance)
  add("INSPECCIONES", INSP_HEADERS, options.inspections ?? [])
  add("HALLAZGOS_INSPECCION", HALL_HEADERS, options.findings ?? [])
  const pautas = add("PAUTAS_PREVENTIVAS", PAUTA_HEADERS, options.schedules ?? [])
  if (options.withDetail) {
    // Igual que el consolidado real: bajo la tabla de pautas, dos filas en blanco y otra tabla de detalle por ítem.
    pautas.addRow([]); pautas.addRow([])
    pautas.addRow(["Detalle por ítem de cada pauta"])
    pautas.addRow(["FORMULARIO", "ES_PRUEBA", "FECHA", "PATENTE", "ID_EQUIPO", "PAUTA", "ITEM", "RESULTADO"])
    for (let i = 0; i < 5; i++) pautas.addRow(["CAMIONES", "No", at("2026-07-21T00:00:00.000"), "BCDF-12", "KA-1", "40.000 KM", `Ítem ${i}`, "REALIZADO"])
  }
  add("EQUIPOS", EQUIPO_HEADERS, options.equipment ?? [])
  add("CALIDAD_DATOS", ["FUENTE", "PROBLEMA", "CANTIDAD", "EJEMPLO_DETALLE"], [["MANTENCIONES", "Sin fecha de salida de taller", 95, "Ej. detalle con J. PEREZ"], ["MANTENCIONES", "Fecha de salida anterior a la de ingreso", 10, null]])
  return await book.xlsx.writeBuffer() as ArrayBuffer
}

const schedulePlain = (over: Record<string, unknown> = {}) => row(PAUTA_HEADERS, {
  FORMULARIO: "CAMIONES", ES_PRUEBA: "No", FECHA: at("2026-07-21T00:00:00.000"), MARCA_TEMPORAL: at("2026-07-23T12:03:18.371"), FAENA: "BIODIVERSA", MECANICO: "Mecánico de prueba",
  PATENTE: "BCDF-12", ID_EQUIPO: "KA-1", ODOMETRO_HOROMETRO: 402622, PAUTA: "40.000 KM", REALIZADO: 39, NO_REALIZADO: 2, NO_APLICA: 7,
  "%_CUMPLIMIENTO": { formula: "IF((K2+L2)=0,\"\",K2/(K2+L2))", result: 0.951219512195122 }, IMG_FILTROS: "https://drive.google.com/open?id=img", ...over,
})

/* ── Base y datos ─────────────────────────────────────────────────────────── */

const preexistingStamp = at("2025-09-30T10:11:12.999")
const manualStamp = at("2025-10-01T08:00:00.123")

async function tables() {
  const order = <T extends { sourceKey: string }>(rows: T[]) => [...rows].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))
  return JSON.stringify({
    records: order(await testDb.select().from(schema.mantHistoricalRecords)), inspections: order(await testDb.select().from(schema.mantHistoricalInspections)),
    findings: order(await testDb.select().from(schema.mantHistoricalFindings)), schedules: order(await testDb.select().from(schema.mantHistoricalScheduleChecks)),
    scheduleItems: order(await testDb.select().from(schema.mantHistoricalScheduleItems)),
  })
}
const records = () => testDb.select().from(schema.mantHistoricalRecords)
const byRecordId = async (id: string) => (await records()).find((record) => record.sourceRecordId === id)!
const audits = () => testDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "mant_historical_import"))

let source: ArrayBuffer

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await testDb.insert(schema.users).values({ id: actor.userId, name: "Jefatura", email: actor.email, hashedPassword: "hash" })
  await testDb.insert(schema.worksites).values([{ id: "bio", code: "BIO-C", name: "Biodiversa" }, { id: "santa", code: "STA-C", name: "Santa Fe" }, { id: "arauco", code: "ARA-C", name: "Arauco" }, { id: "cholguan", code: "CHO-C", name: "Cholguan - Arauco" }])
  await testDb.insert(schema.worksiteAliases).values({ id: "alias-horcones", worksiteId: "arauco", aliasText: "Horcones", aliasKey: "horcones" })
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "type-c", slug: "type-c", name: "Camión", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" })
  await testDb.insert(schema.fuelVehicles).values([
    { id: "v1", code: "KA-1", plate: "BCDF12", type: "Camión", equipmentTypeId: "type-c", worksiteId: "bio" },
    { id: "v2", code: "KA-2", plate: "GHJK34", type: "Camión", equipmentTypeId: "type-c", worksiteId: "santa" },
    { id: "v3", code: "KA-3", plate: "LPRS56", type: "Camión", equipmentTypeId: "type-c", worksiteId: "bio" },
  ])

  // Dos filas que ya estaban en la base por el importador del formulario (otra planilla, otros datos).
  const old = (sourceKey: string, extra: Partial<typeof schema.mantHistoricalRecords.$inferInsert>) => ({
    sourceKey, fingerprint: `fp-viejo-${sourceKey.slice(0, 6)}`, sourceFile: "NUEVA BASE DE DATOS MANTENCION.xlsx", sourceSheet: "BIODIVERSA", sourceRow: 5,
    submittedAt: "2025-09-30", worksiteText: "BIODIVERSA", equipmentText: "KA-1 / BCDF-12", equipmentMatch: "unmatched", orderText: "55", kindText: "", readingText: "0",
    description: "Descripción del formulario", hoursText: "2", fields: [{ header: "Campo del formulario nuevo", value: "intacto" }], importedBy: actor.userId, ...extra,
  })
  await testDb.insert(schema.mantHistoricalRecords).values([
    old(stampKey(preexistingStamp, MAIL), { worksiteId: null, vehicleId: null }),
    old(stampKey(manualStamp, MAIL), { sourceRow: 6, worksiteId: "santa", vehicleId: "v2", equipmentMatch: "linked", actionType: "preventiva", laborHours: 9, contractText: "Manual" }),
  ])

  source = await build({
    maintenance: [
      maint(),                                                                                  // MT-1: equipo y faena resueltos
      maint({ ID_EQUIPO: "KA-2", PATENTE: "GHJK-34", FAENA: "SANTA FE", CONTRATO: "Residuos", TIPO_ACCION: "PREVENTIVA", TIPO_TRABAJO: "ELECTRICO", HORAS_TRABAJADAS: 1.5, DIAS_DETENIDO: 2 }), // MT-2
      maint({ ID_EQUIPO: "KA-1", PATENTE: "GHJK-34", FAENA: "Horcones", OBS_CALIDAD: "Salida anterior al ingreso" }), // MT-3: conflicto de código y patente; alias de faena
      maint({ ID_EQUIPO: "KA-9", PATENTE: null, EQUIPO_ORIGINAL: "KA-9", FAENA: "ENAP", TIPO_ACCION: "SIN CLASIFICAR (form. nuevo)", TIPO_TRABAJO: null }), // MT-4: sin equipo, sin faena, sin clasificar
      maint({ ID_EQUIPO: "DEIBIS", PATENTE: null, EQUIPO_ORIGINAL: "DEIBIS" }),                  // MT-5: no es equipo
      maint({ POSIBLE_PRUEBA: "Revisar: registro único del form. nuevo en esta hoja" }),         // MT-6: posible prueba
      maint({ ID_EQUIPO: null, PATENTE: "BCDF-12", EQUIPO_ORIGINAL: "BCDF-12" }),                // MT-7: sin código, se vincula por patente
      maint({ MARCA_TEMPORAL: preexistingStamp, TIPO_ACCION: "SIN CLASIFICAR (form. nuevo)", FUENTE: "NUEVA_BASE_DE_DATOS_MANTENCION (form. nuevo)", TIPO_TRABAJO: "HIDRAULICO", HORAS_TRABAJADAS: 3 }), // MT-8: ya existía
      maint({ MARCA_TEMPORAL: manualStamp, ID_EQUIPO: "KA-1", PATENTE: "BCDF-12", FAENA: "BIODIVERSA", TIPO_ACCION: "CORRECTIVA", HORAS_TRABAJADAS: 4 }), // MT-9: ya existía con vínculo manual y datos distintos
    ],
    inspections: [inspection(), inspection({ ID_INSPECCION: "IN-00002", TIPO_UNIDAD: "CARRO", PATENTE_ORIGINAL: "ZZ-YY-11", PATENTE: "ZZYY-11", ID_EQUIPO: "KRR-010", KM_INSPECCION: null, BUEN_ESTADO: 12, REGULAR: 0, MAL_ESTADO: 0 })],
    findings: [
      finding({ ITEM: "Plumillas", ESTADO: "Mal estado", NIVEL: "MAL" }),
      finding({ ITEM: "Asiento conductor", ESTADO: "Regular estado", NIVEL: "REGULAR" }),
      finding({ ITEM: "Plumillas", ESTADO: "Mal estado", NIVEL: "MAL" }),                    // el mismo ítem repetido
      finding({ ID_INSPECCION: "IN-00099", ITEM: "Huérfano", ESTADO: "Mal estado", NIVEL: "MAL" }), // inspección inexistente
      finding({ ITEM: "Sin estado", ESTADO: "Raro", NIVEL: "RARO" }),
    ],
    schedules: [schedulePlain(), schedulePlain({ ES_PRUEBA: "Sí", MARCA_TEMPORAL: at("2026-10-27T11:32:11.315"), PATENTE: "SSSSSSS", ID_EQUIPO: "SSSSSSS", PAUTA: "900 HRS", REALIZADO: 35, NO_REALIZADO: 0, "%_CUMPLIMIENTO": 1 })],
    withDetail: true,
    equipment: [
      row(EQUIPO_HEADERS, { ID_EQUIPO: "KA-1", PATENTE: "BCDF-12", CATEGORIA: "Equipo", TIPO: "CAMION" }),
      row(EQUIPO_HEADERS, { ID_EQUIPO: "KA-3", PATENTE: "LPRS-99", CATEGORIA: "Equipo", TIPO: "CAMION" }),
      row(EQUIPO_HEADERS, { ID_EQUIPO: "KA-77", PATENTE: "XXXX-11", CATEGORIA: "Equipo", TIPO: "CARGADOR FRONTAL" }),
      row(EQUIPO_HEADERS, { ID_EQUIPO: "DEIBIS", PATENTE: null, CATEGORIA: "No es equipo (persona/lugar/genérico)", TIPO: null }),
    ],
  })
}, 180_000)

describe.sequential("importador del consolidado de mantención", () => {
  it("la simulación informa lo que haría y no escribe nada", async () => {
    const before = await tables()
    const result = await importConsolidated(actor, source, "CONSOLIDADO.xlsx", { apply: false })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.data.applied).toBe(false)
    expect(result.data.sheets.maintenance).toMatchObject({ total: 9, created: 6, completed: 2, rejected: 1, test: 1, unchanged: 0 })
    expect(result.data.scheduleItems).toMatchObject({ read: 5, created: 5 })
    expect(await tables()).toBe(before)
    expect(await audits()).toHaveLength(0)
  })

  it("aplica en una transacción, con auditoría, y cuadra el total de cada hoja", async () => {
    const result = await importConsolidated(actor, source, "CONSOLIDADO.xlsx", { apply: true })
    if (!result.ok) throw new Error(result.message)
    const { maintenance, inspections, findings, scheduleChecks } = result.data.sheets
    expect(maintenance).toMatchObject({ total: 9, created: 6, completed: 2, unchanged: 0, rejected: 1, linked: 6, unmatched: 1, conflicts: 1, withoutWorksite: 1 })
    expect(maintenance.total).toBe(maintenance.created + maintenance.completed + maintenance.unchanged + maintenance.rejected + maintenance.testExcluded)
    expect(inspections).toMatchObject({ total: 2, created: 2, linked: 1, unmatched: 1 })
    expect(findings).toMatchObject({ total: 5, created: 3, rejected: 2 })
    expect(scheduleChecks).toMatchObject({ total: 2, created: 2, test: 1, linked: 1, unmatched: 1 })
    expect(await records()).toHaveLength(8)
    expect(await testDb.select().from(schema.mantHistoricalInspections)).toHaveLength(2)
    expect(await testDb.select().from(schema.mantHistoricalFindings)).toHaveLength(3)
    expect(await testDb.select().from(schema.mantHistoricalScheduleChecks)).toHaveLength(2)
    expect(await testDb.select().from(schema.mantHistoricalScheduleItems)).toHaveLength(5)
    expect(result.data.scheduleItems).toMatchObject({ read: 5, created: 5 })
    const [importedPauta] = await testDb.select().from(schema.mantHistoricalScheduleChecks).where(eq(schema.mantHistoricalScheduleChecks.vehicleId, "v1"))
    expect(importedPauta).toMatchObject({ mechanic: "Mecánico de prueba", filtersPhotoUrl: "https://drive.google.com/open?id=img" })
    const audit = await audits()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ userId: actor.userId, action: "create" })
    expect(await testDb.select().from(schema.mantRecords)).toHaveLength(0)
  })

  it("importa la fila nueva con sus columnas de origen y sin fotos", async () => {
    const row1 = await byRecordId("MT-00001")
    expect(row1).toMatchObject({
      vehicleId: "v1", equipmentMatch: "linked", worksiteId: "bio", actionType: "correctiva", specialties: ["mecanica", "soldadura"], laborHours: 4,
      isTest: false, contractText: null, sourceFile: "CONSOLIDADO.xlsx", sourceSheet: "MANTENCIONES", sourceRow: 2, submittedAt: "2025-08-11",
      entryDate: "2025-08-18", exitDate: "2025-08-19", description: "Trabajo 1", orderText: "1001", kindText: "CORRECTIVA",
      originSource: "Consolidado_Mantencion (form. antiguo)",
    })
    expect(row1.fields.some((field) => /FOTO/.test(field.header))).toBe(false)
    expect(row1.fields.find((field) => field.header === "MARCA_TEMPORAL")?.value).toBe("2025-08-11T18:02:30")
    expect(row1.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    const row2 = await byRecordId("MT-00002")
    expect(row2).toMatchObject({ contractText: "Residuos", worksiteId: "santa", actionType: "preventiva", laborHours: 1.5, downtimeDays: 2, specialties: ["electrica"] })
    // La clave es la del formulario: marca temporal al segundo y correo.
    expect(row1.sourceKey).toBe(stampKey(at("2025-08-11T18:02:30.807"), MAIL))
  })

  it("conserva «sin clasificar», vincula por patente y respeta el alias de faena", async () => {
    expect(await byRecordId("MT-00004")).toMatchObject({ actionType: "sin_clasificar", specialties: null, vehicleId: null, equipmentMatch: "unmatched", worksiteId: null, worksiteText: "ENAP" })
    expect(await byRecordId("MT-00007")).toMatchObject({ vehicleId: "v1", equipmentMatch: "linked" })
    expect(await byRecordId("MT-00003")).toMatchObject({ worksiteId: "arauco", worksiteText: "Horcones", qualityNotes: "Salida anterior al ingreso" })
  })

  it("un código y una patente de equipos distintos quedan en conflicto, sin elegir uno", async () => {
    expect(await byRecordId("MT-00003")).toMatchObject({ vehicleId: null, equipmentMatch: "conflict" })
  })

  it("rechaza lo que no es equipo con su motivo y no lo guarda", async () => {
    expect((await records()).some((record) => record.sourceRecordId === "MT-00005")).toBe(false)
    const result = await importConsolidated(actor, source, "CONSOLIDADO.xlsx", { apply: false })
    if (!result.ok) throw new Error(result.message)
    expect(result.data.notImported).toEqual(expect.arrayContaining([expect.objectContaining({ sheet: "MANTENCIONES", recordId: "MT-00005", kind: "rejected", reason: expect.stringMatching(/No es un equipo/) })]))
  })

  it("marca las filas de prueba en lugar de esconderlas", async () => {
    expect(await byRecordId("MT-00006")).toMatchObject({ isTest: true })
    const pautas = await testDb.select().from(schema.mantHistoricalScheduleChecks)
    expect(pautas.filter((pauta) => pauta.isTest).map((pauta) => pauta.scheduleLabel)).toEqual(["900 HRS"])
  })

  it("completa una fila preexistente sin tocar su contenido de origen", async () => {
    const completed = await byRecordId("MT-00008")
    expect(completed).toMatchObject({ actionType: "sin_clasificar", specialties: ["hidraulica"], laborHours: 3, originSource: "NUEVA_BASE_DE_DATOS_MANTENCION (form. nuevo)", vehicleId: "v1", equipmentMatch: "linked", worksiteId: "bio" })
    expect(completed.sourceKey).toBe(stampKey(preexistingStamp, MAIL))
    // Lo que ya tenía sigue igual.
    expect(completed.fields).toEqual([{ header: "Campo del formulario nuevo", value: "intacto" }])
    expect(completed).toMatchObject({ fingerprint: expect.stringMatching(/^fp-viejo-/), sourceFile: "NUEVA BASE DE DATOS MANTENCION.xlsx", sourceSheet: "BIODIVERSA", sourceRow: 5, description: "Descripción del formulario", orderText: "55", kindText: "" })
  })

  it("no sobrescribe un vínculo manual ni una columna ya cargada, y lo informa sin abortar", async () => {
    const manual = await byRecordId("MT-00009")
    expect(manual).toMatchObject({ vehicleId: "v2", worksiteId: "santa", equipmentMatch: "linked", actionType: "preventiva", laborHours: 9, contractText: "Manual" })
    // Lo que estaba vacío sí se completa.
    expect(manual.originSource).toBe("Consolidado_Mantencion (form. antiguo)")
    const result = await importConsolidated(actor, source, "CONSOLIDADO.xlsx", { apply: false })
    if (!result.ok) throw new Error(result.message)
    const detail = result.data.differences.filter((difference) => difference.recordId === "MT-00009").map((difference) => difference.detail).join(" | ")
    expect(detail).toMatch(/tipo de acción: guardado preventiva, el archivo trae correctiva/)
    expect(detail).toMatch(/horas: guardado 9, el archivo trae 4/)
    expect(detail).toMatch(/equipo: el vínculo guardado es otro equipo/)
    expect(detail).toMatch(/faena: el vínculo guardado es otra faena/)
    expect(result.data.sheets.maintenance.withDifference).toBeGreaterThan(0)
  })

  it("enlaza los hallazgos a su inspección, conserva el ítem repetido y rechaza los huérfanos", async () => {
    const inspections = await testDb.select().from(schema.mantHistoricalInspections)
    const first = inspections.find((inspection) => inspection.sourceRecordId === "IN-00001")!
    expect(first).toMatchObject({ vehicleId: "v1", worksiteId: "bio", inspectionDate: "2026-07-20", reading: 366028, goodCount: 42, regularCount: 3, badCount: 4, formKind: "CAMION" })
    expect(first.fields.some((field) => field.header === "RESPALDO")).toBe(false)
    // La marca temporal se guarda al segundo; el día inspeccionado, sólo el día.
    expect(first).toMatchObject({ submittedAt: "2026-07-20 20:44:16", inspectionDate: "2026-07-20" })
    expect(inspections.find((inspection) => inspection.sourceRecordId === "IN-00002")).toMatchObject({ vehicleId: null, equipmentMatch: "unmatched", unitKind: "CARRO", reading: null })
    const findings = await testDb.select().from(schema.mantHistoricalFindings)
    expect(findings.map((item) => [item.item, item.condition]).sort()).toEqual([["Asiento conductor", "regular"], ["Plumillas", "mal"], ["Plumillas", "mal"]])
    expect(findings.every((item) => item.inspectionSourceKey === first.sourceKey && item.foundOn === "2026-07-20")).toBe(true)
    // El primero lleva la clave que fija el contrato; el repetido, un número de orden.
    expect(findings.find((item) => item.item === "Asiento conductor")!.sourceKey).toBe(createHash("sha256").update(`${first.sourceKey}\nACCESORIOS\nAsiento conductor`).digest("hex"))
    expect(new Set(findings.map((item) => item.sourceKey)).size).toBe(3)
  })

  it("las pautas guardan el cumplimiento y el detalle por ítem", async () => {
    const pautas = await testDb.select().from(schema.mantHistoricalScheduleChecks)
    expect(pautas).toHaveLength(2)
    const real = pautas.find((pauta) => !pauta.isTest)!
    expect(real).toMatchObject({ scheduleLabel: "40.000 KM", compliance: 0.9512, doneCount: 39, notDoneCount: 2, notApplicableCount: 7, vehicleId: "v1", performedOn: "2026-07-21", reading: 402622, submittedAt: "2026-07-23 12:03:18", mechanic: "Mecánico de prueba" })
    expect(real.filtersPhotoUrl).toBe("https://drive.google.com/open?id=img")
    const items = await testDb.select().from(schema.mantHistoricalScheduleItems)
    expect(items).toHaveLength(5)
    expect(items.every((item) => item.checkSourceKey === real.sourceKey)).toBe(true)
    expect(items.map((item) => item.result)).toEqual(Array.from({ length: 5 }, () => "realizado"))
    expect(real.fields.some((field) => field.header === "IMG_FILTROS")).toBe(false)
    expect(real.fields.find((field) => field.header === "%_CUMPLIMIENTO")?.formula).toMatch(/K2/)
  })

  it("es idempotente: la segunda corrida no cambia nada", async () => {
    const before = await tables()
    const auditsBefore = (await audits()).length
    const again = await importConsolidated(actor, source, "CONSOLIDADO.xlsx", { apply: true })
    if (!again.ok) throw new Error(again.message)
    for (const counts of Object.values(again.data.sheets)) expect(counts).toMatchObject({ created: 0, completed: 0 })
    expect(again.data.sheets.maintenance).toMatchObject({ unchanged: 8, rejected: 1 })
    expect(again.data.sheets.inspections.unchanged).toBe(2)
    expect(again.data.sheets.findings.unchanged).toBe(3)
    expect(again.data.sheets.scheduleChecks.unchanged).toBe(2)
    expect(again.data.scheduleItems).toMatchObject({ read: 5, created: 0, replaced: 0, unchanged: 5 })
    expect(await tables()).toBe(before)
    expect((await audits()).length).toBe(auditsBefore)
  })

  it("con el parámetro activo las filas de prueba no se importan, pero se informan", async () => {
    await testDb.insert(schema.systemSettings).values({ key: EXCLUDE_TESTS_SETTING, value: "1" })
    const withTests = await build({
      maintenance: [maint({ MARCA_TEMPORAL: at("2025-12-01T09:00:00.000"), POSIBLE_PRUEBA: "Revisar: posible prueba" }), maint({ MARCA_TEMPORAL: at("2025-12-02T09:00:00.000") })],
      schedules: [schedulePlain({ ES_PRUEBA: "Sí", MARCA_TEMPORAL: at("2026-11-01T10:00:00.000"), PAUTA: "120.000 KM" })],
    })
    const before = (await records()).length
    const result = await importConsolidated(actor, withTests, "CONSOLIDADO-2.xlsx", { apply: true })
    if (!result.ok) throw new Error(result.message)
    expect(result.data.excludeTestRows).toBe(true)
    expect(result.data.sheets.maintenance).toMatchObject({ total: 2, created: 1, test: 1, testExcluded: 1 })
    expect(result.data.sheets.scheduleChecks).toMatchObject({ total: 1, created: 0, testExcluded: 1 })
    expect(result.data.notImported.filter((item) => item.kind === "test")).toHaveLength(2)
    expect((await records()).length).toBe(before + 1)
    await testDb.delete(schema.systemSettings).where(eq(schema.systemSettings.key, EXCLUDE_TESTS_SETTING))
  })

  it("completa is_test de falso a verdadero en una fila que ya existía", async () => {
    const stamp = at("2025-11-03T07:08:09.500")
    await testDb.insert(schema.mantHistoricalRecords).values({
      sourceKey: stampKey(stamp, MAIL), fingerprint: "fp-prueba", sourceFile: "NUEVA BASE DE DATOS MANTENCION.xlsx", sourceSheet: "MASISA", sourceRow: 3, submittedAt: "2025-11-03",
      worksiteText: "BIODIVERSA", worksiteId: "bio", equipmentText: "KA-1", vehicleId: "v1", equipmentMatch: "linked", orderText: "1", kindText: "", readingText: "0", description: "d", hoursText: "1",
      fields: [{ header: "X", value: "y" }], importedBy: actor.userId, isTest: false,
    })
    const book = await build({ maintenance: [maint({ MARCA_TEMPORAL: stamp, POSIBLE_PRUEBA: "Revisar: posible prueba" })] })
    const result = await importConsolidated(actor, book, "CONSOLIDADO-3.xlsx", { apply: true })
    if (!result.ok) throw new Error(result.message)
    expect(result.data.sheets.maintenance).toMatchObject({ total: 1, created: 0, completed: 1, test: 1 })
    const row = (await records()).find((record) => record.sourceKey === stampKey(stamp, MAIL))!
    expect(row.isTest).toBe(true)
    expect(row.fingerprint).toBe("fp-prueba")
    expect(row.fields).toEqual([{ header: "X", value: "y" }])
    const again = await importConsolidated(actor, book, "CONSOLIDADO-3.xlsx", { apply: true })
    if (!again.ok) throw new Error(again.message)
    expect(again.data.sheets.maintenance).toMatchObject({ created: 0, completed: 0, unchanged: 1 })
  })

  it("informa el conflicto de equipo que el consolidado resuelve, sin hacerlo en silencio", async () => {
    const stamp = at("2025-11-04T07:08:09.500")
    await testDb.insert(schema.mantHistoricalRecords).values({
      sourceKey: stampKey(stamp, MAIL), fingerprint: "fp-conflicto", sourceFile: "NUEVA BASE DE DATOS MANTENCION.xlsx", sourceSheet: "BIODIVERSA", sourceRow: 4, submittedAt: "2025-11-04",
      worksiteText: "BIODIVERSA", worksiteId: "bio", equipmentText: "KA-1 / GHJK-34", vehicleId: null, equipmentMatch: "conflict", orderText: "1", kindText: "", readingText: "0", description: "d", hoursText: "1",
      fields: [{ header: "X", value: "y" }], importedBy: actor.userId,
    })
    const book = await build({ maintenance: [maint({ MARCA_TEMPORAL: stamp })] })
    const simulation = await importConsolidated(actor, book, "CONSOLIDADO-4.xlsx", { apply: false })
    if (!simulation.ok) throw new Error(simulation.message)
    expect(simulation.data.resolvedConflicts).toEqual([expect.objectContaining({ sheet: "MANTENCIONES", detail: expect.stringMatching(/conflicto/) })])
    expect(formatConsolidatedReport(simulation.data)).toMatch(/Conflictos resueltos por el consolidado \(1\)/)
    const result = await importConsolidated(actor, book, "CONSOLIDADO-4.xlsx", { apply: true })
    if (!result.ok) throw new Error(result.message)
    expect((await records()).find((record) => record.sourceKey === stampKey(stamp, MAIL))).toMatchObject({ vehicleId: "v1", equipmentMatch: "linked" })
  })

  it("resuelve «CHOLGUAN» con el respaldo aunque los alias de faenas aún no estén cargados", async () => {
    const stamp = at("2025-11-05T07:08:09.500")
    const book = await build({ maintenance: [maint({ MARCA_TEMPORAL: stamp, FAENA: "CHOLGUAN" })], inspections: [inspection({ ID_INSPECCION: "IN-00050", N_FORMULARIO: 50, FAENA_GRUPO: "CHOLGUAN" })] })
    expect(await testDb.select().from(schema.worksiteAliases).where(eq(schema.worksiteAliases.aliasKey, "cholguan"))).toHaveLength(0)
    const result = await importConsolidated(actor, book, "CONSOLIDADO-5.xlsx", { apply: true })
    if (!result.ok) throw new Error(result.message)
    expect(result.data.sheets.maintenance.withoutWorksite).toBe(0)
    expect(result.data.sheets.inspections.withoutWorksite).toBe(0)
    expect((await records()).find((record) => record.sourceKey === stampKey(stamp, MAIL))).toMatchObject({ worksiteId: "cholguan" })
  })

  it("el formulario nuevo y el consolidado producen la misma clave de identidad", async () => {
    const formHeaders = ["Marca temporal", "Dirección de correo electrónico", "Puntuación", "FAENA", "Orden de trabajo", "TIPO DE ACCION", "ACEITE", "TIPO DE TRABAJO", "QUIEN", "EXTERNO", "CONDUCTOR", "Equipo", "ODOMETRO U HOROMETRO", "TRABAJO REALIZADO", "REPUESTOS", "FECHA INGRESO EQUIPO TALLER", "FECHA SALIDA TALLER", "HORAS TRABAJADAS", "FOTOGRAFIA"]
    const email = "Otro.Correo@Example.test "
    const stamps: Array<Date | string> = [at("2025-12-10T14:15:16.789"), "10/12/2025 14:15:17"]
    const formBook = new ExcelJS.Workbook(); const sheet = formBook.addWorksheet("BIODIVERSA"); sheet.addRow(formHeaders)
    for (const stamp of stamps) sheet.addRow([stamp, email, 0, "BIODIVERSA", "1", "CORRECTIVA", "", "MECANICO", "Mecánico", "", "", "KA-1 / BCDF-12", 0, "Trabajo", "", "18/08/2025", "19/08/2025", 2, ""])
    const fromForm = await parseHistoricalWorkbook(await formBook.xlsx.writeBuffer() as ArrayBuffer)
    const fromConsolidated = await parseConsolidatedWorkbook(await build({ maintenance: stamps.map((stamp) => maint({ MARCA_TEMPORAL: typeof stamp === "string" ? at("2025-12-10T14:15:17.000") : stamp, CORREO: email })) }))
    if (!fromForm.ok) throw new Error(fromForm.message)
    if (!fromConsolidated.ok) throw new Error(fromConsolidated.message)
    expect(fromConsolidated.data.maintenance.map((row) => row.sourceKey)).toEqual(fromForm.rows.map((row) => row.sourceKey))
    expect(new Set(fromForm.rows.map((row) => row.sourceKey)).size).toBe(2)
  })

  it("el informe no trae correos ni nombres de personas", async () => {
    const result = await importConsolidated(actor, source, "C:\\datos\\CONSOLIDADO.xlsx", { apply: false })
    if (!result.ok) throw new Error(result.message)
    const report = formatConsolidatedReport(result.data)
    expect(result.data.fileName).toBe("CONSOLIDADO.xlsx")
    expect(report).toContain("simulación")
    for (const forbidden of [MAIL, "@", "DEIBIS", "Mecánico de prueba", "Conductor de prueba", "Ejecutante de prueba", "PEREZ"]) expect(report).not.toContain(forbidden)
    expect(report).toContain("MT-00005")
    expect(report).toContain("Sin fecha de salida de taller (95)")
    expect(report).toMatch(/KA-77 · patente XXXX-11/)
    expect(report).toMatch(/KA-3: consolidado LPRS-99, flota LPRS56/)
    expect(report).toMatch(/ENAP/)
  })

  it("un archivo que no es el consolidado aborta antes de escribir", async () => {
    const before = await tables()
    const wrongBook = new ExcelJS.Workbook()
    wrongBook.addWorksheet("MANTENCIONES").addRow(["ID_REGISTRO", "FAENA"])
    expect(await importConsolidated(actor, await wrongBook.xlsx.writeBuffer() as ArrayBuffer, "otro.xlsx", { apply: true })).toMatchObject({ ok: false, message: expect.stringMatching(/faltan las hojas/) })
    const withoutCode = await build({ maintenance: [], maintenanceHeaders: MANT_HEADERS.filter((header) => header !== "ID_EQUIPO") })
    expect(await importConsolidated(actor, withoutCode, "otro.xlsx", { apply: true })).toMatchObject({ ok: false, message: expect.stringMatching(/falta ID_EQUIPO/) })
    expect(await tables()).toBe(before)
  })

  it("rechaza una fila sin marca temporal o repetida, sin abortar el resto", async () => {
    const original = maint({ MARCA_TEMPORAL: at("2026-01-05T10:00:00.000") })
    const copy = original.map((value, index) => (index === 0 ? "MT-COPIA" : value))
    const result = await parseConsolidatedWorkbook(await build({ maintenance: [original, copy, maint({ MARCA_TEMPORAL: null }), maint({ CORREO: null })] }))
    if (!result.ok) throw new Error(result.message)
    expect(result.data.maintenance).toHaveLength(1)
    expect(result.data.rejected.map((rejected) => rejected.reason)).toEqual([
      expect.stringMatching(/posible duplicado/), expect.stringMatching(/marca temporal válida/), expect.stringMatching(/correo de origen/),
    ])
  })

  it("lee un libro con gráficos, que ExcelJS no puede cargar tal cual", async () => {
    const zip = await JSZip.loadAsync(source)
    const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string")
    zip.file("xl/worksheets/sheet1.xml", sheetXml.replace("</worksheet>", '<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></worksheet>'))
    zip.file("xl/worksheets/_rels/sheet1.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/drawing1.xml" Id="rId1"/></Relationships>')
    zip.file("xl/drawings/drawing1.xml", '<wsDr xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><oneCellAnchor><from><col>12</col><colOff>0</colOff><row>3</row><rowOff>0</rowOff></from><ext cx="6120000" cy="2700000"/><graphicFrame><nvGraphicFramePr><cNvPr id="1" name="Chart 1"/><cNvGraphicFramePr/></nvGraphicFramePr><xfrm/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></graphicFrame><clientData/></oneCellAnchor></wsDr>')
    zip.file("xl/drawings/_rels/drawing1.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="/xl/charts/chart1.xml" Id="rId1"/></Relationships>')
    zip.file("xl/charts/chart1.xml", '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>')
    const withChart = await zip.generateAsync({ type: "uint8array" })
    const stripped = await stripDrawings(withChart)
    expect(stripped).not.toBeNull()
    expect(Object.keys((await JSZip.loadAsync(stripped!)).files).some((name) => /drawings|charts/.test(name))).toBe(false)
    const parsed = await parseConsolidatedWorkbook(withChart)
    if (!parsed.ok) throw new Error(parsed.message)
    expect(parsed.data.maintenance).toHaveLength(9)
    expect(parsed.data.rejected.map((rejected) => rejected.sheet)).toEqual(["HALLAZGOS_INSPECCION", "HALLAZGOS_INSPECCION"])
    // La tabla de detalle de las pautas se lee como ítems, no como pautas nuevas.
    expect(parsed.data.scheduleChecks).toHaveLength(2)
    expect(parsed.data.scheduleItems).toHaveLength(5)
    expect(parsed.data.notes.join(" ")).toMatch(/5 ítems de detalle leídos/)
  })
})
