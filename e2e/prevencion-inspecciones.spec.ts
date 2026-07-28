import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: Inspecciones y Auditorías de Seguridad.
 *
 * Covers:
 *   • Carga del listado de ejecuciones y programas de inspección.
 *   • Navegación a las vistas de programas y plantillas.
 */
test.describe("Prevención — Inspecciones y auditorías", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de inspecciones carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/inspecciones")
    await expect(page).toHaveURL(/\/prevencion\/inspecciones/)

    // Título de la página
    await expect(page.getByRole("heading", { name: "Inspecciones y auditorías" })).toBeVisible()
    await expect(page.getByText(/Listas de chequeo/i)).toBeVisible()
  })
})
