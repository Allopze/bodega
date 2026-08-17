import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Privacidad SST, Ley Karín y Casos Reservados.
 *
 * Covers:
 *   • Carga del módulo de privacidad y derechos ARCO.
 */
test.describe("Prevención — Privacidad y Casos Reservados (Ley Karín)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de privacidad carga correctamente", async ({ page }) => {
    // No hay página en /prevencion/privacidad: el módulo vive en subrutas
    // (`solicitudes` es el workbench de derechos del titular, `auditoria` el de
    // accesos sensibles). El spec apuntaba a una ruta que no existe.
    await page.goto("/prevencion/privacidad/solicitudes")
    await expect(page).toHaveURL(/\/prevencion\/privacidad\/solicitudes/)

    await expectPageTitle(page, "Derechos del titular")
  })
})
