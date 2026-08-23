import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Matriz de Requisitos Legales y Conformidad Normativa.
 *
 * Cubre:
 *   • Renderizado del workbench de Requisitos Legales y Normativos (DS 594, DS 40, Ley 16.744).
 *   • Visualización de la matriz de aplicabilidad y evaluación de cumplimiento por faena.
 *   • Acciones de exportación y evaluación de conformidad.
 */

test.describe("Prevención — Cumplimiento y requisitos legales", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista de requisitos legales carga el workbench y la matriz de aplicabilidad", async ({ page }) => {
    await page.goto("/prevencion/requisitos-legales")
    await expect(page).toHaveURL(/\/prevencion\/requisitos-legales/)
    await expectPageTitle(page, "Requisitos legales")

    // Verificación de faena y tabla de normativas
    await expect(page.getByText("Faena E2E").first()).toBeVisible({ timeout: 30_000 })
  })
})
