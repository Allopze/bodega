import { expect, test, type Locator, type Page } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"
import { PERIOD, QA, cleanupLooker, leftovers, seedLooker } from "./mantencion-panel-looker-seed"
import {
  EX, MATRIX_DAYS, MACHINE_PRIOR, SEPTEMBER, accessIsOriginal, barsOf, cleanupExtra, extraLeftovers, filterBar, machinePlanning, matrixOf, param,
  plateTable, ready, row, rx, seedExtra, tabTo, tabUrl, watchProblems, withSql, driversTable, chipsOf,
} from "./mantencion-panel-looker-seed-extra"

/**
 * Cobertura que le faltaba al tablero Looker (2026-11-24), todo con datos QA propios y en el navegador:
 * C. las listas de Código y Frecuencia se acotan a la unidad de la pestaña y una URL de la otra unidad se ignora;
 * D. el tope de 8 pautas de la matriz con diez pautas de UN equipo; E. el teclado en las barras de faena + mecánico,
 * en una fila de conductor y en la leyenda del gráfico combinado; F. los valores: el % de un mes es el promedio de
 * los % de cada pauta, y «Consolidado por horas» sigue la regla vigente. Los controles responden sólo al hidratar: se
 * espera la marca de `ready` antes de cada clic.
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(180_000)

const ADMIN = "admin@e2e.chome.cl"
const dmy = (iso: string) => iso.split("-").reverse().join("-")
/** Miles como los pinta la pantalla (es-CL: «40.000», pero «1200»). */
const es = (value: number) => new Intl.NumberFormat("es-CL").format(value)
const freqName = (value: number, unit: string) => new RegExp(`^${rx(es(value)).source} ${unit === "km" ? "km" : "h"}\\b`)
const column = (matrix: Locator, code: string, date: string) => matrix.getByRole("columnheader", { name: new RegExp(`${rx(code).source}\\s*${date}`) })
const num = (text: string) => Number(text.replace(/[^\d,\-−]/g, "").replace("−", "-").replace(",", "."))

let machineIntervals: number[] = []
test.beforeAll(async () => {
  await withSql(async (sql) => {
    await cleanupExtra(sql)
    await seedLooker(sql)
    machineIntervals = await seedExtra(sql, { matrix: true, machine: true })
  })
})
test.afterAll(async () => {
  await withSql(async (sql) => {
    await cleanupExtra(sql)
    await cleanupLooker(sql)
    expect(await leftovers(sql)).toBe(0)
    expect(await extraLeftovers(sql)).toBe(0)
    expect(await accessIsOriginal(sql)).toBe(true)
  })
})

let problems: string[] = []
test.beforeEach(async ({ page }) => {
  problems = watchProblems(page)
  await login(page, ADMIN)
})
test.afterEach(() => { expect(problems).toEqual([]) })

/** Abre el popover de un filtro de la barra y devuelve sus casillas (la primera es «Todos»/«Todas»). */
async function openFilter(page: Page, label: "Faena" | "Código" | "Frecuencia"): Promise<Locator> {
  await filterBar(page).getByRole("button", { name: new RegExp(`^${label}:`) }).click()
  const popover = page.getByRole("dialog")
  await expect(popover).toBeVisible()
  return popover.getByRole("checkbox")
}
const closeFilter = async (page: Page) => { await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0) }

