import { expect, test, type Page } from "@playwright/test"
import { cerrarSesion, expectPageTitle, login } from "./helpers"
import { leftovers, PERIOD, QA, cleanupLooker, seedLooker } from "./mantencion-panel-looker-seed"
import {
  EX, FLOW, MACHINE_PRIOR, USERS, accessIsOriginal, bookText, bulkRef, chileDay, cleanupExtra, extraLeftovers, field, grantMechanicPanelWithoutExport,
  machinePlanning, equipmentTable, pairs, readBook, ready, row, scopeSupervisorToFaenaA, seedExtra, tabUrl, watchProblems, withSql, workTable,
  type Book,
} from "./mantencion-panel-looker-seed-extra"

/**
 * «Exportar Excel» de Planificación, Correctivo y Preventivo del Panel de mantención (2026-11-24; pestañas y unidad nuevas el 2026-11-27).
 * Se pulsa el botón del encabezado, se descarga el .xlsx y se lee con exceljs: lo que se comprueba es el archivo, no el servicio.
 * Cada pestaña trae su libro, de UNA unidad (la de la barra de filtros): Planificación, el consolidado de esa unidad; Correctivo, los
 * trabajos, conductores, horas y registros y trabajos por mes; Preventivo, el cumplimiento por equipo, por mes, por faena y mecánico y la
 * matriz. Siembra SUS PROPIOS datos QA (`seedLooker` + `seedExtra`: 30 correctivos del formulario, diez pautas de un equipo, una máquina
 * con preventiva declarada y las dos máquinas del flujo de Planificación) y los borra al terminar. El alcance por faena y el permiso
 * `mant:export` se prueban con usuarios del fixture E2E cuyo acceso se ajusta y se devuelve (ver `seedExtra.ts`: `audit_log` es de sólo
 * agregar, un usuario nuevo que exporta no se podría borrar).
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(180_000)

type Tab = "planificacion" | "correctivo" | "preventivo"
type Unit = "km" | "h"
const SHORT: Record<Tab, string> = { planificacion: "Planificación", correctivo: "Correctivo", preventivo: "Preventivo" }
/** El nombre del archivo sale del título del libro («Panel de mantención · Correctivo · Por kilómetros»), no del valor de la URL. */
const FILE_SLUG = (tab: Tab, unit: Unit) => `${tab}_${unit === "km" ? "por_kilometros" : "por_horas"}`
const PLANNING_SHEET: Record<Unit, string> = { km: "Consolidado por kilómetros", h: "Consolidado por horas" }
const DATA_SHEETS: Record<Exclude<Tab, "planificacion">, string[]> = {
  correctivo: ["Correctivos", "Conductores", "Horas y registros", "Trabajos por mes"],
  preventivo: ["Cumplimiento por equipo", "Cumplimiento por mes", "Cumplimiento faena y mecánico", "Matriz de checklist", "Pautas de la matriz"],
}
const sheetNames = (tab: Tab, unit: Unit = "km") => [...(tab === "planificacion" ? [PLANNING_SHEET[unit]] : DATA_SHEETS[tab]), "Filtros", "Metadatos"]
const buttonName = (tab: Tab) => `Exportar Excel: Panel de mantención, pestaña ${SHORT[tab]}, con los filtros elegidos`
const ADMIN = "admin@e2e.chome.cl"
/** Lo que sólo existe en la faena B: no puede aparecer en el libro de quien no la ve. */
const FAENA_B = [QA.wsB.name, QA.wsB.code, QA.b1.code, QA.b1.plate, QA.otB1, QA.driverB.name, QA.mechanicB]
const dmy = (iso: string) => iso.split("-").reverse().join("-")

let machineIntervals: number[] = []
test.beforeAll(async () => {
  await withSql(async (sql) => {
    await cleanupExtra(sql)
    await seedLooker(sql)
    machineIntervals = await seedExtra(sql, { bulk: true, matrix: true, machine: true, flow: true })
  })
})
test.afterAll(async () => {
  await withSql(async (sql) => {
    await cleanupExtra(sql)
    await cleanupLooker(sql)
    // La limpieza es parte de la prueba: ni filas, ni archivos, ni accesos ajenos a su estado de origen.
    expect(await leftovers(sql)).toBe(0)
    expect(await extraLeftovers(sql)).toBe(0)
    expect(await accessIsOriginal(sql)).toBe(true)
  })
})

let problems: string[] = []
test.beforeEach(({ page }) => { problems = watchProblems(page) })
test.afterEach(() => { expect(problems).toEqual([]) })

