import { expect, test, type Locator, type Page } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"
import {
  CHECKS, CUTOVER, NOT_DONE_ITEM, PERIOD, QA, RUTA, cleanupLooker, leftovers, seedLooker, seedNativePreventive, withSql,
} from "./mantencion-panel-looker-seed"
import {
  barOf, barsOf, chileDay, chipsOf, equipmentTable, filterBar, funnelOf, matrixOf, param, paramsOf, planningTable, ready, row, rx, tabTo, tabUrl,
  watchProblems, workTable,
} from "./mantencion-panel-looker-seed-extra"

/**
 * Panel de mantención estilo Looker, con sus cuatro pestañas (Hoy, Planificación, Correctivo y Preventivo; 2026-11-27): la barra
 * de filtros (con la unidad «Por kilómetros»/«Por horas»), el filtro cruzado por URL y las pasadas de humo por pestaña.
 * Siembra SUS PROPIOS datos QA y los borra al terminar (`mantencion-panel-looker-seed.ts`; fechas fijas, `PERIOD` las
 * contiene). Los controles existen en el HTML del servidor pero NO responden hasta hidratar: antes de cada clic se espera `ready`.
 * El recorrido de punta a punta de una persona vive en `mantencion-panel-looker-flujo.spec.ts`.
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(180_000)

const A = QA.wsA.id
/** La faena A reúne al camión A1 y a la máquina M1: acota la base E2E a lo sembrado aquí. */
const urlA = (tab: string, extra: Record<string, string> = {}) => tabUrl(tab, { faena: A, ...extra })

/** Chip de la barra («Faena: QA_ …»), con su botón de quitar. */
function chip(page: Page, label: string, value?: string | RegExp) {
  const chips = chipsOf(page, label)
  return value === undefined ? chips : chips.filter({ hasText: value })
}

/** El botón de un trabajo de la tabla de Correctivo («Filtrar el panel por el trabajo OT OT-QA-LOOKER-0001»). */
const workButton = (page: Page, folio: string, source = "OT") => funnelOf(workTable(page), `Filtrar el panel por el trabajo ${source} ${folio}`)

test.beforeAll(async () => {
  await withSql((sql) => seedLooker(sql))
})

test.afterAll(async () => {
  await withSql(async (sql) => {
    await cleanupLooker(sql)
    // La limpieza es parte de la prueba: no quedan filas QA ni archivos de foto huérfanos.
    expect(await leftovers(sql)).toBe(0)
  })
})

/** Errores de consola y respuestas 4xx/5xx del origen de la prueba: un tablero sano no deja ninguno. */
let problems: string[] = []
test.beforeEach(async ({ page }) => {
  await page.goto("/dashboard")
  if (page.url().includes("/login")) await login(page)
  problems = watchProblems(page)
})

test.afterEach(() => {
  expect(problems).toEqual([])
})

