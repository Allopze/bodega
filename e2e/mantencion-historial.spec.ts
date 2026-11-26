import { createHash } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { expectPageTitle, login, textoVisible } from "./helpers"
import { PERIOD, QA, cleanupLooker, leftovers, seedLooker } from "./mantencion-panel-looker-seed"
import { EX, bulkDate, bulkRef, cleanupExtra, extraLeftovers, field, readBook, seedExtra, watchProblems, withSql } from "./mantencion-panel-looker-seed-extra"

/**
 * Historial de mantenciones (2026-11-25): la vista unificada de formularios + órdenes de trabajo + registros firmados.
 * Siembra SUS PROPIOS datos QA con la misma base que el Panel Looker (`seedLooker` + 30 correctivos del formulario) y los
 * borra al terminar. Fechas FIJAS y período `PERIOD`: el corte de los formularios (2026-12-01) no las mueve.
 *
 * Faena A del seed, en `PERIOD`: 2 OT que entraron a taller (camión A1 el 12-11 y máquina M1 el 08-11) y 30 correctivos del
 * formulario del camión X1 (del 02-10 al 31-10): 32 trabajos, todos correctivos. Los registros firmados del seed tienen OT y
 * no se cuentan dos veces.
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(180_000)

const ADMIN = "admin@e2e.chome.cl"
const FAENA_A = `/mantencion/registros/historicos?${PERIOD}&faena=${QA.wsA.id}`
const TOTAL = 2 + EX.bulkRows
const X1 = `${EX.bulk.code} · ${EX.bulk.plate}`
const A1 = `${QA.a1.code} · ${QA.a1.plate}`
const TABLE = "Trabajos de mantención"

/**
 * Tres trabajos del formulario del camión X1 con una clave de origen REAL (sha256, 64 hex: la ficha rechaza cualquier otra) y
 * fechas de septiembre, fuera de `PERIOD`: no cambian los conteos de arriba. Sirven para la ficha y sus vecinos.
 */
const FICHA_FILE = "QA_historial.xlsx"
const FICHA = [
  { day: "2026-09-10", text: "QA_ Ficha anterior" },
  { day: "2026-09-20", text: "QA_ Ficha central" },
  { day: "2026-09-30", text: "QA_ Ficha siguiente" },
].map((item) => ({ ...item, key: createHash("sha256").update(`qa-historial-ficha-${item.day}`).digest("hex") }))

test.beforeAll(async () => {
  await withSql(async (sql) => {
    await sql`delete from mant_historical_records where source_file = ${FICHA_FILE}`
    await cleanupExtra(sql)
    await seedLooker(sql)
    await seedExtra(sql, { bulk: true })
    const [admin] = await sql<Array<{ id: string }>>`select id from users where email = ${ADMIN}`
    for (const [index, item] of FICHA.entries()) {
      await sql`
        insert into mant_historical_records (
          source_key, fingerprint, source_file, source_sheet, source_row, submitted_at, worksite_text, worksite_id,
          equipment_text, vehicle_id, equipment_match, order_text, kind_text, reading_text, description,
          entry_date, hours_text, fields, imported_by, action_type, labor_hours, is_test
        ) values (
          ${item.key}, ${item.key}, ${FICHA_FILE}, 'MANTENCIONES', ${index + 2}, ${`${item.day} 09:00:00`}, ${QA.wsA.name}, ${QA.wsA.id},
          ${`${EX.bulk.code} / ${EX.bulk.plate}`}, ${EX.bulk.id}, 'linked', ${`QA-FICHA-${index + 1}`}, 'CORRECTIVA', '151000', ${item.text},
          ${item.day}, '2', ${sql.json([{ header: "CONDUCTOR", value: "QA_ CONDUCTOR FICHA" }])}, ${admin!.id}, 'correctiva', 2, false
        )`
    }
  })
})
test.afterAll(async () => {
  await withSql(async (sql) => {
    await sql`delete from mant_historical_records where source_file = ${FICHA_FILE}`
    await cleanupExtra(sql)
    await cleanupLooker(sql)
    // La limpieza es parte de la prueba: ni filas ni archivos de la siembra quedan.
    expect(await leftovers(sql)).toBe(0)
    expect(await extraLeftovers(sql)).toBe(0)
  })
})

