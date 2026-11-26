import { PGlite } from "@electric-sql/pglite"
import ExcelJS from "exceljs"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

/**
 * «Exportar Excel» de Planificación, Camiones y Máquinas contra Postgres de verdad: el libro respeta los
 * filtros de la URL, un usuario con una sola faena no obtiene filas de otra (ni filtrando por ella ni con un
 * filtro cruzado hacia sus datos) y la hoja de correctivos trae todo el filtro, no sólo la página de 25.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const testGlobal = globalThis as typeof globalThis & { __db?: DB }
testGlobal.__db = testDb

vi.mock("@/db", () => ({
  get db() { return testGlobal.__db },
  get Tx() { return undefined },
}))

const { buildLookerExport } = await import("@/lib/services/mantencion/looker/export")
const { loadCorrectivePage } = await import("@/lib/services/mantencion/looker/corrective")
const { loadPlanningData } = await import("@/lib/services/mantencion/looker/planning")
const { parseLookerFilters } = await import("@/lib/services/mantencion/looker/filters")
const { viewerFromSession } = await import("@/lib/services/mantencion/access")

const TODAY = "2026-11-24"
const U = "u-export"
// Quien creó y ejecutó las OT y los registros de las ramas de OT y nativa: un usuario aparte, porque «lo propio» (lo que creó o tiene
// asignado) se suma al alcance por faena y el usuario de la prueba vería sus propias OT de otra faena.
const OTHER = "u-export-otro"
const A = { ws: "ws-exp-a", vehicle: "v-exp-a", code: "KA-A1", plate: "AAAA-01", name: "Faena A" }
const B = { ws: "ws-exp-b", vehicle: "v-exp-b", code: "KB-B1", plate: "BBBB-02", name: "Faena B" }
// Una faena CERRADA (inactiva) con un camión: no aparece entre las opciones de la barra, pero sus datos existen y se consultan.
const C = { ws: "ws-exp-c", vehicle: "v-exp-c", code: "KC-C1", plate: "CCCC-03", name: "Faena C cerrada" }
// Un camión INACTIVO de la faena A, sin ficha: tampoco está entre las opciones de código.
const A2 = { ws: A.ws, vehicle: "v-exp-a2", code: "KA-A2", plate: "AAAA-04", name: A.name }
// Camiones sin ficha (no entran a Planificación) para las ramas de OT y de registro nativo, una por faena.
const A3 = { ws: A.ws, vehicle: "v-exp-a3", code: "KA-A3", plate: "AAAA-05", name: A.name }
const B3 = { ws: B.ws, vehicle: "v-exp-b3", code: "KB-B3", plate: "BBBB-06", name: B.name }
const SNAP = (code: string, plate: string, worksite: string) => ({ code, plate, noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite, unit: "km" as const })

const VIEW_ALL = ["mant:export", "mant:records:view_all", "mant:ot:view_all"]
const globalSession = { user: { id: U, email: "jefe@chome.test", name: "Jefe", isGlobal: true, worksiteIds: [], permissions: VIEW_ALL } } as unknown as Session
const scopedToA = { user: { id: U, email: "supervisor@chome.test", name: "Supervisor A", isGlobal: false, worksiteIds: [A.ws], permissions: ["mant:export", "mant:records:view_worksite", "mant:ot:view_worksite"] } } as unknown as Session

const scopedToAC = { user: { id: U, email: "jefe-ac@chome.test", name: "Jefe A y C", isGlobal: false, worksiteIds: [A.ws, C.ws], permissions: ["mant:export", "mant:records:view_worksite", "mant:ot:view_worksite"] } } as unknown as Session

const OCTOBER = { desde: "2026-10-01", hasta: "2026-10-31" }
const SEPTEMBER = { desde: "2026-09-01", hasta: "2026-09-30" }

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values([U, OTHER].map((id) => ({ id, name: `Usuario ${id}`, email: `${id}@chome.test`, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })))
  await testDb.insert(schema.worksites).values([A, B, C].map((site) => ({ id: site.ws, name: site.name, code: site.ws.toUpperCase(), isActive: site !== C, createdAt: now, updatedAt: now })))
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-exp", slug: "export-km", name: "Camión", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" })
  await testDb.insert(schema.mantBrands).values({ id: "b-exp", name: "Scania", nameKey: "scania" })
  await testDb.insert(schema.fuelVehicles).values([A, B].map((site) => ({
    id: site.vehicle, code: site.code, plate: site.plate, type: "Camión", equipmentTypeId: "fet-exp", worksiteId: site.ws, model: "R450", year: 2021, brand: "Scania",
  })))
  await testDb.insert(schema.mantEquipmentProfiles).values([A, B].map((site) => ({ vehicleId: site.vehicle, brandId: "b-exp" })))
  await testDb.insert(schema.fuelVehicles).values([C, A2, A3, B3].map((item) => ({
    id: item.vehicle, code: item.code, plate: item.plate, type: "Camión", equipmentTypeId: "fet-exp", worksiteId: item.ws, model: "R450", year: 2021, brand: "Scania",
    isActive: item === C || item === A3 || item === B3,
  })))

  await testDb.insert(schema.mantSchedules).values({ id: "s-exp", name: "Camiones", nameKey: "camiones-export", unit: "km", version: 1 })
  await testDb.insert(schema.mantScheduleVersions).values({
    scheduleId: "s-exp", version: 1, snapshot: { id: "s-exp", name: "Camiones", unit: "km", version: 1, intervals: [10_000, 40_000], groups: [], brandRules: [] },
    summary: "Pauta de prueba", createdBy: U,
  })
  await testDb.update(schema.mantEquipmentProfiles).set({ scheduleId: "s-exp" }).where(eq(schema.mantEquipmentProfiles.vehicleId, A.vehicle))
  await testDb.update(schema.mantEquipmentProfiles).set({ scheduleId: "s-exp" }).where(eq(schema.mantEquipmentProfiles.vehicleId, B.vehicle))

  // Sólo la faena A tiene una preventiva firmada: B queda sin lecturas ni A/B, para ver las celdas vacías.
  await testDb.insert(schema.mantRecords).values({
    id: "rec-prev-a", folio: "MR-P-A", kind: "P", vehicleId: A.vehicle, equipmentSnapshot: SNAP(A.code, A.plate, A.name), worksiteId: A.ws,
    reading: 151_000, unit: "km", workDate: "2026-10-10", registeredBy: U, executorKind: "yo", executorUserId: U, executorName: "Mecánico A",
    signedAt: "2026-10-10T15:00:00Z", receivedAt: "2026-10-10T15:00:00Z", status: "vigente", review: "pendiente", scheduleVersion: 1,
    scheduleNameSnapshot: "Camiones", intervalValue: 40_000, suggestedIntervalValue: 40_000, notes: "Pauta de octubre",
  })

  // Correctivas del historial de octubre: 30 en A (todas con el conductor JUAN PEREZ) y 2 en B (PEDRO SOTO).
  const hist = (n: number, site: typeof A, driver: string) => ({
    sourceKey: `hist-${site.ws}-${n}`, fingerprint: `fp-${site.ws}-${n}`, sourceFile: "consolidado.xlsx", sourceSheet: "MANTENCIONES", sourceRow: 10 + n,
    submittedAt: `2026-10-${String((n % 28) + 1).padStart(2, "0")} 10:00:00`, worksiteText: site.name, worksiteId: site.ws,
    equipmentText: `${site.code} / ${site.plate}`, vehicleId: site.vehicle, equipmentMatch: "linked", orderText: `F-${site.ws}-${n}`, kindText: "CORRECTIVA",
    readingText: "145.000", description: `Trabajo ${n} en ${site.name}`, entryDate: `2026-10-${String((n % 28) + 1).padStart(2, "0")}`,
    exitDate: null, hoursText: "1", fields: [{ header: "CONDUCTOR QUE UTILIZO EL EQUIPO", value: driver }],
    importedBy: U, actionType: "correctiva", laborHours: 1, isTest: false,
  })
  await testDb.insert(schema.mantHistoricalRecords).values([
    ...Array.from({ length: 30 }, (_, n) => hist(n, A, "JUAN PEREZ")),
    ...Array.from({ length: 2 }, (_, n) => hist(100 + n, B, "PEDRO SOTO")),
  ])

  // Una pauta histórica de octubre por faena, con mecánico, observación y detalle por ítem.
  const check = (key: string, site: typeof A, mechanic: string, observation: string) => ({
    sourceKey: key, fingerprint: `fp-${key}`, sourceFile: "consolidado.xlsx", sourceSheet: "PAUTAS_PREVENTIVAS", sourceRow: 3,
    submittedAt: "2026-10-16 10:00:00", performedOn: "2026-10-15", formKind: "CAMIONES", scheduleLabel: "40.000 KM",
    equipmentText: `${site.code} / ${site.plate}`, vehicleId: site.vehicle, equipmentMatch: "linked", worksiteText: site.name, worksiteId: site.ws,
    reading: 145_000, doneCount: 39, notDoneCount: 1, notApplicableCount: 9, compliance: 0.975, mechanic, observations: observation,
    isTest: false, fields: [], importedBy: U,
  })
  await testDb.insert(schema.mantHistoricalScheduleChecks).values([
    check("pauta-a", A, "Javier Roa", "Observación de la faena A"),
    check("pauta-b", B, "Marta Díaz", "Observación de la faena B"),
  ])
  await testDb.insert(schema.mantHistoricalScheduleItems).values(["pauta-a", "pauta-b"].flatMap((key) => [
    { sourceKey: `${key}-1`, checkSourceKey: key, itemName: "Cambio aceite motor", result: "realizado", sortOrder: 0 },
    { sourceKey: `${key}-2`, checkSourceKey: key, itemName: "Revisión frenos", result: "no_realizado", sortOrder: 1 },
  ]))

  // Correctivas de septiembre de la faena cerrada C y del camión inactivo A2 (nadie más trabaja en septiembre).
  const histOf = (key: string, n: number, item: typeof C, driver: string) => ({
    ...hist(n, { ...A, ws: item.ws, vehicle: item.vehicle, code: item.code, plate: item.plate, name: item.name }, driver),
    sourceKey: `hist-${key}-${n}`, fingerprint: `fp-${key}-${n}`, submittedAt: `2026-09-${10 + n} 10:00:00`, entryDate: `2026-09-${10 + n}`,
  })
  await testDb.insert(schema.mantHistoricalRecords).values([
    ...[0, 1, 2].map((n) => histOf("c", n, C, "ANA CIERRE")),
    ...[0, 1, 2].map((n) => histOf("a2", n, A2, "LUIS BAJA")),
  ])

  // OT en taller (agosto) y correctiva nativa (diciembre) de un camión de A y uno de B, para las otras dos ramas de la unión.
  const ot = (id: string, item: typeof A3) => ({
    id, folio: `OT-${id}`, vehicleId: item.vehicle, worksiteId: item.ws, equipmentSnapshot: SNAP(item.code, item.plate, item.name),
    repair: true, maintenance: false, requestDate: "2026-08-10", requestedByUserId: OTHER, requesterName: "Solicitante", repairDescription: "Reparación",
    status: "en_ejecucion", assignedToUserId: OTHER, assignedByUserId: OTHER, assignedAt: "2026-08-12T12:00:00Z", workshopKind: "interno",
    workshopEntryAt: "2026-08-12T12:00:00Z", estimatedDeliveryDate: "2026-08-30", startedAt: "2026-08-12T12:00:00Z", startedByUserId: OTHER,
    actionType: "correctiva", laborHours: 4, workPerformed: `Frenos de ${item.name}`,
  })
  await testDb.insert(schema.mantWorkOrders).values([ot("ot-a", A3), ot("ot-b", B3)])
  for (const item of [A3, B3]) {
    const id = `rec-c-${item.ws}`
    await testDb.insert(schema.mantRecords).values({
      id, folio: `MR-C-${item.ws}`, kind: "C", vehicleId: item.vehicle, equipmentSnapshot: SNAP(item.code, item.plate, item.name), worksiteId: item.ws,
      reading: 150_000, unit: "km", workDate: "2026-12-05", registeredBy: OTHER, executorKind: "yo", executorUserId: OTHER, executorName: "Mecánico Nativo",
      signedAt: "2026-12-05T15:00:00Z", receivedAt: "2026-12-05T15:00:00Z", status: "vigente", review: "pendiente",
    })
    await testDb.insert(schema.mantRecordCorrectives).values({ recordId: id, workTypes: ["Mecánico"], oils: [], description: `Filtro de ${item.name}`, noParts: true, hours: 2, inWorkshop: false })
  }
})

type Params = Record<string, string | string[] | undefined>

async function exportOf(session: Session, tab: "planificacion" | "camiones" | "maquinas", params: Params, maxRows?: number, today = TODAY) {
  const result = await buildLookerExport(session, { tab, params, today, ...(maxRows ? { maxRows } : {}) })
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(result.base64, "base64") as unknown as ArrayBuffer)
  return { result, workbook }
}

/** Filas de datos de una hoja (sin el encabezado) como arreglos de celdas; una celda vacía se lee como "". */
function dataRows(workbook: ExcelJS.Workbook, name: string): unknown[][] {
  const sheet = workbook.getWorksheet(name)
  if (!sheet) throw new Error(`falta la hoja ${name}`)
  const rows: unknown[][] = []
  sheet.eachRow((row, number) => {
    if (number === 1) return
    rows.push((row.values as unknown[]).slice(1).map((value) => value ?? ""))
  })
  return rows
}

