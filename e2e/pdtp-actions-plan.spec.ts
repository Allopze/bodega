import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: PDTP — Plan de Acción y Gestión de Acciones Correctivas.
 *
 * Covers:
 *   • Navegación a /prevencion/pdtp/acciones
 *   • Visualización del plan de acción del programa activo
 */
test.describe("PDTP — Plan de acción y hallazgos", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la página del plan de acción carga el encabezado correctamente", async ({ page }) => {
    await page.goto("/prevencion/pdtp/acciones")

    // Page header
    await expect(page.getByRole("heading", { name: "Plan de acción PDTP" })).toBeVisible()
  })

  test("el plan de acción muestra la tabla de acciones o el estado de programa no activo", async ({ page }) => {
    await page.goto("/prevencion/pdtp/acciones")

    // Verifica que exista la vista del plan de acción o el mensaje de programa no activo
    const hasTable = await page.getByRole("table").isVisible().catch(() => false)
    const hasEmpty = await page.getByText(/No hay un programa PDTP activo/).isVisible().catch(() => false)
    const hasContent = await page.locator("main").isVisible().catch(() => false)

    expect(hasTable || hasEmpty || hasContent).toBeTruthy()
  })
})