/** Abre la pestaña, comprueba que el botón está en el encabezado y descarga el libro. */
async function exportFrom(page: Page, tab: Tab, url: string, { cross = true, unit = "km" }: { cross?: boolean; unit?: Unit } = {}): Promise<Book> {
  await page.goto(url)
  await expectPageTitle(page, "Panel de mantención")
  // En escritorio las acciones de página viven en el TopBar (`banner`): la copia local es `lg:hidden`, así que hay UN botón.
  const button = page.getByRole("banner").getByRole("button", { name: buttonName(tab), exact: true })
  await expect(button).toBeVisible()
  await expect(page.getByRole("button", { name: buttonName(tab), exact: true })).toHaveCount(1)
  await ready(page, { cross })
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), button.click()])
  expect(download.suggestedFilename()).toMatch(new RegExp(`^panel_de_mantencion_${FILE_SLUG(tab, unit)}_\\d{4}-\\d{2}-\\d{2}\\.xlsx$`))
  const book = await readBook(download)
  expect([...book.keys()]).toEqual(sheetNames(tab, unit))
  return book
}

const sheet = (book: Book, name: string) => book.get(name)!
const filtros = (book: Book, concept: string) => pairs(sheet(book, "Filtros"), concept)
const plates = (book: Book, name: string) => sheet(book, name).rows.map((cells) => field(sheet(book, name), cells, "Patente"))

test("Planificación: el libro trae el consolidado de la unidad, la regla vigente de la máquina y los filtros de la URL", async ({ page }) => {
  await login(page, ADMIN)
  const expected = machinePlanning(machineIntervals)
  // Regla vigente: punto de la última preventiva (4.520 h → 4.500) + base 300 = 4.800; con 4.780 actuales faltan 20. No se deja
  // sólo la función: si la regla y el cálculo se equivocaran juntos, estos literales lo dirían.
  expect(machineIntervals.join(",")).toBe("300,600,900,1200")
  expect(expected).toMatchObject({ programmed: 4500, real: 4520, current: 4780, next: 4800, delta: -20, remaining: 20, situation: "Por vencer" })

  // Por kilómetros: UNA hoja con los equipos por km de la faena A (la de horas no se incluye). El equipo elegido con un clic no recorta la hoja.
  const km = await exportFrom(page, "planificacion", tabUrl("planificacion", { faena: QA.wsA.id, x_equipo: QA.a1.id }))
  const kmSheet = sheet(km, PLANNING_SHEET.km)
  expect(plates(km, PLANNING_SHEET.km).sort()).toEqual([QA.a1.plate, EX.bulk.plate, EX.matrix.plate].sort())
  const a1 = kmSheet.rows.find((cells) => field(kmSheet, cells, "Patente") === QA.a1.plate)!
  expect(field(kmSheet, a1, "Frecuencia (km)")).toBeNull()
  expect(field(kmSheet, a1, "Próxima a los (km)")).toBeNull()
  expect(field(kmSheet, a1, "Estado")).toBe("Sin dato")
  expect(filtros(km, "Pestaña")).toEqual(["Planificación"])
  expect(filtros(km, "Unidad de control")).toEqual(["Por kilómetros"])
  // Planificación es el estado de hoy: no tiene período.
  expect(filtros(km, "Período")).toEqual([])
  expect(filtros(km, "Filtro cruzado: Equipo")).toEqual([`${QA.a1.code} · ${QA.a1.plate}`])
  expect(filtros(km, "Nota").some((note) => note.includes("el equipo elegido con un clic no recorta la hoja"))).toBe(true)
  expect(bookText(km)).not.toContain(QA.m1.plate)

  // Por horas: la máquina de la regla vigente con A, B, delta, próxima y faltantes (equipo elegido por la barra: ese sí recorta).
  const hoursBook = await exportFrom(page, "planificacion", tabUrl("planificacion", { faena: QA.wsA.id, unidad: "h", equipo: EX.machine.id }), { unit: "h" })
  const hours = sheet(hoursBook, PLANNING_SHEET.h)
  expect(hours.rows).toHaveLength(1)
  const machine = hours.rows[0]!
  const cell = (header: string) => field(hours, machine, header)
  expect(cell("Patente")).toBe(EX.machine.plate)
  expect(cell("Código")).toBe(EX.machine.code)
  expect(cell("Faena")).toBe(QA.wsA.name)
  expect(cell("Pauta")).toBe("Maquinaria pesada")
  expect(cell("Frecuencia (h)")).toBe(MACHINE_PRIOR.interval)
  expect(cell("Última mantención")).toBe(MACHINE_PRIOR.date)
  expect(cell("Tocaba a los (h)")).toBe(expected.programmed)
  expect(cell("Se hizo a los (h)")).toBe(expected.real)
  expect(cell("¿A tiempo?")).toBe("20 h tarde")
  expect(cell("Lectura actual (h)")).toBe(expected.current)
  expect(cell("Próxima a los (h)")).toBe(expected.next)
  expect(cell("Faltan (h)")).toBe(expected.remaining)
  expect(cell("Estado")).toBe("Próxima")
  expect(String(cell("Observación"))).toContain(`Preventiva declarada (respaldo: ${MACHINE_PRIOR.evidence})`)
  // Sin lecturas de los últimos 30 días no hay fecha estimada, y la observación dice por qué.
  expect(cell("Fecha estimada")).toBeNull()
  expect(String(cell("Observación"))).toContain("Sin fecha estimada: Sin lecturas suficientes")
  expect(filtros(hoursBook, "Unidad de control")).toEqual(["Por horas"])
  expect(filtros(hoursBook, "Faenas")).toEqual([QA.wsA.name])
  expect(filtros(hoursBook, "Equipos")).toEqual([`${EX.machine.code} · ${EX.machine.plate}`])
  expect(filtros(hoursBook, "Frecuencia")).toEqual(["Todas"])
  expect(filtros(hoursBook, "Filtros cruzados")).toEqual(["Ninguno"])
  expect(pairs(sheet(hoursBook, "Metadatos"), "Generado por")).toEqual([ADMIN])
  expect(bookText(hoursBook)).not.toContain(QA.b1.plate)

  // Frecuencia 900 h: la hoja queda con las máquinas de esa pauta (las cuatro de la faena A la usan; la sin pauta, no).
  const byFrequency = await exportFrom(page, "planificacion", tabUrl("planificacion", { faena: QA.wsA.id, unidad: "h", frecuencia: "900" }), { unit: "h" })
  expect(plates(byFrequency, PLANNING_SHEET.h).sort()).toEqual([EX.machine.plate, FLOW.late.plate, FLOW.ok.plate].sort())
  expect(filtros(byFrequency, "Frecuencia")).toEqual(["900 h"])
})