const everything = (workbook: ExcelJS.Workbook) => JSON.stringify(workbook.worksheets.map((sheet) => sheet.getSheetValues()))

describe("Excel de Camiones · filtros de la URL", () => {
  it("«Correctivos» trae TODAS las filas del filtro, más que una página de 25", async () => {
    const { workbook, result } = await exportOf(globalSession, "camiones", OCTOBER)
    const rows = dataRows(workbook, "Correctivos")
    expect(rows).toHaveLength(32)
    expect(result.sheets.find((sheet) => sheet.title === "Correctivos")).toEqual({ title: "Correctivos", rowCount: 32 })
    // La pantalla muestra 25 por página; el libro, el total del mismo filtro.
    const page = await loadCorrectivePage(viewerFromSession(globalSession), parseLookerFilters({ ...OCTOBER, pestana: "camiones" }, TODAY), {})
    expect(page.rows).toHaveLength(25)
    expect(page.total).toBe(32)
    expect(rows.length).toBeGreaterThan(page.rows.length)
    // Y son las mismas filas, en el mismo orden, que se ven recorriendo las páginas de la pantalla.
    const pageTwo = await loadCorrectivePage(viewerFromSession(globalSession), { ...parseLookerFilters({ ...OCTOBER, pestana: "camiones" }, TODAY), page: 2 }, {})
    expect(rows.map((row) => row[2])).toEqual([...page.rows, ...pageTwo.rows].map((row) => row.reference))
  })

  it("la faena de la URL acota todas las hojas, y «Filtros» la nombra", async () => {
    const { workbook } = await exportOf(globalSession, "camiones", { ...OCTOBER, faena: A.ws })
    const correctives = dataRows(workbook, "Correctivos")
    expect(correctives).toHaveLength(30)
    expect(correctives.every((row) => row[6] === A.name)).toBe(true)
    expect(dataRows(workbook, "Conductores")).toEqual([["JUAN PEREZ", 30, 30]])
    expect(dataRows(workbook, "Cumplimiento faena y mecánico")).toEqual([[A.name, "Javier Roa", 97.5, 1]])
    expect(dataRows(workbook, "Pautas de la matriz")).toHaveLength(1)
    expect(dataRows(workbook, "Matriz de checklist")).toEqual([
      ["Cambio aceite motor", "", "Realizado"],
      ["Revisión frenos", "", "No realizado"],
    ])
    const filters = dataRows(workbook, "Filtros")
    expect(filters).toContainEqual(["Faenas", A.name])
    expect(filters).toContainEqual(["Período", "01-10-2026 al 31-10-2026"])
    expect(everything(workbook)).not.toContain(B.name)
  })

  it("el período de la URL acota: un mes sin trabajos deja las hojas sin filas", async () => {
    const { workbook } = await exportOf(globalSession, "camiones", { desde: "2026-07-01", hasta: "2026-07-31" })
    expect(dataRows(workbook, "Correctivos")).toEqual([])
    expect(dataRows(workbook, "Conductores")).toEqual([])
    expect(dataRows(workbook, "Matriz de checklist")).toEqual([])
    // «Cumplimiento por mes» conserva el mes del período, sin pautas: el % vacío y 0 pautas.
    expect(dataRows(workbook, "Cumplimiento por mes")).toEqual([["jul 2026", "", 0]])
  })

  it("un conductor elegido acota «Correctivos» y la serie, pero «Conductores» sigue mostrando a todos, como la pantalla", async () => {
    const { workbook } = await exportOf(globalSession, "camiones", { ...OCTOBER, x_conductor: "PEDRO SOTO" })
    const correctives = dataRows(workbook, "Correctivos")
    expect(correctives).toHaveLength(2)
    expect(correctives.every((row) => row[6] === B.name)).toBe(true)
    expect(dataRows(workbook, "Conductores").map((row) => row[0]).sort()).toEqual(["JUAN PEREZ", "PEDRO SOTO"])
    expect(dataRows(workbook, "Horas y registros")).toEqual([[`${B.code} · ${B.plate}`, 2, 2]])
    expect(dataRows(workbook, "Filtros")).toContainEqual(["Filtro cruzado: Conductor", "PEDRO SOTO"])
  })

  it("un equipo de la URL acota los correctivos y los códigos quedan nombrados en «Filtros»", async () => {
    const { workbook } = await exportOf(globalSession, "camiones", { ...OCTOBER, equipo: B.vehicle })
    expect(dataRows(workbook, "Correctivos")).toHaveLength(2)
    expect(dataRows(workbook, "Filtros")).toContainEqual(["Códigos (equipos)", `${B.code} · ${B.plate}`])
  })

  it("«Por horas» pide la otra unidad: sin máquinas por horas no hay filas, y el encabezado habla de horas", async () => {
    const { workbook } = await exportOf(globalSession, "maquinas", OCTOBER)
    expect(dataRows(workbook, "Correctivos")).toEqual([])
    expect(workbook.getWorksheet("Correctivos")!.getRow(1).getCell(8).value).toBe("Horómetro (h)")
    expect(dataRows(workbook, "Filtros")).toContainEqual(["Pestaña", "Por horas"])
  })

  it("sobre el tope de filas corta la hoja y lo dice dentro del libro", async () => {
    const { workbook, result } = await exportOf(globalSession, "camiones", OCTOBER, 10)
    expect(dataRows(workbook, "Correctivos")).toHaveLength(10)
    expect(result.truncated).toBe(true)
    expect(dataRows(workbook, "Filtros").some((row) => /«Correctivos»: la hoja se cortó en 10 de 32 trabajos; acota el período/.test(String(row[1])))).toBe(true)
  })
})