test("las cuatro pestañas cargan sus bloques, la pregunta que responden y la barra de filtros", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Secciones del panel de mantención" })

  await page.goto(urlA("planificacion"))
  await expectPageTitle(page, "Panel de mantención")
  await expect(nav.getByRole("link", { name: "Planificación", exact: true })).toHaveAttribute("aria-current", "page")
  await expect(page.getByText("¿Qué equipo necesita mantención y cuándo?")).toBeVisible()
  await expect(page.locator("[data-planning-summary]")).toBeVisible()
  await expect(page.getByText("Faltantes para la próxima mantención", { exact: true })).toBeVisible()
  await expect(page.getByText("¿Se hizo a tiempo la última mantención?", { exact: true })).toBeVisible()
  await expect(row(planningTable(page), QA.a1.plate)).toBeVisible()
  await expect(filterBar(page)).toBeVisible()

  await page.goto(urlA("correctivo"))
  await expect(page.getByText("¿Qué se rompió, en qué equipo y cuánto trabajo costó en el período?")).toBeVisible()
  for (const stat of ["Trabajos correctivos", "Horas de trabajo", "Equipos con correctivo", "Sin foto de respaldo"]) {
    await expect(page.getByText(stat, { exact: true }).first()).toBeVisible()
  }
  await expect(page.getByText("Horas y registros por equipo", { exact: true })).toBeVisible()
  await expect(page.getByText("Horas trabajadas por conductor", { exact: true })).toBeVisible()
  await expect(page.getByText("Trabajos correctivos por mes", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Trabajos del período", exact: true })).toBeVisible()
  await expect(row(workTable(page), QA.otA1)).toBeVisible()
  // La tabla de conductores ya no existe: quedan las barras.
  await expect(page.getByRole("table", { name: "Conductores del período" })).toHaveCount(0)
  await expect(filterBar(page)).toBeVisible()

  await page.goto(urlA("preventivo"))
  await expect(page.getByText("¿Se están cumpliendo las pautas y con qué evidencia?")).toBeVisible()
  await expect(page.getByText("Cumplimiento por mes", { exact: true })).toBeVisible()
  await expect(page.getByText("Cumplimiento por faena y mecánico", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Cumplimiento por equipo", exact: true })).toBeVisible()
  await expect(equipmentTable(page)).toBeVisible()
  await expect(matrixOf(page)).toBeVisible()

  // Hoy es la página sin `pestana`, con su franja de pendientes.
  await page.goto(`${RUTA}?pestana=hoy`)
  await expect(page.getByRole("region", { name: "Pendientes de hoy" })).toBeVisible()
})

test("las pestañas viejas «camiones» y «maquinas» redirigen a Correctivo con su unidad y sin perder los demás parámetros", async ({ page }) => {
  await page.goto(urlA("camiones"))
  await expect(page).toHaveURL(/pestana=correctivo/)
  // La unidad por kilómetros no se escribe en la URL (es la de siempre).
  expect(paramsOf(page)).toEqual({ pestana: "correctivo", ...Object.fromEntries(new URLSearchParams(PERIOD)), faena: A })
  await expect(row(workTable(page), QA.otA1)).toBeVisible()
  await expect(filterBar(page).getByRole("link", { name: "Por kilómetros", exact: true })).toHaveAttribute("aria-current", "page")

  await page.goto(urlA("maquinas", { x_mes: "2026-11" }))
  await expect(page).toHaveURL(/pestana=correctivo/)
  expect(paramsOf(page)).toEqual({ pestana: "correctivo", unidad: "h", ...Object.fromEntries(new URLSearchParams(PERIOD)), faena: A, x_mes: "2026-11" })
  await expect(filterBar(page).getByRole("link", { name: "Por horas", exact: true })).toHaveAttribute("aria-current", "page")
  await expect(row(workTable(page), QA.otM1)).toBeVisible()
})

test("Planificación: la tira de cifras filtra por estado, el segundo clic lo quita y un equipo se filtra con su embudo", async ({ page }) => {
  await page.goto(urlA("planificacion"))
  await ready(page)
  const summary = page.locator("[data-planning-summary]")
  const unknown = summary.getByRole("link", { name: /^Sin pauta o lectura/ })
  // El camión A1 no tiene pauta ni lectura: es el único de la faena A por kilómetros.
  await expect(summary.getByRole("link", { name: /^Equipos controlados/ })).toContainText("1")
  await expect(unknown).toContainText("1")
  await expect(summary.getByRole("link", { name: /^Vencidas/ })).toContainText("0")

  await unknown.click()
  await expect.poll(() => param(page, "estado")).toBe("sin_dato")
  await expect(unknown).toHaveAttribute("aria-current", "true")
  await expect(unknown).toContainText("filtrando")
  await expect(chip(page, "Estado", "Sin pauta o lectura")).toBeVisible()
  await expect(row(planningTable(page), QA.a1.plate)).toBeVisible()

  await unknown.click()
  await expect.poll(() => param(page, "estado")).toBeNull()
  await expect(chip(page, "Estado")).toHaveCount(0)

  // Vencidas no tiene a ninguno: la tabla lo dice y «Equipos controlados» devuelve la lista.
  await summary.getByRole("link", { name: /^Vencidas/ }).click()
  await expect.poll(() => param(page, "estado")).toBe("vencida")
  await expect(page.getByRole("heading", { name: "Ningún equipo está en estado «Vencidas»" })).toBeVisible()
  await summary.getByRole("link", { name: /^Equipos controlados/ }).click()
  await expect.poll(() => param(page, "estado")).toBeNull()
  await expect(row(planningTable(page), QA.a1.plate)).toBeVisible()

  // El embudo filtra por el equipo; un segundo clic lo quita. La patente no filtra: enlaza al historial.
  const funnel = funnelOf(planningTable(page), `Filtrar el panel por ${QA.a1.plate}`)
  await funnel.click()
  await expect.poll(() => param(page, "x_equipo")).toBe(QA.a1.id)
  await expect(funnel).toHaveAttribute("aria-pressed", "true")
  await expect(chip(page, "Patente", QA.a1.plate)).toBeVisible()
  await funnel.click()
  await expect.poll(() => param(page, "x_equipo")).toBeNull()
  await expect(row(planningTable(page), QA.a1.plate).getByRole("link", { name: QA.a1.plate, exact: true })).toHaveAttribute("href", /\/mantencion\/registros\/historicos\?.*equipo=/)
})

test("Correctivo: un trabajo filtra a sus conductores y un conductor deja la tabla con sus trabajos, y cada uno se quita con un segundo clic", async ({ page }) => {
  await page.goto(urlA("correctivo"))
  await ready(page)
  const drivers = barsOf(page, "Horas trabajadas por conductor")
  await expect(barOf(drivers, QA.driverA.name)).toBeVisible()

  const otButton = workButton(page, QA.otA1)
  await otButton.click()
  await expect.poll(() => param(page, "x_ot")).not.toBeNull()
  await expect(chip(page, "OT", QA.otA1)).toBeVisible()
  await expect(otButton).toHaveAttribute("aria-pressed", "true")
  await expect(barOf(drivers, QA.driverA.name)).toBeVisible()
  await expect(barOf(drivers, QA.driverM.name)).toHaveCount(0)

  const driverBar = barOf(drivers, QA.driverA.name)
  await driverBar.click()
  await expect.poll(() => param(page, "x_conductor")).toBe(QA.driverA.name)
  await expect(chip(page, "Conductor", QA.driverA.name)).toBeVisible()
  await expect(driverBar).toHaveAttribute("aria-pressed", "true")
  await expect(row(workTable(page), QA.otA1)).toBeVisible()

  await driverBar.click()
  await expect.poll(() => param(page, "x_conductor")).toBeNull()
  await otButton.click()
  await expect.poll(() => param(page, "x_ot")).toBeNull()
  await expect(filterBar(page).getByRole("button", { name: /^Eliminar filtro/ })).toHaveCount(1) // sólo la faena de la URL
})

test("Correctivo: el clic en una fila filtra por el trabajo, el embudo por el equipo y la patente sólo abre su historial", async ({ page }) => {
  await page.goto(urlA("correctivo"))
  await ready(page)
  const table = workTable(page)
  const history = row(table, QA.otA1).getByRole("link", { name: QA.a1.plate, exact: true })
  await expect(history).toHaveAttribute("href", /\/mantencion\/registros\/historicos\?.*equipo=qa-looker-veh-a1/)
  // El historial se abre en el período y la faena del panel.
  await expect(history).toHaveAttribute("href", /desde=2026-10-01.*hasta=2026-11-20|hasta=2026-11-20.*desde=2026-10-01/)

  // Clic en una celda cualquiera de la fila: filtra por el trabajo.
  await row(table, QA.otA1).getByRole("cell").nth(3).click()
  await expect.poll(() => param(page, "x_ot")).not.toBeNull()
  await expect(chip(page, "OT", QA.otA1)).toBeVisible()
  await row(table, QA.otA1).getByRole("cell").nth(3).click()
  await expect.poll(() => param(page, "x_ot")).toBeNull()

  // El embudo filtra por el equipo y no abre nada: sigue en el panel.
  const funnel = funnelOf(table, `Filtrar el panel por ${QA.a1.plate}`)
  await funnel.click()
  await expect.poll(() => param(page, "x_equipo")).toBe(QA.a1.id)
  await expect(funnel).toHaveAttribute("aria-pressed", "true")
  await expect(page).toHaveURL(/\/mantencion\/panel/)
  await funnel.click()
  await expect.poll(() => param(page, "x_equipo")).toBeNull()
})

test("Preventivo: el embudo de un equipo filtra la matriz y el de una columna filtra la tabla", async ({ page }) => {
  await page.goto(urlA("preventivo"))
  await ready(page)
  const matrix = matrixOf(page)
  await expect(row(equipmentTable(page), QA.a1.plate)).toBeVisible()

  const equipmentFunnel = funnelOf(equipmentTable(page), `Filtrar el panel por ${QA.a1.plate}`)
  await equipmentFunnel.click()
  await expect.poll(() => param(page, "x_equipo")).toBe(QA.a1.id)
  await expect(chip(page, "Patente", QA.a1.plate)).toBeVisible()
  await expect(matrix.getByRole("columnheader", { name: rx(QA.m1.plate) })).toHaveCount(0)
  await expect(matrix.getByRole("columnheader", { name: rx(QA.a1.plate) })).toHaveCount(2)
  // La tabla no se filtra a sí misma por el equipo: sigue completa y resalta su fila.
  await expect(row(equipmentTable(page), QA.a1.plate)).toHaveAttribute("data-selected", "true")

  const columnFunnel = funnelOf(matrix, `Filtrar el panel por la pauta del 14-10-2026 de ${QA.a1.plate}`)
  await columnFunnel.click()
  await expect.poll(() => param(page, "x_check")).toBe(`h:${CHECKS.a1Oct.key}`)
  await expect(matrix.locator('button[aria-pressed="true"]')).toHaveCount(1)
  // x_check reemplaza al equipo (son alternativas): la tabla sigue mostrando al A1 y con su única pauta.
  await expect(row(equipmentTable(page), QA.a1.plate)).toBeVisible()
  expect(param(page, "x_equipo")).toBeNull()

  await columnFunnel.click()
  await expect.poll(() => param(page, "x_check")).toBeNull()
})

test("Preventivo: la patente de una columna de la matriz abre la ficha del equipo en esa pauta, y Escape la cierra", async ({ page }) => {
  await page.goto(urlA("preventivo"))
  await ready(page)
  const matrix = matrixOf(page)
  await matrix.getByRole("columnheader", { name: new RegExp(`${rx(QA.a1.plate).source}\\s*14-10-2026`) }).getByRole("link", { name: QA.a1.plate, exact: true }).click()
  const sheet = page.getByRole("dialog", { name: QA.a1.plate })
  await expect(sheet).toBeVisible()
  expect(param(page, "ficha")).toBe(QA.a1.id)
  expect(param(page, "pauta")).toBe(`h:${CHECKS.a1Oct.key}`)
  // La pestaña de esa pauta (la de octubre, 40.000 KM) es la elegida.
  await expect(sheet.getByRole("tab", { selected: true })).toContainText("40.000 KM")
  await expect(sheet.getByRole("heading", { name: /^Lo que no se hizo/ })).toBeVisible()
  await expect(sheet.getByText("QA_ Revisión frenos").first()).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(sheet).toBeHidden()
  await expect.poll(() => param(page, "ficha")).toBeNull()
  expect(param(page, "pauta")).toBeNull()
})

test("Borrar filtros, recarga con la URL y cambio de unidad que reinicia lo que nombra un equipo", async ({ page }) => {
  await page.goto(tabUrl("correctivo"))
  await ready(page)
  await funnelOf(workTable(page), `Filtrar el panel por ${QA.a1.plate}`).click()
  await expect.poll(() => param(page, "x_equipo")).toBe(QA.a1.id)

  await page.reload()
  await expect(page).toHaveURL(/x_equipo=/)
  await expect(chip(page, "Patente", QA.a1.plate)).toBeVisible()
  await ready(page)

  await filterBar(page).getByRole("button", { name: "Borrar filtros" }).click()
  await expect(page).toHaveURL(`${RUTA}?pestana=correctivo`)
  await expect(filterBar(page)).not.toContainText("Filtros activos:")

  const unit = filterBar(page).getByRole("group", { name: "Unidad de control" })
  await unit.getByRole("link", { name: "Por horas", exact: true }).click()
  await expect(page).toHaveURL(`${RUTA}?pestana=correctivo&unidad=h`)
  await expect(unit.getByRole("link", { name: "Por horas", exact: true })).toHaveAttribute("aria-current", "page")
  await unit.getByRole("link", { name: "Por kilómetros", exact: true }).click()
  await expect(page).toHaveURL(`${RUTA}?pestana=correctivo`)
})

test("cambiar de pestaña conserva la unidad, el período y la faena y suelta el resto; cambiar de unidad suelta lo que nombra un equipo", async ({ page }) => {
  // PAN4-9 (2026-11-26): los enlaces de las pestañas llevaban sólo `pestana` y quien elegía un período y una faena los perdía.
  const nav = page.getByRole("navigation", { name: "Secciones del panel de mantención" })
  await page.goto(urlA("correctivo", { unidad: "h" }))
  await ready(page)
  await funnelOf(workTable(page), `Filtrar el panel por ${QA.m1.plate}`).click()
  await expect.poll(() => param(page, "x_equipo")).toBe(QA.m1.id)

  await nav.getByRole("link", { name: "Preventivo", exact: true }).click()
  // Unidad, período y faena siguen; el equipo elegido en la otra pestaña no viaja.
  await expect(page).toHaveURL(/pestana=preventivo/)
  expect(paramsOf(page)).toEqual({ pestana: "preventivo", unidad: "h", ...Object.fromEntries(new URLSearchParams(PERIOD)), faena: A })
  await expect(page.locator("[data-looker-filter-ready]")).toBeVisible({ timeout: 30_000 })

  // «Hoy» es la página sin `pestana`, con la misma unidad, el mismo período y la misma faena.
  await nav.getByRole("link", { name: "Hoy", exact: true }).click()
  await expect(page).not.toHaveURL(/pestana=/)
  expect(paramsOf(page)).toEqual({ unidad: "h", ...Object.fromEntries(new URLSearchParams(PERIOD)), faena: A })

  // Planificación (estado y fechas) → Correctivo: los parámetros propios no viajan.
  await page.goto(urlA("planificacion", { estado: "vencida", fecha_hasta: chileDay(30) }))
  await ready(page, { cross: false })
  await nav.getByRole("link", { name: "Correctivo", exact: true }).click()
  await expect(page).toHaveURL(/pestana=correctivo/)
  expect(paramsOf(page)).toEqual({ pestana: "correctivo", ...Object.fromEntries(new URLSearchParams(PERIOD)), faena: A })

  // Cambiar de unidad suelta el equipo, la frecuencia, el filtro cruzado y la ficha; el período y la faena quedan.
  await page.goto(urlA("preventivo", { equipo: QA.a1.id, frecuencia: "40000", x_equipo: QA.a1.id }))
  await ready(page)
  await filterBar(page).getByRole("link", { name: "Por horas", exact: true }).click()
  await expect(page).toHaveURL(/unidad=h/)
  expect(paramsOf(page)).toEqual({ pestana: "preventivo", unidad: "h", ...Object.fromEntries(new URLSearchParams(PERIOD)), faena: A })
  await expect(row(equipmentTable(page), QA.m1.plate)).toBeVisible()
})

test("la barra filtra por faena múltiple, equipo con buscador y frecuencia, y cada uno queda en la URL y en un chip", async ({ page }) => {
  await page.goto(tabUrl("preventivo"))
  await ready(page)
  const bar = filterBar(page)

  await bar.getByRole("button", { name: /^Faena:/ }).click()
  await page.getByRole("checkbox", { name: QA.wsA.name, exact: true }).click()
  await expect.poll(() => param(page, "faena")).toBe(QA.wsA.id)
  await page.getByRole("checkbox", { name: QA.wsB.name, exact: true }).click()
  await expect.poll(() => param(page, "faena")).toBe(`${QA.wsA.id},${QA.wsB.id}`)
  await expect(page.getByRole("checkbox", { name: QA.wsB.name, exact: true })).toBeChecked()
  await page.keyboard.press("Escape")
  await expect(bar.getByRole("button", { name: "Faena: 2 seleccionados" })).toBeVisible()
  await expect(chip(page, "Faena", QA.wsA.name)).toBeVisible()
  await expect(chip(page, "Faena", QA.wsB.name)).toBeVisible()

  // El equipo se busca (hay más de seis opciones): el buscador sólo recorta la lista, no el tablero.
  await bar.getByRole("button", { name: /^Equipo:/ }).click()
  await page.getByRole("searchbox", { name: "Buscar equipo" }).fill(QA.a1.plate)
  await expect(page.getByRole("checkbox", { name: rx(QA.b1.code) })).toHaveCount(0)
  await page.getByRole("checkbox", { name: rx(QA.a1.code) }).click()
  await expect.poll(() => param(page, "equipo")).toBe(QA.a1.id)
  await page.keyboard.press("Escape")
  await expect(chip(page, "Equipo", rx(QA.a1.code))).toBeVisible()

  await bar.getByRole("button", { name: /^Frecuencia:/ }).click()
  await page.getByRole("checkbox", { name: /^40\.000 km/ }).click()
  await expect.poll(() => param(page, "frecuencia")).toBe("40000")
  await page.keyboard.press("Escape")
  await expect(chip(page, "Frecuencia", "40.000 km")).toBeVisible()

  // Los tres filtros acotan lo que se ve: sólo el camión A1 y sólo su pauta de 40.000 km.
  await expect(bar.getByRole("button", { name: /^Eliminar filtro/ })).toHaveCount(4)
  await expect(row(equipmentTable(page), QA.a1.plate)).toContainText("40.000 KM")
  await expect(row(equipmentTable(page), QA.a1.plate)).not.toContainText("10.000 KM")
  await expect(row(equipmentTable(page), QA.b1.plate)).toHaveCount(0)
  expect(param(page, "desde")).toBe(new URLSearchParams(PERIOD).get("desde"))
})

test("quitar un chip deja el resto de los chips y de los parámetros", async ({ page }) => {
  await page.goto(tabUrl("preventivo", { faena: `${QA.wsA.id},${QA.wsB.id}`, equipo: QA.a1.id, frecuencia: "40000" }))
  await ready(page)
  const remove = (label: string, value?: string | RegExp) => chip(page, label, value).getByRole("button", { name: `Eliminar filtro ${label}`, exact: true }).click()
  await expect(filterBar(page).getByRole("button", { name: /^Eliminar filtro/ })).toHaveCount(4)

  await remove("Faena", QA.wsB.name)
  await expect.poll(() => param(page, "faena")).toBe(QA.wsA.id)
  await expect(chip(page, "Faena")).toHaveCount(1)
  await expect(chip(page, "Faena", QA.wsA.name)).toBeVisible()
  expect(param(page, "equipo")).toBe(QA.a1.id)
  expect(param(page, "frecuencia")).toBe("40000")

  await remove("Frecuencia")
  await expect.poll(() => param(page, "frecuencia")).toBeNull()
  await expect(filterBar(page).getByRole("button", { name: /^Eliminar filtro/ })).toHaveCount(2)
  expect(param(page, "faena")).toBe(QA.wsA.id)
  expect(param(page, "equipo")).toBe(QA.a1.id)

  await remove("Equipo")
  await expect.poll(() => param(page, "equipo")).toBeNull()
  await expect(chip(page, "Faena", QA.wsA.name)).toBeVisible()
  expect(param(page, "desde")).toBe(new URLSearchParams(PERIOD).get("desde"))
  expect(param(page, "pestana")).toBe("preventivo")
})

test("Preventivo: las barras de mes y de faena + mecánico filtran, se quitan con un segundo clic y sobreviven a la recarga", async ({ page }) => {
  await page.goto(tabUrl("preventivo"))
  await ready(page)

  await test.step("mes", async () => {
    const octubre = page.getByRole("button", { name: /^oct 2026/ })
    await octubre.click()
    await expect.poll(() => param(page, "x_mes")).toBe("2026-10")
    await expect(chip(page, "Mes", "octubre 2026")).toBeVisible()
    await expect(octubre).toHaveAttribute("aria-pressed", "true")
    // Octubre sólo tiene la pauta del camión A1 y la de la máquina M1: el B1 (noviembre) sale de la tabla y de la matriz.
    await expect(row(equipmentTable(page), QA.a1.plate)).toBeVisible()
    await expect(row(equipmentTable(page), QA.b1.plate)).toHaveCount(0)
    await expect(matrixOf(page).getByRole("columnheader", { name: rx(QA.a1.plate) })).toHaveCount(1)

    await page.reload()
    await ready(page)
    await expect(chip(page, "Mes", "octubre 2026")).toBeVisible()
    await expect(octubre).toHaveAttribute("aria-pressed", "true")
    await expect(row(equipmentTable(page), QA.b1.plate)).toHaveCount(0)

    await octubre.click()
    await expect.poll(() => param(page, "x_mes")).toBeNull()
    await expect(chip(page, "Mes")).toHaveCount(0)
    await expect(row(equipmentTable(page), QA.b1.plate)).toBeVisible()
  })

  await test.step("faena + mecánico", async () => {
    const group = barsOf(page, "Cumplimiento por faena y mecánico")
    const barB = barOf(group, `${QA.wsB.name} · ${QA.mechanicB}`)
    await barB.click()
    await expect.poll(() => param(page, "x_faena")).toBe(QA.wsB.id)
    expect(param(page, "x_mecanico")).toBe(QA.mechanicB)
    await expect(chip(page, "Faena", QA.wsB.name)).toBeVisible()
    await expect(chip(page, "Mecánico", QA.mechanicB)).toBeVisible()
    await expect(barB).toHaveAttribute("aria-pressed", "true")
    // La barra se filtra a las demás: la tabla y la matriz se acotan a la faena B.
    await expect(row(equipmentTable(page), QA.b1.plate)).toBeVisible()
    await expect(row(equipmentTable(page), QA.a1.plate)).toHaveCount(0)

    await page.reload()
    await ready(page)
    await expect(chip(page, "Mecánico", QA.mechanicB)).toBeVisible()
    await expect(barB).toHaveAttribute("aria-pressed", "true")

    await barB.click()
    await expect.poll(() => param(page, "x_faena")).toBeNull()
    expect(param(page, "x_mecanico")).toBeNull()
    await expect(filterBar(page).getByRole("button", { name: /^Eliminar filtro/ })).toHaveCount(0)
    await expect(row(equipmentTable(page), QA.a1.plate)).toBeVisible()
  })
})

test("Correctivo: el gráfico combinado y las columnas por mes filtran la tabla y los conductores", async ({ page }) => {
  await page.goto(tabUrl("correctivo"))
  await ready(page)
  const legendA = page.getByRole("button", { name: QA.a1.plate, exact: true })
  const legendB = page.getByRole("button", { name: QA.b1.plate, exact: true })
  const drivers = barsOf(page, "Horas trabajadas por conductor")
  await expect(legendB).toBeVisible()
  await expect(row(workTable(page), QA.otA1)).toBeVisible()
  await expect(row(workTable(page), QA.otB1)).toBeVisible()

  // Clic en la barra del gráfico: B1 trabajó más horas (4 h contra 2,5 h), así que es la primera.
  await page.locator(".recharts-bar-rectangle").first().click()
  await expect.poll(() => param(page, "x_equipo")).toBe(QA.b1.id)
  await expect(legendB).toHaveAttribute("aria-pressed", "true")
  await expect(chip(page, "Patente", QA.b1.plate)).toBeVisible()
  await expect(row(workTable(page), QA.otB1)).toBeVisible()
  await expect(row(workTable(page), QA.otA1)).toHaveCount(0)
  await expect(barOf(drivers, QA.driverB.name)).toBeVisible()
  await expect(barOf(drivers, QA.driverA.name)).toHaveCount(0)
  // El gráfico no se filtra a sí mismo: las dos barras siguen ahí.
  await expect(legendA).toBeVisible()

  // La leyenda es el control de teclado: un segundo clic quita el filtro y vuelve todo.
  await legendB.click()
  await expect.poll(() => param(page, "x_equipo")).toBeNull()
  await expect(row(workTable(page), QA.otA1)).toBeVisible()
  await expect(barOf(drivers, QA.driverA.name)).toBeVisible()

  await legendA.click()
  await expect.poll(() => param(page, "x_equipo")).toBe(QA.a1.id)
  await expect(row(workTable(page), QA.otB1)).toHaveCount(0)
  await expect(barOf(drivers, QA.driverB.name)).toHaveCount(0)
  await legendA.click()

  // Las columnas por mes: noviembre sólo tiene la OT del camión A1 (12-11); octubre, la del B1 (20-10).
  const noviembre = page.getByRole("button", { name: /^nov 2026/ })
  await noviembre.click()
  await expect.poll(() => param(page, "x_mes")).toBe("2026-11")
  await expect(chip(page, "Mes", "noviembre 2026")).toBeVisible()
  await expect(row(workTable(page), QA.otA1)).toBeVisible()
  await expect(row(workTable(page), QA.otB1)).toHaveCount(0)
  await noviembre.click()
  await expect.poll(() => param(page, "x_mes")).toBeNull()
  await expect(row(workTable(page), QA.otB1)).toBeVisible()
})

test("recargar con x_check, x_mes y x_conductor reconstruye el estado de cada pestaña", async ({ page }) => {
  await test.step("Preventivo: pauta y mes", async () => {
    await page.goto(tabUrl("preventivo", { x_check: `h:${CHECKS.b1Nov.key}`, x_mes: "2026-11" }))
    const expectRebuilt = async () => {
      await expect(chip(page, "Mantención", rx(QA.b1.code))).toBeVisible()
      await expect(chip(page, "Mes", "noviembre 2026")).toBeVisible()
      await expect(matrixOf(page).locator('button[aria-pressed="true"]')).toHaveCount(1)
      await expect(matrixOf(page).locator('button[aria-pressed="true"]')).toHaveAccessibleName(rx(QA.b1.plate))
      await expect(page.getByRole("button", { name: /^nov 2026/ })).toHaveAttribute("aria-pressed", "true")
    }
    await expectRebuilt()
    await page.reload()
    await expectRebuilt()
    expect(param(page, "x_check")).toBe(`h:${CHECKS.b1Nov.key}`)
    // El estado reconstruido es interactivo: quitar el mes deja la mantención.
    await ready(page)
    await chip(page, "Mes").getByRole("button", { name: "Eliminar filtro Mes" }).click()
    await expect.poll(() => param(page, "x_mes")).toBeNull()
    expect(param(page, "x_check")).toBe(`h:${CHECKS.b1Nov.key}`)
  })

  await test.step("Correctivo: conductor y mes", async () => {
    await page.goto(tabUrl("correctivo", { x_conductor: QA.driverB.name, x_mes: "2026-10" }))
    const expectRebuilt = async () => {
      await expect(chip(page, "Conductor", QA.driverB.name)).toBeVisible()
      await expect(chip(page, "Mes", "octubre 2026")).toBeVisible()
      await expect(barOf(barsOf(page, "Horas trabajadas por conductor"), QA.driverB.name)).toHaveAttribute("aria-pressed", "true")
      await expect(row(workTable(page), QA.otB1)).toBeVisible()
      await expect(row(workTable(page), QA.otA1)).toHaveCount(0)
    }
    await expectRebuilt()
    await page.reload()
    await expectRebuilt()
    await ready(page)
    await chip(page, "Conductor").getByRole("button", { name: "Eliminar filtro Conductor" }).click()
    await expect.poll(() => param(page, "x_conductor")).toBeNull()
    expect(param(page, "x_mes")).toBe("2026-10")
  })
})

test("el teclado opera un trabajo, una pauta de la matriz y una barra con Enter y Espacio", async ({ page }) => {
  /** Enter fija el filtro, Espacio lo quita; `aria-pressed` y el foco acompañan. */
  async function pressTwice(control: Locator, key: string) {
    await expect(control).toHaveAttribute("aria-pressed", "false")
    await page.keyboard.press("Enter")
    await expect.poll(() => param(page, key)).not.toBeNull()
    await expect(control).toHaveAttribute("aria-pressed", "true")
    await expect(control).toBeFocused()
    await page.keyboard.press("Space")
    await expect.poll(() => param(page, key)).toBeNull()
    await expect(control).toHaveAttribute("aria-pressed", "false")
  }

  await page.goto(urlA("correctivo"))
  await ready(page)
  await test.step("trabajo de la tabla", async () => {
    const control = workButton(page, QA.otA1)
    await tabTo(page, page.getByRole("heading", { name: "Trabajos del período", exact: true }), control)
    await pressTwice(control, "x_ot")
  })

  await page.goto(urlA("preventivo"))
  await ready(page)
  const preventivo = page.getByRole("heading", { name: "¿Qué se hizo en cada pauta?", exact: true })
  await test.step("columna de la matriz", async () => {
    const control = funnelOf(matrixOf(page), `Filtrar el panel por la pauta del 14-10-2026 de ${QA.a1.plate}`)
    await tabTo(page, preventivo, control)
    await pressTwice(control, "x_check")
  })
  await test.step("barra de mes", async () => {
    const control = page.getByRole("button", { name: /^oct 2026/ })
    await tabTo(page, page.getByRole("heading", { name: "¿Se cumplen las pautas?", exact: true }), control)
    await pressTwice(control, "x_mes")
  })
})

test("«Por horas» muestra de punta a punta lo de la máquina y nada de los camiones", async ({ page }) => {
  await page.goto(tabUrl("correctivo", { unidad: "h" }))
  await expectPageTitle(page, "Panel de mantención")
  await ready(page)

  // Correctivo: la OT de la máquina, con su horómetro (no «Odómetro») y sus horas.
  await expect(workTable(page).getByRole("columnheader", { name: "Horómetro" })).toBeVisible()
  await expect(row(workTable(page), QA.otM1)).toContainText(/4\.?510 h/)
  await expect(row(workTable(page), QA.otA1)).toHaveCount(0)
  await expect(row(workTable(page), QA.otB1)).toHaveCount(0)
  await expect(barOf(barsOf(page, "Horas trabajadas por conductor"), QA.driverM.name)).toContainText(/6 h/)
  await expect(barOf(barsOf(page, "Horas trabajadas por conductor"), QA.driverA.name)).toHaveCount(0)
  await expect(page.getByRole("button", { name: QA.m1.plate, exact: true })).toBeVisible()
  await expect(page.getByRole("img", { name: /Barras: horas trabajadas; línea: número de registros/ })).toBeVisible()

  // Preventivo: las dos pautas de horas del histórico, su matriz y sus barras.
  await page.goto(tabUrl("preventivo", { unidad: "h" }))
  await ready(page)
  await expect(row(equipmentTable(page), QA.m1.plate)).toContainText("300 H")
  await expect(row(equipmentTable(page), QA.m1.plate)).toContainText("600 H")
  await expect(row(equipmentTable(page), QA.a1.plate)).toHaveCount(0)
  const matrix = matrixOf(page)
  await expect(matrix.getByRole("columnheader", { name: rx(QA.m1.plate) })).toHaveCount(2)
  await expect(matrix.getByRole("img", { name: "QA_ Nivel hidráulico: Realizado" }).first()).toBeVisible()
  await expect(matrix.getByRole("img", { name: `${NOT_DONE_ITEM}: No realizado` }).first()).toBeVisible()
  await expect(matrix.getByRole("img", { name: /QA_ Revisión frenos/ })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /^nov 2026/ })).toContainText("90%")
  await expect(barOf(barsOf(page, "Cumplimiento por faena y mecánico"), `${QA.wsA.name} · ${QA.mechanicM}`)).toBeVisible()

  // Y el filtro cruzado funciona igual por horas: el embudo de la máquina la fija.
  await funnelOf(equipmentTable(page), `Filtrar el panel por ${QA.m1.plate}`).click()
  await expect.poll(() => param(page, "x_equipo")).toBe(QA.m1.id)
  await expect(chip(page, "Patente", QA.m1.plate)).toBeVisible()
})

test("el visor de la correctiva abre y cierra una foto real", async ({ page }) => {
  await page.goto(urlA("correctivo"))
  await ready(page)
  const thumb = row(workTable(page), QA.otA1).getByRole("button", { name: rx(`Ampliar la foto de respaldo de ${QA.a1.plate}`) })
  await expect(thumb).toBeVisible()
  await expect(row(workTable(page), QA.otM1)).toHaveCount(0) // la máquina es de la otra unidad
  const miniature = thumb.locator("img")
  await expect.poll(() => miniature.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0)

  await thumb.click()
  const viewer = page.getByRole("dialog", { name: rx(`Foto de respaldo de ${QA.a1.plate}`) })
  await expect(viewer).toBeVisible()
  const image = viewer.getByRole("img", { name: rx(`Foto de respaldo de ${QA.a1.plate}`) })
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(96)
  const served = await page.request.get(`/api/mantencion/fotos/${QA.photoWork}`)
  expect(served.status()).toBe(200)
  expect(served.headers()["content-type"]).toBe("image/png")
  // Abrir la foto no filtró el panel por el trabajo (la fila entera filtra con el clic).
  expect(param(page, "x_ot")).toBeNull()

  await viewer.getByRole("button", { name: "Cerrar" }).click()
  await expect(viewer).toBeHidden()
  await expect(thumb).toBeFocused()

  await page.goto(urlA("correctivo", { x_mes: "2026-10", faena: QA.wsB.id }))
  await expect(row(workTable(page), QA.otB1)).toContainText("Sin foto")
})

test("el visor de la matriz abre y cierra la foto de una preventiva de la plataforma", async ({ page }) => {
  const today = chileDay(0)
  // Las preventivas de la plataforma cuentan desde el corte de los formularios: antes, el tablero no las muestra por diseño
  // (y un período futuro no es válido: no hay cómo adelantar la prueba).
  test.skip(today < CUTOVER, `Las preventivas de la plataforma cuentan desde el ${CUTOVER}; hoy es ${today} y el tablero aún no las muestra`)
  await withSql((sql) => seedNativePreventive(sql, today))
  await page.goto(`${RUTA}?pestana=preventivo&desde=${CUTOVER}&hasta=${today}`)
  await ready(page)
  const thumb = matrixOf(page).getByRole("columnheader", { name: rx(QA.a1.plate) }).getByRole("button", { name: rx(`Ampliar Filtros usados del equipo ${QA.a1.plate}`) })
  await expect(thumb).toBeVisible()

  await thumb.click()
  const viewer = page.getByRole("dialog", { name: /Filtros usados/ })
  await expect(viewer).toBeVisible()
  const image = viewer.getByRole("img", { name: rx(`Filtros usados del equipo ${QA.a1.plate}`) })
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(96)
  await viewer.getByRole("button", { name: "Cerrar" }).click()
  await expect(viewer).toBeHidden()
  await expect(thumb).toBeFocused()
})

test("la ficha de una preventiva de la plataforma muestra el motivo de lo que no se hizo", async ({ page }) => {
  const today = chileDay(0)
  // El motivo sólo lo capturan los registros de la plataforma (el formulario histórico no lo trae): cuentan desde el corte.
  test.skip(today < CUTOVER, `Las preventivas de la plataforma cuentan desde el ${CUTOVER}; hoy es ${today} y no hay motivo que mostrar`)
  await withSql((sql) => seedNativePreventive(sql, today))
  await page.goto(`${RUTA}?pestana=preventivo&desde=${CUTOVER}&hasta=${today}&ficha=${QA.a1.id}`)
  const sheet = page.getByRole("dialog", { name: QA.a1.plate })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText("Motivo: QA_ Sin repuesto")).toBeVisible()
})

