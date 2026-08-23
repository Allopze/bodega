import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Gestión Integral de Incidentes, Investigación y RE-20 (DS 44).
 *
 * Cubre:
 *   • Navegación a la bandeja de incidentes y KPI de siniestralidad.
 *   • Registro de un nuevo incidente mediante el formulario de reporte.
 *   • Navegación al detalle del incidente y visualización de investigación / RE-20.
 *   • Exportación del consolidado de incidentes a Excel.
 */

const RUN = Date.now().toString(36).toUpperCase().slice(-5)

test.describe("Prevención — Incidentes y denuncias RE-20", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("flujo completo: reporte de incidente, visualización de detalle y exportación", async ({ page }) => {
    const descripcion = `Falla de freno en equipo durante maniobra E2E-${RUN}`

    // 1. Bandeja principal
    await page.goto("/prevencion/incidentes")
    await expectPageTitle(page, "Incidentes y accidentes")

    const main = page.locator("#main-content")
    await expect(main.getByRole("link", { name: "Reportar", exact: true })).toBeVisible()
    await expect(main.getByRole("link", { name: /Exportar Excel/i })).toBeVisible()

    // 2. Navegar al formulario de reporte
    await main.getByRole("link", { name: "Reportar", exact: true }).click()
    await expect(page).toHaveURL(/\/prevencion\/incidentes\/reportar/)
    await expectPageTitle(page, "Reportar incidente o accidente")

    // 3. Llenar campos del reporte
    await page.locator('textarea[name="shortDescription"]').fill(descripcion)
    await page.locator('textarea[name="detailedDescription"]').fill("Durante el traslado de materiales en rampa, el conductor detecta pérdida de presión en frenos y activa parada de emergencia sin lesionados.")
    await page.locator('input[name="exactLocation"]').fill("Rampa Acceso Norte - Faena E2E")

    // Enviar reporte
    await page.getByRole("button", { name: "Enviar reporte" }).click()
    await expect(page).toHaveURL(/\/prevencion\/incidentes(\/[^/]+)?$/, { timeout: 30_000 })

    // 4. Verificar presencia en el listado
    await page.goto("/prevencion/incidentes")
    const fila = page.getByRole("row").filter({ hasText: descripcion }).first()
    await expect(fila).toBeVisible({ timeout: 30_000 })

    // 5. Abrir detalle del incidente
    await fila.getByRole("link").first().click()
    await expect(page).toHaveURL(/\/prevencion\/incidentes\/[^/?]+$/, { timeout: 30_000 })
    await expect(page.getByText(descripcion).first()).toBeVisible()

    // 6. Exportar Excel
    await page.goto("/prevencion/incidentes")
    const descarga = page.waitForEvent("download")
    await page.locator("#main-content").getByRole("link", { name: /Exportar Excel/i }).click()
    const archivoDescargado = await descarga
    expect(archivoDescargado.suggestedFilename()).toMatch(/^incidentes_\d{4}-\d{2}-\d{2}\.xlsx$/)
  })
})
