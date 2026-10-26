import { test, expect, type Locator } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: rediseño del tablero (`/dashboard`).
 *
 * Fija las decisiones de producto del rediseño que `dashboard.spec.ts` no cubre
 * porque no existían: panel único por grupo, cifras en sans, Finanzas que abre
 * por los gráficos, «Antigüedad de la deuda» en orden cronológico y el Resumen
 * sin el botón «Ver N vencidas». La excepción a la regla 7 de AGENTS.md que las
 * respalda aplica **sólo** a `/dashboard`; por eso una de las pruebas compara
 * contra `/analitica`, que conserva los numerales mono.
 *
 * Locators: los roles (`getByRole`) ignoran lo oculto por CSS, que es lo que se
 * quiere (el título del `PageHeader` y sus acciones se renderizan en la TopBar y
 * en la cabecera móvil a la vez). Las comprobaciones sobre estructura (paneles,
 * celdas, familia tipográfica) miden el DOM pintado con `evaluate`.
 */

/**
 * Tramos de `AGING_BUCKETS` en `lib/services/billing/config.ts`, en el orden
 * cronológico que el gráfico debe respetar. Se repiten acá a propósito: importar
 * código de la app obligaría a resolver el alias `@/` dentro del runner de
 * Playwright (mismo criterio que `e2e/helpers.ts`).
 */
const ORDEN_TRAMOS = ["No vencida", "1–30 días", "31–60 días", "61–90 días", "Más de 90 días"]

const GRUPO_INGRESOS = "Ingresos (facturación de venta)"
const GRUPO_EGRESOS = "Egresos (compra y consumo)"

/** Borde superior del elemento, en coordenadas de la ventana. */
async function bordeSuperior(locator: Locator): Promise<number> {
  const box = await locator.boundingBox()
  if (!box) throw new Error("El elemento no tiene caja: ¿está oculto o fuera del DOM?")
  return box.y
}

/**
 * Familia tipográfica calculada del valor de cada tile de KPI **visible**.
 *
 * El valor es el primer `.tabular-nums` del tile (la etiqueta no lo lleva; la
 * variación `Delta` viene después en el DOM). Un tile en estado vacío no tiene
 * cifra y no entra en la lista.
 */
async function familiasDeCifras(tiles: Locator): Promise<string[]> {
  return tiles.evaluateAll((nodes) =>
    nodes
      .filter((node) => node.getClientRects().length > 0)
      .map((node) => {
        const valor = node.querySelector(".tabular-nums")
        return valor ? getComputedStyle(valor).fontFamily : null
      })
      .filter((familia): familia is string => familia !== null),
  )
}

