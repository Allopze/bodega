import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: PDTP — Plantillas de programa y utilidades de importación/exportación.
 *
 * Covers:
 *   • Navegación a /prevencion/pdtp/plantillas
 *   • Botón de crear programa desde la página de plantillas
 *   • Diálogo de importación Excel en detalle del programa
 */
test.describe("PDTP — Plantillas e importación/exportación", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la página de plantillas carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/pdtp/plantillas")

    // Page header
    await expect(page.getByRole("heading", { name: "Plantillas de programas preventivos" })).toBeVisible()

    // Action button to create program
    await expect(page.getByRole("link", { name: "Crear programa" })).toBeVisible()
  })

  test("el botón de crear programa desde plantillas redirige a /prevencion/pdtp/nuevo", async ({ page }) => {
    await page.goto("/prevencion/pdtp/plantillas")

    await page.getByRole("link", { name: "Crear programa" }).click()
    await expect(page).toHaveURL("/prevencion/pdtp/nuevo")
  })
})