test("Planificación: el estado y el rango de fechas de la pantalla acotan el libro, con las vencidas dentro, y quedan en «Filtros»", async ({ page }) => {
  await login(page, ADMIN)
  const until = chileDay(30)
  // «Próximos 30 días» (fecha_hasta) + «Vencidas»: sólo la máquina vencida del flujo (su fecha estimada ya pasó, y aun así entra).
  const book = await exportFrom(
    page, "planificacion", tabUrl("planificacion", { faena: QA.wsA.id, unidad: "h", fecha_hasta: until, estado: "vencida" }), { unit: "h" },
  )
  const hours = sheet(book, PLANNING_SHEET.h)
  expect(hours.rows).toHaveLength(1)
  const late = hours.rows[0]!
  expect(field(hours, late, "Patente")).toBe(FLOW.late.plate)
  expect(field(hours, late, "Estado")).toBe("Vencida")
  expect(field(hours, late, "Faltan (h)")).toBe(-100)
  expect(field(hours, late, "Lectura actual (h)")).toBe(3400)
  expect(field(hours, late, "Fecha estimada")).toBe(chileDay(-20))
  expect(field(hours, late, "Uso diario (h/día)")).toBe(5.6)
  expect(filtros(book, "Estado")).toEqual(["Vencidas"])
  expect(filtros(book, "Próxima mantención (estimada)")).toEqual([`hasta ${dmy(until)}`])
  // Sin el estado, la fecha sola deja a la vencida y no trae a las que no tienen fecha (ni a la que está a ~40 días).
  const dated = await exportFrom(page, "planificacion", tabUrl("planificacion", { faena: QA.wsA.id, unidad: "h", fecha_hasta: until }), { unit: "h" })
  expect(plates(dated, PLANNING_SHEET.h)).toEqual([FLOW.late.plate])
  const wider = await exportFrom(page, "planificacion", tabUrl("planificacion", { faena: QA.wsA.id, unidad: "h", fecha_hasta: chileDay(90) }), { unit: "h" })
  expect(plates(wider, PLANNING_SHEET.h)).toEqual([FLOW.late.plate, FLOW.ok.plate])
})

