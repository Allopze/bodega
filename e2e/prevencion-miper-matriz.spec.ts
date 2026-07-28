import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Matriz de Riesgos MIPER y Controles.
 *
 * Covers:
 *   • Carga del workbench MIPER y controles por puesto de trabajo.
 *   • Navegación entre vistas y tabs del workbench.
 */
test.describe("Prevención — Matriz MIPER y Controles", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de MIPER y controles carga sin errores", async ({ page }) => {
    await page.goto("/prevencion/miper")
    await expect(page).toHaveURL(/\/prevencion\/miper/)

    // Título y descripción
    await expectPageTitle(page, "MIPER y controles")
  })
})