let problems: string[] = []
test.beforeEach(({ page }) => { problems = watchProblems(page) })
test.afterEach(() => { expect(problems).toEqual([]) })

/** Las filas de la tabla de escritorio (la lista móvil son tarjetas y no cuenta). */
const rows = (page: Page) => page.getByRole("region", { name: TABLE }).locator("tbody tr")

test("la lista une formularios y órdenes de trabajo, cuenta lo mismo que el Panel y pagina de a 25", async ({ page }) => {
  await login(page, ADMIN)
  await page.goto(FAENA_A)
  await expectPageTitle(page, "Historial de mantenciones")
  await expect(textoVisible(page, new RegExp(`^${TOTAL} trabajos del 01-10-2026 al 20-11-2026 en ${QA.wsA.name}\\.`))).toBeVisible()
  // El tipo se elige en un solo control, con el conteo de cada uno (A5).
  await expect(page.getByRole("link", { name: `Todos (${TOTAL})`, exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: `Correctivas (${TOTAL})`, exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Preventivas (0)", exact: true })).toBeVisible()
  // La OT del camión A1 es lo más reciente y trae su trabajo; las dos fuentes conviven en la misma tabla.
  await expect(rows(page)).toHaveCount(25)
  await expect(rows(page).first()).toContainText(A1)
  await expect(rows(page).first()).toContainText(`QA_ Trabajo correctivo ${QA.a1.code}`)
  await expect(rows(page).first()).toContainText("Orden de trabajo")
  await expect(rows(page).nth(2)).toContainText(X1)
  await expect(rows(page).nth(2)).toContainText("Formulario")
  // Página 2: los 7 trabajos que no caben en la primera.
  await page.goto(`${FAENA_A}&page=2`)
  await expect(rows(page)).toHaveCount(TOTAL - 25)
  // El Panel enlaza a esta lista con el mismo período y faena y su total coincide: la prueba de PGlite fija la igualdad.
  await page.goto(`/mantencion/panel?${PERIOD}&faena=${QA.wsA.id}`)
  await page.getByRole("link", { name: /Trabajos del período/ }).click()
  await expect(page).toHaveURL(new RegExp(`/mantencion/registros/historicos\\?desde=2026-10-01&hasta=2026-11-20&faena=${QA.wsA.id}`))
  await expect(textoVisible(page, new RegExp(`^${TOTAL} trabajos del 01-10-2026`))).toBeVisible()
})

test("la búsqueda, el orden y la agrupación viajan en la URL y las filas los siguen", async ({ page }) => {
  await login(page, ADMIN)
  await page.goto(FAENA_A)
  await page.getByRole("searchbox", { name: "Buscar en el historial de mantenciones" }).fill("masivo 7")
  await expect(page).toHaveURL(/q=masivo\+7|q=masivo%207/)
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText("QA_ Trabajo masivo 7")

  // Orden por equipo: el enlace de la cabecera cambia la URL y la primera fila es la del equipo que va primero.
  await page.goto(FAENA_A)
  await page.getByRole("region", { name: TABLE }).getByRole("link", { name: "Equipo", exact: true }).click()
  await expect(page).toHaveURL(/orden=equipo/)
  await expect(rows(page).first()).toContainText(A1)

  // Agrupar por equipo: aparece un encabezado por equipo, con su conteo.
  await page.getByRole("link", { name: "Por equipo", exact: true }).click()
  await expect(page).toHaveURL(/agrupar=equipo/)
  await expect(page.getByRole("region", { name: TABLE }).getByRole("link", { name: X1, exact: true })).toBeVisible()
})

test("la vista previa abre sin salir de la lista y lleva a la ficha completa", async ({ page }) => {
  await login(page, ADMIN)
  await page.goto(`${FAENA_A}&q=${encodeURIComponent("masivo 30")}`)
  await expect(rows(page)).toHaveCount(1)
  await page.getByRole("button", { name: `QA_ Trabajo masivo 30. Vista previa del trabajo de ${X1} del 31-10-2026`, exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText("QA_ Trabajo masivo 30", { exact: true })).toBeVisible()
  await expect(dialog.getByText("Correctiva", { exact: true })).toBeVisible()
  await expect(dialog.getByText("1,5 h", { exact: true })).toBeVisible()
  await expect(dialog.getByRole("link", { name: "Abrir la ficha completa", exact: true })).toHaveAttribute("href", /\/mantencion\/registros\/historicos\/[^/]+$/)
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/q=masivo/)
})

test("«Exportar Excel» baja las mismas filas que la lista, con sus filtros", async ({ page }) => {
  await login(page, ADMIN)
  await page.goto(FAENA_A)
  const button = page.getByRole("button", { name: "Exportar Excel", exact: true }).filter({ visible: true })
  await expect(button).toHaveCount(1)
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), button.click()])
  expect(download.suggestedFilename()).toMatch(/^historial-mantenciones-\d{4}-\d{2}-\d{2}\.xlsx$/)
  const book = await readBook(download)
  const sheet = book.get("Historial")!
  expect(sheet).toBeTruthy()
  expect(sheet.rows).toHaveLength(TOTAL)
  expect(sheet.header.slice(0, 8)).toEqual(["Fecha", "Equipo", "Faena", "Origen", "Referencia", "Nº de orden", "Tipo", "Trabajo"])
  // Orden de la pantalla (fecha ↓): primero la OT del camión A1.
  const first = sheet.rows[0]!
  expect(field(sheet, first, "Equipo")).toBe(A1)
  expect(field(sheet, first, "Origen")).toBe("Orden de trabajo")
  expect(field(sheet, first, "Tipo")).toBe("Correctiva")
  expect(field(sheet, first, "Trabajo")).toBe(`QA_ Trabajo correctivo ${QA.a1.code}`)
  expect(sheet.rows.filter((cells) => field(sheet, cells, "Origen") === "Formulario")).toHaveLength(EX.bulkRows)

  // Con un filtro, el libro trae sólo lo filtrado: el servidor vuelve a leer la URL.
  await page.goto(`${FAENA_A}&origen=historial`)
  const [filtered] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.getByRole("button", { name: "Exportar Excel", exact: true }).filter({ visible: true }).click()])
  const filteredSheet = (await readBook(filtered)).get("Historial")!
  expect(filteredSheet.rows).toHaveLength(EX.bulkRows)
  expect(filteredSheet.rows.map((cells) => field(filteredSheet, cells, "Nº de orden"))).toContain(bulkRef(1))
})

