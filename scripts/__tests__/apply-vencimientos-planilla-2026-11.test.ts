import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import ExcelJS from "exceljs"
import JSZip from "jszip"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { computeRutDv } from "@/lib/rut"
import * as schema from "@/db/schema"

// El script importa `@/db` estáticamente: se importa dinámicamente dentro de
// cada test, una vez asignado `testGlobal.__db`.

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const ACTOR = "jefatura@chome.test"
const UNCLASSIFIED = "worker-position-unclassified"

/* ── Planilla sintética ───────────────────────────────────────────────────── */
// Todo inventado: patentes, RUT (con dígito verificador válido) y nombres no
// corresponden a nadie. La planilla real no entra al repositorio.

const rut = (body: string) => `${body}-${computeRutDv(body)}`
/** El mismo RUT escrito con puntos, como lo escribe la planilla. */
const dotted = (value: string) => value.replace(/^(\d+)(\d{3})(\d{3})-(.)$/, "$1.$2.$3-$4")
const date = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

const R = {
  w1: rut("90000001"), w2: rut("90000002"), w3: rut("90000003"), w4: rut("90000004"),
  w5: rut("90000005"), w6: rut("90000006"), w7: rut("90000007"),
  n1: rut("91000001"), n2: rut("91000002"), n3: rut("91000003"),
}
const BAD_RUT = (() => { const body = "91000004"; const dv = computeRutDv(body); return `${body}-${dv === "0" ? "1" : "0"}` })()

type Cell = Date | string | null
type MachineInput = [faena: string | null, machine: string | null, code: string | null, plate: string | null, soap: Cell, permit: Cell, review: Cell]
type WorkerInput = [faena: string | null, name: string | null, rut: string | null, cargo: string | null, classes: string | null, expires: Cell, notes: string | null]

const MACHINES: MachineInput[] = [
  ["Horcones", "Camión", "KA.20", "TEST-11", date("2099-01-01"), date("2099-01-02"), date("2099-01-03")],
  ["Masisa maderas", "Camión", "KA-2", "TEST-22", null, date("2099-03-03"), date("2099-04-04")],
  ["Biodiversa", "Tracto camión", "KCH-2", "TEST-33", date("2099-05-05"), date("2099-05-06"), date("2099-05-07")],
  ["Biodiversa", "Tracto camión", "KCH-1", "TEST-44", date("2099-06-05"), date("2099-06-06"), date("2099-06-07")],
  ["Masisa tableros", "Camión", null, "TEST-55", date("2099-07-07"), date("2099-07-08"), date("2099-07-09")],
  ["Masisa tableros", "Camión", "KA-9", "NEW-11", "30-09-2099", date("2099-09-30"), date("2099-04-13")],
  ["Biodiversa", "Carro", "NO TIENE CODIGO", "NEW-22", date("2099-08-01"), date("2099-08-02"), date("2099-08-03")],
  ["Horcones", "Batea", null, "NEW-33", date("2099-08-04"), date("2099-08-05"), date("2099-08-06")],
  ["Biodiversa", "Tracto camión", "INTERNO 7", "NEW-44", date("2099-08-07"), date("2099-08-08"), date("2099-08-09")],
  ["Biodiversa", "Camión", "KA-77", "OLD-11", date("2020-01-01"), date("2019-06-01"), date("2020-03-01")],
  ["Teno", "Camión", "KA-88", "LOST-1", date("2099-01-01"), date("2099-01-01"), date("2099-01-01")],
  ["Biodiversa", "Camión", "KA-66", "REP-1", date("2099-01-01"), date("2099-01-01"), date("2099-01-01")],
  ["Biodiversa", "Camión", "KA-67", "REP-1", date("2099-01-01"), date("2099-01-01"), date("2099-01-01")],
  ["Biodiversa", "Montacargas", "KA-55", "GRUA-1", date("2099-01-01"), date("2099-01-01"), date("2099-01-01")],
  ["Biodiversa", "Camión", "KA-44", null, date("2099-01-01"), date("2099-01-01"), date("2099-01-01")],
]

const WORKERS: WorkerInput[] = [
  ["Masisa tableros", "UNO PRUEBA SOTO", dotted(R.w1), "Chofer", "A2/A4/B", date("2020-06-01"), "Prorroga por 6 meses"],
  ["Biodiversa", "DOS PRUEBA SOTO", dotted(R.w2), "CONDUCTOR", "A5", date("2099-05-05"), null],
  ["Horcones", "TRES PRUEBA SOTO", dotted(R.w3), "supervisor", "b", date("2099-06-06"), null],
  ["Biodiversa", "CUATRO PRUEBA SOTO", dotted(R.w4), "PREV DE RIESGOS", "B", date("2099-01-01"), null],
  ["Biodiversa", "CINCO PRUEBA SOTO", dotted(R.w5), "CONDUCTOR/MECANICO", "A9", date("2099-02-02"), null],
  ["Biodiversa", "SEIS PRUEBA SOTO", dotted(R.w6), "OPERARIO ESPECIAL", "B", null, null],
  ["Masisa maderas", "SIETE PRUEBA SOTO", dotted(R.w7), "Chofer", "A2", date("2099-01-01"), null],
  ["Horcones", "ANA PRUEBA SOTO", dotted(R.n1), "conductor", "a3, a5", date("2099-03-03"), null],
  ["Horcones", "PEDRO LUIS DE LA PRUEBA MUESTRA", dotted(R.n2), "conductor", "a1,a2,b,d", date("2099-07-07"), "LEY 21.806"],
  ["Teno", "OCHO PRUEBA SOTO", dotted(R.n3), "conductor", "A5", date("2099-01-01"), null],
  ["Horcones", "NUEVE PRUEBA SOTO", dotted(BAD_RUT), "conductor", "A5", date("2099-01-01"), null],
]

const MACHINE_HEADERS = ["Faena", "Máquina", "Código interno", "Patente", "Venc. SOAP", "Venc. Permiso de circulación", "Venc. Revisión técnica", "Próximo vencimiento", "Documento", "Días restantes", "Estado"]
const WORKER_HEADERS = ["Faena", "Nombre trabajador", "RUT", "Cargo", "Clase licencia", "Venc. licencia de conducir", "Días restantes", "Estado", "Observaciones"]

