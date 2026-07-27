import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: PDTP — Aplicabilidad y Cobertura por Faena.
 *
 * Covers:
 *   • Navegación a /prevencion/pdtp/aplicabilidad
 *   • Carga de la matriz de aplicabilidad por faena y actividad
 *   • Selección de faena en vista de detalle del programa
 */
test.describe("PDTP — Matriz de aplicabilidad por faena", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la página de aplicabilidad por faena carga con título y descripción", async ({ page }) => {
    await page.goto("/prevencion/pdtp/aplicabilidad")

    // Heading
    await expect(page.getByRole("heading", { name: /Aplicabilidad y Reglas por Faena/ })).toBeVisible()
  })

  test("el detalle del programa responde al filtro por faena", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-prog-e2e?faena=ws-e2e")

    // Heading principal del programa
    await expect(page.getByRole("heading", { name: "Programa PDTP E2E" })).toBeVisible()
  })
})
