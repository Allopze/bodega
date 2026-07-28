import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: PDTP — Dashboard de cumplimiento, plantillas e importación/exportación.
 *
 * Covers:
 *   • Dashboard ejecutivo de cumplimiento (/prevencion/pdtp)
 *   • Listado de programas anuales (/prevencion/pdtp/programas)
 *   • Navegación a /prevencion/pdtp/plantillas
 *   • Botón de crear programa desde la página de plantillas
 */
test.describe("PDTP — Dashboard, plantillas e importación/exportación", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("el dashboard de cumplimiento en /prevencion/pdtp carga los encabezados y KPIs", async ({ page }) => {
    await page.goto("/prevencion/pdtp")

    // Page header
    await expect(page.getByRole("heading", { name: "Dashboard de Cumplimiento SG-SST" })).toBeVisible()

    // Enlace al listado de programas
    await expect(page.getByRole("link", { name: "Listado de programas" })).toBeVisible()
  })

  test("la página reubicada del listado de programas (/prevencion/pdtp/programas) carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/pdtp/programas")

    // Page header del listado o redirección si hay único programa. Antes se
    // comprobaba con isVisible().catch() sin esperar — un chequeo puntual,
    // no reintentado — lo que flaqueaba bajo carga (workers concurrentes)
    // porque corría antes de que el encabezado terminara de renderizar.
    const listHeading = page.getByRole("heading", { name: /Listado de programas preventivos/ })
    const programHeading = page.getByRole("heading", { name: /Programa/ })
    await expect(listHeading.or(programHeading)).toBeVisible()
  })

  test("la página de plantillas carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/pdtp/plantillas")

    // Page header
    await expect(page.getByRole("heading", { name: "Plantillas de programas preventivos" })).toBeVisible()

    // Action button to create program
    await expect(page.getByRole("link", { name: "Crear programa" })).toBeVisible()
  })

  test("el botón de crear programa desde plantillas redirige a /prevencion/pdtp/nuevo", async ({ page }) => {
    await page.goto("/prevencion/pdtp/plantillas")

    await page.getByRole("link", { name: "Crear programa" }).click()
    await expect(page).toHaveURL("/prevencion/pdtp/nuevo")
  })
})