/** La misma forma que la planilla real: fila 1 = instrucción combinada, fila 2 = encabezados, columnas calculadas con fórmula. */
async function buildPlanilla(options: { machines?: MachineInput[]; workers?: WorkerInput[]; machineHeaders?: string[]; shiftMachines?: boolean } = {}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet("Resumen").addRow(["Resumen de vencimientos al", null, date("2026-11-05")])

  const machines = workbook.addWorksheet("Máquinas")
  machines.addRow(["Completa solo las celdas amarillas (A a G). Fila 3 = ejemplo, bórrala o reemplázala."])
  machines.mergeCells("A1:K1")
  // `shiftMachines` mete una columna delante: todas las letras se corren un lugar y los nombres de encabezado siguen valiendo.
  const lead = options.shiftMachines ? ["Nota"] : []
  machines.addRow([...lead, ...(options.machineHeaders ?? MACHINE_HEADERS)])
  for (const [index, input] of (options.machines ?? MACHINES).entries()) {
    machines.addRow([...lead.map(() => "x"), ...input, { formula: `MIN(E${index + 3}:G${index + 3})`, result: 73_050 }, "SOAP", 1000, "Vigente"])
  }

  const workers = workbook.addWorksheet("Trabajadores")
  workers.addRow(["Completa solo las celdas amarillas (A a F). Fila 3 = ejemplo, bórrala o reemplázala."])
  workers.mergeCells("A1:H1")
  workers.addRow(WORKER_HEADERS)
  for (const [index, input] of (options.workers ?? WORKERS).entries()) {
    const [faena, name, workerRut, cargo, classes, expires, notes] = input
    workers.addRow([faena, name, workerRut, cargo, classes, expires, { formula: `F${index + 3}-TODAY()`, result: 100 }, "Vigente", notes])
  }
  // Las fechas llevan formato de fecha, como en la planilla real (si no, Excel las lee como números).
  for (const sheet of [machines, workers]) {
    sheet.eachRow((row) => row.eachCell((cell) => { if (cell.value instanceof Date) cell.numFmt = "dd-mm-yyyy" }))
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

/* ── Base ─────────────────────────────────────────────────────────────────── */

const script = () => import("../apply-vencimientos-planilla-2026-11")

async function run(apply: boolean, buffer?: Buffer) {
  const { applyVencimientosPlanilla202611 } = await script()
  return applyVencimientosPlanilla202611({ actorEmail: ACTOR, apply, buffer: buffer ?? await buildPlanilla() })
}

async function one<T>(rows: PromiseLike<T[]>): Promise<T> {
  const [row] = await rows
  if (!row) throw new Error("fila esperada")
  return row
}

const vehicle = (plate: string) => one(inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.plate, plate)))
const worker = (id: string) => one(inMemoryDb.select().from(schema.workers).where(eq(schema.workers.id, id)))
const workerByRut = (value: string) => one(inMemoryDb.select().from(schema.workers).where(eq(schema.workers.rut, value)))
const license = async (workerId: string) => (await inMemoryDb.select().from(schema.workerDriverLicenses).where(eq(schema.workerDriverLicenses.workerId, workerId)))[0]
const positionNamed = (name: string) => one(inMemoryDb.select().from(schema.workerPositions).where(eq(schema.workerPositions.name, name)))

