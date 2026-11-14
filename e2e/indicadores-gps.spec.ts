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

  test("la página son gráficos: sin tiles y con cada cifra del período como enlace de la tira", async ({ page }) => {
    await page.goto(RUTA)
    await expectPageTitle(page, "Indicadores GPS")
    await esperarGraficos(page)

    await expect(page.locator("[data-kpi-card]"), "los tiles de KPI ya no existen en esta pantalla").toHaveCount(0)
    // Los enlaces de la tira (Km recorridos, Viajes…) llevan a un subconjunto de la app; las secciones sin datos no pintan tira.
    const destinos = await page
      .getByRole("region", { name: /^(Uso de la flota|Ralentí y conducción)$/ })
      .locator("a[data-pressable]")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")))
    for (const href of destinos) expect(href, "cifra de la tira sin destino").toMatch(/^\//)
    expect(destinos.length, "una sección no puede tener más de 4 cifras en su tira").toBeLessThanOrEqual(8)
  })

  test("los rankings se dibujan como gráficos de barras, no como listas", async ({ page }) => {
    await page.goto(RUTA)
    await expectPageTitle(page, "Indicadores GPS")
    await esperarGraficos(page)

    // Sin lecturas en la base E2E no hay rankings: entonces sólo se comprueba que ninguno quedó como lista.
    await expect(page.locator("[data-rank-fill]"), "un ranking quedó como lista de barras HTML").toHaveCount(0)
    const rankings = page.getByRole("img", { name: /^(Km recorridos por faena|Equipos con más km recorridos|Equipos con más horas de motor|Equipos con más excesos de velocidad)/ })
    for (const ranking of await rankings.all()) {
      await expect(ranking.locator("svg.recharts-surface")).toBeVisible()
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
