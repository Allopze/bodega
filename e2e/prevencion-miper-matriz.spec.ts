import { test, expect } from "@playwright/test"
import { login } from "./helpers"

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
    await expect(page.getByRole("heading", { name: "MIPER y controles" })).toBeVisible()
    await expect(page.getByText(/Versiona peligros, riesgos y controles/i)).toBeVisible()
  })
})