describe("Excel de Camiones · alcance por faena", () => {
  it("un usuario con la faena A obtiene sólo la faena A, sin filtros", async () => {
    const { workbook } = await exportOf(scopedToA, "camiones", OCTOBER)
    const correctives = dataRows(workbook, "Correctivos")
    expect(correctives).toHaveLength(30)
    expect(correctives.every((row) => row[6] === A.name)).toBe(true)
    expect(dataRows(workbook, "Conductores")).toEqual([["JUAN PEREZ", 30, 30]])
    expect(everything(workbook)).not.toContain(B.name)
    expect(everything(workbook)).not.toContain("PEDRO SOTO")
    expect(everything(workbook)).not.toContain("Observación de la faena B")
  })

  it("pedir la faena B no devuelve filas de B, en ninguna hoja, y no se nombra la faena ajena", async () => {
    const { workbook } = await exportOf(scopedToA, "camiones", { ...OCTOBER, faena: B.ws })
    for (const name of ["Correctivos", "Conductores", "Horas y registros", "Cumplimiento faena y mecánico", "Cumplimiento por patente", "Matriz de checklist", "Pautas de la matriz"]) {
      expect(dataRows(workbook, name), name).toEqual([])
    }
    expect(dataRows(workbook, "Filtros")).toContainEqual(["Faenas", "1 faena sin nombre disponible (fuera de tu alcance o inactiva)"])
    expect(everything(workbook)).not.toContain(B.name)
    expect(everything(workbook)).not.toContain(B.ws)
  })

  it("un filtro cruzado hacia equipo, trabajo o pauta de la faena B no abre sus datos", async () => {
    const { workbook } = await exportOf(scopedToA, "camiones", {
      ...OCTOBER, x_equipo: B.vehicle, x_ot: `h:hist-${B.ws}-100`, x_check: "h:pauta-b",
    })
    expect(everything(workbook)).not.toContain(B.name)
    expect(everything(workbook)).not.toContain(B.code)
    expect(everything(workbook)).not.toContain("Observación de la faena B")
    // Lo que no se puede resolver dentro del alcance se ignora, como en la pantalla: quedan los datos de A.
    expect(dataRows(workbook, "Correctivos")).toHaveLength(30)
  })

  it("sin permiso de ver ninguna faena el libro sale vacío, no con todo", async () => {
    const nobody = { user: { id: U, email: "x@chome.test", isGlobal: false, worksiteIds: [], permissions: ["mant:export"] } } as unknown as Session
    const { workbook } = await exportOf(nobody, "camiones", OCTOBER)
    expect(dataRows(workbook, "Correctivos")).toEqual([])
    expect(dataRows(workbook, "Conductores")).toEqual([])
    expect(dataRows(workbook, "Matriz de checklist")).toEqual([])
  })
})

