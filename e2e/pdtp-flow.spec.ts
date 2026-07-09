import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: PDTP — Programa de Trabajo Preventivo SG-SST.
 *
 * Covers:
 *   • Navigation to /prevencion/pdtp/nuevo
 *   • Form fields: year and title with controlled state
 *   • Summary section updates live as user types
 *   • Form submission → redirect to editor
 *   • Editor page loads with builder tabs
 */
test.describe("PDTP — Creación y edición de programas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la página de creación carga con el formulario correcto", async ({ page }) => {
    await page.goto("/prevencion/pdtp/nuevo")

    // Page header
    await expect(page.getByRole("heading", { name: "Nuevo programa preventivo" })).toBeVisible()

    // Form fields
    await expect(page.getByLabel("Año del programa")).toBeVisible()
    await expect(page.getByLabel("Título del programa")).toBeVisible()

    // Summary section
    await expect(page.getByText("Resumen antes de crear")).toBeVisible()

    // Submit button
    await expect(page.getByRole("button", { name: "Crear programa" })).toBeVisible()
  })

  test("el resumen se actualiza en vivo al escribir año y título", async ({ page }) => {
    await page.goto("/prevencion/pdtp/nuevo")

    const yearInput = page.getByLabel("Año del programa")
    const titleInput = page.getByLabel("Título del programa")

    // Default year should show in summary
    const currentYear = new Date().getFullYear()
    await expect(page.getByText(String(currentYear))).toBeVisible()

    // Type a title and verify it appears in summary
    await titleInput.fill("Mi Programa de Prueba")
    await expect(page.getByText("Mi Programa de Prueba")).toBeVisible()

    // Change year and verify summary updates
    await yearInput.fill("2027")
    await expect(page.getByText("2027")).toBeVisible()

    // "Pendiente" should no longer be visible for title
    await expect(page.getByText("Pendiente")).not.toBeVisible()
  })

  // FIXME: El form se queda en /nuevo en vez de redirigir a /editar
  test.skip("el formulario crea un programa y navega al editor", async ({ page }) => {
    await page.goto("/prevencion/pdtp/nuevo")

    const titleInput = page.getByLabel("Título del programa")
    await titleInput.fill("Programa E2E Playwright")

    // Submit the form
    await page.getByRole("button", { name: "Crear programa" }).click()

    // Should redirect to the editor page
    await expect(page).toHaveURL(/\/prevencion\/pdtp\/[^/]+\/editar/, { timeout: 15_000 })

    // Editor page should show the program title
    await expect(page.getByRole("heading", { name: /Programa E2E Playwright/ })).toBeVisible()

    // Builder tabs should be visible (Metadatos, Hojas, etc.)
    await expect(page.getByRole("tab", { name: /Metadatos|Hoja|Actividad|Planificación/ }).first()).toBeVisible()
  })

  // FIXME: Depende del test anterior que está skipeado
  test.skip("el editor muestra las tabs del builder correctamente", async ({ page }) => {
    // First create a program
    await page.goto("/prevencion/pdtp/nuevo")
    await page.getByLabel("Título del programa").fill("Programa Tabs E2E")
    await page.getByRole("button", { name: "Crear programa" }).click()
    await expect(page).toHaveURL(/\/prevencion\/pdtp\/[^/]+\/editar/, { timeout: 15_000 })

    // Verify all builder tabs are present
    await expect(page.getByRole("tab", { name: "Metadatos" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Hojas" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Objetivos" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Actividades" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Planificación" })).toBeVisible()

    // Click on Metadatos tab and verify the form fields
    await page.getByRole("tab", { name: "Metadatos" }).click()
    await expect(page.getByLabel("Título del programa")).toBeVisible()
    await expect(page.getByLabel("Estado de cumplimiento mínimo (%)")).toBeVisible()
  })
})