test("la pestaña Hoy carga el título, la franja de pendientes y las secciones de siempre", async ({ page }) => {
  await page.goto(`${RUTA}?pestana=hoy`)
  await expectPageTitle(page, "Panel de mantención")
  await expect(page.getByRole("region", { name: "Pendientes de hoy" })).toBeVisible()
  // «Reportes de equipos» no se pinta sin reportes diarios transcritos, así que no es parte de la pasada de humo.
  for (const section of ["Órdenes de trabajo", "Trabajos de mantención", "Pautas y disponibilidad", "Pautas y hallazgos de formularios"]) {
    await expect(page.getByRole("heading", { name: section, exact: true }).first()).toBeVisible()
  }
  // Sin parámetros abre la misma pestaña.
  await page.goto(RUTA)
  await expect(page.getByRole("region", { name: "Pendientes de hoy" })).toBeVisible()
})

test("la pestaña Hoy ofrece el menú para llegar a Planificación, Correctivo y Preventivo", async ({ page }) => {
  // Regresión (2026-11-24): `renderHoyTab` armaba su encabezado sin `PanelTabs` y las pestañas nuevas
  // sólo se alcanzaban escribiendo la URL. La cubre también `page.test.tsx` («menú de pestañas»).
  await page.goto(RUTA)
  const nav = page.getByRole("navigation", { name: "Secciones del panel de mantención" })
  await expect(nav).toBeVisible()
  await expect(nav.getByRole("link", { name: "Hoy", exact: true })).toHaveAttribute("aria-current", "page")
  for (const nombre of ["Planificación", "Correctivo", "Preventivo"]) {
    await expect(nav.getByRole("link", { name: nombre, exact: true })).toBeVisible()
  }
  // Las pestañas «Por kilómetros» y «Por horas» de antes ya no son pestañas: son la unidad de la barra de filtros.
  await expect(nav.getByRole("link", { name: "Por kilómetros" })).toHaveCount(0)
  // «Hoy» no tiene marca de hidratación (`data-looker-filter-ready` sólo existe donde hay barra de filtros):
  // un clic que cae antes de hidratar lo cancela el `history.replaceState` inicial de Next y no llega al
  // servidor. Se reintenta el clic hasta que navegue, como `openLatestDraft` en `helpers.ts`.
  const correctivo = nav.getByRole("link", { name: "Correctivo", exact: true })
  await expect(async () => {
    await correctivo.click()
    await expect(page).toHaveURL(`${RUTA}?pestana=correctivo`, { timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
})