test("Correctivo: «Correctivos» trae TODAS las filas del filtro y no sólo la página visible; el resto de las hojas sigue al filtro", async ({ page }) => {
  await login(page, ADMIN)
  const url = tabUrl("correctivo", { faena: QA.wsA.id })
  await page.goto(url)
  // Pantalla: 31 trabajos (la OT del camión A1 y los 30 del camión extra), de a 25 por página.
  await expect(page.getByText("31 trabajos", { exact: true })).toBeVisible()
  const visible = workTable(page).locator("tbody tr")
  await expect(visible).toHaveCount(25)
  // Orden fecha ↓: la OT del 12-11 y los correctivos 30 a 7 (31-10 a 08-10) están en la página 1; del 1 al 6 sólo están en la página 2.
  for (const n of [1, 6]) await expect(workTable(page).getByRole("button", { name: `Filtrar el panel por el trabajo Formulario ${bulkRef(n)}`, exact: true })).toHaveCount(0)
  await expect(workTable(page).getByRole("button", { name: `Filtrar el panel por el trabajo Formulario ${bulkRef(7)}`, exact: true })).toBeVisible()

  const book = await exportFrom(page, "correctivo", url)
  const work = sheet(book, "Correctivos")
  expect(work.rows).toHaveLength(31)
  const refs = work.rows.map((cells) => String(field(work, cells, "Referencia")))
  expect(refs[0]).toBe(QA.otA1)
  for (let n = 1; n <= EX.bulkRows; n++) expect(refs).toContain(bulkRef(n))
  expect(refs).not.toContain(QA.otB1)
  const ot = work.rows[0]!
  expect(field(work, ot, "Fecha")).toBe("2026-11-12")
  expect(field(work, ot, "Fuente")).toBe("Orden de trabajo")
  expect(field(work, ot, "Odómetro (km)")).toBe(150100)
  expect(field(work, ot, "Horas hombre")).toBe(2.5)
  const bulk = work.rows.find((cells) => field(work, cells, "Referencia") === bulkRef(3))!
  expect([field(work, bulk, "Fecha"), field(work, bulk, "Código"), field(work, bulk, "Horas hombre"), field(work, bulk, "Fuente")])
    .toEqual(["2026-10-04", EX.bulk.code, 1.5, "Historial de formularios"])

  // Conductores, horas por equipo y trabajos por mes suman las 31 filas (no las 25 visibles): 30 × 1,5 h = 45 h.
  expect(sheet(book, "Conductores").rows).toEqual([[EX.bulkDriver, 45, 30], [QA.driverA.name, 2.5, 1]])
  expect(sheet(book, "Horas y registros").rows).toEqual([[EX.bulk.plate, EX.bulk.code, 45, 30], [QA.a1.plate, QA.a1.code, 2.5, 1]])
  expect(sheet(book, "Trabajos por mes").rows).toEqual([["oct 2026", 30], ["nov 2026", 1]])

  expect(filtros(book, "Pestaña")).toEqual(["Correctivo"])
  expect(filtros(book, "Unidad de control")).toEqual(["Por kilómetros"])
  expect(filtros(book, "Período")).toEqual(["01-10-2026 al 20-11-2026"])
  expect(filtros(book, "Faenas")).toEqual([QA.wsA.name])
  expect(filtros(book, "Equipos")).toEqual(["Todos"])
  expect(filtros(book, "Nota").some((note) => note.includes("La hoja «Correctivos» trae todos los trabajos del filtro"))).toBe(true)
  const meta = sheet(book, "Metadatos")
  expect(pairs(meta, "Alcance de faena")).toEqual(["Todas las faenas (usuario global)"])
  expect([pairs(meta, "Período (desde)"), pairs(meta, "Período (hasta)")]).toEqual([["2026-10-01"], ["2026-11-20"]])
  expect(pairs(meta, "Filtros aplicados")[0]).toContain('"pestana":"Correctivo"')
  expect(pairs(meta, "Filtros aplicados")[0]).toContain('"unidad":"Por kilómetros"')

  // La exportación se audita con la pestaña, los parámetros y las filas de cada hoja.
  const audit = await withSql(async (sql) => (await sql`
    select new_state from audit_log where entity_type = 'board_data_export' and user_email = ${ADMIN} order by created_at desc limit 1`)[0]?.new_state)
  const state = JSON.parse(String(audit)) as { tab: string; truncated: boolean; params: Record<string, string>; tables: Array<{ title: string; rowCount: number }> }
  expect([state.tab, state.truncated, state.params.faena]).toEqual(["correctivo", false, QA.wsA.id])
  expect(state.tables.find((table) => table.title === "Correctivos")?.rowCount).toBe(31)
})

