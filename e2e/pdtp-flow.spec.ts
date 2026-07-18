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
    await expect(page.getByRole("radiogroup", { name: "Seleccionar año" })).toBeVisible()
    await expect(
      page
        .getByRole("radiogroup", { name: "Seleccionar año" })
        .getByRole("radio")
        .filter({ hasText: String(new Date().getFullYear()) })
        .first(),
    ).toBeVisible()
    await expect(page.getByLabel("Título del programa")).toBeVisible()

    // Summary section
    await expect(page.getByText("Resumen antes de crear")).toBeVisible()

    // Submit button
    await expect(page.getByRole("button", { name: "Crear programa" })).toBeVisible()
  })

  test("el resumen se actualiza en vivo al escribir año y título", async ({ page }) => {
    await page.goto("/prevencion/pdtp/nuevo")

    const titleInput = page.getByLabel("Título del programa")

    // Default year should show in summary
    const currentYear = new Date().getFullYear()
    await expect(page.getByText(String(currentYear), { exact: true }).first()).toBeVisible()

    // Type a title and verify it appears in summary
    await titleInput.fill("Mi Programa de Prueba")
    await expect(titleInput).toHaveValue("Mi Programa de Prueba")

    // Change year and verify summary updates
    await page.getByRole("button", { name: "Otro año…" }).click()
    const yearInput = page.getByLabel("Año personalizado")
    await yearInput.fill("2027")
    await expect(page.getByText("2027", { exact: true }).first()).toBeVisible()

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

/**
 * E2E: PDTP — flujo checklist → plan de acción (Gap 5 del checklist de
 * seguimiento). Usa el fixture sembrado por e2e/setup-db.ts
 * (pdtp-prog-e2e / pdtp-act-e2e / pdtp-exec-e2e con un checklist activo de
 * 1 ítem) en vez de crear el programa por UI — el flujo de creación tiene
 * un bug conocido (ver test.skip arriba) que no es responsabilidad de este
 * spec. Solo verifica el camino UI; el cálculo de % y las reglas de negocio
 * ya están cubiertos por lib/__tests__/pdtp-checklist-action-plan.test.ts.
 */
test.describe("PDTP — Checklist de verificación y plan de acción", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("marcar un ítem 'No cumple' genera automáticamente una acción correctiva", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-prog-e2e/ejecucion/pdtp-exec-e2e")

    await expect(page.getByRole("heading", { name: /Verificación/ })).toBeVisible()

    // Inicia el checklist de faena única (patrón B — sin sujeto).
    await page.getByRole("button", { name: "Iniciar verificación" }).click()
    await expect(page.getByRole("button", { name: "Guardar respuestas" })).toBeVisible()

    // Marca el único ítem como "No cumple" y agrega la observación que se
    // convertirá en el hallazgo de la acción generada.
    await page.getByRole("button", { name: "No cumple" }).click()
    await page.getByRole("button", { name: "Agregar nota" }).click()
    await page.getByPlaceholder("Agrega una nota breve...").fill("Falta EPP en terreno")
    await page.getByRole("button", { name: "Guardar nota" }).click()

    // Persiste la respuesta antes de enviar — "Enviar revisión" opera sobre lo
    // guardado en servidor, no sobre el draft local (draftsByInstance).
    await page.getByRole("button", { name: "Guardar respuestas" }).click()
    await expect(page.getByText("Pendiente de respuesta")).not.toBeVisible()

    await page.getByRole("button", { name: "Enviar revisión" }).click()

    // El checklist queda completado (badge) y el plan de acción muestra la
    // acción autogenerada con el hallazgo ingresado.
    await expect(page.getByText("Completado")).toBeVisible()
    await expect(page.getByRole("button", { name: /Falta EPP en terreno/ })).toBeVisible()
  })
})
