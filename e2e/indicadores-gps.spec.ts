import { test, expect, type Page } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"

/**
 * E2E: Indicadores GPS (`/flota/indicadores`).
 *
 * La base E2E casi no trae lecturas de GPS, así que la pantalla suele mostrar sus
 * estados vacíos (una línea que dice qué falta y qué hacer, no ceros). Por eso las
 * comprobaciones de estructura valen para los dos casos: con datos o sin ellos.
 *
 * Locators: `getByRole` ignora los nodos ocultos por CSS. Las comprobaciones sobre
 * celdas del panel miden el DOM pintado con `evaluate`; el gráfico diferido
 * (`lazyChart`) deja un `[data-chart-loading]` hasta que llega su chunk, y un
 * gráfico sin datos devuelve `null` y su celda se oculta (`empty:hidden`).
 */

const RUTA = "/flota/indicadores"

/** Espera a que ningún gráfico siga cargando: un esqueleto todavía no sabe si tendrá datos. */
async function esperarGraficos(page: Page) {
  await expect(page.locator("[data-chart-loading]")).toHaveCount(0, { timeout: 30_000 })
}

test.describe("Indicadores GPS", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("carga para un administrador con su título y sin gráficos colgados", async ({ page }) => {
    const errores: string[] = []
    page.on("pageerror", (error) => errores.push(error.message))

    await page.goto(RUTA)
    await expectPageTitle(page, "Indicadores GPS")
    await expect(page.getByRole("region", { name: "Uso de la flota" })).toBeVisible()
    await esperarGraficos(page)
    expect(errores, "errores de JavaScript en la página").toEqual([])
  })

  test("ninguna celda visible de un panel queda vacía", async ({ page }) => {
    await page.goto(RUTA)
    await expectPageTitle(page, "Indicadores GPS")
    await esperarGraficos(page)

    const vacias = await page.locator("[data-dashboard-panel] > div > *").evaluateAll((celdas) =>
      celdas
        .filter((celda) => celda.getClientRects().length > 0)
        .filter((celda) => celda.innerHTML.trim() === "")
        .map((celda) => celda.className),
    )
    expect(vacias, "celdas visibles sin contenido").toEqual([])
  })

  test("a lo más ocho tiles en la página y cada uno lleva a su subconjunto", async ({ page }) => {
    await page.goto(RUTA)
    await expectPageTitle(page, "Indicadores GPS")
    await esperarGraficos(page)

    const tiles = await page.locator("[data-kpi-card]").count()
    expect(tiles, `${tiles} tiles`).toBeLessThanOrEqual(8)
    // Cada tile es un enlace que contiene el `data-kpi-card`: mismos conteos.
    expect(await page.locator("a:has([data-kpi-card])").count(), "hay tiles que no son enlaces").toBe(tiles)
    for (const href of await page.locator("a:has([data-kpi-card])").evaluateAll((links) => links.map((link) => link.getAttribute("href")))) {
      expect(href, "tile sin destino").toMatch(/^\//)
    }
  })

  test("cambiar el período escribe desde y hasta en la URL", async ({ page }) => {
    await page.goto(RUTA)
    await expectPageTitle(page, "Indicadores GPS")
    await expect(page).not.toHaveURL(/[?&]desde=/)

    await page.getByRole("group", { name: "Período", exact: true }).getByRole("button", { name: "Período anterior", exact: true }).click()
    await expect(page).toHaveURL(/[?&]desde=\d{4}-\d{2}-\d{2}/)
    await expect(page).toHaveURL(/[?&]hasta=\d{4}-\d{2}-\d{2}/)
    // Se aplica con `router.replace`: la pantalla sigue en su título y no se acumulan entradas de historial.
    await expectPageTitle(page, "Indicadores GPS")
    await esperarGraficos(page)
  })

  test("un rango inválido en la URL avisa y cae al período por defecto", async ({ page }) => {
    await page.goto(`${RUTA}?desde=2026-13-45&hasta=2026-01-01`)
    await expectPageTitle(page, "Indicadores GPS")
    await expect(page.getByText("El rango de fechas de la dirección no es válido", { exact: false })).toBeVisible()
  })

  test("aparece en el menú de Flota y el ítem queda activo", async ({ page }) => {
    await page.goto(RUTA)
    // El menú se busca por href, no por rótulo: el href es el contrato (mismo criterio que control-operacional-navegacion).
    const item = page.getByRole("navigation", { name: "Navegación", exact: true }).locator('a[href="/flota/indicadores"]').first()
    await expect(item).toBeVisible()
    await expect(item).toHaveAttribute("aria-current", "page")
  })
})