test("Preventivo: el libro sigue al filtro por faena, frecuencia y mes, y trae la matriz de la pantalla", async ({ page }) => {
  await login(page, ADMIN)
  // Sólo la pauta de 40.000 km de la faena A; el mes cruzado no acota la hoja «por mes» (muestra octubre y noviembre).
  const book = await exportFrom(page, "preventivo", tabUrl("preventivo", { faena: QA.wsA.id, frecuencia: "40000", x_mes: "2026-10" }))
  expect(sheet(book, "Cumplimiento por mes").rows).toEqual([["oct 2026", 97.5, 1], ["nov 2026", null, 0]])
  expect(sheet(book, "Cumplimiento faena y mecánico").rows).toEqual([[QA.wsA.name, QA.mechanicA, 97.5, 1]])
  const byEquipment = sheet(book, "Cumplimiento por equipo")
  expect(byEquipment.header.slice(0, 7)).toEqual(["Patente", "Código", "Faena", "Niveles de pauta", "Cumplimiento (%)", "Pautas", "Sin hacer"])
  expect(byEquipment.rows.map((cells) => cells.slice(0, 7))).toEqual([[QA.a1.plate, QA.a1.code, QA.wsA.name, "40.000 KM", 97.5, 1, 1]])
  const matrix = sheet(book, "Matriz de checklist")
  expect(matrix.header).toEqual(["Ítem", "Sistema", `${QA.a1.code} · 14-10-2026 · 40.000 KM`])
  expect(matrix.rows).toEqual([
    ["QA_ Cambio aceite motor", null, "Realizado"], ["QA_ Revisión frenos", null, "No realizado"], ["QA_ Revisión ABS", null, "No aplica"],
  ])
  const checks = sheet(book, "Pautas de la matriz")
  expect(checks.rows).toHaveLength(1)
  expect([field(checks, checks.rows[0]!, "Mecánico"), field(checks, checks.rows[0]!, "Observaciones"), field(checks, checks.rows[0]!, "Fotos en la plataforma")])
    .toEqual([QA.mechanicA, `QA_ Observación ${QA.a1.code}`, 0])

  expect(filtros(book, "Pestaña")).toEqual(["Preventivo"])
  expect(filtros(book, "Unidad de control")).toEqual(["Por kilómetros"])
  expect(filtros(book, "Período")).toEqual(["01-10-2026 al 20-11-2026"])
  expect(filtros(book, "Faenas")).toEqual([QA.wsA.name])
  expect(filtros(book, "Frecuencia")).toEqual(["40.000 km"])
  expect(filtros(book, "Filtro cruzado: Mes")).toHaveLength(1)
  expect(filtros(book, "Filtro cruzado: Mes")[0]).toMatch(/octubre 2026|oct 2026/i)
  expect(pairs(sheet(book, "Metadatos"), "Filtros aplicados")[0]).toContain('"pestana":"Preventivo"')
})

test("Preventivo: la matriz del libro trae las pautas con detalle más allá de las 8 de la pantalla, y el % del mes es el promedio de las pautas", async ({ page }) => {
  await login(page, ADMIN)
  const url = tabUrl("preventivo", { equipo: EX.matrix.id }, "desde=2026-09-01&hasta=2026-11-20")
  await page.goto(url)
  // Pantalla: 12 pautas del equipo, pero la matriz muestra las últimas 8 (la fecha más antigua de las 8 es el 09-10).
  await expect(row(equipmentTable(page), EX.matrix.plate).getByRole("cell").nth(3)).toHaveText("12")
  await expect(page.getByRole("table", { name: "Matriz de checklist de pautas" }).getByRole("columnheader")).toHaveCount(9)

  const book = await exportFrom(page, "preventivo", url)
  const matrix = sheet(book, "Matriz de checklist")
  const label = (date: string) => `${EX.matrix.code} · ${date} · 10.000 KM`
  const days = ["30-10", "27-10", "24-10", "21-10", "18-10", "15-10", "12-10", "09-10", "06-10", "03-10"].map((day) => label(`${day}-2026`))
  expect(matrix.header).toEqual(["Ítem", "Sistema", ...days, label("22-09-2026"), label("08-09-2026")])
  // El ítem propio de las dos pautas más antiguas (03 y 06 de octubre) sólo está en el libro: la pantalla no lo muestra.
  const old = matrix.rows.find((cells) => cells[0] === EX.oldItem)!
  expect(old.slice(2).filter((state) => state === "Realizado")).toHaveLength(2)
  expect(old[2 + 8]).toBe("Realizado")
  expect(old[2 + 9]).toBe("Realizado")
  expect(sheet(book, "Pautas de la matriz").rows).toHaveLength(12)
  expect(filtros(book, "Nota").some((note) => /hasta 60 pautas.*la pantalla muestra las últimas 8/.test(note))).toBe(true)

  // 100 % y 20 % de septiembre → 60 % (el cociente de los totales daría 43 %); octubre, diez pautas de 75 %; noviembre, ninguna.
  expect(sheet(book, "Cumplimiento por mes").rows).toEqual([["sept 2026", 60, 2], ["oct 2026", 75, 10], ["nov 2026", null, 0]])
  expect(sheet(book, "Cumplimiento por equipo").rows.map((cells) => cells.slice(0, 7)))
    .toEqual([[EX.matrix.plate, EX.matrix.code, QA.wsA.name, "10.000 KM", 72.5, 12, 14]])
  expect(sheet(book, "Cumplimiento faena y mecánico").rows).toEqual([[QA.wsA.name, EX.mechanicX, 72.5, 12]])
})

