import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: Integración Transversal del Ciclo de Vida EPP.
 *
 * Covers:
 *   • Navegación encadenada multi-módulo: Solicitudes → Aprobaciones → Compras → Recepción → Entregas.
 */
test.describe("Integración Transversal — Ciclo de Vida EPP", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("navegación completa por los hitos del ciclo EPP", async ({ page }) => {
    // 1. Solicitudes
    await page.goto("/solicitudes")
    await expect(page).toHaveURL(/\/solicitudes/)

    // 2. Aprobaciones
    await page.goto("/aprobaciones")
    await expect(page).toHaveURL(/\/aprobaciones/)

    // 3. Compras
    await page.goto("/compras")
    await expect(page).toHaveURL(/\/compras/)

    // 4. Recepción
    await page.goto("/recepcion")
    await expect(page).toHaveURL(/\/recepcion/)

    // 5. Entregas
    await page.goto("/entregas")
    await expect(page).toHaveURL(/\/entregas/)
  })
})