test("las listas de Código y Frecuencia se acotan a la unidad de la pestaña, y Planificación ofrece las dos", async ({ page }) => {
  // Lo que la base E2E tiene: equipos activos con ficha por unidad, y los intervalos de las pautas que esos equipos usan.
  const { equipment, frequencies } = await withSql(async (sql) => ({
    equipment: Object.fromEntries((await sql<Array<{ meter: string; n: number }>>`
      select t.default_meter_type as meter, count(*)::int as n
        from mant_equipment_profiles p join fuel_vehicles v on v.id = p.vehicle_id
        join fuel_equipment_types t on t.id = v.equipment_type_id join worksites w on w.id = v.worksite_id
       where v.is_active group by 1`).map((item) => [item.meter, item.n])) as Record<string, number>,
    frequencies: await sql<Array<{ unit: string; value: number }>>`
      select distinct v.snapshot->>'unit' as unit, jsonb_array_elements_text(v.snapshot->'intervals')::int as value
        from mant_schedules s join mant_schedule_versions v on v.schedule_id = s.id and v.version = s.version
       where s.deleted_at is null and s.id in (
         select p.schedule_id from mant_equipment_profiles p join fuel_vehicles fv on fv.id = p.vehicle_id where fv.is_active and p.schedule_id is not null)`,
  }))
  const km = frequencies.filter((item) => item.unit === "km")
  const hours = frequencies.filter((item) => item.unit === "h")
  expect(equipment.odometer).toBeGreaterThan(3)
  expect(equipment.hour_meter).toBeGreaterThan(3)
  expect(km.length).toBeGreaterThan(0)
  expect(hours.length).toBeGreaterThan(0)

  const trucks = [QA.a1, QA.b1, EX.matrix]
  const machines = [QA.m1, EX.machine]
  const cases = [
    { tab: "camiones", codes: equipment.odometer!, freq: km, present: trucks, absent: machines, absentFreq: hours },
    { tab: "maquinas", codes: equipment.hour_meter!, freq: hours, present: machines, absent: trucks, absentFreq: km },
    { tab: "planificacion", codes: equipment.odometer! + equipment.hour_meter!, freq: [...km, ...hours], present: [...trucks, ...machines], absent: [], absentFreq: [] },
  ]
  for (const item of cases) {
    await test.step(item.tab, async () => {
      await page.goto(tabUrl(item.tab))
      await ready(page)
      const codes = await openFilter(page, "Código")
      // Sólo los equipos de su unidad: la cuenta sale de la base (más «Todos») y cada equipo QA está donde corresponde.
      await expect(codes, "casillas de Código").toHaveCount(item.codes + 1)
      for (const vehicle of item.present) await expect(page.getByRole("checkbox", { name: rx(vehicle.code) })).toHaveCount(1)
      for (const vehicle of item.absent) await expect(page.getByRole("checkbox", { name: rx(vehicle.code) })).toHaveCount(0)
      await closeFilter(page)

      const options = await openFilter(page, "Frecuencia")
      await expect(options, "casillas de Frecuencia").toHaveCount(item.freq.length + 1)
      for (const { unit, value } of item.freq) await expect(page.getByRole("checkbox", { name: freqName(value, unit) })).toHaveCount(1)
      for (const { unit, value } of item.absentFreq) await expect(page.getByRole("checkbox", { name: freqName(value, unit) })).toHaveCount(0)
      await closeFilter(page)
    })
  }
})

test("una URL de Camiones con un equipo y una frecuencia de horas no produce chips ni error, y la de Máquinas con los de km tampoco", async ({ page }) => {
  const cases: Array<{ tab: string; params: Record<string, string>; kept: string[] }> = [
    { tab: "camiones", params: { equipo: QA.m1.id, frecuencia: "300" }, kept: [QA.a1.plate, QA.b1.plate] },
    { tab: "camiones", params: { x_equipo: QA.m1.id }, kept: [QA.a1.plate, QA.b1.plate] },
    { tab: "maquinas", params: { equipo: QA.a1.id, frecuencia: "40000" }, kept: [QA.m1.plate] },
  ]
  for (const item of cases) {
    await test.step(`${item.tab} ${new URLSearchParams(item.params).toString()}`, async () => {
      await page.goto(tabUrl(item.tab, item.params))
      await expectPageTitle(page, "Panel de mantención")
      await ready(page)
      // La pestaña se ve como si no se hubieran pedido: sin chips, sin «Borrar filtros» y con todo lo suyo.
      await expect(filterBar(page).getByRole("button", { name: /^Eliminar filtro/ })).toHaveCount(0)
      await expect(filterBar(page).getByRole("button", { name: "Borrar filtros" })).toHaveCount(0)
      await expect(filterBar(page).getByText("Filtros activos")).toHaveCount(0)
      await expect(filterBar(page).getByRole("button", { name: "Código: Todos" })).toBeVisible()
      await expect(filterBar(page).getByRole("button", { name: "Frecuencia: Todas" })).toBeVisible()
      for (const plate of item.kept) await expect(row(plateTable(page), plate)).toBeVisible()
    })
  }
})

