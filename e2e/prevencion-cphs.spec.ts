import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: Comité Paritario de Higiene y Seguridad (CPHS - DS 54).
 *
 * Covers:
 *   • Carga del módulo CPHS (actas, elecciones, acuerdos).
 */
test.describe("Prevención — Comité Paritario CPHS", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de CPHS carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/cphs")
    await expect(page).toHaveURL(/\/prevencion\/cphs/)

    // Título de la página
    await expect(page.getByRole("heading", { name: /Comité Paritario|CPHS/i })).toBeVisible()
  })
})
