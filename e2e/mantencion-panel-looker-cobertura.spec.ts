import { expect, test, type Locator, type Page } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"
import { PERIOD, QA, cleanupLooker, leftovers, seedLooker } from "./mantencion-panel-looker-seed"
import {
  EX, FLOW, MATRIX_DAYS, MACHINE_PRIOR, SEPTEMBER, accessIsOriginal, barOf, barsOf, chileDay, chipsOf, cleanupExtra, equipmentTable, extraLeftovers, filterBar,
  funnelOf, machinePlanning, matrixOf, param, paramsOf, planningTable, ready, row, rx, seedExtra, tabTo, tabUrl, watchProblems, withSql, workTable,
} from "./mantencion-panel-looker-seed-extra"

/**
 * Cobertura que le faltaba al tablero Looker (2026-11-24; reescrita el 2026-11-27 para Planificación, Correctivo y Preventivo), todo con datos
 * QA propios y en el navegador: C. las listas de Equipo y Frecuencia se acotan a la unidad y una URL de la otra unidad se ignora;
 * D. el tope de 8 pautas de la matriz con diez pautas de UN equipo; E. el teclado en las barras de faena + mecánico, en una barra de
 * conductor y en la leyenda del gráfico combinado; F. los valores: el % de un mes es el promedio de los % de cada pauta, y el detalle
 * por horas de Planificación sigue la regla vigente; G. la fecha estimada, el filtro por fechas y los atajos «Próximos N días»
 * (las vencidas siguen dentro) con lecturas relativas a hoy. Los controles responden sólo al hidratar: se espera la marca de
 * `ready` antes de cada clic.
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(180_000)

const ADMIN = "admin@e2e.chome.cl"
const dmy = (iso: string) => iso.split("-").reverse().join("-")
/** Miles como los pinta la pantalla (es-CL: «40.000», pero «1200»). */
const es = (value: number) => new Intl.NumberFormat("es-CL").format(value)
const freqName = (value: number, unit: string) => new RegExp(`^${rx(es(value)).source} ${unit === "km" ? "km" : "h"}\\b`)
const num = (text: string) => Number(text.replace(/[^\d,\-−]/g, "").replace("−", "-").replace(",", "."))
const chip = (page: Page, label: string) => chipsOf(page, label)
/** La faena A reúne a los equipos QA de las dos unidades: acota la base E2E a lo sembrado aquí. */
const urlA = (tab: string, extra: Record<string, string> = {}) => tabUrl(tab, { faena: QA.wsA.id, ...extra })

