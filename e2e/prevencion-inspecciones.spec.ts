import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Inspecciones y Auditorías de Seguridad.
 *
 * Covers:
 *   • Carga del listado de ejecuciones y programas de inspección.
 *   • Navegación a las vistas de programas y plantillas.
 */
test.describe("Prevención — Inspecciones y auditorías", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de inspecciones carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/inspecciones")
    await expect(page).toHaveURL(/\/prevencion\/inspecciones/)

    // Título de la página
    await expectPageTitle(page, "Inspecciones")
  })

  // C-11/C-12 (auditoría 2026-08-18): antes de esto, "/prevencion/inspecciones"
  // y "/prevencion/auditorias" compartían el mismo motor pero el catálogo no
  // filtraba por `kind`, así que una auditoría (kind='audit') aparecía también
  // bajo el catálogo de Inspecciones, y el catálogo de Auditorías no se
  // alcanzaba desde ningún enlace propio.
  test("la vista de auditorías carga y su catálogo se alcanza desde un enlace propio", async ({ page }) => {
    await page.goto("/prevencion/auditorias")
    await expect(page).toHaveURL(/\/prevencion\/auditorias$/)
    await expectPageTitle(page, "Auditorías del SGSST")

    // `exact: true` porque el sidebar tiene un ítem "Catálogo y programación"
    // que también matchearía por substring.
    await page.getByRole("link", { name: "Catálogo", exact: true }).click()
    await expect(page).toHaveURL(/\/prevencion\/auditorias\/catalogo/)
    await expectPageTitle(page, "Catálogo de auditorías")
    await expect(page.getByText("AUD-E2E")).toBeVisible()
  })

  test("el catálogo de inspecciones no lista plantillas de auditoría", async ({ page }) => {
    await page.goto("/prevencion/inspecciones/catalogo")
    await expect(page).toHaveURL(/\/prevencion\/inspecciones\/catalogo/)
    await expectPageTitle(page, "Catálogo de inspecciones")
    await expect(page.getByText("AUD-E2E")).not.toBeVisible()
  })
})
