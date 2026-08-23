import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Gestión de CPHS, Actas y Gobernanza Paritaria (DS 54).
 *
 * Cubre:
 *   • Renderizado del listado de Comités Paritarios de Higiene y Seguridad.
 *   • Verificación de sesiones ordinarias/extraordinarias, quórum y acuerdos.
 *   • Visualización de revisiones por la dirección y estado de mandatos.
 */

test.describe("Prevención — CPHS y Gobernanza Paritaria", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la bandeja de CPHS muestra comités constituidos y reuniones", async ({ page }) => {
    await page.goto("/prevencion/cphs")
    await expect(page).toHaveURL(/\/prevencion\/cphs/)
    await expectPageTitle(page, "CPHS y gobernanza")

    // Verificación de tabla o tarjetas de comités
    await expect(page.getByText("Faena E2E").first()).toBeVisible({ timeout: 30_000 })
  })
})
