import { expect, test } from "@playwright/test"
import { login } from "./helpers"

/**
 * El indicador no calculable, visto por dos roles (DATA-IND-001, TASK-UI-009).
 *
 * El hallazgo original: las tasas aparecían como «—» sin decir qué dato
 * faltaba. La corrección antepuso una banda que nombra el denominador ausente
 * y ofrece cargarlo — pero sólo se había comprobado con un administrador, que
 * es el caso fácil: quien puede arreglarlo.
 *
 * La pregunta que faltaba responder es la del otro lado. Alguien que consulta
 * los indicadores sin permiso para registrar horas-hombre ve el mismo guion.
 * Si la explicación estuviera detrás del permiso de edición, para ese rol el
 * defecto original seguiría intacto: una cifra vacía sin causa.
 *
 * El criterio es explícito —"ningún 'No calculable' genérico"— y no admite
 * excepción por rol: la causa es información, no una acción.
 */
const RUTA = "/prevencion/indicadores"

test.describe("Indicadores — el denominador faltante se explica a todos los roles", () => {
  test("quien puede cargar HH ve la causa y el botón que la resuelve", async ({ page }) => {
    await login(page)
    await page.goto(RUTA)
    await page.waitForLoadState("networkidle").catch(() => undefined)

    const banda = page.getByText(/Sin denominadores cargados|Faltan denominadores en/)
    if (await banda.count() === 0) test.skip(true, "El año sembrado tiene todos sus denominadores cargados.")

    await expect(banda.first()).toBeVisible()
    // La causa, no sólo el hecho: qué se calcula con ese dato y por qué el mes
    // no puede cerrarse sin él.
    await expect(page.getByText(/horas-hombre/i).first()).toBeVisible()

    /*
     * Con el alcance en "Total" no hay botón, y está bien: los denominadores se
     * cargan por faena, así que un botón ahí abriría un diálogo sin destino.
     * En su lugar dice qué falta hacer antes. Se comprueba porque es la
     * diferencia entre "no hay acción" y "la acción necesita un paso previo".
     */
    await expect(page.getByText("Selecciona una faena para cargarlos.")).toBeVisible()

    // Y elegida una faena concreta, aparece la acción correctiva.
    await page.locator("button[role='combobox']").first().click()
    await page.getByRole("option").nth(1).click()
    await page.waitForLoadState("networkidle").catch(() => undefined)
    await expect(page.getByRole("button", { name: "Cargar dotación y HH" })).toBeVisible({ timeout: 10_000 })
  })

  test("quien no puede cargarlas ve la misma causa, sin un botón que no le sirve", async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await login(page, "prevencion.lectura@e2e.chome.cl", "chome2026")
      await page.goto(RUTA)
      await page.waitForLoadState("networkidle").catch(() => undefined)

      // Primero: el rol llega a la pantalla. Si redirigiera a /forbidden, la
      // prueba pasaría sin comprobar nada de lo que le importa.
      await expect(page).toHaveURL(new RegExp(RUTA))

      const banda = page.getByText(/Sin denominadores cargados|Faltan denominadores en/)
      if (await banda.count() === 0) test.skip(true, "El año sembrado tiene todos sus denominadores cargados.")

      // La explicación es información y no está detrás del permiso de edición.
      await expect(banda.first()).toBeVisible()
      await expect(page.getByText(/horas-hombre/i).first()).toBeVisible()
      // Y no se le ofrece una acción que el servidor le rechazaría.
      await expect(page.getByRole("button", { name: "Cargar dotación y HH" })).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  test("el guion de una tasa no calculable nunca aparece sin su explicación", async ({ page }) => {
    await login(page)
    await page.goto(RUTA)
    await page.waitForLoadState("networkidle").catch(() => undefined)

    // Un «—» suelto es exactamente el defecto que DATA-IND-001 describía. Si
    // hay alguno, tiene que haber una banda que diga por qué.
    const guiones = await page.getByText("—", { exact: true }).count()
    if (guiones === 0) return
    await expect(page.getByText(/Sin denominadores cargados|Faltan denominadores en/).first()).toBeVisible()
  })
})