test("Por horas: los libros de Correctivo y Preventivo traen lo de la máquina, con Horómetro, y nada de los camiones", async ({ page }) => {
  await login(page, ADMIN)
  const corrective = await exportFrom(page, "correctivo", tabUrl("correctivo", { faena: QA.wsA.id, unidad: "h", x_equipo: QA.m1.id }), { unit: "h" })
  const work = sheet(corrective, "Correctivos")
  expect(work.header).toContain("Horómetro (h)")
  expect(work.rows).toHaveLength(1)
  expect([QA.otM1, QA.m1.code, 4510, 6].map(String)).toEqual(
    [field(work, work.rows[0]!, "Referencia"), field(work, work.rows[0]!, "Código"), field(work, work.rows[0]!, "Horómetro (h)"), field(work, work.rows[0]!, "Horas hombre")].map(String),
  )
  expect(sheet(corrective, "Conductores").rows).toEqual([[QA.driverM.name, 6, 1]])
  // El gráfico de horas por equipo no se filtra a sí mismo: trae también la máquina del formulario (igual que la pantalla).
  expect(sheet(corrective, "Horas y registros").rows).toEqual([[QA.m1.plate, QA.m1.code, 6, 1], [FLOW.late.plate, FLOW.late.code, 1.5, 1]])
  expect(filtros(corrective, "Filtro cruzado: Equipo")).toEqual([`${QA.m1.code} · ${QA.m1.plate}`])
  expect(filtros(corrective, "Unidad de control")).toEqual(["Por horas"])
  const correctiveText = bookText(corrective)
  for (const other of [QA.a1.code, QA.a1.plate, QA.b1.code, EX.bulk.code, QA.otA1, QA.otB1, QA.driverA.name]) expect(correctiveText).not.toContain(other)

  const preventive = await exportFrom(page, "preventivo", tabUrl("preventivo", { faena: QA.wsA.id, unidad: "h", x_equipo: QA.m1.id }), { unit: "h" })
  // 600 h de octubre al 50 % y 300 h de noviembre al 90 %: la hoja «por mes» ignora el mes pero sí aplica el equipo.
  expect(sheet(preventive, "Cumplimiento por mes").rows).toEqual([["oct 2026", 50, 1], ["nov 2026", 90, 1]])
  expect(sheet(preventive, "Cumplimiento faena y mecánico").rows).toEqual([[QA.wsA.name, QA.mechanicM, 70, 2]])
  // La tabla por equipo no se filtra a sí misma por el equipo elegido: trae las dos máquinas con pautas de la faena A (sólo la M1 las tiene).
  expect(sheet(preventive, "Cumplimiento por equipo").rows.map((cells) => cells.slice(0, 7)))
    .toEqual([[QA.m1.plate, QA.m1.code, QA.wsA.name, "300 H · 600 H", 70, 2, 12]])
  const matrix = sheet(preventive, "Matriz de checklist")
  expect(matrix.header).toEqual(["Ítem", "Sistema", `${QA.m1.code} · 05-11-2026 · 300 H`, `${QA.m1.code} · 20-10-2026 · 600 H`])
  expect(matrix.rows.map((cells) => cells[0])).toEqual(["QA_ Nivel hidráulico", "QA_ Filtro de aire", "QA_ Mangueras", "QA_ Sensor de nivel"])
  expect(filtros(preventive, "Pestaña")).toEqual(["Preventivo"])
  expect(filtros(preventive, "Unidad de control")).toEqual(["Por horas"])
  const text = bookText(preventive)
  for (const other of [QA.a1.code, QA.a1.plate, QA.b1.code, EX.bulk.code, QA.otA1, QA.otB1, QA.driverA.name]) expect(text).not.toContain(other)
})

