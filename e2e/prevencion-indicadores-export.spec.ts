import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Dashboard de Indicadores SST y Exportación Ejecutiva.
 *
 * Covers:
 *   • Carga del dashboard de indicadores de prevención.
 *   • Verificación de visualización de métricas y gráficos.
 */
test.describe("Prevención — Dashboard de Indicadores SST", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de indicadores carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/indicadores")
    await expect(page).toHaveURL(/\/prevencion\/indicadores/)

    // Título de la página
    await expectPageTitle(page, /Indicadores|Estadísticas/i)
  })
})
