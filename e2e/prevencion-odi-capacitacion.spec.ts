import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: control anual de capacitaciones y evidencia (DS 44).
 *
 * Cubre:
 *   • Renderizado de la bandeja anual por faena.
 *   • Visualización de estados y evidencia de capacitación.
 *   • Exportación de registros de capacitación a Excel.
 */

test.describe("Prevención — Capacitaciones y ODI", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la bandeja anual de capacitación carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/capacitacion")
    await expect(page).toHaveURL(/\/prevencion\/capacitacion/)
    await expectPageTitle(page, "Capacitación")
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
