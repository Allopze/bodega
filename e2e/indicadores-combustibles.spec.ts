import { test, expect, type Page } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"

/**
 * E2E Spec: «Indicadores de combustible» (`/combustibles/indicadores`).
 *
 * Dos secciones —Consumo y Eficiencia— de gráficos, con una tira de cifras en Consumo y enlaces al
 * módulo, sobre el período compartido de Combustible. Fija lo que una regresión rompería sin que
 * ninguna prueba de componente lo notara: que la página cargue, que ningún gráfico se quede en su
 * esqueleto, que no queden celdas vacías en el panel, que no haya tiles (la pantalla es de gráficos;
 * las cifras van en una tira de ≤ 4 enlaces) y que el control de período cambie la URL.
 *
 * No exige un número concreto de cifras ni de gráficos: la base E2E puede no traer lecturas de
 * medidor ni telemetría, y entonces la sección dice su estado vacío en vez de un gráfico (A4). Lo
 * que se afirma es siempre «lo que se dibuja está completo», no «se dibuja todo».
 *
 * Locators: los roles (`getByRole`) ignoran lo oculto por CSS; las comprobaciones de estructura
 * (celdas del panel, esqueletos de carga) miden el DOM pintado con `evaluate`/`locator`.
 */

const RUTA = "/combustibles/indicadores"

