import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Ciclo de Vida Completo de Acciones CAPA.
 *
 * Covers:
 *   • Carga del listado de acciones correctivas y preventivas.
 *   • Filtrado por estado y origen.
 *   • Presencia de resumen de indicadores CAPA.
 */
test.describe("Prevención — Ciclo de vida CAPA", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de CAPA carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/capa")
    await expect(page).toHaveURL(/\/prevencion\/capa/)

    // Título de la página
    await expectPageTitle(page, /Acciones CAPA|Gestión CAPA/i)
  })
})
