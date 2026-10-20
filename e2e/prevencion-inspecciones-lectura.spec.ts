import { test, expect, type Page } from "@playwright/test"
import { login, textoVisible } from "./helpers"

/**
 * E2E: el detalle de una inspección ya declarada ejecutada, en modo lectura y revisión
 * (`/prevencion/inspecciones/<runId>` con la ejecución `completed`).
 *
 * La lectura abre con el resumen, sigue con los hallazgos y deja lo conforme plegado por sección
 * («{Sección} · 4 conformes»). A 390 px los hallazgos son tarjetas con sus acciones a la vista: la tabla
 * los dejaba tras un scroll horizontal y «Derivar a CAPA» quedaba fuera de la pantalla.
 *
 * Se ancla en `INSP-E2E-0003` (`insp-e2e-bloqueada`): completada, con un hallazgo abierto (el
 * manómetro, no conforme) y cuatro ítems conformes. Es la ejecución que ningún spec muta: los demás
 * archivos sólo la abren para leerla.
 */
const RUN = "/prevencion/inspecciones/insp-e2e-bloqueada"

async function sinDesborde(page: Page) {
  const medidas = await page.evaluate(() => ({ ancho: document.documentElement.clientWidth, contenido: document.documentElement.scrollWidth }))
  expect(medidas.contenido, "la página desborda horizontalmente").toBeLessThanOrEqual(medidas.ancho)
}

test.describe("Inspecciones — detalle en lectura", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("a 390×844 «Derivar a CAPA» se ve sin scroll horizontal y lo conforme viene plegado", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(RUN)

    // Resumen primero: el nombre de la región y el resultado.
    const resumen = page.getByRole("region", { name: "Resumen de la inspección" })
    await expect(resumen).toBeVisible({ timeout: 30_000 })
    await expect(resumen.getByText("Resultado normalizado")).toBeVisible()

    // Los hallazgos son tarjetas bajo `md`: sin tabla, y la acción dentro de la pantalla.
    await expect(page.getByRole("region", { name: "Hallazgos de la inspección" })).toBeHidden()
    const tarjeta = page.getByRole("article").filter({ hasText: "Manómetro" })
    await expect(tarjeta).toBeVisible()
    const derivar = tarjeta.getByRole("button", { name: "Derivar a CAPA" })
    await expect(derivar).toBeVisible()
    const caja = (await derivar.boundingBox())!
    expect(caja.x, "«Derivar a CAPA» empieza antes del borde izquierdo").toBeGreaterThanOrEqual(0)
    expect(caja.x + caja.width, "«Derivar a CAPA» queda tras el borde derecho").toBeLessThanOrEqual(390)
    expect(caja.height, "el botón mide menos de 44 px de alto").toBeGreaterThanOrEqual(44)
    await expect(derivar).toBeInViewport({ ratio: 1 })
    await sinDesborde(page)

    // Lo conforme viene plegado: «{Sección} · 4 conformes», cerrado, y al abrirlo aparecen sus ítems.
    const plegado = page.locator("details:not([open])").filter({ has: page.locator(":scope > summary", { hasText: /· 4 conformes/ }) })
    await expect(plegado).toHaveCount(1)
    const resumenPlegado = plegado.locator(":scope > summary")
    await expect(resumenPlegado).toBeVisible()
    await expect(page.getByText("Sello", { exact: false }).filter({ visible: true })).toHaveCount(0)
    await resumenPlegado.click()
    await expect(textoVisible(page, /Sello/).first()).toBeVisible()
    await sinDesborde(page)
  })

  test("a 1280 px los hallazgos son una tabla con la acción en su fila y sin columna de evidencia vacía", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(RUN)

    const tabla = page.getByRole("region", { name: "Hallazgos de la inspección" })
    await expect(tabla).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("article").filter({ hasText: "Manómetro" })).toBeHidden()
    await expect(tabla.getByRole("columnheader", { name: "Evidencia" })).toHaveCount(0)
    for (const columna of ["Hallazgo", "Gravedad", "Estado", "Acción"]) {
      await expect(tabla.getByRole("columnheader", { name: columna, exact: true })).toBeVisible()
    }
    const fila = tabla.getByRole("row").filter({ hasText: "Manómetro" })
    await expect(fila.getByRole("button", { name: "Derivar a CAPA" })).toBeVisible()
    // En lectura no hay «Opcional» por ítem ni controles de captura.
    await expect(page.getByText("Opcional", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("radiogroup")).toHaveCount(0)
    await expect(page.locator("details:not([open]) > summary").filter({ hasText: /· 4 conformes/ })).toHaveCount(1)
  })
})
