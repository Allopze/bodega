import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: Matriz y Entrega Técnica de EPP Preventivo.
 *
 * Covers:
 *   • Carga del catálogo / matriz de EPP preventivo por cargo.
 */
test.describe("Prevención — Matriz de EPP Preventivo", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de EPP preventivo carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/epp-preventivo")
    await expect(page).toHaveURL(/\/prevencion\/epp-preventivo/)

    // Título de la página
    await expect(page.getByRole("heading", { name: /EPP|Elementos de protección/i })).toBeVisible()
  })
})