test("los filtros cruzados de trabajo, de conductor y de faena + mecánico acotan cada hoja como la pantalla: cada bloque ignora el que él mismo emite", async ({ page }) => {
  await login(page, ADMIN)
  const otId = await withSql(async (sql) => (await sql`select id from mant_work_orders where folio = ${QA.otA1}`)[0]!.id as string)
  const refs = (book: Book) => sheet(book, "Correctivos").rows.map((cells) => field(sheet(book, "Correctivos"), cells, "Referencia"))

  // Trabajo (OT): la tabla «Correctivos» no se reduce a la OT elegida (32 trabajos del período, de las dos faenas); «Conductores» y el gráfico por equipo sí.
  const byOt = await exportFrom(page, "correctivo", tabUrl("correctivo", { x_ot: `ot:${otId}` }))
  expect(refs(byOt)).toHaveLength(32)
  expect(refs(byOt)).toEqual(expect.arrayContaining([QA.otA1, QA.otB1]))
  expect(sheet(byOt, "Conductores").rows).toEqual([[QA.driverA.name, 2.5, 1]])
  expect(sheet(byOt, "Horas y registros").rows).toEqual([[QA.a1.plate, QA.a1.code, 2.5, 1]])
  expect(filtros(byOt, "Filtro cruzado: OT")).toEqual([QA.otA1])
  expect(filtros(byOt, "Filtro cruzado: Equipo")).toHaveLength(0) // el equipo que deriva de la OT no es un filtro propio

  // Conductor: «Conductores» los muestra a todos; «Correctivos» y «Horas y registros» se acotan a sus trabajos.
  const byDriver = await exportFrom(page, "correctivo", tabUrl("correctivo", { x_conductor: QA.driverB.name }))
  expect(sheet(byDriver, "Conductores").rows).toEqual([[EX.bulkDriver, 45, 30], [QA.driverB.name, 4, 1], [QA.driverA.name, 2.5, 1]])
  expect(refs(byDriver)).toEqual([QA.otB1])
  expect(sheet(byDriver, "Horas y registros").rows).toEqual([[QA.b1.plate, QA.b1.code, 4, 1]])
  expect(filtros(byDriver, "Filtro cruzado: Conductor")).toEqual([QA.driverB.name])

  // Mes: «Trabajos por mes» no se acota al mes elegido (sigue mostrando todos); la tabla y los conductores sí.
  const byMonth = await exportFrom(page, "correctivo", tabUrl("correctivo", { x_mes: "2026-10" }))
  expect(sheet(byMonth, "Trabajos por mes").rows).toEqual([["oct 2026", 31], ["nov 2026", 1]])
  expect(refs(byMonth)).toHaveLength(31)
  expect(refs(byMonth)).not.toContain(QA.otA1)
  expect(refs(byMonth)).toContain(QA.otB1)
  expect(filtros(byMonth, "Filtro cruzado: Mes")).toHaveLength(1)

  // Faena + mecánico (una barra de Preventivo): acota el cumplimiento, pero «faena y mecánico» sigue mostrando todas las barras
  // (como la pantalla: de menor a mayor cumplimiento).
  const byBar = await exportFrom(page, "preventivo", tabUrl("preventivo", { x_faena: QA.wsB.id, x_mecanico: QA.mechanicB }))
  expect(sheet(byBar, "Cumplimiento por mes").rows).toEqual([["oct 2026", null, 0], ["nov 2026", 50, 1]])
  expect(sheet(byBar, "Cumplimiento faena y mecánico").rows).toEqual([
    [QA.wsB.name, QA.mechanicB, 50, 1], [QA.wsA.name, EX.mechanicX, 75, 10], [QA.wsA.name, QA.mechanicA, 86.3, 2],
  ])
  expect(sheet(byBar, "Cumplimiento por equipo").rows.map((cells) => cells[0])).toEqual([QA.b1.plate])
  expect(filtros(byBar, "Filtro cruzado: Faena")).toEqual([QA.wsB.name])
  expect(filtros(byBar, "Filtro cruzado: Mecánico")).toEqual([QA.mechanicB])
})

test("Hoy conserva su botón de siempre (una hoja por gráfico y «Trabajos»), no el de las pestañas nuevas", async ({ page }) => {
  await login(page, ADMIN)
  await page.goto(`/mantencion/panel?pestana=hoy&${PERIOD}`)
  await expectPageTitle(page, "Panel de mantención")
  const own = page.getByRole("banner").getByRole("button", { name: "Exportar Excel: Panel de mantención, una hoja por gráfico y la hoja Trabajos", exact: true })
  await expect(own).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("button", { name: /pestaña/ })).toHaveCount(0)
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), own.click()])
  const names = [...(await readBook(download)).keys()]
  expect(names).toContain("Trabajos")
  expect(names).toContain("Metadatos")
  for (const looker of [...Object.values(PLANNING_SHEET), "Correctivos", "Matriz de checklist", "Filtros"]) expect(names).not.toContain(looker)
})

