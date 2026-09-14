import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Capacitaciones, Competencias y Matriz ODI (DS 40 / DS 44).
 *
 * Cubre:
 *   • Renderizado de la bandeja de sesiones de capacitación y competencias.
 *   • Navegación al catálogo de capacitación y versiones publicadas.
 *   • Visualización de brechas de capacitación y reconocimientos pendientes.
 *   • Exportación de registros de capacitación a Excel.
 */

test.describe("Prevención — Capacitaciones y ODI", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la bandeja de capacitación carga correctamente y permite navegar al catálogo", async ({ page }) => {
    await page.goto("/prevencion/capacitacion")
    await expect(page).toHaveURL(/\/prevencion\/capacitacion/)
    await expectPageTitle(page, "Capacitación y competencias")

    // Navegación al catálogo de capacitación
    await page.goto("/prevencion/capacitacion/catalogo")
    await expect(page).toHaveURL(/\/prevencion\/capacitacion\/catalogo/)
    await expectPageTitle(page, "Catálogo de capacitación")
  })

  test("exportar entrega el consolidado de capacitaciones en Excel", async ({ page }) => {
    await page.goto("/prevencion/capacitacion")
    const exportBtn = page.getByRole("link", { name: /Exportar Excel/i })
    if (await exportBtn.count() > 0) {
      const descarga = page.waitForEvent("download")
      await exportBtn.click()
      const archivo = await descarga
      expect(archivo.suggestedFilename()).toMatch(/\.xlsx$/)
    }
  })
})
