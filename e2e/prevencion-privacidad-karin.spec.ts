import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: Privacidad SST, Ley Karín y Casos Reservados.
 *
 * Covers:
 *   • Carga del módulo de privacidad y derechos ARCO.
 */
test.describe("Prevención — Privacidad y Casos Reservados (Ley Karín)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de privacidad carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/privacidad")
    await expect(page).toHaveURL(/\/prevencion\/privacidad/)

    // Título de la página
    await expect(page.getByRole("heading", { name: /Privacidad|Derechos/i })).toBeVisible()
  })
})
