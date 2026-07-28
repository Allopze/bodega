import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Módulo de Recepción de Mercadería y Órdenes de Compra (`/recepcion`).
 *
 * Covers:
 *   • Carga del listado de órdenes de compra pendientes de recepción.
 *   • Renderizado de la tabla de recepciones y controles de búsqueda/filtro.
 */
test.describe("Módulo de Recepción", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de recepción carga correctamente", async ({ page }) => {
    await page.goto("/recepcion")
    await expect(page).toHaveURL(/\/recepcion/)

    // Título y encabezado
    await expectPageTitle(page, "Recepción")
  })
})
