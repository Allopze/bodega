import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Privacidad de Datos y Gestión de Casos Reservados (Ley Karin / Ley 21.643).
 *
 * Cubre:
 *   • Acceso al portal de Privacidad y Protección de Datos Sensibles.
 *   • Navegación a Solicitudes de derechos del titular.
 *   • Verificación de Auditoría de accesos a datos sensibles.
 */

test.describe("Prevención — Privacidad y Ley Karin", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de privacidad carga con enlaces a solicitudes y auditoría", async ({ page }) => {
    await page.goto("/prevencion/privacidad")
    await expect(page).toHaveURL(/\/prevencion\/privacidad/)
    await expectPageTitle(page, "Datos personales")

    await expect(page.getByRole("heading", { name: "Solicitudes de derechos" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Auditoría de accesos" })).toBeVisible()
  })

  test("navegación a la bandeja de auditoría de accesos", async ({ page }) => {
    await page.goto("/prevencion/privacidad/auditoria")
    await expect(page).toHaveURL(/\/prevencion\/privacidad\/auditoria/)
    await expectPageTitle(page, /Auditoría de accesos|Accesos sensibles/i)
  })
})
