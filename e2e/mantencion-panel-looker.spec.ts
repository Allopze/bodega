import { expect, test, type Locator, type Page } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"
import { trackConsole } from "./mantencion-3-helpers"
import {
  CHECKS, CUTOVER, PERIOD, QA, RUTA, cleanupLooker, leftovers, seedLooker, seedNativePreventive, withSql,
} from "./mantencion-panel-looker-seed"

/**
 * Panel de mantención estilo Looker (2026-11-23): las pestañas Hoy, Planificación, Camiones y Máquinas,
 * la barra de filtros y el filtro cruzado por URL. Siembra SUS PROPIOS datos QA y los borra al terminar
 * (`mantencion-panel-looker-seed.ts`; fechas fijas, `PERIOD` las contiene). Los controles existen en el
 * HTML del servidor pero NO responden hasta hidratar: antes de cada clic se espera `ready`.
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(180_000)

const chileDay = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date(Date.now() + offset * 86_400_000))
const rx = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
const param = (page: Page, key: string) => new URL(page.url()).searchParams.get(key)
const tabUrl = (tab: string, extra: Record<string, string> = {}) =>
  `${RUTA}?${new URLSearchParams({ pestana: tab, ...Object.fromEntries(new URLSearchParams(PERIOD)), ...extra }).toString()}`

const filterBar = (page: Page) => page.locator("[data-looker-filter-bar]")
const otTable = (page: Page) => page.getByRole("table", { name: "Órdenes de trabajo y correctivas del período" })
const driversTable = (page: Page) => page.getByRole("table", { name: "Conductores del período" })
const plateTable = (page: Page) => page.getByRole("table", { name: "Cumplimiento por patente" })
const matrixOf = (page: Page) => page.getByRole("table", { name: "Matriz de checklist de pautas" })
const row = (table: Locator, text: string) => table.getByRole("row", { name: rx(text) })
/** Encabezado de una columna de la matriz: código, fecha y nivel (el espacio entre los tres lo pone el navegador). */
const column = (matrix: Locator, code: string, date: string) => matrix.getByRole("columnheader", { name: new RegExp(`${rx(code).source}\\s*${date}`) })
const barsOf = (page: Page, name: string) => page.getByRole("group", { name })

/** Chip de la barra («Faena: QA_ …»), con su botón de quitar. */
function chip(page: Page, label: string, value?: string | RegExp) {
  const chips = filterBar(page).locator("span").filter({ has: page.getByRole("button", { name: `Eliminar filtro ${label}`, exact: true }) })
  return value === undefined ? chips : chips.filter({ hasText: value })
}

/** Los controles existen en el HTML del servidor; el clic recién funciona al hidratar. */
async function ready(page: Page) {
  await expect(page.locator("[data-looker-filter-ready]")).toBeVisible({ timeout: 30_000 })
  await expect(page.locator("[data-cross-filter-ready]").first()).toBeVisible({ timeout: 30_000 })
}

/** Navegación por teclado: parte de `from` (un clic fija el punto de partida de Tab) y avanza hasta `target`. */
async function tabTo(page: Page, from: Locator, target: Locator, max = 80) {
  await from.click()
  for (let step = 0; step < max; step++) {
    await page.keyboard.press("Tab")
    if (await target.evaluate((el) => el === document.activeElement)) return step + 1
  }
  throw new Error(`Tab no llegó al control tras ${max} pulsaciones`)
}

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
  problems = trackConsole(page)
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().startsWith(new URL(page.url()).origin)) problems.push(`${response.status()} ${response.url()}`)
  })
})

test.afterEach(() => {
  expect(problems).toEqual([])
})

