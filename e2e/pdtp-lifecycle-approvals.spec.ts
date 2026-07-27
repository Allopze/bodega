import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: PDTP — Ciclo de vida del programa y flujo de aprobaciones.
 *
 * Covers:
 *   • Navegación al dashboard de aprobaciones (/prevencion/pdtp/aprobaciones)
 *   • Visualización de ejecuciones semanales pendientes de aprobación
 *   • Visualización de la tarjeta de estado de ciclo de vida del programa
 */
test.describe("PDTP — Ciclo de vida y aprobaciones", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la página de aprobaciones PDTP carga correctamente el encabezado", async ({ page }) => {
    await page.goto("/prevencion/pdtp/aprobaciones")

    // Page Header
    await expect(page.getByRole("heading", { name: "Aprobaciones PDTP" })).toBeVisible()

    // Breadcrumbs
    await expect(page.getByRole("link", { name: "Programa preventivo SG-SST" })).toBeVisible()
  })

  test("la página de aprobaciones muestra la tabla o el estado sin pendientes", async ({ page }) => {
    await page.goto("/prevencion/pdtp/aprobaciones")

    // Verifica que exista o la tabla de aprobaciones o el mensaje sin pendientes
    const hasTable = await page.getByRole("table").isVisible().catch(() => false)
    const hasEmptyState = await page.getByText("Sin pendientes").isVisible().catch(() => false)

    expect(hasTable || hasEmptyState).toBeTruthy()
  })

  test("el detalle del programa muestra la tarjeta de estado del ciclo de vida", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-prog-e2e")

    // Section title
    await expect(page.getByRole("heading", { name: "Estado del programa" })).toBeVisible()

    // Steps indicator
    await expect(page.getByText("Elaboración")).toBeVisible()
    await expect(page.getByText("Versión congelada")).toBeVisible()
  })
})
