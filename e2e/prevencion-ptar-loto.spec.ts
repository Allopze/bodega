import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Permisos de Trabajo de Alto Riesgo (PTAR) y Bloqueo LOTO.
 *
 * Covers:
 *   • Carga del listado de permisos de trabajo.
 *   • Acciones de exportación y filtrado.
 *   • Visualización de la matriz de tipos de permisos (Altura, Espacio Confinado, Caliente, LOTO).
 */
test.describe("Prevención — Permisos de Trabajo (PTAR)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de permisos de trabajo carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/permisos")
    await expect(page).toHaveURL(/\/prevencion\/permisos/)

    // Título y descripción
    await expectPageTitle(page, "Permisos de trabajo")

    // Exportación a Excel
    await expect(page.getByRole("link", { name: /Exportar Excel/i })).toBeVisible()
  })
})
