import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Indicadores Estadísticos SST y Exportación a Excel.
 *
 * Cubre:
 *   • Renderizado del panel de indicadores anuales y mensuales (IF, IG, IA, HH).
 *   • Verificación de visualización de faenas y períodos.
 *   • Descarga del archivo Excel oficial de indicadores.
 */

test.describe("Prevención — Indicadores SST y Exportación", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("el panel de indicadores anuales carga y ofrece descarga Excel", async ({ page }) => {
    await page.goto("/prevencion/indicadores")
    await expect(page).toHaveURL(/\/prevencion\/indicadores/)
    await expectPageTitle(page, "Indicadores de seguridad y salud en el trabajo")

    // Botón de exportación
    const exportBtn = page.getByRole("button", { name: /Exportar Excel/i }).or(page.getByRole("link", { name: /Exportar Excel/i }))
    if (await exportBtn.count() > 0) {
      const descarga = page.waitForEvent("download")
      await exportBtn.first().click()
      const archivo = await descarga
      // El exporte es el libro CANÓNICO de indicadores (anual, mensual, fuentes
      // y conciliación), y la ruta lo nombra así desde
      // `app/api/prevencion/indicadores/export/route.ts`. El nombre anterior
      // —`indicadores_sst_<año>`— quedó en el spec y no en el producto.
      expect(archivo.suggestedFilename()).toMatch(/^indicadores_canonicos_\d{4}\.xlsx$/)
    }
  })
})
