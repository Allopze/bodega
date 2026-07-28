import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: Capacitación, Competencias e Inducción (ODI/DAS - DS 40 / DS 44).
 *
 * Covers:
 *   • Carga del listado de sesiones de capacitación y habilitación de trabajadores.
 *   • Presencia de botones de exportación.
 *   • Verificación de rutas asociadas (brechas, catálogo).
 */
test.describe("Prevención — Capacitación e Inducciones ODI/DAS", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de capacitación carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/capacitacion")
    await expect(page).toHaveURL(/\/prevencion\/capacitacion/)

    // Título de la página
    await expect(page.getByRole("heading", { name: "Capacitación y competencias" })).toBeVisible()
    await expect(page.getByText(/Sesiones, asistencia, evaluación y habilitación/i)).toBeVisible()

    // Exportación a Excel
    await expect(page.getByRole("link", { name: /Exportar Excel/i })).toBeVisible()
  })

  test("la vista de brechas de competencias carga", async ({ page }) => {
    await page.goto("/prevencion/capacitacion/brechas")
    await expect(page).not.toHaveURL(/\/forbidden/)
  })

  test("la vista de catálogo de cursos carga", async ({ page }) => {
    await page.goto("/prevencion/capacitacion/catalogo")
    await expect(page).not.toHaveURL(/\/forbidden/)
  })
})