describe("Excel de Planificación", () => {
  it("las dos tablas del consolidado traen A, B, próxima, delta y faltantes de la pantalla; lo que no existe queda vacío", async () => {
    const { workbook } = await exportOf(globalSession, "planificacion", {})
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Consolidado por kilómetros", "Consolidado por horas", "Filtros", "Metadatos"])
    const km = dataRows(workbook, "Consolidado por kilómetros")
    expect(km).toHaveLength(2)
    const rowA = km.find((row) => row[1] === A.code)!
    // [Patente, Código, Tipo, Faena, Pauta, Frecuencia, Última mantención, A, B, Actual, Próxima, Delta, Faltantes, Situación, Observación]
    expect(rowA.slice(0, 6)).toEqual([A.plate, A.code, "Camión", A.name, "Camiones", 40_000])
    expect(rowA.slice(7, 13)).toEqual([150_000, 151_000, 151_000, 160_000, -1_000, 9_000])
    const rowB = km.find((row) => row[1] === B.code)!
    // Sin preventiva ni lecturas: frecuencia, última mantención, A, B, actual, próxima, delta y faltantes quedan vacíos (no en cero).
    expect(rowB.slice(5)).toEqual(["", "", "", "", "", "", "", "", "Sin dato", ""])
    expect(dataRows(workbook, "Consolidado por horas")).toEqual([])
    // Orden de la pantalla: por faltantes, así que A (faltan 9.000) va antes que B (sin dato); la fecha es una fecha de Excel con formato de día.
    const sheet = workbook.getWorksheet("Consolidado por kilómetros")!
    expect([sheet.getRow(2).getCell(1).value, sheet.getRow(3).getCell(1).value]).toEqual([A.plate, B.plate])
    expect(sheet.getRow(2).getCell(7).value).toEqual(new Date("2026-10-10T00:00:00.000Z"))
    expect(sheet.getRow(2).getCell(7).numFmt).toBe("dd-mm-yyyy")
  })

  it("trae las mismas filas que la pantalla para los mismos filtros", async () => {
    const filters = parseLookerFilters({ pestana: "planificacion", faena: A.ws }, TODAY)
    const screen = await loadPlanningData(viewerFromSession(globalSession), filters, {}, ["equipment"])
    const { workbook } = await exportOf(globalSession, "planificacion", { faena: A.ws })
    expect(dataRows(workbook, "Consolidado por kilómetros").map((row) => row[1])).toEqual(screen.km.map((row) => row.code))
    expect(screen.km).toHaveLength(1)
  })

  it("el alcance también rige: con la faena A, pedir la B deja la tabla sin equipos", async () => {
    const own = await exportOf(scopedToA, "planificacion", {})
    expect(dataRows(own.workbook, "Consolidado por kilómetros").map((row) => row[1])).toEqual([A.code])
    const other = await exportOf(scopedToA, "planificacion", { faena: B.ws })
    expect(dataRows(other.workbook, "Consolidado por kilómetros")).toEqual([])
    expect(everything(other.workbook)).not.toContain(B.code)
  })
})