test("el alcance por faena se aplica en el servidor: el administrador ve la faena B y el supervisor de la faena A, ni una fila", async ({ page }) => {
  await withSql((sql) => scopeSupervisorToFaenaA(sql))
  // Control: con el mismo filtro, el administrador SÍ trae lo de la faena B (si no, el vacío de abajo no probaría nada).
  await login(page, ADMIN)
  const control = await exportFrom(page, "correctivo", tabUrl("correctivo", { faena: QA.wsB.id }))
  expect(sheet(control, "Correctivos").rows.map((cells) => field(sheet(control, "Correctivos"), cells, "Referencia"))).toEqual([QA.otB1])
  expect(filtros(control, "Faenas")).toEqual([QA.wsB.name])
  expect(bookText(control)).toContain(QA.driverB.name)

  await cerrarSesion(page)
  await login(page, USERS.scoped.email)
  for (const tab of ["planificacion", "correctivo", "preventivo"] as const) {
    const book = await exportFrom(page, tab, tabUrl(tab, { faena: QA.wsB.id }), { cross: false })
    for (const name of sheetNames(tab).filter((item) => item !== "Filtros" && item !== "Metadatos")) {
      // «Cumplimiento por mes» y «Trabajos por mes» listan siempre los meses del período, con % o conteo vacío y 0 pautas: eso tampoco es un dato.
      const data = sheet(book, name).rows.filter((cells) => cells.slice(1).some((value) => value !== null && value !== 0))
      expect(data, `${SHORT[tab]} · ${name}`).toHaveLength(0)
    }
    // «Filtros» no nombra la faena ajena (ni su código, ni lo suyo): sólo dice que no hay nombre disponible para ese id.
    expect(filtros(book, "Faenas")[0]).toMatch(/sin nombre disponible/)
    const text = bookText(book)
    for (const foreign of FAENA_B) expect(text, `${SHORT[tab]} no debe nombrar «${foreign}»`).not.toContain(foreign)
    expect(pairs(sheet(book, "Metadatos"), "Alcance de faena")).toEqual([QA.wsA.name])
    expect(pairs(sheet(book, "Metadatos"), "Generado por")).toEqual([USERS.scoped.email])
  }
  // Y en su propia faena el mismo usuario sí exporta datos: el vacío de arriba es por el alcance, no por el usuario.
  const own = await exportFrom(page, "correctivo", tabUrl("correctivo", { faena: QA.wsA.id }))
  expect(sheet(own, "Correctivos").rows).toHaveLength(31)
  expect(filtros(own, "Faenas")).toEqual([QA.wsA.name])
  for (const foreign of FAENA_B) expect(bookText(own)).not.toContain(foreign)
  // Sin pedir faena, el alcance la pone: cada fila del consolidado es de la faena A (3 equipos por km sembrados) y no hay de la B.
  const all = await exportFrom(page, "planificacion", tabUrl("planificacion"))
  const faenas = (book: Book, name: string) => sheet(book, name).rows.map((cells) => field(sheet(book, name), cells, "Faena"))
  expect(faenas(all, PLANNING_SHEET.km)).toEqual(Array(3).fill(QA.wsA.name))
  expect(filtros(all, "Faenas")).toEqual(["Todas las faenas de tu alcance"])
  for (const foreign of FAENA_B) expect(bookText(all)).not.toContain(foreign)
  // Y por horas: las cuatro máquinas de la faena A (la M1, la de la regla vigente y las dos del flujo).
  const allHours = await exportFrom(page, "planificacion", tabUrl("planificacion", { unidad: "h" }), { unit: "h" })
  expect(faenas(allHours, PLANNING_SHEET.h)).toEqual(Array(4).fill(QA.wsA.name))
})

test("quien ve el Panel sin «mant:export» no tiene el botón en ninguna de las tres pestañas", async ({ page }) => {
  await withSql((sql) => grantMechanicPanelWithoutExport(sql))
  await login(page, USERS.noExport.email)
  for (const tab of ["planificacion", "correctivo", "preventivo"] as const) {
    await page.goto(tabUrl(tab, { faena: QA.wsA.id }))
    await expectPageTitle(page, "Panel de mantención")
    // La pestaña carga con sus datos (no es una pantalla de «sin permiso») y ya hidrató: el TopBar pone ahí las acciones de página.
    // (Un mecánico no ve las OT de otros: la tabla de trabajos puede venir vacía, la pestaña no.)
    await expect(tab === "planificacion"
      ? page.locator("[data-planning-summary]")
      : page.getByRole("heading", { name: tab === "correctivo" ? "Trabajos del período" : "Cumplimiento por equipo", exact: true })).toBeVisible()
    await ready(page, { cross: false })
    await expect(page.getByRole("button", { name: /Exportar Excel/ }), SHORT[tab]).toHaveCount(0)
    await expect(page.getByRole("banner").getByRole("button", { name: /Exportar/ }), SHORT[tab]).toHaveCount(0)
  }
})
