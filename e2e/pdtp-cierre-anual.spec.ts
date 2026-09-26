import { test, expect } from "@playwright/test"
import { login, textoVisible } from "./helpers"

/**
 * E2E: cierre anual del programa (PREV-C03.6, D21).
 *
 * Usa el fixture propio `pdtp-2024-e2e` (e2e/setup-db.ts): un programa 2024
 * activo, con la faena E2E como única faena y sus doce cierres mensuales. El
 * año ya terminó a la fecha real, así que se puede cerrar. Ningún otro spec lo
 * lee: cerrarlo no cambia lo que ven los demás.
 */
const PROGRAM_URL = "/prevencion/pdtp/pdtp-2024-e2e"

test.describe("PDTP — cierre anual", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("cierra el año 2024 con motivo y la versión queda como año cerrado, sin archivar ni registrar", async ({ page }) => {
    await page.goto(PROGRAM_URL)
    await expect(page.getByRole("heading", { name: "Estado del programa" })).toBeVisible()

    const closeButton = page.getByRole("button", { name: "Cerrar el año 2024", exact: true })
    // Idempotente ante un reintento del spec: si ya se cerró, se verifica el estado.
    if (await closeButton.count() > 0) {
      await expect(closeButton).toBeEnabled()
      await closeButton.click()
      const dialog = page.getByRole("dialog", { name: "Cerrar el año 2024" })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText(/no se podrá archivar/)).toBeVisible()
      await dialog.getByLabel("Motivo").fill("Cierre anual 2024 revisado por Jefatura de Prevención")
      await dialog.getByRole("button", { name: "Cerrar el año 2024", exact: true }).click()
      await expect(dialog).toBeHidden({ timeout: 15_000 })
    }

    await expect(textoVisible(page, /El año 2024 está cerrado formalmente/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("button", { name: "Cerrar el año 2024", exact: true })).toHaveCount(0)
    // Un año cerrado es evidencia: no se ofrece archivarlo.
    await expect(page.getByRole("button", { name: "Archivar versión", exact: true })).toHaveCount(0)
  })
})