test("la matriz cuenta trabajos por equipo y mes y cada celda lleva a su lista", async ({ page }) => {
  await login(page, ADMIN)
  await page.goto(`${FAENA_A}&vista=matriz`)
  const matrix = page.getByRole("table", { name: "Trabajos por equipo y mes" })
  await expect(matrix).toBeVisible()
  // Octubre: los 30 correctivos del formulario del camión X1.
  const cell = matrix.getByRole("link", { name: `${X1}, oct 2026: ${EX.bulkRows} trabajos: ${EX.bulkRows} correctivas` })
  await expect(cell).toBeVisible()
  await cell.click()
  await expect(page).not.toHaveURL(/vista=matriz/)
  await expect(page).toHaveURL(/desde=2026-10-01&hasta=2026-10-31/)
  await expect(page).toHaveURL(new RegExp(`equipo=${EX.bulk.id}`))
  await expect(textoVisible(page, new RegExp(`^${EX.bulkRows} trabajos del 01-10-2026 al 31-10-2026`))).toBeVisible()
  await expect(rows(page).first()).toContainText(bulkDate(EX.bulkRows).split("-").reverse().join("-"))
})

test("la ficha del trabajo del formulario resume el trabajo, pliega los datos originales y enlaza al anterior y al siguiente", async ({ page }) => {
  await login(page, ADMIN)
  const [previous, middle, next] = FICHA
  await page.goto(`/mantencion/registros/historicos/${middle!.key}`)
  await expectPageTitle(page, "Trabajo del formulario")
  await expect(page.getByText(middle!.text, { exact: true })).toBeVisible()
  await expect(page.getByText("Correctiva", { exact: true })).toBeVisible()
  await expect(page.getByText("151000", { exact: true })).toBeVisible()
  // Los datos tal como venían en el formulario van plegados hasta que se piden.
  await expect(page.getByText("CONDUCTOR", { exact: true })).toBeHidden()
  await page.getByText(/^Ver los \d+ campos tal como venían en el formulario$/).click()
  await expect(page.getByText("CONDUCTOR", { exact: true })).toBeVisible()
  // Trabajo anterior y siguiente del mismo equipo, en orden cronológico.
  await expect(page.getByRole("link", { name: /Trabajo anterior de este equipo/ })).toHaveAttribute("href", new RegExp(`/${previous!.key}$`))
  await expect(page.getByRole("link", { name: /Trabajo siguiente de este equipo/ })).toHaveAttribute("href", new RegExp(`/${next!.key}$`))
  await page.getByRole("link", { name: /Trabajo siguiente de este equipo/ }).click()
  await expect(page.getByText(next!.text, { exact: true })).toBeVisible()
  // Desde el siguiente se vuelve al central por «anterior».
  await expect(page.getByRole("link", { name: /Trabajo anterior de este equipo/ })).toHaveAttribute("href", new RegExp(`/${middle!.key}$`))
})

