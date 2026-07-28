import { expect, test } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: PDTP — Cobertura MIPER y legal (/prevencion/pdtp/cobertura).
 *
 * Antes de este spec la página solo tenía un smoke de accesibilidad (axe),
 * sin ninguna interacción. El fixture pdtp-prog-e2e tiene 2 actividades sin
 * fuente vinculada, así que el banner de advertencia y el estado "Sin
 * fuente" están garantizados al entrar.
 */
test.describe("PDTP — Cobertura MIPER y legal", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("muestra el banner de actividades sin fuente demostrable", async ({ page }) => {
    await page.goto("/prevencion/pdtp/cobertura")

    await expect(page.getByRole("status")).toContainText("sin fuente demostrable")

    const activityCard = page.locator("div.rounded-lg.border.p-4", { hasText: "Charla de seguridad E2E" })
    await expect(activityCard.getByText("Sin fuente")).toBeVisible()
  })

  test("vincular una fuente a una actividad la quita de \"sin fuente\"", async ({ page }) => {
    await page.goto("/prevencion/pdtp/cobertura")

    const activityCard = page.locator("div.rounded-lg.border.p-4", { hasText: "Charla de seguridad E2E" })
    await activityCard.getByRole("button", { name: "Vincular fuente" }).click()

    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("heading", { name: "Vincular origen de la medida" })).toBeVisible()
    await dialog.getByLabel("Tipo").click()
    await page.getByRole("option", { name: "Objetivo interno" }).click()
    await dialog.getByLabel("Identificador de fuente").fill("obj-interno-e2e-1")
    await dialog.getByLabel("Justificación").fill("Cubre la charla de seguridad como objetivo interno declarado del programa.")
    await dialog.getByRole("button", { name: "Crear vínculo" }).click()

    await expect(dialog).not.toBeVisible()

    // La acción no auto-refresca la vista (se invoca desde onSubmit, no un
    // form action) — recargar confirma que el vínculo quedó persistido.
    await page.reload()
    await expect(activityCard.getByText("Sin fuente")).not.toBeVisible()
    await expect(activityCard.getByText(/Objetivo interno/)).toBeVisible()
  })
})