describe("Excel de Camiones · faenas y equipos que no están entre las opciones de la barra", () => {
  // Las opciones sólo traen faenas y equipos ACTIVOS del alcance; los datos de una faena cerrada se consultan igual. «Filtros» no
  // puede decir «sin datos» de una faena que sí trae filas, ni nombrar una faena ajena.
  const SINNOMBRE = "1 faena sin nombre disponible (fuera de tu alcance o inactiva)"

  it("faena ACTIVA del alcance: «Filtros» la nombra", async () => {
    const { workbook } = await exportOf(scopedToAC, "camiones", { ...OCTOBER, faena: A.ws })
    expect(dataRows(workbook, "Correctivos")).toHaveLength(30)
    expect(dataRows(workbook, "Filtros")).toContainEqual(["Faenas", A.name])
  })

  it("faena INACTIVA del alcance: las hojas traen sus filas y «Filtros» no afirma «sin datos» ni la nombra", async () => {
    for (const session of [scopedToAC, globalSession]) {
      const { workbook } = await exportOf(session, "camiones", { ...SEPTEMBER, faena: C.ws })
      const correctives = dataRows(workbook, "Correctivos")
      expect(correctives, session.user.email ?? "").toHaveLength(3)
      expect(correctives.every((row) => row[6] === C.name)).toBe(true)
      expect(dataRows(workbook, "Conductores")).toEqual([["ANA CIERRE", 3, 3]])
      const filters = dataRows(workbook, "Filtros")
      expect(filters).toContainEqual(["Faenas", SINNOMBRE])
      expect(JSON.stringify(filters)).not.toMatch(/sin datos/)
      expect(JSON.stringify(filters)).not.toContain(C.name)
      expect(JSON.stringify(filters)).not.toContain(C.ws)
    }
  })

  it("faena AJENA: sin filas, el mismo texto veraz y sin nombrarla", async () => {
    const { workbook } = await exportOf(scopedToA, "camiones", { ...SEPTEMBER, faena: C.ws })
    for (const name of ["Correctivos", "Conductores", "Horas y registros", "Cumplimiento por patente", "Matriz de checklist"]) {
      expect(dataRows(workbook, name), name).toEqual([])
    }
    expect(dataRows(workbook, "Filtros")).toContainEqual(["Faenas", SINNOMBRE])
    expect(everything(workbook)).not.toContain(C.name)
    expect(everything(workbook)).not.toContain(C.ws)
    expect(everything(workbook)).not.toContain("ANA CIERRE")
  })

  it("equipo inactivo: trae sus filas y «Filtros» no lo declara sin datos; uno activo con ficha se nombra", async () => {
    const inactive = await exportOf(globalSession, "camiones", { ...SEPTEMBER, equipo: A2.vehicle })
    expect(dataRows(inactive.workbook, "Correctivos")).toHaveLength(3)
    const filters = dataRows(inactive.workbook, "Filtros")
    expect(filters).toContainEqual(["Códigos (equipos)", "1 código sin nombre disponible (fuera de tu alcance o inactivo)"])
    expect(JSON.stringify(filters)).not.toMatch(/sin datos/)
    expect(JSON.stringify(filters)).not.toContain(A2.code)
    const active = await exportOf(globalSession, "camiones", { ...OCTOBER, equipo: B.vehicle })
    expect(dataRows(active.workbook, "Filtros")).toContainEqual(["Códigos (equipos)", `${B.code} · ${B.plate}`])
  })
})