test("las tres pestañas cargan sus bloques y la barra de filtros", async ({ page }) => {
  await page.goto(tabUrl("planificacion"))
  await expectPageTitle(page, "Panel de mantención")
  await expect(page.getByRole("navigation", { name: "Secciones del panel de mantención" })).toBeVisible()
  await expect(page.getByRole("table", { name: "Consolidado mantención por kilómetros" })).toBeVisible()
  await expect(page.getByRole("table", { name: "Consolidado mantención por horas" })).toBeVisible()
  await expect(page.getByRole("group", { name: "Delta de kilometraje por equipo" })).toBeVisible()

  for (const tab of ["camiones", "maquinas"]) {
    await page.goto(tabUrl(tab))
    await expectPageTitle(page, "Panel de mantención")
    await expect(page.getByRole("heading", { name: "Correctivo", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Preventivo", exact: true })).toBeVisible()
    await expect(otTable(page)).toBeVisible()
    await expect(matrixOf(page)).toBeVisible()
    await expect(filterBar(page)).toBeVisible()
  }
})

test("un clic en una fila de km filtra las horas, y el segundo clic lo quita", async ({ page }) => {
  await page.goto(tabUrl("planificacion"))
  await ready(page)
  const kmTable = page.getByRole("table", { name: "Consolidado mantención por kilómetros" })
  const hoursTable = page.getByRole("table", { name: "Consolidado mantención por horas" })
  const first = kmTable.locator("tbody button[data-cross-filter]").first()
  const plate = await first.innerText()
  await first.click()
  await expect(page).toHaveURL(/x_equipo=/)
  await expect(first).toHaveAttribute("aria-pressed", "true")
  await expect(filterBar(page)).toContainText(plate)
  await expect(hoursTable).toContainText("se controla por km")
  await first.click()
  await expect(page).not.toHaveURL(/x_equipo=/)
  await expect(filterBar(page)).not.toContainText(plate)
})

test("una OT filtra sus conductores y un conductor filtra las OT", async ({ page }) => {
  await page.goto(tabUrl("camiones"))
  await ready(page)
  const otButton = row(otTable(page), QA.otA1).getByRole("button", { name: QA.otA1 })
  await otButton.click()
  await expect(page).toHaveURL(/x_ot=/)
  await expect(filterBar(page)).toContainText(QA.otA1)
  await expect(row(driversTable(page), QA.driverA.name)).toBeVisible()
  await expect(row(driversTable(page), QA.driverB.name)).toHaveCount(0)

  const driverButton = row(driversTable(page), QA.driverA.name).getByRole("button").first()
  await driverButton.click()
  await expect(page).toHaveURL(/x_conductor=/)
  await expect(filterBar(page)).toContainText(QA.driverA.name)
  await expect(row(otTable(page), QA.otA1)).toBeVisible()

  await driverButton.click()
  await expect(page).not.toHaveURL(/x_conductor=/)
  await otButton.click()
  await expect(page).not.toHaveURL(/x_ot=/)
})

test("una patente filtra la matriz y una columna de la matriz filtra la tabla", async ({ page }) => {
  await page.goto(tabUrl("camiones"))
  await ready(page)
  const matrix = matrixOf(page)
  await row(plateTable(page), QA.a1.plate).getByRole("button").first().click()
  await expect(page).toHaveURL(/x_equipo=/)
  await expect(filterBar(page)).toContainText(QA.a1.plate)
  await expect(matrix.getByRole("columnheader", { name: rx(QA.b1.code) })).toHaveCount(0)

  await column(matrix, QA.a1.code, "10-11-2026").getByRole("button").click()
  await expect(page).toHaveURL(/x_check=/)
  await expect(matrix.locator('button[aria-pressed="true"]')).toHaveCount(1)
  await expect(row(plateTable(page), QA.a1.plate)).toBeVisible()

  await matrix.locator('button[aria-pressed="true"]').click()
  await expect(page).not.toHaveURL(/x_check=/)
})

test("Borrar filtros, recarga con la URL y cambio de pestaña que reinicia", async ({ page }) => {
  await page.goto(tabUrl("camiones"))
  await ready(page)
  await row(plateTable(page), QA.a1.plate).getByRole("button").first().click()
  await expect(page).toHaveURL(/x_equipo=/)

  await page.reload()
  await expect(page).toHaveURL(/x_equipo=/)
  await expect(filterBar(page)).toContainText(QA.a1.plate)
  await ready(page)

  await filterBar(page).getByRole("button", { name: "Borrar filtros" }).click()
  await expect(page).toHaveURL(`${RUTA}?pestana=camiones`)
  await expect(filterBar(page)).not.toContainText("Filtros activos:")

  await page.getByRole("link", { name: "Máquinas", exact: true }).click()
  await expect(page).toHaveURL(`${RUTA}?pestana=maquinas`)
})

test("la barra filtra por faena múltiple, código con buscador y frecuencia, y cada uno queda en la URL y en un chip", async ({ page }) => {
  await page.goto(tabUrl("camiones"))
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

  // El código se busca (hay más de seis opciones): el buscador sólo recorta la lista, no el tablero.
  await bar.getByRole("button", { name: /^Código:/ }).click()
  await page.getByRole("searchbox", { name: "Buscar código" }).fill(QA.a1.plate)
  await expect(page.getByRole("checkbox", { name: rx(QA.b1.code) })).toHaveCount(0)
  await page.getByRole("checkbox", { name: rx(QA.a1.code) }).click()
  await expect.poll(() => param(page, "equipo")).toBe(QA.a1.id)
  await page.keyboard.press("Escape")
  await expect(chip(page, "Código", rx(QA.a1.code))).toBeVisible()

  await bar.getByRole("button", { name: /^Frecuencia:/ }).click()
  await page.getByRole("checkbox", { name: /^40\.000 km/ }).click()
  await expect.poll(() => param(page, "frecuencia")).toBe("40000")
  await page.keyboard.press("Escape")
  await expect(chip(page, "Frecuencia", "40.000 km")).toBeVisible()

  // Los tres filtros acotan lo que se ve: sólo el camión A1 y sólo su pauta de 40.000 km.
  await expect(bar.getByRole("button", { name: /^Eliminar filtro/ })).toHaveCount(4)
  await expect(row(plateTable(page), QA.a1.plate)).toContainText("40.000 KM")
  await expect(row(plateTable(page), QA.a1.plate)).not.toContainText("10.000 KM")
  await expect(row(plateTable(page), QA.b1.plate)).toHaveCount(0)
  expect(param(page, "desde")).toBe(new URLSearchParams(PERIOD).get("desde"))
})

test("quitar un chip deja el resto de los chips y de los parámetros", async ({ page }) => {
  await page.goto(tabUrl("camiones", { faena: `${QA.wsA.id},${QA.wsB.id}`, equipo: QA.a1.id, frecuencia: "40000" }))
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

  await remove("Código")
  await expect.poll(() => param(page, "equipo")).toBeNull()
  await expect(chip(page, "Faena", QA.wsA.name)).toBeVisible()
  expect(param(page, "desde")).toBe(new URLSearchParams(PERIOD).get("desde"))
  expect(param(page, "pestana")).toBe("camiones")
})

test("las barras de mes y de faena + mecánico filtran, se quitan con un segundo clic y sobreviven a la recarga", async ({ page }) => {
  await page.goto(tabUrl("camiones"))
  await ready(page)

  await test.step("mes", async () => {
    const octubre = barsOf(page, "% de cumplimiento por mes").getByRole("button", { name: /^oct 2026/ })
    await octubre.click()
    await expect.poll(() => param(page, "x_mes")).toBe("2026-10")
    await expect(chip(page, "Mes", "octubre 2026")).toBeVisible()
    await expect(octubre).toHaveAttribute("aria-pressed", "true")
    // Octubre sólo tiene la pauta del camión A1: el B1 (noviembre) sale de la tabla y de la matriz.
    await expect(row(plateTable(page), QA.a1.plate)).toBeVisible()
    await expect(row(plateTable(page), QA.b1.plate)).toHaveCount(0)
    await expect(matrixOf(page).getByRole("columnheader", { name: rx(QA.a1.code) })).toHaveCount(1)

    await page.reload()
    await ready(page)
    await expect(chip(page, "Mes", "octubre 2026")).toBeVisible()
    await expect(octubre).toHaveAttribute("aria-pressed", "true")
    await expect(row(plateTable(page), QA.b1.plate)).toHaveCount(0)

    await octubre.click()
    await expect.poll(() => param(page, "x_mes")).toBeNull()
    await expect(chip(page, "Mes")).toHaveCount(0)
    await expect(row(plateTable(page), QA.b1.plate)).toBeVisible()
  })

  await test.step("faena + mecánico", async () => {
    const group = barsOf(page, "% de cumplimiento por faena y mecánico")
    const barB = group.getByRole("button", { name: rx(`${QA.wsB.name} · ${QA.mechanicB}`) })
    await barB.click()
    await expect.poll(() => param(page, "x_faena")).toBe(QA.wsB.id)
    expect(param(page, "x_mecanico")).toBe(QA.mechanicB)
    await expect(chip(page, "Faena", QA.wsB.name)).toBeVisible()
    await expect(chip(page, "Mecánico", QA.mechanicB)).toBeVisible()
    await expect(barB).toHaveAttribute("aria-pressed", "true")
    // La barra se filtra a las demás: el resto de la columna Preventivo y el Correctivo se acotan a la faena B.
    await expect(row(plateTable(page), QA.b1.plate)).toBeVisible()
    await expect(row(plateTable(page), QA.a1.plate)).toHaveCount(0)
    await expect(row(otTable(page), QA.otB1)).toBeVisible()
    await expect(row(otTable(page), QA.otA1)).toHaveCount(0)

    await page.reload()
    await ready(page)
    await expect(chip(page, "Mecánico", QA.mechanicB)).toBeVisible()
    await expect(barB).toHaveAttribute("aria-pressed", "true")

    await barB.click()
    await expect.poll(() => param(page, "x_faena")).toBeNull()
    expect(param(page, "x_mecanico")).toBeNull()
    await expect(filterBar(page).getByRole("button", { name: /^Eliminar filtro/ })).toHaveCount(0)
    await expect(row(plateTable(page), QA.a1.plate)).toBeVisible()
  })
})

test("el gráfico combinado de horas y registros filtra la tabla de OT y los conductores", async ({ page }) => {
  await page.goto(tabUrl("camiones"))
  await ready(page)
  const legendA = page.getByRole("button", { name: `${QA.a1.code} · ${QA.a1.plate}`, exact: true })
  const legendB = page.getByRole("button", { name: `${QA.b1.code} · ${QA.b1.plate}`, exact: true })
  await expect(legendB).toBeVisible()
  await expect(row(otTable(page), QA.otA1)).toBeVisible()
  await expect(row(otTable(page), QA.otB1)).toBeVisible()

  // Clic en la barra del gráfico: B1 trabajó más horas (4 h contra 2,5 h), así que es la primera.
  await page.locator(".recharts-bar-rectangle").first().click()
  await expect.poll(() => param(page, "x_equipo")).toBe(QA.b1.id)
  await expect(legendB).toHaveAttribute("aria-pressed", "true")
  await expect(chip(page, "Patente", QA.b1.plate)).toBeVisible()
  await expect(row(otTable(page), QA.otB1)).toBeVisible()
  await expect(row(otTable(page), QA.otA1)).toHaveCount(0)
  await expect(row(driversTable(page), QA.driverB.name)).toBeVisible()
  await expect(row(driversTable(page), QA.driverA.name)).toHaveCount(0)
  // El gráfico no se filtra a sí mismo: las dos barras siguen ahí.
  await expect(legendA).toBeVisible()

  // La leyenda es el control de teclado: un segundo clic quita el filtro y vuelve todo.
  await legendB.click()
  await expect.poll(() => param(page, "x_equipo")).toBeNull()
  await expect(row(otTable(page), QA.otA1)).toBeVisible()
  await expect(row(driversTable(page), QA.driverA.name)).toBeVisible()

  await legendA.click()
  await expect.poll(() => param(page, "x_equipo")).toBe(QA.a1.id)
  await expect(row(otTable(page), QA.otB1)).toHaveCount(0)
  await expect(row(driversTable(page), QA.driverB.name)).toHaveCount(0)
})

test("recargar con x_check, x_conductor y x_mes reconstruye el estado", async ({ page }) => {
  const url = tabUrl("camiones", { x_check: `h:${CHECKS.b1Nov.key}`, x_conductor: QA.driverB.name, x_mes: "2026-11" })
  await page.goto(url)
  const expectRebuilt = async () => {
    await expect(chip(page, "Mantención", rx(QA.b1.code))).toBeVisible()
    await expect(chip(page, "Conductor", QA.driverB.name)).toBeVisible()
    await expect(chip(page, "Mes", "noviembre 2026")).toBeVisible()
    await expect(matrixOf(page).locator('button[aria-pressed="true"]')).toHaveCount(1)
    await expect(matrixOf(page).locator('button[aria-pressed="true"]')).toContainText(QA.b1.code)
    await expect(row(driversTable(page), QA.driverB.name).getByRole("button").first()).toHaveAttribute("aria-pressed", "true")
    await expect(barsOf(page, "% de cumplimiento por mes").getByRole("button", { name: /^nov 2026/ })).toHaveAttribute("aria-pressed", "true")
    await expect(row(otTable(page), QA.otB1)).toBeVisible()
    await expect(row(otTable(page), QA.otA1)).toHaveCount(0)
  }
  await expectRebuilt()
  await page.reload()
  await expectRebuilt()
  expect(new URL(page.url()).searchParams.get("x_check")).toBe(`h:${CHECKS.b1Nov.key}`)

  // El estado reconstruido es interactivo: quitar el conductor deja la mantención y el mes.
  await ready(page)
  await chip(page, "Conductor").getByRole("button", { name: "Eliminar filtro Conductor" }).click()
  await expect.poll(() => param(page, "x_conductor")).toBeNull()
  expect(param(page, "x_check")).toBe(`h:${CHECKS.b1Nov.key}`)
  expect(param(page, "x_mes")).toBe("2026-11")
})

test("el teclado opera una fila de OT, una columna de la matriz y una barra con Enter y Espacio", async ({ page }) => {
  await page.goto(tabUrl("camiones"))
  await ready(page)

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

  const preventivo = page.getByRole("heading", { name: "Preventivo", exact: true })
  const steps: Array<[string, Locator, Locator, string]> = [
    ["fila de OT", page.getByRole("heading", { name: "Correctivo", exact: true }), row(otTable(page), QA.otA1).getByRole("button", { name: QA.otA1 }), "x_ot"],
    ["columna de la matriz", preventivo, column(matrixOf(page), QA.b1.code, "12-11-2026").getByRole("button"), "x_check"],
    ["barra de mes", preventivo, barsOf(page, "% de cumplimiento por mes").getByRole("button", { name: /^oct 2026/ }), "x_mes"],
  ]
  for (const [name, from, control, key] of steps) {
    await test.step(name, async () => {
      await tabTo(page, from, control)
      await pressTwice(control, key)
    })
  }
})

test("Máquinas por horas muestra de punta a punta lo de la máquina y nada de los camiones", async ({ page }) => {
  await page.goto(tabUrl("maquinas"))
  await expectPageTitle(page, "Panel de mantención")
  await ready(page)
  await expect(page.getByText("OT con ingreso a taller y correctivas del período, sólo máquinas por horas.")).toBeVisible()
  await expect(page.getByText(/Pautas de formularios hasta el 30-11-2026 .* sólo máquinas por horas\./)).toBeVisible()

  // Correctivo: la OT de la máquina, con su horómetro (no «Odómetro») y sus horas.
  await expect(otTable(page).getByRole("columnheader", { name: "Horómetro" })).toBeVisible()
  await expect(row(otTable(page), QA.otM1)).toContainText(/4\.?510 h/)
  await expect(row(otTable(page), QA.otA1)).toHaveCount(0)
  await expect(row(otTable(page), QA.otB1)).toHaveCount(0)
  await expect(row(driversTable(page), QA.driverM.name)).toContainText(/6 h/)
  await expect(row(driversTable(page), QA.driverA.name)).toHaveCount(0)
  await expect(page.getByRole("button", { name: `${QA.m1.code} · ${QA.m1.plate}`, exact: true })).toBeVisible()
  await expect(page.getByRole("img", { name: /Barras: horas trabajadas; línea: número de registros/ })).toBeVisible()

  // Preventivo: las dos pautas de horas del histórico, su matriz y sus barras.
  await expect(row(plateTable(page), QA.m1.plate)).toContainText("300 H")
  await expect(row(plateTable(page), QA.m1.plate)).toContainText("600 H")
  await expect(row(plateTable(page), QA.a1.plate)).toHaveCount(0)
  const matrix = matrixOf(page)
  await expect(matrix.getByRole("columnheader", { name: rx(QA.m1.code) })).toHaveCount(2)
  await expect(matrix.getByRole("img", { name: "QA_ Nivel hidráulico: Realizado" }).first()).toBeVisible()
  await expect(matrix.getByRole("img", { name: /QA_ Revisión frenos/ })).toHaveCount(0)
  await expect(barsOf(page, "% de cumplimiento por mes").getByRole("button", { name: /^nov 2026: 90/ })).toBeVisible()
  await expect(barsOf(page, "% de cumplimiento por faena y mecánico").getByRole("button", { name: rx(`${QA.wsA.name} · ${QA.mechanicM}`) })).toBeVisible()

  // Y el filtro cruzado funciona igual por horas: la OT filtra a su conductor.
  await row(otTable(page), QA.otM1).getByRole("button", { name: QA.otM1 }).click()
  await expect.poll(() => param(page, "x_ot")).not.toBeNull()
  await expect(chip(page, "OT", QA.otM1)).toBeVisible()
  await expect(row(driversTable(page), QA.driverM.name)).toBeVisible()
})

test("el visor de la correctiva abre y cierra una foto real", async ({ page }) => {
  await page.goto(tabUrl("camiones"))
  await ready(page)
  const thumb = row(otTable(page), QA.otA1).getByRole("button", { name: rx(`Ampliar la foto de respaldo de ${QA.a1.code}`) })
  await expect(thumb).toBeVisible()
  await expect(row(otTable(page), QA.otB1)).toContainText("Sin foto")
  const miniature = thumb.locator("img")
  await expect.poll(() => miniature.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0)

  await thumb.click()
  const viewer = page.getByRole("dialog", { name: rx(`Foto de respaldo de ${QA.a1.code}`) })
  await expect(viewer).toBeVisible()
  const image = viewer.getByRole("img", { name: rx(`Foto de respaldo de ${QA.a1.code}`) })
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(96)
  const served = await page.request.get(`/api/mantencion/fotos/${QA.photoWork}`)
  expect(served.status()).toBe(200)
  expect(served.headers()["content-type"]).toBe("image/png")

  await viewer.getByRole("button", { name: "Cerrar" }).click()
  await expect(viewer).toBeHidden()
  await expect(thumb).toBeFocused()
})

test("el visor de la matriz abre y cierra la foto de una preventiva de la plataforma", async ({ page }) => {
  const today = chileDay(0)
  // Las preventivas de la plataforma cuentan desde el corte de los formularios: antes, el tablero no las muestra por diseño.
  test.skip(today < CUTOVER, `Las preventivas de la plataforma cuentan desde el ${CUTOVER}; hoy es ${today} y el tablero aún no las muestra`)
  await withSql((sql) => seedNativePreventive(sql, today))
  await page.goto(`${RUTA}?pestana=camiones&desde=${CUTOVER}&hasta=${today}`)
  await ready(page)
  const thumb = matrixOf(page).getByRole("columnheader", { name: rx(QA.a1.code) }).getByRole("button", { name: rx(`Ampliar Filtros usados del equipo ${QA.a1.code}`) })
  await expect(thumb).toBeVisible()

  await thumb.click()
  const viewer = page.getByRole("dialog", { name: /Filtros usados/ })
  await expect(viewer).toBeVisible()
  const image = viewer.getByRole("img", { name: rx(`Filtros usados del equipo ${QA.a1.code}`) })
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(96)
  await viewer.getByRole("button", { name: "Cerrar" }).click()
  await expect(viewer).toBeHidden()
  await expect(thumb).toBeFocused()
})

test("la pestaña Hoy carga el título, la franja Hoy y las secciones de siempre", async ({ page }) => {
  await page.goto(`${RUTA}?pestana=hoy`)
  await expectPageTitle(page, "Panel de mantención")
  await expect(page.getByRole("heading", { name: "Hoy", exact: true })).toBeVisible()
  // «Reportes de equipos» no se pinta sin reportes diarios transcritos, así que no es parte de la pasada de humo.
  for (const section of ["Órdenes de trabajo", "Trabajos de mantención", "Pautas y disponibilidad", "Pautas y hallazgos de formularios"]) {
    await expect(page.getByRole("heading", { name: section, exact: true }).first()).toBeVisible()
  }
  // Sin parámetros abre la misma pestaña.
  await page.goto(RUTA)
  await expect(page.getByRole("heading", { name: "Hoy", exact: true })).toBeVisible()
})

test("la pestaña Hoy ofrece el menú para llegar a Planificación, Camiones y Máquinas", async ({ page }) => {
  // Regresión (2026-11-24): `renderHoyTab` armaba su encabezado sin `PanelTabs` y las tres pestañas nuevas
  // sólo se alcanzaban escribiendo la URL. La cubre también `page.test.tsx` («menú de pestañas»).
  await page.goto(RUTA)
  const nav = page.getByRole("navigation", { name: "Secciones del panel de mantención" })
  await expect(nav).toBeVisible()
  await expect(nav.getByRole("link", { name: "Hoy", exact: true })).toHaveAttribute("aria-current", "page")
  for (const nombre of ["Planificación", "Camiones", "Máquinas"]) {
    await expect(nav.getByRole("link", { name: nombre, exact: true })).toBeVisible()
  }
  // «Hoy» no tiene marca de hidratación (`data-looker-filter-ready` sólo existe donde hay barra de filtros):
  // un clic que cae antes de hidratar lo cancela el `history.replaceState` inicial de Next y no llega al
  // servidor. Se reintenta el clic hasta que navegue, como `openLatestDraft` en `helpers.ts`.
  const camiones = nav.getByRole("link", { name: "Camiones", exact: true })
  await expect(async () => {
    await camiones.click()
    await expect(page).toHaveURL(`${RUTA}?pestana=camiones`, { timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
})
