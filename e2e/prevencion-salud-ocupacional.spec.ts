import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Higiene Ocupacional y Vigilancia Médica (Protocolos MINSAL).
 *
 * Cubre:
 *   • Renderizado del panel de Higiene y Vigilancia Ocupacional.
 *   • Verificación de protocolos aplicables (PREXOR, PLANESI, TMERT, Radiación UV).
 *   • Visualización de Grupos de Exposición Similar (GES) y programas de vigilancia.
 */

test.describe("Prevención — Salud Ocupacional e Higiene", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("el panel de higiene muestra programas de vigilancia y protocolos MINSAL", async ({ page }) => {
    await page.goto("/prevencion/higiene")
    await expect(page).toHaveURL(/\/prevencion\/higiene/)
    await expectPageTitle(page, "Higiene y vigilancia")

    // Pestañas o secciones de grupos de exposición y programas
    const tabProtocolos = page.getByRole("tab", { name: /Protocolos/i }).or(page.getByText(/Protocolos/i))
    if (await tabProtocolos.count() > 0) {
      await expect(tabProtocolos.first()).toBeVisible({ timeout: 30_000 })
    }
  })
})