describe("Excel de Camiones · alcance por faena en las ramas de OT y de registro nativo", () => {
  const AUGUST = { desde: "2026-08-01", hasta: "2026-08-31" }
  const DECEMBER = { desde: "2026-12-01", hasta: "2026-12-31" }
  const TODAY_DEC = "2026-12-31"

  it("sin filtro de alcance (usuario global) trae la OT en taller y la correctiva nativa de las dos faenas", async () => {
    const aug = await exportOf(globalSession, "camiones", AUGUST)
    expect(dataRows(aug.workbook, "Correctivos").map((row) => [row[1], row[2], row[6]]).sort()).toEqual([
      ["Orden de trabajo", "OT-ot-a", A.name], ["Orden de trabajo", "OT-ot-b", B.name],
    ])
    const dec = await exportOf(globalSession, "camiones", DECEMBER, undefined, TODAY_DEC)
    expect(dataRows(dec.workbook, "Correctivos").map((row) => [row[1], row[2], row[6]]).sort()).toEqual([
      ["Registro de la plataforma", `MR-C-${A.ws}`, A.name], ["Registro de la plataforma", `MR-C-${B.ws}`, B.name],
    ])
  })

  it("un usuario de la faena A no obtiene la OT ni el registro de B: ni sin filtros, ni pidiendo B, ni con un filtro cruzado hacia ellos", async () => {
    const cases: Array<[string, Params, string, string]> = [
      ["OT", AUGUST, "OT-ot-a", "OT-ot-b"],
      ["registro", DECEMBER, `MR-C-${A.ws}`, `MR-C-${B.ws}`],
    ]
    for (const [label, period, own, foreign] of cases) {
      const today = label === "OT" ? TODAY : TODAY_DEC
      const plain = await exportOf(scopedToA, "camiones", period, undefined, today)
      expect(dataRows(plain.workbook, "Correctivos").map((row) => row[2]), label).toEqual([own])
      const asked = await exportOf(scopedToA, "camiones", { ...period, faena: B.ws }, undefined, today)
      expect(dataRows(asked.workbook, "Correctivos"), `${label} faena=B`).toEqual([])
      const crossed = await exportOf(scopedToA, "camiones", { ...period, x_ot: label === "OT" ? "ot:ot-b" : `r:rec-c-${B.ws}`, x_equipo: B3.vehicle }, undefined, today)
      expect(dataRows(crossed.workbook, "Correctivos").map((row) => row[2]), `${label} x_ot=B`).toEqual([own])
      for (const { workbook } of [plain, asked, crossed]) {
        expect(everything(workbook), label).not.toContain(foreign)
        expect(everything(workbook), label).not.toContain(B3.code)
      }
    }
  })
})