let machineIntervals: number[] = []
test.beforeAll(async () => {
  await withSql(async (sql) => {
    await cleanupExtra(sql)
    await seedLooker(sql)
    machineIntervals = await seedExtra(sql, { matrix: true, machine: true, flow: true })
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
async function openFilter(page: Page, label: "Faena" | "Equipo" | "Frecuencia"): Promise<Locator> {
  await filterBar(page).getByRole("button", { name: new RegExp(`^${label}:`) }).click()
  const popover = page.getByRole("dialog")
  await expect(popover).toBeVisible()
  return popover.getByRole("checkbox")
}
const closeFilter = async (page: Page) => { await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0) }

test("las listas de Equipo y Frecuencia se acotan a la unidad de la barra, en cada pestaña", async ({ page }) => {
  // Lo que la base E2E tiene: equipos activos con ficha por unidad, y los intervalos de las pautas que esos equipos usan.
  // La unidad es la del equipo (`mant_equipment_profiles.unit`) y, si no la fija, la de su tipo: un camión de Cholguan mide en horas
  // aunque su tipo sea de odómetro (2026-11-25).
  const { equipment, frequencies } = await withSql(async (sql) => ({
    equipment: Object.fromEntries((await sql<Array<{ meter: string; n: number }>>`
      select coalesce(case p.unit when 'km' then 'odometer' when 'h' then 'hour_meter' end, t.default_meter_type) as meter, count(*)::int as n
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
  const machines = [QA.m1, EX.machine, FLOW.late, FLOW.ok]
  const cases: Array<{ tab: string; extra: Record<string, string>; codes: number; freq: Array<{ unit: string; value: number }>; present: Array<{ code: string }>; absent: Array<{ code: string }>; absentFreq: Array<{ unit: string; value: number }> }> = [
    { tab: "correctivo", extra: {}, codes: equipment.odometer!, freq: km, present: trucks, absent: machines, absentFreq: hours },
    { tab: "correctivo", extra: { unidad: "h" }, codes: equipment.hour_meter!, freq: hours, present: machines, absent: trucks, absentFreq: km },
    { tab: "planificacion", extra: {}, codes: equipment.odometer!, freq: km, present: trucks, absent: machines, absentFreq: hours },
    { tab: "planificacion", extra: { unidad: "h" }, codes: equipment.hour_meter!, freq: hours, present: machines, absent: trucks, absentFreq: km },
    { tab: "preventivo", extra: { unidad: "h" }, codes: equipment.hour_meter!, freq: hours, present: machines, absent: trucks, absentFreq: km },
  ]
  for (const item of cases) {
    await test.step(`${item.tab} ${item.extra["unidad"] ?? "km"}`, async () => {
      await page.goto(tabUrl(item.tab, item.extra))
      await ready(page, { cross: false })
      const codes = await openFilter(page, "Equipo")
      // Sólo los equipos de su unidad: la cuenta sale de la base (más «Todos») y cada equipo QA está donde corresponde.
      await expect(codes, "casillas de Equipo").toHaveCount(item.codes + 1)
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

test("una URL con un equipo y una frecuencia de la otra unidad no produce chips ni error", async ({ page }) => {
  const cases: Array<{ tab: string; params: Record<string, string>; kept: string[] }> = [
    { tab: "correctivo", params: { equipo: QA.m1.id, frecuencia: "300" }, kept: [QA.otA1, QA.otB1] },
    { tab: "correctivo", params: { x_equipo: QA.m1.id }, kept: [QA.otA1, QA.otB1] },
    { tab: "correctivo", params: { unidad: "h", equipo: QA.a1.id, frecuencia: "40000" }, kept: [QA.otM1] },
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
      await expect(filterBar(page).getByRole("button", { name: "Equipo: Todos" })).toBeVisible()
      await expect(filterBar(page).getByRole("button", { name: "Frecuencia: Todas" })).toBeVisible()
      for (const folio of item.kept) await expect(row(workTable(page), folio)).toBeVisible()
    })
  }
})

test("Planificación: la fecha estimada, el rango por fechas y los atajos «Próximos N días» dejan las vencidas dentro", async ({ page }) => {
  const filters = page.locator("[data-planning-date-filter]")
  const shortcuts = filters.getByRole("group", { name: "Atajos (incluyen las vencidas)" })
  const shortcut = (days: number) => shortcuts.getByRole("button", { name: `Próximos ${days} días`, exact: true })
  const rowOf = (plate: string) => row(planningTable(page, "h"), plate)
  const summary = page.locator("[data-planning-summary]")
  const stat = (name: string) => summary.getByRole("link", { name: new RegExp(`^${name}`) })

  await page.goto(urlA("planificacion", { unidad: "h" }))
  await ready(page)
  // Sin fecha filtrada: la máquina vencida, la próxima, la que está al día y la sin pauta. Sus fechas salen de las lecturas de los últimos 30 días.
  for (const machine of [FLOW.late, FLOW.ok, EX.machine, QA.m1]) await expect(rowOf(machine.plate)).toBeVisible()
  await expect(stat("Equipos controlados")).toContainText("4")
  await expect(stat("Vencidas")).toContainText("1")
  await expect(stat("Próximas")).toContainText("1")
  await expect(stat("Al día")).toContainText("1")
  await expect(stat("Sin pauta o lectura")).toContainText("1")
  // Ya venció (faltan −100 h): la fecha estimada parte de la última lectura (hace 2 días) y retrocede 100 h ÷ 5,6 h/día = 18 días.
  await expect(rowOf(FLOW.late.plate)).toContainText(`desde ≈ ${dmy(chileDay(-20))}`)
  await expect(rowOf(FLOW.late.plate)).toContainText("≈ 5,6 h/día")
  await expect(rowOf(FLOW.late.plate)).toContainText("Vencida")
  // Sin lecturas recientes no hay estimación y la tabla dice por qué.
  await expect(rowOf(EX.machine.plate).getByRole("cell").nth(8)).toContainText("—")
  await expect(rowOf(EX.machine.plate).getByRole("cell").nth(8).locator("[title]").first()).toHaveAttribute("title", /Sin lecturas suficientes/)

  // «Próximos 30 días» fija sólo el término: la vencida (fecha pasada) sigue dentro; la que está al día (≈ 40 días) y las sin fecha, fuera.
  await shortcut(30).click()
  await expect.poll(() => param(page, "fecha_hasta")).toBe(chileDay(30))
  expect(param(page, "fecha_desde")).toBeNull()
  await expect(shortcut(30)).toHaveAttribute("aria-pressed", "true")
  await expect(shortcut(7)).toHaveAttribute("aria-pressed", "false")
  await expect(chip(page, "Próxima mantención")).toContainText(`hasta ${dmy(chileDay(30))}`)
  await expect(rowOf(FLOW.late.plate)).toBeVisible()
  await expect(rowOf(FLOW.ok.plate)).toHaveCount(0)
  await expect(rowOf(EX.machine.plate)).toHaveCount(0)
  await expect(rowOf(QA.m1.plate)).toHaveCount(0)
  await expect(stat("Equipos controlados")).toContainText("1")
  await expect(stat("Vencidas")).toContainText("1")

  // El estado de la tira se combina con la fecha (y se quita con un segundo clic, dejando la fecha).
  await stat("Vencidas").click()
  await expect.poll(() => param(page, "estado")).toBe("vencida")
  await expect(rowOf(FLOW.late.plate)).toBeVisible()
  await stat("Vencidas").click()
  await expect.poll(() => param(page, "estado")).toBeNull()
  expect(param(page, "fecha_hasta")).toBe(chileDay(30))

  // 90 días trae también la que está al día; un segundo clic en el vigente quita el atajo.
  await shortcut(90).click()
  await expect.poll(() => param(page, "fecha_hasta")).toBe(chileDay(90))
  await expect(rowOf(FLOW.ok.plate)).toBeVisible()
  await expect(rowOf(FLOW.late.plate)).toBeVisible()
  await shortcut(90).click()
  await expect.poll(() => param(page, "fecha_hasta")).toBeNull()
  await expect(rowOf(QA.m1.plate)).toBeVisible()

  // El chip quita las dos fechas de una vez.
  await shortcut(7).click()
  await expect.poll(() => param(page, "fecha_hasta")).toBe(chileDay(7))
  await chip(page, "Próxima mantención").getByRole("button", { name: "Eliminar filtro Próxima mantención" }).click()
  await expect.poll(() => param(page, "fecha_hasta")).toBeNull()

  // Filtrar por la ÚLTIMA mantención: el rango es de otra fecha, los atajos de «próximos días» no aplican y la vencida (hace 90 días) entra.
  await filters.getByRole("button", { name: "Última mantención", exact: true }).click()
  await expect.poll(() => param(page, "fecha")).toBe("ultima")
  await expect(shortcuts).toHaveCount(0)
  await page.goto(urlA("planificacion", { unidad: "h", fecha: "ultima", fecha_desde: chileDay(-100), fecha_hasta: chileDay(-60) }))
  await ready(page)
  await expect(rowOf(FLOW.late.plate)).toBeVisible()
  await expect(rowOf(FLOW.ok.plate)).toHaveCount(0)
  await expect(chip(page, "Última mantención")).toContainText(`${dmy(chileDay(-100))} al ${dmy(chileDay(-60))}`)
  await filters.getByRole("button", { name: "Próxima mantención (estimada)", exact: true }).click()
  await expect.poll(() => param(page, "fecha")).toBeNull()
  expect(param(page, "fecha_desde")).toBeNull()
  expect(param(page, "fecha_hasta")).toBeNull()
  await expect(shortcuts).toBeVisible()
})

test("Planificación: «Faltantes» y «¿Se hizo a tiempo?» son filtros por equipo que no se filtran a sí mismos", async ({ page }) => {
  await page.goto(urlA("planificacion", { unidad: "h" }))
  await ready(page)
  const remaining = barsOf(page, "Faltantes para la próxima mantención por equipo")
  const timing = page.getByRole("group", { name: /^Diferencia entre cuando tocaba y cuando se hizo/ })
  const rowOf = (plate: string) => row(planningTable(page, "h"), plate)

  // «Faltantes»: lo vencido arriba, con la cifra escrita; el sin pauta (M1) no se dibuja.
  const buttons = remaining.getByRole("button")
  await expect(buttons.first()).toHaveAccessibleName(new RegExp(`^${FLOW.late.plate}: Vencida por 100 h`))
  await expect(buttons).toHaveCount(3)
  await expect(remaining.getByRole("button", { name: new RegExp(`^${QA.m1.plate}`) })).toHaveCount(0)
  await expect(remaining.getByRole("button", { name: new RegExp(`^${EX.machine.plate}: Faltan 20 h`) })).toBeVisible()
  // «¿A tiempo?»: la vencida se hizo a tiempo (tocaba y se hizo a las 3.000 h); la máquina de la regla vigente, 20 h tarde.
  await expect(barOf(timing, FLOW.late.plate)).toContainText("A tiempo")
  await expect(barOf(timing, EX.machine.plate)).toContainText("20 h tarde")

  const lateBar = remaining.getByRole("button", { name: new RegExp(`^${FLOW.late.plate}`) })
  await lateBar.click()
  await expect.poll(() => param(page, "x_equipo")).toBe(FLOW.late.id)
  await expect(lateBar).toHaveAttribute("aria-pressed", "true")
  await expect(chip(page, "Patente")).toContainText(FLOW.late.plate)
  await expect(barOf(timing, FLOW.late.plate)).toHaveAttribute("aria-pressed", "true")
  // Ninguno se filtra a sí mismo ni la tabla: siguen completos y sólo se resalta el elegido.
  await expect(buttons).toHaveCount(3)
  await expect(rowOf(FLOW.ok.plate)).toBeVisible()
  await expect(rowOf(FLOW.late.plate)).toHaveAttribute("data-selected", "true")
  await lateBar.click()
  await expect.poll(() => param(page, "x_equipo")).toBeNull()

  // El camino de la otra barra y de la fila entera.
  await barOf(timing, EX.machine.plate).click()
  await expect.poll(() => param(page, "x_equipo")).toBe(EX.machine.id)
  await rowOf(EX.machine.plate).getByRole("cell").nth(1).click()
  await expect.poll(() => param(page, "x_equipo")).toBeNull()
})

test("Planificación: la patente lleva al historial de mantenciones del equipo y «atrás» vuelve al panel con sus filtros", async ({ page }) => {
  await page.goto(urlA("planificacion", { unidad: "h", estado: "vencida" }))
  await ready(page)
  const link = row(planningTable(page, "h"), FLOW.late.plate).getByRole("link", { name: FLOW.late.plate, exact: true })
  await expect(link).toHaveAttribute("href", new RegExp(`/mantencion/registros/historicos\\?.*equipo=${FLOW.late.id}`))
  await link.click()
  await expect(page).toHaveURL(new RegExp(`/mantencion/registros/historicos\\?.*equipo=${FLOW.late.id}`))
  await page.goBack()
  await expect(page).toHaveURL(/\/mantencion\/panel\?/)
  expect(paramsOf(page)).toMatchObject({ pestana: "planificacion", unidad: "h", estado: "vencida", faena: QA.wsA.id })
  await expect(row(planningTable(page, "h"), FLOW.late.plate)).toBeVisible()
})

test("la matriz muestra las 8 pautas más recientes de un equipo con diez, en orden, y ni una más", async ({ page }) => {
  await page.goto(tabUrl("preventivo", { equipo: EX.matrix.id }))
  await ready(page)
  const matrix = matrixOf(page)
  const newest = [...MATRIX_DAYS].reverse().slice(0, 8).map(dmy)
  const headers = await matrix.getByRole("columnheader").allInnerTexts()
  expect(headers[0]).toBe("Ítem")
  // Columnas de la más reciente (30-10) a la octava (09-10); las del 06-10 y 03-10 quedan fuera.
  expect(headers.slice(1).map((text) => /\d{2}-\d{2}-\d{4}/.exec(text)?.[0])).toEqual(newest)
  for (const text of headers.slice(1)) expect(text).toContain(EX.matrix.plate)
  await expect(page.getByText("2 ítems · 8 pautas", { exact: true })).toBeVisible()
  // El ítem propio de las dos pautas excluidas no aparece, ni como fila ni como celda; tampoco el aviso de «sin detalle».
  await expect(matrix.getByText(EX.oldItem)).toHaveCount(0)
  await expect(matrix.getByRole("img", { name: rx(EX.oldItem) })).toHaveCount(0)
  await expect(page.getByText(/no traen detalle por ítem/)).toHaveCount(0)
  // Las diez pautas existen y cuentan en el cumplimiento: la tabla por equipo dice 10; el tope es de la matriz, no de los datos.
  const cells = row(equipmentTable(page), EX.matrix.plate).getByRole("cell")
  await expect(cells.nth(3)).toHaveText("10")
  await expect(cells.nth(2)).toContainText("75%")
  // Las 8 columnas se pueden fijar: el embudo de la columna del 30-10 filtra y deja sólo su pauta en la tabla.
  await funnelOf(matrix, `Filtrar el panel por la pauta del ${newest[0]} de ${EX.matrix.plate}`).click()
  await expect.poll(() => param(page, "x_check")).toBe(`h:qa-e2e-looker-check-x2-${MATRIX_DAYS.at(-1)}`)
  await expect(cells.nth(3)).toHaveText("1")
})

test("el % de un mes es el promedio de los % de cada pauta, no el cociente de los totales", async ({ page }) => {
  // Septiembre del equipo extra: una pauta 2 de 2 (100 %, con 5 «No aplica») y otra 1 de 5 (20 %). Promedio 60 %; cociente 3/7 = 43 %.
  await page.goto(tabUrl("preventivo", {}, SEPTEMBER))
  await ready(page)
  const months = page.getByRole("button", { name: /^sept 2026/ })
  await expect(months).toHaveCount(1)
  await expect(months).toContainText("60%")
  await expect(barOf(barsOf(page, "Cumplimiento por faena y mecánico"), `${QA.wsA.name} · ${EX.mechanicX}`)).toHaveAccessibleName(`${QA.wsA.name} · ${EX.mechanicX}: 60%`)
  const cells = row(equipmentTable(page), EX.matrix.plate).getByRole("cell")
  await expect(cells.nth(2)).toHaveText("60%")
  await expect(cells.nth(3)).toHaveText("2")
  await expect(page.getByText("43%")).toHaveCount(0)
  // Las dos pautas también son las dos columnas de la matriz.
  const dates = (await matrixOf(page).getByRole("columnheader").allInnerTexts()).slice(1).map((text) => /\d{2}-\d{2}-\d{4}/.exec(text)?.[0])
  expect(dates).toEqual(["22-09-2026", "08-09-2026"])
})

test("el detalle por equipo de horas muestra tocaba, se hizo, actual, próxima y faltan de la máquina según la regla vigente", async ({ page }) => {
  const expected = machinePlanning(machineIntervals)
  // La regla (schedule.ts / status.ts): punto = máx(base, redondeo(4.520 / 300) × 300) = 4.500; próxima = punto + base = 4.800; con 4.780 faltan 20.
  expect(machineIntervals.join(",")).toBe("300,600,900,1200")
  expect(expected).toMatchObject({ programmed: 4500, real: 4520, current: 4780, next: 4800, delta: -20, remaining: 20 })

  await page.goto(urlA("planificacion", { unidad: "h", equipo: EX.machine.id }))
  await ready(page)
  const table = planningTable(page, "h")
  const headers = (await table.getByRole("columnheader").allInnerTexts()).map((text) => text.trim())
  expect(headers).toEqual([
    "Equipo", "Última mantención", "Tocaba a los", "Se hizo a los", "¿A tiempo?", "Lectura actual", "Próxima a los", "Faltan", "Fecha estimada", "Estado",
  ])
  const machine = row(table, EX.machine.plate)
  await expect(machine).toHaveCount(1)
  const cells = (await machine.getByRole("cell").allInnerTexts()).map((text) => text.trim())
  expect(cells).toHaveLength(headers.length)
  const at = (header: string) => cells[headers.indexOf(header)]!
  expect(at("Equipo")).toContain(EX.machine.plate)
  expect(at("Equipo")).toContain(EX.machine.code)
  expect(at("Equipo")).toContain(QA.wsA.name)
  expect(at("Última mantención")).toContain(MACHINE_PRIOR.date.split("-").reverse().join("-"))
  expect(at("Última mantención")).toContain("Declarada")
  expect(at("Última mantención")).toContain(`Cada ${MACHINE_PRIOR.interval} h`)
  expect(num(at("Tocaba a los"))).toBe(expected.programmed)
  expect(num(at("Se hizo a los"))).toBe(expected.real)
  expect(num(at("Lectura actual"))).toBe(expected.current)
  expect(num(at("Próxima a los"))).toBe(expected.next)
  expect(at("¿A tiempo?")).toBe("20 h tarde")
  expect(num(at("Faltan"))).toBe(expected.remaining)
  expect(at("Estado")).toBe(expected.situation === "Por vencer" ? "Próxima" : expected.situation)
  // El detalle de cada cifra va en su `title`: tocaba/se hizo en «¿A tiempo?», lo que falta en «Faltan».
  await expect(machine.getByRole("cell").nth(4)).toHaveAttribute("title", "Tocaba a los 4.500 h y se hizo a los 4.520 h")
  await expect(machine.getByRole("cell").nth(7)).toHaveAttribute("title", "Faltan 20 h")
  // El gráfico de «¿a tiempo?» dice lo mismo que la tabla, y la tabla trae sólo la fila del equipo pedido.
  await expect(barOf(page.getByRole("group", { name: /^Diferencia entre cuando tocaba/ }), EX.machine.plate)).toContainText("20 h tarde")
  await expect(table.getByRole("row")).toHaveCount(2)
})

test("el teclado opera las barras de faena + mecánico, una barra de conductor y la leyenda del gráfico combinado con Enter y Espacio", async ({ page }) => {
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

  await page.goto(tabUrl("preventivo"))
  await ready(page)
  await test.step("barra de faena + mecánico", async () => {
    const bar = barOf(barsOf(page, "Cumplimiento por faena y mecánico"), `${QA.wsB.name} · ${QA.mechanicB}`)
    await tabTo(page, page.getByRole("heading", { name: "¿Se cumplen las pautas?", exact: true }), bar)
    await operate(bar, ["x_faena", "x_mecanico"])
    // Lo que fija es la dupla: la faena B y su mecánico (no un valor cualquiera).
    await page.keyboard.press("Enter")
    await expect.poll(() => param(page, "x_faena")).toBe(QA.wsB.id)
    expect(param(page, "x_mecanico")).toBe(QA.mechanicB)
    await expect(chip(page, "Mecánico").filter({ hasText: QA.mechanicB })).toBeVisible()
    await page.keyboard.press("Enter")
    await expect.poll(() => param(page, "x_faena")).toBeNull()
  })

  await page.goto(tabUrl("correctivo"))
  await ready(page)
  await test.step("barra de conductor", async () => {
    const driver = barOf(barsOf(page, "Horas trabajadas por conductor"), QA.driverA.name)
    await tabTo(page, page.getByRole("heading", { name: "¿Dónde se concentra el trabajo?", exact: true }), driver)
    await operate(driver, ["x_conductor"])
    await page.keyboard.press("Enter")
    await expect.poll(() => param(page, "x_conductor")).toBe(QA.driverA.name)
    await expect(chip(page, "Conductor").filter({ hasText: QA.driverA.name })).toBeVisible()
    await page.keyboard.press("Enter")
    await expect.poll(() => param(page, "x_conductor")).toBeNull()
  })

  // La leyenda del gráfico combinado SÍ es interactiva: son botones con `aria-pressed` (un clic o Enter/Espacio fijan `x_equipo`).
  await test.step("leyenda del gráfico combinado", async () => {
    const legend = page.getByRole("button", { name: QA.b1.plate, exact: true })
    await tabTo(page, page.getByText("Horas y registros por equipo", { exact: true }), legend)
    await operate(legend, ["x_equipo"])
    await page.keyboard.press("Space")
    await expect.poll(() => param(page, "x_equipo")).toBe(QA.b1.id)
    await expect(chip(page, "Patente").filter({ hasText: QA.b1.plate })).toBeVisible()
    await page.keyboard.press("Space")
    await expect.poll(() => param(page, "x_equipo")).toBeNull()
  })
  expect(param(page, "desde")).toBe(new URLSearchParams(PERIOD).get("desde"))
})