/** Espera a que ningún gráfico diferido siga en su esqueleto: un esqueleto aún no sabe si su gráfico tiene datos. */
async function esperarGraficos(page: Page) {
  await expect(page.getByRole("heading", { level: 2, name: "Consumo", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { level: 2, name: "Eficiencia", exact: true })).toBeVisible()
  await expect(page.locator("[data-chart-loading]")).toHaveCount(0, { timeout: 30_000 })
}

test.describe("Indicadores de combustible", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("abre con su título, las dos secciones y los enlaces al módulo, sin errores de consola", async ({ page }) => {
    const errores: string[] = []
    page.on("pageerror", (error) => errores.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") errores.push(message.text())
    })

    await page.goto(RUTA)
    await expectPageTitle(page, "Indicadores de combustible")
    await esperarGraficos(page)

    // Cada sección termina en enlaces al lugar donde se trabaja; llevan el período en el `href`.
    const consumo = page.getByRole("region", { name: "Consumo", exact: true })
    await expect(consumo.getByRole("link", { name: "Panel de combustible", exact: true })).toHaveAttribute("href", /^\/combustibles(\?|$)/)
    await expect(consumo.getByRole("link", { name: "Consumo", exact: true })).toHaveAttribute("href", /^\/combustibles\/consumo\/litros(\?|$)/)
    await expect(consumo.getByRole("link", { name: "Cargas", exact: true })).toHaveAttribute("href", /^\/combustibles\/cargas(\?|$)/)
    const eficiencia = page.getByRole("region", { name: "Eficiencia", exact: true })
    await expect(eficiencia.getByRole("link", { name: "Motor en vacío", exact: true })).toHaveAttribute("href", /^\/combustibles\/consumo\/motor-en-vacio(\?|$)/)

    // La consola no se asserta en seco: recursos de terceros o el HMR del dev pueden ensuciarla. Sí los
    // errores de la propia app (un gráfico que reventó aparece como «No se pudo dibujar …»).
    await expect(page.getByText(/No se pudo dibujar/)).toHaveCount(0)
    expect(errores.filter((texto) => !/favicon|Failed to load resource/i.test(texto)), "errores de consola de la página").toEqual([])
  })

  test("ningún gráfico queda en su esqueleto ni hay celdas vacías en los paneles", async ({ page }) => {
    await page.goto(RUTA)
    await esperarGraficos(page)

    // Una celda visible de un panel debe tener contenido: las de gráficos sin datos se ocultan con `empty:hidden`.
    const vacias = await page.locator("[data-dashboard-panel]").evaluateAll((paneles) =>
      paneles
        .filter((panel) => panel.getClientRects().length > 0)
        .flatMap((panel) => Array.from(panel.querySelectorAll(":scope > div > *")))
        .filter((celda) => celda.getClientRects().length > 0)
        .filter((celda) => (celda.textContent ?? "").trim() === "" && celda.querySelector("svg, canvas, img") === null)
        .map((celda) => celda.className),
    )
    expect(vacias, "celdas visibles sin contenido").toEqual([])

    // Un panel visible no puede quedar sin celdas visibles (un marco vacío).
    const marcosVacios = await page.locator("[data-dashboard-panel]").evaluateAll((paneles) =>
      paneles
        .filter((panel) => panel.getClientRects().length > 0)
        .filter((panel) => Array.from(panel.querySelectorAll(":scope > div > *")).every((celda) => celda.getClientRects().length === 0))
        .length,
    )
    expect(marcosVacios).toBe(0)
  })

  test("sin tiles: las cifras van en una tira de hasta cuatro enlaces", async ({ page }) => {
    await page.goto(RUTA)
    await esperarGraficos(page)

    // La pantalla es de gráficos: ningún `KpiCard`.
    await expect(page.locator("[data-kpi-card]")).toHaveCount(0)

    // La tira de Consumo: cada cifra es un enlace a su detalle (litros, costo, camiones, maquinaria).
    const consumo = page.getByRole("region", { name: "Consumo", exact: true })
    const cifras = consumo.getByRole("link", { name: /Litros cargados|Costo del libro de Copec|Camiones · km\/L|Maquinaria · L\/h/ })
    expect(await cifras.count()).toBeLessThanOrEqual(4)
    for (const href of await cifras.evaluateAll((nodos) => nodos.map((nodo) => nodo.getAttribute("href") ?? ""))) {
      expect(href, "destino de la cifra").toMatch(/^\/combustibles\/(consumo|cargas)(\/|\?|$)/)
    }
  })

  test("los rankings de Consumo son gráficos de barras, no listas", async ({ page }) => {
    await page.goto(RUTA)
    await esperarGraficos(page)

    // El gráfico de barras se pinta dentro de un `role="img"` cuyo nombre trae el del ranking; con una
    // sola faena (o sin cargas) la celda no existe, así que se afirma por ranking presente.
    for (const nombre of ["Litros por faena en el período", "Litros por tipo de equipo en el período"]) {
      const grafico = page.getByRole("img", { name: new RegExp(nombre) })
      expect(await grafico.count(), `gráficos «${nombre}»`).toBeLessThanOrEqual(1)
      if ((await grafico.count()) === 1) await expect(page.getByRole("list", { name: nombre })).toHaveCount(0)
    }
  })

  test("cada gráfico trae su «Ver datos» con una tabla", async ({ page }) => {
    await page.goto(RUTA)
    await esperarGraficos(page)

    const resumenes = page.locator("details > summary", { hasText: "Ver datos" })
    const total = await resumenes.count()
    test.skip(total === 0, "Sin gráficos con datos en esta base: no hay «Ver datos» que abrir")

    await resumenes.first().click()
    await expect(page.locator("details[open] table").first()).toBeVisible()
  })

  test("elegir otro período cambia la URL y la pantalla vuelve a cargar sus secciones", async ({ page }) => {
    await page.goto(RUTA)
    await esperarGraficos(page)

    const periodo = page.getByRole("group", { name: "Período" })
    await periodo.getByRole("button", { name: "Período anterior" }).click()
    await expect(page).toHaveURL(/[?&]periodo=/)
    const elegido = new URL(page.url()).searchParams.get("periodo")
    expect(elegido).toBeTruthy()

    // Las dos secciones vuelven a resolverse con el período nuevo y los enlaces lo arrastran.
    await esperarGraficos(page)
    await expect(page.getByRole("region", { name: "Consumo", exact: true }).getByRole("link", { name: "Cargas", exact: true }))
      .toHaveAttribute("href", new RegExp(`periodo=${elegido}`))
  })

  test("el menú de Combustible trae «Indicadores» y lleva a la pantalla", async ({ page }) => {
    await page.goto("/combustibles")
    await page
      .getByRole("navigation", { name: "Navegación", exact: true })
      .locator(`a[href="${RUTA}"]`)
      .click()
    await expect(page).toHaveURL((url) => url.pathname === RUTA)
    await expectPageTitle(page, "Indicadores de combustible")
  })
})