test("Planificación: un equipo de la otra unidad deja el aviso una sola vez, con su patente", async ({ page }) => {
  // El camión A1 se controla por km: la tabla de horas queda vacía y dice por qué, sin repetirlo en otro lado de la pantalla.
  await page.goto(tabUrl("planificacion", { faena: QA.wsA.id, x_equipo: QA.a1.id }))
  await ready(page)
  const message = `${QA.a1.plate} se controla por km; no tiene registros por horas.`
  await expect(page.getByRole("heading", { name: message, exact: true })).toHaveCount(1)
  await expect(page.getByText(/se controla por km/).locator("visible=true")).toHaveCount(1)
  // La de km, en cambio, sigue completa (la fila elegida resaltada) y no repite el aviso de unidad.
  await expect(row(page.getByRole("table", { name: "Consolidado mantención por kilómetros" }), QA.a1.plate).getByRole("button", { name: QA.a1.plate })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByText(/se controla por horas/).locator("visible=true")).toHaveCount(0)
})

test("la matriz muestra las 8 pautas más recientes de un equipo con diez, en orden, y ni una más", async ({ page }) => {
  await page.goto(tabUrl("camiones", { equipo: EX.matrix.id }))
  await ready(page)
  const matrix = matrixOf(page)
  const newest = [...MATRIX_DAYS].reverse().slice(0, 8).map(dmy)
  const headers = await matrix.getByRole("columnheader").allInnerTexts()
  expect(headers[0]).toBe("Ítem")
  // Columnas de la más reciente (30-10) a la octava (09-10); las del 06-10 y 03-10 quedan fuera.
  expect(headers.slice(1).map((text) => /\d{2}-\d{2}-\d{4}/.exec(text)?.[0])).toEqual(newest)
  for (const text of headers.slice(1)) expect(text).toContain(EX.matrix.code)
  await expect(page.getByText("2 ítems · 8 pautas", { exact: true })).toBeVisible()
  // El ítem propio de las dos pautas excluidas no aparece, ni como fila ni como celda; tampoco el aviso de «sin detalle».
  await expect(matrix.getByText(EX.oldItem)).toHaveCount(0)
  await expect(matrix.getByRole("img", { name: rx(EX.oldItem) })).toHaveCount(0)
  await expect(page.getByText(/no traen detalle por ítem/)).toHaveCount(0)
  // Las diez pautas existen y cuentan en el cumplimiento: la tabla por patente dice 10; el tope es de la matriz, no de los datos.
  await expect(row(plateTable(page), EX.matrix.plate).getByRole("cell").last()).toHaveText("10")
  await expect(row(plateTable(page), EX.matrix.plate)).toContainText("75%")
  // Las 8 columnas se pueden fijar: la columna del 30-10 filtra y deja sólo su pauta en la tabla.
  await column(matrix, EX.matrix.code, newest[0]!).getByRole("button").click()
  await expect.poll(() => param(page, "x_check")).toBe(`h:qa-e2e-looker-check-x2-${MATRIX_DAYS.at(-1)}`)
  await expect(row(plateTable(page), EX.matrix.plate).getByRole("cell").last()).toHaveText("1")
})

