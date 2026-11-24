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
const A = { ws: "ws-exp-a", vehicle: "v-exp-a", code: "KA-A1", plate: "AAAA-01", name: "Faena A" }
const B = { ws: "ws-exp-b", vehicle: "v-exp-b", code: "KB-B1", plate: "BBBB-02", name: "Faena B" }
const SNAP = (code: string, plate: string, worksite: string) => ({ code, plate, noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite, unit: "km" as const })

const VIEW_ALL = ["mant:export", "mant:records:view_all", "mant:ot:view_all"]
const globalSession = { user: { id: U, email: "jefe@chome.test", name: "Jefe", isGlobal: true, worksiteIds: [], permissions: VIEW_ALL } } as unknown as Session
const scopedToA = { user: { id: U, email: "supervisor@chome.test", name: "Supervisor A", isGlobal: false, worksiteIds: [A.ws], permissions: ["mant:export", "mant:records:view_worksite", "mant:ot:view_worksite"] } } as unknown as Session

const OCTOBER = { desde: "2026-10-01", hasta: "2026-10-31" }

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  const now = new Date().toISOString()
  await testDb.insert(schema.users).values({ id: U, name: "Usuario Export", email: `${U}@chome.test`, hashedPassword: "hash", isActive: true, createdAt: now, updatedAt: now })
  await testDb.insert(schema.worksites).values([A, B].map((site) => ({ id: site.ws, name: site.name, code: site.ws.toUpperCase(), isActive: true, createdAt: now, updatedAt: now })))
  await testDb.insert(schema.fuelEquipmentTypes).values({ id: "fet-exp", slug: "export-km", name: "Camión", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter" })
  await testDb.insert(schema.mantBrands).values({ id: "b-exp", name: "Scania", nameKey: "scania" })
  await testDb.insert(schema.fuelVehicles).values([A, B].map((site) => ({
    id: site.vehicle, code: site.code, plate: site.plate, type: "Camión", equipmentTypeId: "fet-exp", worksiteId: site.ws, model: "R450", year: 2021, brand: "Scania",
  })))
  await testDb.insert(schema.mantEquipmentProfiles).values([A, B].map((site) => ({ vehicleId: site.vehicle, brandId: "b-exp" })))

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
})

type Params = Record<string, string | string[] | undefined>

async function exportOf(session: Session, tab: "planificacion" | "camiones" | "maquinas", params: Params, maxRows?: number) {
  const result = await buildLookerExport(session, { tab, params, today: TODAY, ...(maxRows ? { maxRows } : {}) })
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
    const { workbook } = await exportOf(globalSession, "camiones", { desde: "2026-09-01", hasta: "2026-09-30" })
    expect(dataRows(workbook, "Correctivos")).toEqual([])
    expect(dataRows(workbook, "Conductores")).toEqual([])
    expect(dataRows(workbook, "Matriz de checklist")).toEqual([])
    // «Cumplimiento por mes» conserva el mes del período, sin pautas: el % vacío y 0 pautas.
    expect(dataRows(workbook, "Cumplimiento por mes")).toEqual([["sept 2026", "", 0]])
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

  it("«Máquinas» pide la otra unidad: sin máquinas por horas no hay filas, y el encabezado habla de horas", async () => {
    const { workbook } = await exportOf(globalSession, "maquinas", OCTOBER)
    expect(dataRows(workbook, "Correctivos")).toEqual([])
    expect(workbook.getWorksheet("Correctivos")!.getRow(1).getCell(8).value).toBe("Horómetro (h)")
    expect(dataRows(workbook, "Filtros")).toContainEqual(["Pestaña", "Máquinas (equipos por horas)"])
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
    expect(dataRows(workbook, "Filtros")).toContainEqual(["Faenas", "1 faena fuera de tu alcance: sin datos"])
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
    expect(workbook.getWorksheet("Consolidado por kilómetros")!.getRow(2).getCell(1).value).toBeTruthy()
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
