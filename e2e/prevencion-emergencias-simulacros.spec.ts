import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: Emergencias, Simulacros y Equipos de Extinción.
 *
 * Covers:
 *   • Carga del módulo de planes de emergencia y simulacros.
 */
test.describe("Prevención — Emergencias y Simulacros", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de emergencias carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/emergencias")
    await expect(page).toHaveURL(/\/prevencion\/emergencias/)

    // Título de la página
    await expect(page.getByRole("heading", { name: /Emergencias|Simulacros/i })).toBeVisible()
  })
})