test("el % de un mes es el promedio de los % de cada pauta, no el cociente de los totales", async ({ page }) => {
  // Septiembre del equipo extra: una pauta 2 de 2 (100 %, con 5 «No aplica») y otra 1 de 5 (20 %). Promedio 60 %; cociente 3/7 = 43 %.
  await page.goto(tabUrl("camiones", {}, SEPTEMBER))
  await ready(page)
  const months = barsOf(page, "% de cumplimiento por mes").getByRole("button")
  await expect(months).toHaveCount(1)
  await expect(months.first()).toHaveAccessibleName("sept 2026: 60%")
  await expect(barsOf(page, "% de cumplimiento por faena y mecánico").getByRole("button", { name: `${QA.wsA.name} · ${EX.mechanicX}: 60%`, exact: true })).toBeVisible()
  const cells = row(plateTable(page), EX.matrix.plate).getByRole("cell")
  await expect(cells.nth(3)).toHaveText("60%")
  await expect(cells.nth(4)).toHaveText("2")
  await expect(page.getByText("43%")).toHaveCount(0)
  // Las dos pautas también son las dos columnas de la matriz.
  const dates = (await matrixOf(page).getByRole("columnheader").allInnerTexts()).slice(1).map((text) => /\d{2}-\d{2}-\d{4}/.exec(text)?.[0])
  expect(dates).toEqual(["22-09-2026", "08-09-2026"])
})

test("«Consolidado por horas» muestra A, B, delta, próxima y faltantes de la máquina según la regla vigente", async ({ page }) => {
  const expected = machinePlanning(machineIntervals)
  // La regla (schedule.ts / status.ts): punto = máx(base, redondeo(4.520 / 300) × 300) = 4.500; próxima = punto + base = 4.800; con 4.780 faltan 20.
  expect(machineIntervals.join(",")).toBe("300,600,900,1200")
  expect(expected).toMatchObject({ programmed: 4500, real: 4520, current: 4780, next: 4800, delta: -20, remaining: 20 })

  await page.goto(tabUrl("planificacion", { equipo: EX.machine.id }))
  await ready(page)
  const table = page.getByRole("table", { name: "Consolidado mantención por horas" })
  // La pantalla escribe «Horas programados (A)» (planning-tables.tsx, género de «Km»); el Excel dice «programadas». No se fija el error aquí.
  const headers = (await table.getByRole("columnheader").allInnerTexts()).map((text) => text.trim().replace("programados", "programadas"))
  expect(headers).toEqual([
    "Patente", "Código", "Última mantención", "Horas programadas (A)", "Horas reales (B)", "Horas actuales", "Próxima mantención", "Delta (A − B)", "Faltantes",
  ])
  const machine = row(table, EX.machine.plate)
  await expect(machine).toHaveCount(1)
  const cells = (await machine.getByRole("cell").allInnerTexts()).map((text) => text.trim())
  expect(cells).toHaveLength(headers.length)
  const at = (header: string) => cells[headers.indexOf(header)]!
  expect(at("Patente")).toBe(EX.machine.plate)
  expect(at("Código")).toBe(EX.machine.code)
  expect(at("Última mantención")).toContain(MACHINE_PRIOR.date.split("-").reverse().join("-"))
  expect(at("Última mantención")).toContain("Declarada")
  expect(num(at("Horas programadas (A)"))).toBe(expected.programmed)
  expect(num(at("Horas reales (B)"))).toBe(expected.real)
  expect(num(at("Horas actuales"))).toBe(expected.current)
  expect(num(at("Próxima mantención"))).toBe(expected.next)
  expect(num(at("Delta (A − B)"))).toBe(expected.delta)
  expect(num(at("Faltantes"))).toBe(expected.remaining)
  // Faltantes 20 ≤ 15 % de la base (45): la celda lo dice en su `title`; el delta negativo, «después».
  await expect(machine.getByRole("cell").last()).toHaveAttribute("title", `Faltan ${expected.remaining}`)
  await expect(machine.getByRole("cell").nth(7)).toHaveAttribute("title", `Se hizo ${Math.abs(expected.delta)} después`)
  // El gráfico de delta de horas dice lo mismo que la tabla.
  await expect(barsOf(page, "Delta de horas por equipo").getByRole("button", { name: new RegExp(`^${EX.machine.plate}: [-−]${Math.abs(expected.delta)} h$`) })).toBeVisible()
  // La tabla de km no tiene nada que ver con una máquina: queda vacía, y la de horas trae sólo la fila del equipo pedido.
  await expect(page.getByRole("heading", { name: "Sin equipos por kilómetros con estos filtros" })).toBeVisible()
  await expect(table.getByRole("row")).toHaveCount(2)
})

