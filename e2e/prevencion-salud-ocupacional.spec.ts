import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: Salud Ocupacional e Higiene Industrial (Protocolos MINSAL).
 *
 * Covers:
 *   • Carga del módulo de Higiene Industrial y Salud Ocupacional.
 */
test.describe("Prevención — Salud Ocupacional e Higiene", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de higiene y salud ocupacional carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/higiene")
    await expect(page).toHaveURL(/\/prevencion\/higiene/)

    // Título de la página
    await expect(page.getByRole("heading", { name: /Higiene|Salud ocupacional/i })).toBeVisible()
  })
})
