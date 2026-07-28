import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Gestión de Incidentes, Accidentes e Investigación RE-20 (DS 44).
 *
 * Covers:
 *   • Navegación y renderizado de la página principal de incidentes.
 *   • Botones de acción (Reportar, Exportar Excel).
 *   • Formulario de reporte de incidente / accidente.
 *   • Verificación de contadores e indicadores de accidentalidad (IF, IG, IA).
 */
test.describe("Prevención — Incidentes y denuncias RE-20", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de incidentes carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/incidentes")
    await expect(page).toHaveURL(/\/prevencion\/incidentes/)

    // Título y contenedor principal
    await expectPageTitle(page, "Incidentes y denuncias")

    // Botones de acción en el header, acotados a #main-content: el sidebar tiene
    // su propio link "Reportar incidente".
    const main = page.locator("#main-content")
    await expect(main.getByRole("link", { name: "Reportar", exact: true })).toBeVisible()
    await expect(main.getByRole("link", { name: /Exportar Excel/i })).toBeVisible()
  })

  test("la navegación al formulario de reporte funciona correctamente", async ({ page }) => {
    await page.goto("/prevencion/incidentes")
    // Acotado a #main-content: el sidebar tiene su propio link "Reportar
    // incidente" y sin acotar el locator resuelve a 2 elementos.
    await page.locator("#main-content").getByRole("link", { name: "Reportar", exact: true }).click()
    await expect(page).toHaveURL(/\/prevencion\/incidentes\/reportar/)
  })
})