/** La forma de producción: faenas, equipos y trabajadores ya cargados, «Chofer Camión» como único cargo con gente. */
beforeEach(async () => {
  await pg.exec(`TRUNCATE audit_log, worker_driver_licenses, worker_position_history, worker_position_aliases, worker_position_capabilities,
    workers, fuel_provider_mappings, fuel_vehicle_products, fuel_vehicle_operational_intervals, fuel_vehicles, worksites, users CASCADE`)
  // «Sin clasificar» es un cargo de sistema que el catálogo necesita: se conserva.
  await pg.exec("DELETE FROM worker_positions WHERE is_system = false")
  await pg.exec("DELETE FROM fuel_equipment_types WHERE slug IN ('carro', 'batea')")

  await inMemoryDb.insert(schema.users).values({ id: "u-actor", name: "Jefatura", email: ACTOR, hashedPassword: "x" })
  await inMemoryDb.insert(schema.worksites).values([
    { id: "w-mas", name: "Masisa", code: "MASISA", isActive: true },
    { id: "w-bio", name: "Biodiversa", code: "BIODIVERSA", isActive: true },
    { id: "w-hor", name: "Horcones", code: "HORCONES", isActive: true },
    { id: "w-cho", name: "Cholguan - Arauco", code: "CHOLGUAN-ARAUCO", isActive: true },
    { id: "w-mas-old", name: "Masisa", code: "FA-006", isActive: false },
  ])
  await inMemoryDb.insert(schema.fuelVehicles).values([
    { id: "v-mov", plate: "TEST-11", code: "KA-1", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-cho" },
    { id: "v-same", plate: "TEST-22", code: "KA-2", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-mas", soapExpiresAt: "2026-05-01" },
    { id: "v-sw1", plate: "TEST-33", code: "KCH-1", type: "tracto", equipmentTypeId: "fet-tracto", worksiteId: "w-bio" },
    { id: "v-sw2", plate: "TEST-44", code: "KCH-2", type: "tracto", equipmentTypeId: "fet-tracto", worksiteId: "w-bio" },
    // La patente sin guion de la base y la de la planilla son el mismo equipo; la planilla no trae código y no borra el suyo.
    { id: "v-nodash", plate: "TEST55", code: "KA-5", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-mas" },
  ])
  await inMemoryDb.insert(schema.fuelProviderMappings).values({
    id: "m-mov", provider: "copec", sourceAccount: "acc", externalKey: "TEST11", normalizedValue: "TEST11",
    worksiteId: "w-cho", vehicleId: "v-mov", decidedBy: "u-actor", reason: "prueba", effectiveFrom: "2020-01-01",
  })

  await inMemoryDb.insert(schema.workerPositions).values([
    { id: "pos-chofer", code: "AUTO-TEST1", name: "Chofer Camión", normalizedKey: "chofer camion", needsReview: true },
    { id: "pos-bodega", code: "AUTO-TEST2", name: "Jefe de bodega", normalizedKey: "jefe de bodega", needsReview: true },
  ])
  const base = { isActive: true, positionId: UNCLASSIFIED, position: "Sin clasificar" }
  await inMemoryDb.insert(schema.workers).values([
    { id: "wk1", rut: R.w1, firstName: "Uno", lastName: "Prueba Soto", worksiteId: "w-mas", ...base },
    { id: "wk2", rut: R.w2, firstName: "Dos", lastName: "Prueba Soto", worksiteId: "w-bio", ...base, positionId: "pos-chofer", position: "Chofer Camión" },
    { id: "wk3", rut: R.w3, firstName: "Tres", lastName: "Prueba Soto", worksiteId: "w-hor", ...base, positionId: "pos-bodega", position: "Jefe de bodega" },
    { id: "wk4", rut: R.w4, firstName: "Cuatro", lastName: "Prueba Soto", worksiteId: "w-bio", ...base, isActive: false },
    { id: "wk5", rut: R.w5, firstName: "Cinco", lastName: "Prueba Soto", worksiteId: "w-bio", ...base },
    { id: "wk6", rut: R.w6, firstName: "Seis", lastName: "Prueba Soto", worksiteId: "w-bio", ...base },
    { id: "wk7", rut: R.w7, firstName: "Siete", lastName: "Prueba Soto", worksiteId: "w-mas", ...base },
  ])
})

/* ── Funciones puras ──────────────────────────────────────────────────────── */

describe("lectura de la planilla", () => {
  it("normaliza el código interno: «KA.137» es «KA-137» y «NO TIENE CODIGO» es sin código", async () => {
    const { normalizeEquipmentCode } = await script()
    expect(normalizeEquipmentCode("KA.137")).toEqual({ code: "KA-137", invalid: false })
    expect(normalizeEquipmentCode(" kch 135 ")).toEqual({ code: "KCH-135", invalid: false })
    expect(normalizeEquipmentCode("KRR-09")).toEqual({ code: "KRR-09", invalid: false })
    expect(normalizeEquipmentCode("NO TIENE CODIGO")).toEqual({ code: null, invalid: false })
    expect(normalizeEquipmentCode(null)).toEqual({ code: null, invalid: false })
    expect(normalizeEquipmentCode("INTERNO 7")).toEqual({ code: null, invalid: true })
  })

  it("separa nombre y apellidos: las dos últimas palabras (con sus partículas) son los apellidos", async () => {
    const { splitFullName } = await script()
    expect(splitFullName("ANA PRUEBA SOTO")).toMatchObject({ firstName: "Ana", lastName: "Prueba Soto" })
    expect(splitFullName("PEDRO LUIS DE LA PRUEBA MUESTRA")).toMatchObject({ firstName: "Pedro Luis", lastName: "De la Prueba Muestra" })
    expect(splitFullName("ana de soto")).toMatchObject({ firstName: "Ana", lastName: "De Soto" })
    expect(splitFullName("ana soto")).toMatchObject({ firstName: "Ana", lastName: "Soto" })
    expect(splitFullName("ANA")).toBeNull()
    expect(splitFullName(null)).toBeNull()
  })

  it("busca las columnas por su nombre, no por su letra, y lee la fila 3 como un dato real", async () => {
    const { readPlanilla } = await script()
    const shifted = await readPlanilla(await buildPlanilla({ shiftMachines: true }))
    expect(shifted.machines[0]).toMatchObject({ row: 3, plate: "TEST-11", code: "KA-20", dates: { soap: "2099-01-01" } })
    expect(shifted.machines).toHaveLength(14)
    const data = await readPlanilla(await buildPlanilla())
    expect(data.machines[0]).toMatchObject({ row: 3, plate: "TEST-11", code: "KA-20", dates: { soap: "2099-01-01", permit: "2099-01-02", review: "2099-01-03" } })
    expect(data.machines.find((m) => m.plate === "NEW-11")?.dates.soap).toBe("2099-09-30")
    expect(data.machines.find((m) => m.plate === "NEW-22")?.code).toBeNull()
    expect(data.workers[0]).toMatchObject({ row: 3, rut: R.w1, cargo: "Chofer", classes: "A2/A4/B", expiresAt: "2020-06-01", notes: "Prorroga por 6 meses" })
    // La fila sin patente no es un equipo: queda en las filas omitidas.
    expect(data.skipped.map((note) => note.detail)).toEqual(["no trae patente"])
  })

  it("avisa qué columna falta en vez de leer mal", async () => {
    const { readPlanilla } = await script()
    const headers = MACHINE_HEADERS.map((header) => (header === "Patente" ? "Placa" : header))
    await expect(readPlanilla(await buildPlanilla({ machineHeaders: headers }))).rejects.toThrow(/Patente/)
  })
})

/* ── Chome_Control_Vencimientos_FINAL (2026-11-08) ────────────────────────── */
// Misma información que el consolidado más la faena Cholguán, con otra forma:
// tres filas de título antes de los encabezados, columnas de trazabilidad al
// final, hojas como tablas de Excel y el paquete escrito con OpenXML SDK (XML con
// prefijo `x:` y relaciones con ruta absoluta), que ExcelJS no abre tal cual.

const FINAL_MACHINE_HEADERS = ["Faena", "Máquina", "Código interno", "Patente", "Venc. SOAP", "Venc. permiso circulación", "Venc. revisión técnica", "Próximo vencimiento", "Documento crítico", "Días restantes", "Estado", "Observaciones", "Archivo origen", "Fila origen", "Faena original"]
const FINAL_WORKER_HEADERS = ["Faena", "Nombre trabajador", "RUT", "Cargo", "Clase licencia", "Venc. licencia conducir", "Días restantes", "Estado", "Observaciones", "Archivo origen", "Fila origen", "Faena original"]

/** Reescribe un .xlsx de ExcelJS como lo hace OpenXML SDK: elementos con prefijo `x:` y relaciones de tablas con ruta absoluta. */
async function asOpenXmlSdk(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer)
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  for (const entry of Object.values(zip.files)) {
    if (/^xl\/(workbook|styles|sharedStrings)\.xml$|^xl\/(worksheets|tables)\/[^/]+\.xml$/.test(entry.name)) {
      const xml = await entry.async("string")
      zip.file(entry.name, xml.replace(/<(\/?)([A-Za-z]\w*)(?=[\s/>])/g, "<$1x:$2").replace(`xmlns="${main}"`, `xmlns:x="${main}"`))
    } else if (/^xl\/worksheets\/_rels\/.+\.rels$/.test(entry.name)) {
      zip.file(entry.name, (await entry.async("string")).replace(/Target="\.\.\/tables\//g, 'Target="/xl/tables/'))
    }
  }
  return zip.generateAsync({ type: "nodebuffer" })
}

async function buildFinalPlanilla(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet("Resumen").addRow(["CHOME | CONTROL CONSOLIDADO"])

  const machines = workbook.addWorksheet("Máquinas")
  machines.addRow(["CONTROL DE VENCIMIENTOS | FLOTA"])
  machines.addRow(["3 registros consolidados • Fechas y estados automáticos"])
  machines.addRow([])
  machines.addTable({
    name: "FlotaPrueba", ref: "A4", headerRow: true, style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: FINAL_MACHINE_HEADERS.map((name) => ({ name })),
    rows: [
      ["Horcones", "camion", "KA.20", "TEST-11", date("2099-01-01"), date("2099-01-02"), date("2099-01-03"), date("2099-01-01"), "SOAP", 100, "VIGENTE", null, "Control_vencimientos_Chome-2.xlsx", 4, "Horcones"],
      ["Masisa Maderas", "TRACTO CAMION", "KCH-2", "TEST-22", date("2099-03-03"), null, date("2099-04-04"), date("2099-03-03"), "SOAP", 100, "VIGENTE", "Taller", "Control_vencimientos_Chome.xlsx", 5, "Masisa maderas"],
      ["Cholguán Máquinas", "Camión", null, "TEST-33", null, null, null, null, null, null, "SIN FECHA", null, "Control_vencimientos_Cholguan.xlsx", 23, "Cholguan maquinas"],
    ],
  })

  const workers = workbook.addWorksheet("Trabajadores")
  workers.addRow(["CONTROL DE VENCIMIENTOS | PERSONAL"])
  workers.addRow(["2 trabajadores consolidados"])
  workers.addRow([])
  workers.addTable({
    name: "PersonalPrueba", ref: "A4", headerRow: true, style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: FINAL_WORKER_HEADERS.map((name) => ({ name })),
    rows: [
      ["Masisa Maderas", "UNO PRUEBA SOTO", dotted(R.w1), "Chofer", "A2/A4/B", date("2099-06-01"), 100, "VIGENTE", "Prorroga por 6 meses", "Control_vencimientos_Chome.xlsx", 7, "Masisa maderas"],
      ["Masisa Tableros", "DOS PRUEBA SOTO", dotted(R.w2), "CONDUCTOR", "A5", date("2099-05-05"), 100, "VIGENTE", null, "Control_vencimientos_Chome.xlsx", 6, "Masisa tableros"],
    ],
  })
  for (const sheet of [machines, workers]) {
    sheet.eachRow((row) => row.eachCell((cell) => { if (cell.value instanceof Date) cell.numFmt = "dd-mm-yyyy" }))
  }
  return asOpenXmlSdk(Buffer.from(await workbook.xlsx.writeBuffer()))
}

describe("planilla FINAL (encabezados en la fila 4, tablas y XML de OpenXML SDK)", () => {
  it("ExcelJS no la abre tal cual: es el caso que cubre el lector", async () => {
    const raw = new ExcelJS.Workbook()
    await expect(raw.xlsx.load(await buildFinalPlanilla() as never)).rejects.toThrow()
  })

  it("lee máquinas y trabajadores: salta las filas de título y toma las columnas por su nombre", async () => {
    const { readPlanilla } = await script()
    const data = await readPlanilla(await buildFinalPlanilla())
    expect(data.machines).toHaveLength(3)
    expect(data.machines[0]).toMatchObject({ row: 5, faena: "Horcones", machine: "camion", code: "KA-20", plate: "TEST-11", dates: { soap: "2099-01-01", permit: "2099-01-02", review: "2099-01-03" } })
    expect(data.machines[1]).toMatchObject({ row: 6, faena: "Masisa Maderas", machine: "TRACTO CAMION", plate: "TEST-22", dates: { soap: "2099-03-03", permit: null, review: "2099-04-04" } })
    expect(data.machines[2]).toMatchObject({ faena: "Cholguán Máquinas", plate: "TEST-33", code: null })
    expect(data.workers).toHaveLength(2)
    expect(data.workers[0]).toMatchObject({ row: 5, rut: R.w1, cargo: "Chofer", classes: "A2/A4/B", expiresAt: "2099-06-01", notes: "Prorroga por 6 meses" })
    expect(data.workers[1]).toMatchObject({ row: 6, rut: R.w2, faena: "Masisa Tableros", expiresAt: "2099-05-05" })
    expect(data.skipped).toEqual([])
  })

  it("con la planilla FINAL el plan se aplica igual que con el consolidado; «Cholguán Máquinas» resuelve a «Cholguan - Arauco»", async () => {
    const { applyVencimientosPlanilla202611 } = await script()
    const report = await applyVencimientosPlanilla202611({ actorEmail: ACTOR, apply: false, buffer: await buildFinalPlanilla() })
    // Alias confirmado por el usuario (2026-11-12): la fila de Cholguán ya no se omite.
    expect(report.outcomes.find((o) => o.item === "TEST-33")).toMatchObject({ result: "dry-run" })
    expect(report.outcomes.filter((o) => o.item.startsWith("TEST-") && o.result === "dry-run").length).toBeGreaterThan(0)
    // Dos trabajadores con RUT distinto: el RUT identifica y no hace falta el respaldo por nombre.
    expect(report.review.filter((note) => note.kind === "identificado_por_nombre")).toEqual([])
  }, 60_000)
})

/* ── Marca, modelo y año de los equipos nuevos ────────────────────────────── */

describe("datos de los 15 carros y bateas nuevos", () => {
  const PLATES = ["PWTD-82", "HGKG-54", "JP-3896", "JN-6770", "JN-9374", "JN-9376", "JWPY-64", "PWTY-84", "PWTY-85", "PWYL-34", "PWYL-35", "JA-1225", "PWTK-77", "JK-2385", "HGKG-53"]
  const BATEAS = new Set(["JN-6770", "JN-9374", "JN-9376", "JWPY-64", "PWTK-77", "JK-2385"])

  it("trae marca y año de cada uno, y deja el modelo en null cuando no informa nada", async () => {
    const { NEW_VEHICLE_DETAILS } = await script()
    expect(Object.keys(NEW_VEHICLE_DETAILS).sort()).toEqual([...PLATES].sort())
    for (const [plate, details] of Object.entries(NEW_VEHICLE_DETAILS)) {
      expect(details, plate).not.toBeNull()
      expect(details!.brand, plate).toMatch(/^[A-Z][a-z]+$/)
      expect(details!.year, plate).toBeGreaterThanOrEqual(2000)
      expect(details!.year, plate).toBeLessThanOrEqual(2026)
      // Un modelo que repite la marca o se declara genérico no es un modelo.
      if (details!.model) {
        expect(details!.model.toLowerCase(), plate).not.toBe(details!.brand!.toLowerCase())
        // «Genérico» se conserva tal cual viene (JP-3896, decisión del usuario 2026-11-12).
        expect(details!.model, plate).not.toMatch(/^sin modelo$|^hehizo$/i)
        expect(details!.model, plate).toBe(details!.model.trim())
      }
    }
    expect(NEW_VEHICLE_DETAILS["PWTD-82"]).toEqual({ brand: "Emes", model: "PLANO 2 EJES", year: 2022 })
    expect(NEW_VEHICLE_DETAILS["HGKG-54"]).toEqual({ brand: "Rocongu", model: null, year: 2017 })
    expect(NEW_VEHICLE_DETAILS["JP-3896"]).toEqual({ brand: "Rocongu", model: "PLANO DE 2 EJES GENÉRICO", year: 2015 })
  })

  it("al crear los equipos los guarda en la ficha", async () => {
    const machines: MachineInput[] = PLATES.map((plate) => ["Biodiversa", BATEAS.has(plate) ? "Batea" : "Carro", null, plate, date("2099-01-01"), date("2099-01-02"), date("2099-01-03")])
    await run(true, await buildPlanilla({ machines, workers: [] }))
    expect(await vehicle("PWTD-82")).toMatchObject({ brand: "Emes", model: "PLANO 2 EJES", year: 2022, type: "carro" })
    expect(await vehicle("HGKG-54")).toMatchObject({ brand: "Rocongu", model: null, year: 2017 })
    expect(await vehicle("JN-9374")).toMatchObject({ brand: "Tremac", model: "SRTT20 3N", year: 2014, type: "batea" })
    expect(await vehicle("PWTK-77")).toMatchObject({ brand: "Emes", model: "Semiremolque MELO", year: 2025, type: "batea" })
    for (const plate of PLATES) {
      const row = await vehicle(plate)
      expect(row.brand, plate).toBeTruthy()
      expect(row.year, plate).toBeTruthy()
    }
  }, 60_000)
})

/* ── Dry-run ──────────────────────────────────────────────────────────────── */

describe("planilla de vencimientos 2026-11", () => {
  it("en dry-run informa el plan completo y no escribe nada", async () => {
    const report = await run(false)

    expect(report.outcomes.filter((o) => o.result === "aplicado")).toEqual([])
    expect(report.outcomes.filter((o) => o.step.startsWith("1")).map((o) => [o.item, o.result])).toEqual([["Carro", "dry-run"], ["Batea", "dry-run"]])
    // El tipo y los equipos nuevos todavía no existen: el plan lo dice en vez de omitirlos.
    expect(report.outcomes.find((o) => o.item === "NEW-22" && o.action.startsWith("alta"))).toMatchObject({ result: "dry-run", detail: "el tipo se crea en este mismo plan" })
    expect(report.outcomes.find((o) => o.item === "NEW-22" && o.action.startsWith("SOAP"))).toMatchObject({ result: "dry-run", detail: "el equipo se crea en este mismo plan" })
    expect(report.outcomes.find((o) => o.item === "TEST-11" && o.action.startsWith("faena"))).toMatchObject({ result: "dry-run", detail: "de «Cholguan - Arauco»" })
    expect(report.outcomes.find((o) => o.action === "cargo del catálogo" && o.item === "Conductor de camión")).toMatchObject({ result: "dry-run" })
    // Los trabajadores nuevos se informan por sus iniciales y la fila, nunca por su nombre.
    expect(report.outcomes.filter((o) => o.action === "crear trabajador" && o.result !== "omitido").map((o) => [o.item, o.result])).toEqual([
      ["A.P.S. · fila 10", "dry-run"],
      ["P.L.D.L.P.M. · fila 11", "dry-run"],
    ])

    expect(await inMemoryDb.select().from(schema.auditLog)).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.fuelVehicles)).toHaveLength(5)
    expect(await inMemoryDb.select().from(schema.fuelEquipmentTypes).where(eq(schema.fuelEquipmentTypes.slug, "carro"))).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.workers)).toHaveLength(7)
    expect(await inMemoryDb.select().from(schema.workerDriverLicenses)).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.workerPositionAliases)).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.workerPositions).where(eq(schema.workerPositions.isSystem, false))).toHaveLength(2)
    expect((await vehicle("TEST-11")).worksiteId).toBe("w-cho")
    expect((await one(inMemoryDb.select().from(schema.fuelProviderMappings))).worksiteId).toBe("w-cho")
    expect((await worker("wk1")).positionId).toBe(UNCLASSIFIED)
  }, 60_000)

  /* ── Apply ──────────────────────────────────────────────────────────────── */

  it("crea los tipos, los equipos y sus fechas; corrige faena y código con las asignaciones de proveedor, y deja bitácora", async () => {
    const report = await run(true)

    // Tipos nuevos: sin medidor, categoría «otros».
    const carro = await one(inMemoryDb.select().from(schema.fuelEquipmentTypes).where(eq(schema.fuelEquipmentTypes.slug, "carro")))
    expect(carro).toMatchObject({ name: "Carro", category: "other", defaultMeterType: "none", defaultPerformanceUnit: "not_applicable", isActive: true })
    const batea = await one(inMemoryDb.select().from(schema.fuelEquipmentTypes).where(eq(schema.fuelEquipmentTypes.slug, "batea")))
    expect(batea).toMatchObject({ name: "Batea", defaultMeterType: "none" })

    // Equipo existente que cambia de faena y de código; la asignación de proveedor lo sigue.
    expect(await vehicle("TEST-11")).toMatchObject({ worksiteId: "w-hor", code: "KA-20", soapExpiresAt: "2099-01-01", circulationPermitExpiresAt: "2099-01-02", technicalReviewExpiresAt: "2099-01-03" })
    const mappings = await inMemoryDb.select().from(schema.fuelProviderMappings).where(and(eq(schema.fuelProviderMappings.vehicleId, "v-mov"), eq(schema.fuelProviderMappings.isActive, true)))
    expect(mappings.map((m) => m.worksiteId)).toEqual(["w-hor"])

    // «Masisa maderas» es la faena Masisa; una celda vacía no borra la fecha que Chome ya tenía.
    expect(await vehicle("TEST-22")).toMatchObject({ worksiteId: "w-mas", code: "KA-2", soapExpiresAt: "2026-05-01", circulationPermitExpiresAt: "2099-03-03", technicalReviewExpiresAt: "2099-04-04" })
    // Los códigos de dos tractos se intercambian directo.
    expect((await vehicle("TEST-33")).code).toBe("KCH-2")
    expect((await vehicle("TEST-44")).code).toBe("KCH-1")
    // Patente sin guion en la base: es el mismo equipo, conserva su código aunque la planilla no traiga uno.
    expect(await vehicle("TEST55")).toMatchObject({ code: "KA-5", worksiteId: "w-mas", soapExpiresAt: "2099-07-07" })
    expect(await inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.plate, "TEST-55"))).toHaveLength(0)

    // Equipos nuevos.
    expect(await vehicle("NEW-11")).toMatchObject({ code: "KA-9", type: "camion", equipmentTypeId: "fet-camion", meterType: "odometer", performanceUnit: "km_per_liter", worksiteId: "w-mas", soapExpiresAt: "2099-09-30", brand: null, model: null, year: null, isActive: true })
    expect(await vehicle("NEW-22")).toMatchObject({ code: null, type: "carro", equipmentTypeId: carro.id, meterType: "none", performanceUnit: "not_applicable", worksiteId: "w-bio", soapExpiresAt: "2099-08-01" })
    expect(await vehicle("NEW-33")).toMatchObject({ code: null, type: "batea", equipmentTypeId: batea.id, worksiteId: "w-hor" })
    expect(await vehicle("NEW-44")).toMatchObject({ code: null, type: "tracto", equipmentTypeId: "fet-tracto" })
    const created = await vehicle("NEW-22")
    expect(await inMemoryDb.select().from(schema.fuelVehicleProducts).where(eq(schema.fuelVehicleProducts.vehicleId, created.id))).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.fuelVehicleOperationalIntervals).where(eq(schema.fuelVehicleOperationalIntervals.vehicleId, created.id))).toHaveLength(1)

    // Lo que no se pudo cargar se omite y se informa: faena sin resolver, patente repetida, tipo inexistente, fila sin patente.
    for (const plate of ["LOST-1", "GRUA-1"]) expect(await inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.plate, plate))).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.plate, "REP-1"))).toHaveLength(1)
    expect((await vehicle("REP-1")).code).toBe("KA-66")
    expect(report.outcomes.find((o) => o.item === "LOST-1")).toMatchObject({ result: "omitido" })
    expect(report.outcomes.find((o) => o.item === "GRUA-1" && o.action.startsWith("alta"))).toMatchObject({ result: "omitido" })
    expect(report.outcomes.find((o) => o.item === "REP-1" && o.result === "omitido")).toBeTruthy()
    const omitted = report.review.filter((note) => note.kind === "fila_omitida").map((note) => note.item)
    expect(omitted).toEqual(expect.arrayContaining(["LOST-1", "GRUA-1", "REP-1"]))

    // «A revisar»: todo vencido hace más de un año, fechas vacías y un código que no es código.
    expect(report.review.filter((note) => note.kind === "equipo_vencido").map((note) => note.item)).toEqual(["OLD-11"])
    expect(report.review.find((note) => note.kind === "dato_vacio" && note.item === "TEST-22")?.detail).toContain("SOAP")
    expect(report.review.find((note) => note.kind === "dato_vacio" && note.item === "NEW-44")?.detail).toContain("no tiene forma de código")
    expect(report.review.filter((note) => note.kind === "codigo_duplicado")).toEqual([])

    // Cada cambio deja su fila a nombre del responsable.
    const audit = await inMemoryDb.select().from(schema.auditLog)
    expect(audit.length).toBeGreaterThan(30)
    expect(audit.every((row) => row.userId === "u-actor")).toBe(true)
    expect(audit.filter((row) => row.entityType === "fuel_vehicle" && row.action === "create")).toHaveLength(6)
    expect(audit.filter((row) => row.entityType === "fuel_equipment_type")).toHaveLength(2)
  }, 60_000)

  it("registra el catálogo de cargos: renombra «Chofer Camión», conserva su historia y suma alias, capacidades y clases", async () => {
    await run(true)

    // El cargo existente se renombra (mismo id: sus trabajadores lo siguen) y su nombre viejo queda como alias.
    const conductor = await positionNamed("Conductor de camión")
    expect(conductor.id).toBe("pos-chofer")
    expect(conductor).toMatchObject({ code: "AUTO-TEST1", needsReview: false, requiredLicenseClasses: ["A4", "A5", "A2_ANTIGUA"] })
    const aliases = await inMemoryDb.select().from(schema.workerPositionAliases).where(eq(schema.workerPositionAliases.positionId, conductor.id))
    expect(aliases.map((alias) => alias.normalizedKey).sort()).toEqual([
      "chofer", "chofer camion", "chofer de camion recolector", "conductor", "conductor camion copec", "conductor o chofer de camion ampliroll",
    ])
    expect(aliases.every((alias) => alias.source === "import")).toBe(true)

    const names = (await inMemoryDb.select().from(schema.workerPositions).where(eq(schema.workerPositions.isSystem, false))).map((p) => p.name)
    expect(names).toEqual(expect.arrayContaining([
      "Conductor de camión", "Conductor de tracto", "Conductor y mecánico", "Operador de maquinaria", "Supervisor", "Jefe de terreno",
      "Administrador de contrato", "Prevencionista de riesgos", "Mecánico", "Ayudante mecánico", "Soldador", "Auxiliar", "Administrativo",
    ]))

    const capabilityCodes = async (positionName: string) => {
      const position = await positionNamed(positionName)
      const links = await inMemoryDb.select({ code: schema.workerCapabilities.code }).from(schema.workerPositionCapabilities)
        .innerJoin(schema.workerCapabilities, eq(schema.workerCapabilities.id, schema.workerPositionCapabilities.capabilityId))
        .where(eq(schema.workerPositionCapabilities.positionId, position.id))
      return links.map((link) => link.code).sort()
    }
    expect(await capabilityCodes("Conductor de camión")).toEqual(["drives_vehicle"])
    expect(await capabilityCodes("Operador de maquinaria")).toEqual(["drives_vehicle", "operates_equipment"])
    expect(await capabilityCodes("Soldador")).toEqual([])
    expect(await positionNamed("Conductor de tracto")).toMatchObject({ requiredLicenseClasses: ["A5"] })
    expect(await positionNamed("Operador de maquinaria")).toMatchObject({ requiredLicenseClasses: ["D"] })
    expect(await positionNamed("Soldador")).toMatchObject({ requiredLicenseClasses: [] })
  }, 60_000)

  it("da de alta a los trabajadores que faltan, clasifica a los demás por su cargo y registra las licencias", async () => {
    const report = await run(true)

    // Los dos nuevos de Horcones: nombre en formato título, RUT canónico, activos y con su cargo.
    const conductor = await positionNamed("Conductor de camión")
    expect(await workerByRut(R.n1)).toMatchObject({ firstName: "Ana", lastName: "Prueba Soto", worksiteId: "w-hor", isActive: true, positionId: conductor.id, position: "Conductor de camión" })
    expect(await workerByRut(R.n2)).toMatchObject({ firstName: "Pedro Luis", lastName: "De la Prueba Muestra", worksiteId: "w-hor", positionId: conductor.id })
    expect(await inMemoryDb.select().from(schema.workers)).toHaveLength(9)
    expect(report.outcomes.filter((o) => o.action === "crear trabajador" && o.result !== "omitido").map((o) => o.result)).toEqual(["aplicado", "aplicado"])
    // Sin faena resuelta o con RUT inválido no se crea a nadie.
    expect(await inMemoryDb.select().from(schema.workers).where(eq(schema.workers.rut, R.n3))).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.workers).where(eq(schema.workers.rut, BAD_RUT))).toHaveLength(0)
    expect(report.outcomes.find((o) => o.action === "crear trabajador" && o.detail?.includes("RUT"))).toMatchObject({ result: "omitido" })

    // Clasificación: los alias hacen el calce; lo clasificado a mano no se pisa; el inactivo no se toca.
    expect((await worker("wk1")).positionId).toBe(conductor.id)
    expect((await worker("wk2")).positionId).toBe(conductor.id)
    expect((await worker("wk7")).positionId).toBe(conductor.id)
    expect((await worker("wk5")).positionId).toBe((await positionNamed("Conductor y mecánico")).id)
    expect((await worker("wk3")).positionId).toBe("pos-bodega")
    expect((await worker("wk4")).positionId).toBe(UNCLASSIFIED)
    expect(report.outcomes.find((o) => o.action.startsWith("asignar cargo") && o.detail?.includes("Jefe de bodega"))).toMatchObject({ result: "omitido" })
    // Un cargo que no estaba en el catálogo nace pendiente de revisión, y se informa.
    const pending = await positionNamed("OPERARIO ESPECIAL")
    expect(pending).toMatchObject({ needsReview: true, isSystem: false })
    expect((await worker("wk6")).positionId).toBe(pending.id)
    expect(report.review.find((note) => note.kind === "cargo_pendiente")).toMatchObject({ item: "OPERARIO ESPECIAL" })
    const history = await inMemoryDb.select().from(schema.workerPositionHistory).where(eq(schema.workerPositionHistory.workerId, "wk1"))
    expect(history.map((row) => row.source)).toEqual(["import"])

    // Licencias.
    expect(await license("wk1")).toMatchObject({ classes: ["A2", "A4", "B"], expiresAt: "2020-06-01", notes: "Prorroga por 6 meses" })
    expect(await license("wk2")).toMatchObject({ classes: ["A5"], expiresAt: "2099-05-05", notes: null })
    expect(await license("wk3")).toMatchObject({ classes: ["B"] })
    expect(await license("wk6")).toMatchObject({ classes: ["B"], expiresAt: null })
    expect(await license((await workerByRut(R.n1)).id)).toMatchObject({ classes: ["A3", "A5"] })
    expect(await license((await workerByRut(R.n2)).id)).toMatchObject({ classes: ["A1", "A2", "B", "D"], notes: "LEY 21.806" })
    // Sin clases reconocidas no se guarda nada; el inactivo tampoco.
    expect(await license("wk5")).toBeUndefined()
    expect(await license("wk4")).toBeUndefined()
    expect(await inMemoryDb.select().from(schema.workerDriverLicenses)).toHaveLength(7)

    // «A revisar».
    expect(report.review.filter((note) => note.kind === "licencia_vencida")).toHaveLength(1)
    expect(report.review.find((note) => note.kind === "licencia_vencida")?.detail).toContain("2020-06-01")
    expect(report.review.find((note) => note.kind === "clase_no_reconocida")?.detail).toContain("A9")
    // Chofer con A2 / A1-A2-B-D (nuevo n2): ninguna es A4 ni A5.
    expect(report.review.filter((note) => note.kind === "clase_insuficiente")).toHaveLength(2)
    expect(report.review.find((note) => note.kind === "inactivo")).toBeTruthy()
    expect(report.review.find((note) => note.kind === "dato_vacio" && note.detail.includes("sin fecha de vencimiento"))).toBeTruthy()
    const audit = await inMemoryDb.select().from(schema.auditLog)
    expect(audit.filter((row) => row.entityType === "worker_driver_license")).toHaveLength(7)
    expect(audit.filter((row) => row.entityType === "worker" && row.action === "create")).toHaveLength(2)
  }, 60_000)

  it("el informe no lleva RUT ni nombres de personas", async () => {
    const report = await run(true)
    const printed: string[] = []
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { printed.push(args.map(String).join(" ")) })
    try {
      const { printVencimientosReport } = await script()
      printVencimientosReport(report, true)
    } finally {
      spy.mockRestore()
    }
    const text = `${JSON.stringify(report)}\n${printed.join("\n")}`
    for (const value of [...Object.values(R), BAD_RUT, "Prueba", "PRUEBA", "Muestra", "MUESTRA", "Soto", "SOTO"]) {
      expect(text).not.toContain(value)
      expect(text).not.toContain(dotted(value))
    }
    expect(printed.join("\n")).toContain("A revisar")
  }, 60_000)

  it("una segunda corrida no escribe nada: todo «ya estaba»", async () => {
    await run(true)
    const countAll = async () => ({
      audit: (await inMemoryDb.select().from(schema.auditLog)).length,
      vehicles: (await inMemoryDb.select().from(schema.fuelVehicles)).length,
      workers: (await inMemoryDb.select().from(schema.workers)).length,
      licenses: (await inMemoryDb.select().from(schema.workerDriverLicenses)).length,
      positions: (await inMemoryDb.select().from(schema.workerPositions)).length,
      aliases: (await inMemoryDb.select().from(schema.workerPositionAliases)).length,
      history: (await inMemoryDb.select().from(schema.workerPositionHistory)).length,
    })
    const first = await countAll()
    const second = await run(true)
    expect(second.outcomes.filter((o) => o.result === "aplicado")).toEqual([])
    expect(await countAll()).toEqual(first)
    expect(second.outcomes.filter((o) => o.action === "crear tipo de equipo").map((o) => o.result)).toEqual(["ya estaba", "ya estaba"])

    // Y en dry-run, sobre lo ya aplicado, tampoco queda nada pendiente.
    const dry = await run(false)
    expect(dry.outcomes.filter((o) => o.result === "dry-run")).toEqual([])
  }, 90_000)

  /* ── Lo que no se pisa ──────────────────────────────────────────────────── */

  it("no pisa las clases que un cargo ya exige ni fusiona un alias que choca con otro cargo", async () => {
    await inMemoryDb.insert(schema.workerPositions).values([
      { id: "pos-sup", code: "AUTO-SUP", name: "Supervisor", normalizedKey: "supervisor", needsReview: true, requiredLicenseClasses: ["D"] },
      { id: "pos-conductor", code: "AUTO-CON", name: "Conductor", normalizedKey: "conductor", needsReview: true },
    ])
    const report = await run(true)

    // «Supervisor» ya existía: se adopta (sale de «por revisar») pero sus clases se quedan como estaban.
    expect(await positionNamed("Supervisor")).toMatchObject({ id: "pos-sup", needsReview: false, requiredLicenseClasses: ["D"] })
    expect(report.review.find((note) => note.kind === "conflicto" && note.item === "Supervisor")?.detail).toContain("ya exige D")
    // «Conductor» existe como cargo: no puede ser alias de «Conductor de camión» sin fusionarlos a mano.
    expect(report.outcomes.find((o) => o.action === "nombre alternativo" && o.item.includes("«Conductor»"))).toMatchObject({ result: "omitido" })
    expect(report.review.find((note) => note.kind === "conflicto" && note.detail.includes("«Conductor»"))).toBeTruthy()
    expect(await inMemoryDb.select().from(schema.workerPositions).where(eq(schema.workerPositions.id, "pos-conductor"))).toHaveLength(1)
    // El cargo con alias en conflicto igual se registra con el resto de sus alias.
    expect((await positionNamed("Conductor de camión")).id).toBe("pos-chofer")
  }, 60_000)

  it("un RUT repetido en la planilla no se descarta: identifica al trabajador por su nombre, en cualquier orden", async () => {
    // La planilla escribe «APELLIDOS NOMBRES»; Chome guarda nombre y apellido por separado.
    await inMemoryDb.insert(schema.workers).values({
      id: "wk9", rut: "11111111-1", firstName: "Alejo Salem", lastName: "Prueba Lara", worksiteId: "w-mas",
      isActive: true, positionId: UNCLASSIFIED, position: "Sin clasificar",
    })
    const workersInput: WorkerInput[] = [
      ["Masisa maderas", "SIETE PRUEBA SOTO", dotted(R.w7), "Chofer", "A2", date("2099-01-01"), null],
      ["Masisa maderas", "PRUEBA LARA ALEJO SALEM", dotted(R.w7), "Chofer", "A3/A5/B", date("2099-12-19"), null],
    ]
    const report = await run(true, await buildPlanilla({ machines: [], workers: workersInput }))

    expect(await license("wk7")).toMatchObject({ classes: ["A2"] })
    expect(await license("wk9")).toMatchObject({ classes: ["A3", "A5", "B"], expiresAt: "2099-12-19" })
    expect((await worker("wk9")).positionId).toBe((await positionNamed("Conductor de camión")).id)
    // No nace un duplicado y queda dicho que el RUT de la planilla hay que corregirlo.
    expect(await inMemoryDb.select().from(schema.workers)).toHaveLength(8)
    expect(report.review.find((note) => note.kind === "identificado_por_nombre")?.detail).toContain("repite el de otra fila")
  }, 60_000)

  it("con A2 antigua un conductor de camión no queda con clase insuficiente", async () => {
    const workersInput: WorkerInput[] = [["Masisa maderas", "SIETE PRUEBA SOTO", dotted(R.w7), "Chofer", "A2 Antigua/B", date("2099-01-01"), null]]
    const report = await run(true, await buildPlanilla({ machines: [], workers: workersInput }))
    expect(await license("wk7")).toMatchObject({ classes: ["A2_ANTIGUA", "B"] })
    expect(report.review.filter((note) => note.kind === "clase_insuficiente")).toHaveLength(0)
  }, 60_000)

  it("corrige la patente mal escrita en Chome en vez de crear otro equipo, y conserva su historia", async () => {
    await inMemoryDb.insert(schema.fuelVehicles).values({ id: "v-typo", plate: "DPDH-67", code: "KA-90", type: "camion", equipmentTypeId: "fet-camion", worksiteId: "w-mas" })
    const machines: MachineInput[] = [["Masisa maderas", "Camión", "KA-90", "BPDH-67", date("2099-09-30"), date("2099-09-30"), date("2099-04-30")]]

    const dry = await run(false, await buildPlanilla({ machines, workers: [] }))
    expect(dry.outcomes.find((o) => o.action.startsWith("corregir patente"))).toMatchObject({ result: "dry-run" })
    expect(dry.outcomes.find((o) => o.item === "BPDH-67" && o.action.startsWith("alta"))).toBeUndefined()
    expect((await vehicle("DPDH-67")).id).toBe("v-typo")

    await run(true, await buildPlanilla({ machines, workers: [] }))
    expect(await vehicle("BPDH-67")).toMatchObject({ id: "v-typo", code: "KA-90", technicalReviewExpiresAt: "2099-04-30" })
    expect(await inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.plate, "DPDH-67"))).toHaveLength(0)
    const audit = await inMemoryDb.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, "v-typo"))
    expect(audit.some((row) => (JSON.parse(row.newState ?? "null") as { plate?: string } | null)?.plate === "BPDH-67")).toBe(true)

    const again = await run(true, await buildPlanilla({ machines, workers: [] }))
    expect(again.outcomes.find((o) => o.action.startsWith("corregir patente"))).toMatchObject({ result: "ya estaba" })
  }, 60_000)

  it("omite las filas cuya faena no se resuelve, en equipos y en trabajadores", async () => {
    const machines: MachineInput[] = [["Teno", "Camión", "KA-1", "LOST-1", date("2099-01-01"), date("2099-01-01"), date("2099-01-01")]]
    const workersInput: WorkerInput[] = [["Teno", "ANA PRUEBA SOTO", dotted(R.n1), "conductor", "A5", date("2099-01-01"), null]]
    const report = await run(true, await buildPlanilla({ machines, workers: workersInput }))

    expect(report.outcomes.find((o) => o.step.startsWith("2") && o.item === "Teno")).toMatchObject({ result: "omitido" })
    expect(report.outcomes.find((o) => o.item === "LOST-1")).toMatchObject({ result: "omitido" })
    expect(await inMemoryDb.select().from(schema.fuelVehicles)).toHaveLength(5)
    expect(await inMemoryDb.select().from(schema.workers).where(eq(schema.workers.rut, R.n1))).toHaveLength(0)
    expect(await inMemoryDb.select().from(schema.workerDriverLicenses)).toHaveLength(0)
    expect(report.review.filter((note) => note.kind === "fila_omitida")).toHaveLength(2)
  }, 60_000)

  it("si hay dos faenas activas con el mismo nombre no adivina: omite la fila", async () => {
    await inMemoryDb.insert(schema.worksites).values({ id: "w-mas-2", name: "MASISA", code: "MASISA-2", isActive: true })
    const machines: MachineInput[] = [["Masisa maderas", "Camión", "KA-1", "NEW-11", date("2099-01-01"), date("2099-01-01"), date("2099-01-01")]]
    const report = await run(true, await buildPlanilla({ machines, workers: [] }))
    expect(report.outcomes.find((o) => o.item === "NEW-11")).toMatchObject({ result: "omitido" })
    expect(await inMemoryDb.select().from(schema.fuelVehicles).where(eq(schema.fuelVehicles.plate, "NEW-11"))).toHaveLength(0)
  }, 60_000)

  it("exige un responsable activo para la bitácora y una planilla", async () => {
    const { applyVencimientosPlanilla202611 } = await script()
    await expect(applyVencimientosPlanilla202611({ actorEmail: "nadie@chome.test", apply: true, buffer: await buildPlanilla() })).rejects.toThrow(/responsable/)
    await expect(applyVencimientosPlanilla202611({ actorEmail: ACTOR, apply: true })).rejects.toThrow(/planilla/)
    expect(await inMemoryDb.select().from(schema.auditLog)).toHaveLength(0)
  })
})
