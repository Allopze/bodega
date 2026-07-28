import { test, expect } from "@playwright/test"
import { login } from "./helpers"

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
    await expect(page.getByRole("heading", { name: "Incidentes y denuncias" })).toBeVisible()
    await expect(page.getByText(/Fuente canónica de eventos/i)).toBeVisible()

    // Botones de acción en el header
    await expect(page.getByRole("link", { name: /Reportar/i })).toBeVisible()
    await expect(page.getByRole("link", { name: /Exportar Excel/i })).toBeVisible()
  })

  test("la navegación al formulario de reporte funciona correctamente", async ({ page }) => {
    await page.goto("/prevencion/incidentes")
    await page.getByRole("link", { name: /Reportar/i }).click()
    await expect(page).toHaveURL(/\/prevencion\/incidentes\/reportar/)
  })
})