test.describe("Rediseño del tablero", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle")
  })

  // La primaria calculada («Ver 215 vencidas») duplicaba el enlace de Hoy a Mis
  // pendientes y, verde junto a «Más acciones», competía con él por el primer
  // clic. Las altas siguen en el menú.
  test("el Resumen ya no ofrece «Ver N vencidas» y conserva «Más acciones»", async ({ page }) => {
    // Primero se espera a la cabecera: contar «0» antes de que renderice no
    // probaría nada.
    await expect(page.getByRole("button", { name: "Más acciones", exact: true }).first()).toBeVisible()

    const vencidas = /^Ver [\d.,]+ vencidas?$/
    await expect(
      page.getByRole("link", { name: vencidas }).or(page.getByRole("button", { name: vencidas })),
    ).toHaveCount(0)
  })

  test("Finanzas abre con los gráficos y deja los grupos de KPIs debajo", async ({ page }) => {
    await page.goto("/dashboard?vista=finanzas")
    const finanzas = page.getByRole("region", { name: "Finanzas" })
    const ingresos = finanzas.getByText(GRUPO_INGRESOS, { exact: true })
    const egresos = finanzas.getByText(GRUPO_EGRESOS, { exact: true })
    // La sección se renderiza entera de una vez: con esto visible, un conteo de
    // gráficos en 0 significa de verdad «no hay gráficos de venta».
    await expect(ingresos).toBeVisible()
    await expect(egresos).toBeVisible()

    const graficos = finanzas.getByRole("heading", { name: /^(Facturado y cobrado|Antigüedad de la deuda)$/ })
    if ((await graficos.count()) === 0) test.skip(true, "Sin facturado ni deuda por tramo en esta base: no hay gráfico de venta que ubicar")

    const yIngresos = await bordeSuperior(ingresos)
    for (const grafico of await graficos.all()) {
      const nombre = ((await grafico.textContent()) ?? "").trim()
      expect(await bordeSuperior(grafico), `«${nombre}» debe ir arriba de «${GRUPO_INGRESOS}»`).toBeLessThan(yIngresos)
    }
    // Y los dos grupos conservan su orden: ingresos, después egresos.
    expect(yIngresos).toBeLessThan(await bordeSuperior(egresos))
  })

  // Los tramos son una línea de tiempo: ordenarlos por monto (lo que hacía el
  // ranking genérico) ponía «Más de 90 días» antes de «No vencida».
  test("Antigüedad de la deuda lista los tramos en orden cronológico", async ({ page }) => {
    await page.goto("/dashboard?vista=finanzas")
    await expect(page.getByRole("region", { name: "Finanzas" }).getByText(GRUPO_INGRESOS, { exact: true })).toBeVisible()

    const titulo = page.getByRole("heading", { name: "Antigüedad de la deuda", exact: true })
    if ((await titulo.count()) === 0) test.skip(true, "Sin deuda por tramo en esta base: el gráfico no se dibuja")

    // La celda del gráfico: hijo directo de la grilla del panel. Se acota ahí y
    // no a la sección porque Finanzas trae otras listas (clientes, proveedores).
    const celda = page.locator("[data-dashboard-panel] > div > *").filter({ has: titulo })
    await expect(celda).toHaveCount(1)
    // Con facturación pero sin saldo abierto el gráfico muestra su estado vacío
    // (A4) en vez de los tramos: no hay orden que comprobar.
    if ((await celda.getByText("Sin saldo pendiente").count()) > 0) {
      test.skip(true, "Sin saldo pendiente en esta base: el gráfico muestra su estado vacío")
    }

    // Cada lista se evalúa por separado: si el gráfico lleva además una leyenda
    // en forma de lista, las dos deben ser cronológicas, no una sola secuencia.
    const secuencias = await celda.getByRole("list").evaluateAll((listas, orden) =>
      listas.map((lista) =>
        Array.from(lista.querySelectorAll(":scope > li"))
          .map((fila) => orden.findIndex((tramo) => (fila.textContent ?? "").includes(tramo)))
          .filter((indice) => indice >= 0),
      ),
      ORDEN_TRAMOS,
    )

    const conTramos = secuencias.filter((secuencia) => secuencia.length > 0)
    expect(conTramos.length, "ninguna lista del gráfico nombra los tramos de antigüedad").toBeGreaterThan(0)
    for (const secuencia of conTramos) {
      expect(secuencia, `tramos en el orden ${secuencia.map((i) => ORDEN_TRAMOS[i]).join(" → ")}`)
        .toEqual([...secuencia].sort((a, b) => a - b))
    }
  })

  // Las cifras del tablero son sans; el resto de la app (acá, /analitica) sigue
  // en mono. Si alguien cambia `KpiCard` por defecto o suelta `DASHBOARD_KPI`,
  // una de las dos mitades cae.
  test("las cifras de KPI del tablero van en sans y las de /analitica conservan mono", async ({ page }) => {
    await expect(page.getByRole("region", { name: "Indicadores Operacionales" })).toBeVisible()
    const delTablero = await familiasDeCifras(page.locator("[data-kpi-card]"))
    if (delTablero.length === 0) test.skip(true, "El usuario no ve ningún tile con cifra en el Resumen")
    for (const familia of delTablero) {
      expect(familia, "una cifra del tablero sigue en mono").not.toMatch(/mono/i)
    }

    await page.goto("/analitica")
    if (new URL(page.url()).pathname !== "/analitica") test.skip(true, "El usuario no tiene acceso a /analitica")
    await expect(page.getByRole("region", { name: "KPIs ejecutivos" })).toBeVisible()
    const deAnalitica = await familiasDeCifras(page.locator("[data-kpi-card]"))
    if (deAnalitica.length === 0) test.skip(true, "/analitica no muestra ningún tile con cifra")
    for (const familia of deAnalitica) {
      expect(familia, "una cifra de /analitica dejó de ser mono").toMatch(/mono/i)
    }
  })

  // El defecto de Prevención con SST en cero: un gráfico sin datos devolvía
  // `null` pero su celda seguía ocupando dos columnas, como un hueco blanco.
  test("Prevención no deja celdas de gráfico vacías dentro de sus paneles", async ({ page }) => {
    await page.goto("/dashboard?vista=prevencion")
    await expect(page.getByRole("region", { name: "Prevención", exact: true })).toBeVisible()
    // Los gráficos son componentes de cliente: pueden decidir que no tienen
    // datos después de hidratar.
    await page.waitForLoadState("networkidle")

    const { paneles, problemas } = await page.evaluate(() => {
      const conContenido = (celda: Element) =>
        (celda.textContent ?? "").trim() !== "" || celda.querySelector("svg, canvas, img") !== null
      const pintado = (nodo: Element) => nodo.getClientRects().length > 0

      const problemas: string[] = []
      let paneles = 0
      document.querySelectorAll("[data-dashboard-panel]").forEach((panel, indice) => {
        if (!pintado(panel)) return
        paneles++
        const rejilla = panel.firstElementChild
        const celdas = rejilla ? Array.from(rejilla.children).filter(pintado) : []
        if (!celdas.some(conContenido)) problemas.push(`el panel ${indice + 1} está visible sin ninguna celda con contenido`)
        celdas.forEach((celda, posicion) => {
          if (!conContenido(celda)) problemas.push(`el panel ${indice + 1} tiene una celda vacía visible (celda ${posicion + 1})`)
        })
      })
      return { paneles, problemas }
    })

    expect(paneles, "Prevención debería pintar al menos un panel").toBeGreaterThan(0)
    expect(problemas, problemas.join(" | ")).toEqual([])
  })

  // Los gráficos animan (relleno, resplandor, destaque de columna) salvo que la
  // persona pida lo contrario. Es una prueba de humo: que la ruta de
  // `prefers-reduced-motion` no lance ni deje errores en consola.
  test("con prefers-reduced-motion el Resumen carga sin errores de consola", async ({ page }) => {
    const errores: string[] = []
    page.on("console", (mensaje) => {
      if (mensaje.type() === "error") errores.push(mensaje.text())
    })
    page.on("pageerror", (error) => errores.push(error.message))

    await page.emulateMedia({ reducedMotion: "reduce" })
    // El `beforeEach` ya navegó antes de registrar los oyentes: se vuelve a cargar.
    await page.goto("/dashboard")
    await page.waitForLoadState("networkidle")

    await expect(page.getByRole("region", { name: "Indicadores Operacionales" })).toBeVisible()
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true)
    expect(errores, `errores de consola: ${errores.join(" | ")}`).toHaveLength(0)
  })
})