test("el teclado opera las barras de faena + mecánico, una fila de conductor y la leyenda del gráfico combinado con Enter y Espacio", async ({ page }) => {
  await page.goto(tabUrl("camiones"))
  await ready(page)

  /** Enter fija y Enter quita; Espacio fija y Espacio quita. `aria-pressed`, la URL y el foco acompañan cada paso. */
  async function operate(control: Locator, keys: string[]) {
    for (const key of ["Enter", "Space"]) {
      await expect(control).toHaveAttribute("aria-pressed", "false")
      await page.keyboard.press(key)
      for (const name of keys) await expect.poll(() => param(page, name), `${key} fija ${name}`).not.toBeNull()
      await expect(control).toHaveAttribute("aria-pressed", "true")
      await expect(control).toBeFocused()
      await page.keyboard.press(key)
      for (const name of keys) await expect.poll(() => param(page, name), `${key} quita ${name}`).toBeNull()
      await expect(control).toHaveAttribute("aria-pressed", "false")
    }
  }

  await test.step("barra de faena + mecánico", async () => {
    const bar = barsOf(page, "% de cumplimiento por faena y mecánico").getByRole("button", { name: rx(`${QA.wsB.name} · ${QA.mechanicB}`) })
    await tabTo(page, page.getByRole("heading", { name: "Preventivo", exact: true }), bar)
    await operate(bar, ["x_faena", "x_mecanico"])
    // Lo que fija es la dupla: la faena B y su mecánico (no un valor cualquiera).
    await page.keyboard.press("Enter")
    await expect.poll(() => param(page, "x_faena")).toBe(QA.wsB.id)
    expect(param(page, "x_mecanico")).toBe(QA.mechanicB)
    await expect(chipsOf(page, "Mecánico").filter({ hasText: QA.mechanicB })).toBeVisible()
    await page.keyboard.press("Enter")
    await expect.poll(() => param(page, "x_faena")).toBeNull()
  })

  await test.step("fila de conductor", async () => {
    const driver = row(driversTable(page), QA.driverA.name).getByRole("button").first()
    await tabTo(page, page.getByRole("heading", { name: "Correctivo", exact: true }), driver)
    await operate(driver, ["x_conductor"])
    await page.keyboard.press("Enter")
    await expect.poll(() => param(page, "x_conductor")).toBe(QA.driverA.name)
    await expect(chipsOf(page, "Conductor").filter({ hasText: QA.driverA.name })).toBeVisible()
    await page.keyboard.press("Enter")
    await expect.poll(() => param(page, "x_conductor")).toBeNull()
  })

  // La leyenda del gráfico combinado SÍ es interactiva: son botones con `aria-pressed` (un clic o Enter/Espacio fijan `x_equipo`).
  await test.step("leyenda del gráfico combinado", async () => {
    const legend = page.getByRole("button", { name: `${QA.b1.code} · ${QA.b1.plate}`, exact: true })
    await tabTo(page, page.getByRole("heading", { name: "Horas y registros por equipo", exact: true }), legend)
    await operate(legend, ["x_equipo"])
    await page.keyboard.press("Space")
    await expect.poll(() => param(page, "x_equipo")).toBe(QA.b1.id)
    await expect(chipsOf(page, "Patente").filter({ hasText: QA.b1.plate })).toBeVisible()
    await page.keyboard.press("Space")
    await expect.poll(() => param(page, "x_equipo")).toBeNull()
  })
  expect(param(page, "desde")).toBe(new URLSearchParams(PERIOD).get("desde"))
})
