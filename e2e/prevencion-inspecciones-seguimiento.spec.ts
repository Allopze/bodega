import { test, expect } from "@playwright/test"
import { expectPageTitle, login, textoVisible } from "./helpers"

/**
 * E2E: seguimiento de hallazgos (`/prevencion/inspecciones/seguimiento`).
 *
 * La pantalla es una tabla con filtros (búsqueda, Faena, Estado y Tipo) que viajan en la URL y al
 * enlace «Exportar Excel»: lo que se descarga es lo que se ve. Se ordena por atención (vencidas, sin
 * acción CAPA, abiertas, cerradas) y cada hallazgo enlaza a su inspección.
 *
 * El fixture trae siete hallazgos sin acción CAPA (`setup-db.ts`, «INSP-E2E-0002…0008»). Otros specs
 * derivan o cierran algunos, así que nada acá afirma un total: se ancla en `INSP-E2E-0003`
 * (`insp-e2e-bloqueada`), la ejecución que ningún spec muta.
 */
const RUTA = "/prevencion/inspecciones/seguimiento"
const EXPORTAR = "/api/prevencion/inspecciones/seguimiento/export"

test.describe("Inspecciones — seguimiento de hallazgos", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("lista los hallazgos y cada uno enlaza a su inspección", async ({ page }) => {
    await page.goto(RUTA)
    await expectPageTitle(page, "Seguimiento de inspecciones")

    const tabla = page.getByRole("region", { name: "Tabla con desplazamiento horizontal" })
    await expect(tabla).toBeVisible({ timeout: 30_000 })
    for (const columna of ["Hallazgo", "Faena / sujeto", "Acción correctiva", "Plazo", "Estado"]) {
      await expect(tabla.getByRole("columnheader", { name: new RegExp(columna) })).toBeVisible()
    }

    const fila = tabla.getByRole("row").filter({ hasText: "INSP-E2E-0003" })
    await expect(fila).toHaveCount(1)
    // El hallazgo es el enlace a su inspección, y el estado se dice una sola vez.
    await expect(fila.getByRole("link").first()).toHaveAttribute("href", "/prevencion/inspecciones/insp-e2e-bloqueada")
    await expect(fila.getByText("Sin acción CAPA", { exact: true })).toBeVisible()

    await fila.getByRole("link").first().click()
    await expect(page).toHaveURL(/\/prevencion\/inspecciones\/insp-e2e-bloqueada$/, { timeout: 30_000 })
  })

  test("filtrar por Estado actualiza la URL y el enlace «Exportar Excel» lleva el filtro", async ({ page }) => {
    await page.goto(RUTA)
    await expectPageTitle(page, "Seguimiento de inspecciones")

    const exportar = page.getByRole("link", { name: "Exportar Excel" })
    await expect(exportar).toBeVisible({ timeout: 30_000 })
    // Sin filtros, el enlace descarga todo.
    await expect(exportar).toHaveAttribute("href", EXPORTAR)

    await page.getByRole("combobox", { name: "Estado", exact: true }).click()
    await page.getByRole("option", { name: "Sin acción CAPA", exact: true }).click()

    await expect(page).toHaveURL(/[?&]estado=sin_capa(&|$)/, { timeout: 30_000 })
    await expect(exportar).toHaveAttribute("href", `${EXPORTAR}?estado=sin_capa`)
    // Quedan las filas sin acción, y el filtro se ve como chip removible.
    await expect(textoVisible(page, "INSP-E2E-0003").first()).toBeVisible({ timeout: 30_000 })

    // Un estado sin filas lo dice, con la forma de salir, y el enlace sigue llevando el filtro.
    await page.getByRole("combobox", { name: "Estado", exact: true }).click()
    await page.getByRole("option", { name: "Vencidas", exact: true }).click()
    await expect(page).toHaveURL(/[?&]estado=vencidas(&|$)/, { timeout: 30_000 })
    await expect(exportar).toHaveAttribute("href", `${EXPORTAR}?estado=vencidas`)
    await expect(textoVisible(page, "No hay hallazgos con estos filtros")).toBeVisible()
    await page.getByRole("button", { name: "Limpiar filtros" }).last().click()
    await expect(page).not.toHaveURL(/estado=/, { timeout: 30_000 })
    await expect(exportar).toHaveAttribute("href", EXPORTAR)
  })

  test("la búsqueda acota por código y se refleja en la URL y en la descarga", async ({ page }) => {
    await page.goto(RUTA)
    const buscar = page.getByRole("searchbox", { name: "Buscar en el seguimiento" })
    await expect(buscar).toBeVisible({ timeout: 30_000 })
    await buscar.fill("INSP-E2E-0003")

    await expect(page).toHaveURL(/[?&]q=INSP-E2E-0003/, { timeout: 30_000 })
    await expect(page.getByRole("link", { name: "Exportar Excel" })).toHaveAttribute("href", `${EXPORTAR}?q=INSP-E2E-0003`)
    const filas = page.getByRole("region", { name: "Tabla con desplazamiento horizontal" }).getByRole("row")
    // Encabezado y la única fila de esa inspección.
    await expect(filas).toHaveCount(2, { timeout: 30_000 })
    await expect(filas.nth(1)).toContainText("INSP-E2E-0003")
  })

  for (const ancho of [1024, 1280]) {
    test(`a ${ancho} px la tabla cabe en su región, sin scroll horizontal`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 800 })
      await page.goto(RUTA)
      const tabla = page.getByRole("region", { name: "Tabla con desplazamiento horizontal" })
      await expect(tabla).toBeVisible({ timeout: 30_000 })
      await expect(tabla.getByRole("row").nth(1)).toBeVisible()

      const medidas = await tabla.evaluate((el) => ({ visible: el.clientWidth, contenido: el.scrollWidth }))
      expect(medidas.contenido, "la tabla desborda su región").toBeLessThanOrEqual(medidas.visible)
      const pagina = await page.evaluate(() => ({ ancho: document.documentElement.clientWidth, contenido: document.documentElement.scrollWidth }))
      expect(pagina.contenido, "la página desborda").toBeLessThanOrEqual(pagina.ancho)
      // «Plazo» y «Estado» son las columnas que se perdían tras el scroll.
      const marco = (await tabla.boundingBox())!
      for (const nombre of ["Plazo", "Estado"]) {
        const caja = (await tabla.getByRole("columnheader", { name: new RegExp(nombre) }).boundingBox())!
        expect(caja.x + caja.width, `«${nombre}» se sale de la región`).toBeLessThanOrEqual(marco.x + marco.width + 1)
      }
    })
  }

  test("en el teléfono cada hallazgo es una tarjeta con su enlace a la inspección", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${RUTA}?q=INSP-E2E-0003`)
    const tarjeta = page.getByRole("article").filter({ hasText: "INSP-E2E-0003" })
    await expect(tarjeta).toBeVisible({ timeout: 30_000 })
    await expect(tarjeta.getByRole("link", { name: "Ver inspección" })).toHaveAttribute("href", "/prevencion/inspecciones/insp-e2e-bloqueada")
    const pagina = await page.evaluate(() => ({ ancho: document.documentElement.clientWidth, contenido: document.documentElement.scrollWidth }))
    expect(pagina.contenido, "la página desborda en el teléfono").toBeLessThanOrEqual(pagina.ancho)
  })
})
