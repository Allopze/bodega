import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Bandeja Unificada de Pendientes Operacionales (`/pendientes`).
 *
 * Covers:
 *   • Carga de la cola priorizada de trabajo.
 */
test.describe("Módulo de Mis Pendientes", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de pendientes carga correctamente", async ({ page }) => {
    await page.goto("/pendientes")
    await expect(page).toHaveURL(/\/pendientes/)

    // Título y descripción
    await expectPageTitle(page, "Mis pendientes")
  })
})
