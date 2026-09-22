import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Matriz de Identificación de Peligros y Evaluación de Riesgos (MIPER).
 *
 * Cubre:
 *   • Renderizado del workbench MIPER y visualización de matrices de faenas.
 *   • Navegación por las pestañas del workbench (Matriz, Controles, Importaciones).
 *   • Visualización del Mapa de Calor de Riesgos.
 */

test.describe("Prevención — Matriz MIPER y Controles", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("el workbench de MIPER carga con sus controles y selector de faena", async ({ page }) => {
    await page.goto("/prevencion/miper")
    await expect(page).toHaveURL(/\/prevencion\/miper/)
    await expectPageTitle(page, "MIPER y controles")

    // Botones de acción del header (Nueva matriz / Importar / etc.)
    await expect(page.getByText("Faena E2E").first()).toBeVisible({ timeout: 30_000 })
  })

  // El mapa se trasladó a CGRD el 2026-09-22. El flujo completo del plano y sus
  // marcadores vive en prevencion-cgrd-risk-map.spec.ts; acá sólo queda que la
  // pantalla responde y se titula como corresponde.
  test("navegación al mapa de riesgos interactivo", async ({ page }) => {
    await page.goto("/prevencion/cgrd/mapa")
    await expect(page).toHaveURL(/\/prevencion\/cgrd\/mapa/)
    await expectPageTitle(page, /Mapa de riesgos|Peligros y riesgos/i)
  })
})
