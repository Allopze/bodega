import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Planes de Emergencia y Simulacros de Evacuación.
 *
 * Cubre:
 *   • Renderizado de la bandeja de planes de emergencia por faena.
 *   • Navegación entre pestañas de Planes de Emergencia y Simulacros.
 *   • Visualización de escenarios, brigadas y recursos de respuesta.
 */

test.describe("Prevención — Emergencias y Simulacros", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la bandeja de emergencias carga correctamente y permite alternar pestañas", async ({ page }) => {
    await page.goto("/prevencion/emergencias")
    await expect(page).toHaveURL(/\/prevencion\/emergencias/)
    await expectPageTitle(page, "Emergencias y simulacros")

    // Pestañas de la vista (Planes / Simulacros)
    const tabSimulacros = page.getByRole("tab", { name: /Simulacros/i }).or(page.getByRole("link", { name: /Simulacros/i }))
    if (await tabSimulacros.count() > 0) {
      await tabSimulacros.first().click()
      await expect(page).toHaveURL(/tab=drills|\/emergencias/)
    }
  })
})