test("la hoja de vida del equipo muestra su línea de tiempo y lleva al historial filtrado", async ({ page }) => {
  await login(page, ADMIN)
  await page.goto(`/flota/${EX.bulk.id}/mantencion`)
  await expect(page.getByRole("heading", { name: "Historial de mantenciones" })).toBeVisible()
  // 33 trabajos del camión X1 (los 30 de octubre y los 3 de septiembre de la ficha), de a 10 en la hoja de vida; el más reciente (31-10) va primero y bajo el año 2026.
  await expect(page.getByRole("heading", { name: "2026", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: /Correctiva, 31-10-2026, Formulario: QA_ Trabajo masivo 30/ })).toBeVisible()
  const all = page.getByRole("link", { name: "Ver todo el historial de este equipo", exact: true })
  await expect(all).toHaveAttribute("href", new RegExp(`/mantencion/registros/historicos\\?equipo=${EX.bulk.id}&periodo=todo`))
  await all.click()
  await expect(page).toHaveURL(new RegExp(`equipo=${EX.bulk.id}`))
  await expect(textoVisible(page, new RegExp(`^${EX.bulkRows + FICHA.length} trabajos de todo el historial`))).toBeVisible()
})

test("«Órdenes de trabajo cerradas» avisa dónde están los trabajos anteriores", async ({ page }) => {
  await login(page, ADMIN)
  await page.goto("/mantencion/ot?estado=cerrada")
  await expectPageTitle(page, "Órdenes de trabajo")
  const link = page.getByRole("link", { name: "Historial de mantenciones", exact: true })
  await expect(link).toHaveAttribute("href", "/mantencion/registros/historicos")
  await expect(textoVisible(page, /Aquí están las órdenes de trabajo hechas en la plataforma/)).toBeVisible()
  // Sólo en «Cerradas»: en las otras pestañas el aviso sobra.
  await page.goto("/mantencion/ot?estado=en_ejecucion")
  await expectPageTitle(page, "Órdenes de trabajo")
  await expect(page.getByRole("link", { name: "Historial de mantenciones", exact: true })).toHaveCount(0)
  // Y el enlace lleva a la lista unificada.
  await page.goto("/mantencion/ot?estado=cerrada")
  await link.click()
  await expectPageTitle(page, "Historial de mantenciones")
})

test("en el teléfono la lista son tarjetas con vista previa y no desborda", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const mobileProblems = watchProblems(page)
  try {
    await login(page, ADMIN)
    await page.goto(FAENA_A)
    await expectPageTitle(page, "Historial de mantenciones")
    await expect(page.getByRole("list", { name: "Trabajos de mantención como tarjetas" }).getByRole("button", { name: /^Vista previa del trabajo de / }).first()).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    // La matriz se desplaza dentro de su contenedor: la página no.
    await page.goto(`${FAENA_A}&vista=matriz`)
    await expect(page.getByRole("table", { name: "Trabajos por equipo y mes" })).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  } finally {
    expect(mobileProblems).toEqual([])
    await context.close()
  }
})
