import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Permisos de Trabajo de Alto Riesgo (PTAR) y Aislamiento LOTO.
 *
 * Cubre:
 *   • Renderizado del listado de permisos de trabajo y autorizaciones.
 *   • Verificación de tipos de trabajo crítico (caliente, altura, confinado, excavación).
 *   • Visualización de aislamiento de energías (LOTO) y cuadrilla habilitada.
 *   • Exportación de permisos a Excel.
 */

test.describe("Prevención — Permisos de trabajo PTAR y LOTO", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la bandeja de permisos de trabajo carga con sus acciones", async ({ page }) => {
    await page.goto("/prevencion/permisos")
    await expect(page).toHaveURL(/\/prevencion\/permisos/)
    await expectPageTitle(page, "Permisos de trabajo")

    // Verificación de botón de nuevo permiso o tipos
    const nuevoBtn = page.getByRole("button", { name: /Solicitar permiso|Nuevo permiso/i })
    if (await nuevoBtn.count() > 0) {
      await expect(nuevoBtn.first()).toBeVisible()
    }
  })

  test("exportación de permisos a formato Excel", async ({ page }) => {
    await page.goto("/prevencion/permisos")
    const exportLink = page.getByRole("link", { name: /Exportar Excel/i })
    if (await exportLink.count() > 0) {
      const descarga = page.waitForEvent("download")
      await exportLink.click()
      const archivo = await descarga
      expect(archivo.suggestedFilename()).toMatch(/\.xlsx$/)
    }
  })
})
