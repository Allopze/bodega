import { test, expect } from "@playwright/test"
import { login, textoVisible } from "./helpers"

/**
 * E2E: transición de año (PREV-C03.7, D23).
 *
 * El reloj del servidor no se controla desde Playwright, así que la situación
 * de enero —el año anterior todavía activo mientras el nuevo ya opera— se
 * emula con el fixture propio `pdtp-2025-e2e` (e2e/setup-db.ts): un programa
 * 2025 activo y sin cerrar mientras corre 2026, que también está activo. Este
 * spec sólo lee: no cierra meses ni el año.
 */
test.describe("PDTP — transición de año", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("el tablero PDTP muestra el año operativo y avisa el cierre pendiente del anterior", async ({ page }) => {
    await page.goto("/prevencion/pdtp")
    await expect(textoVisible(page, "PDTP 2025 · cierre pendiente")).toBeVisible()
    const link = page.getByRole("link", { name: "Ver 2025", exact: true })
    await expect(link).toHaveAttribute("href", "/prevencion/pdtp?anio=2025")
  })

  test("el menú de cierres lleva al año que se está cerrando", async ({ page }) => {
    await page.goto("/prevencion/pdtp/cierres")
    await expect(page).toHaveURL(/\/prevencion\/pdtp\/pdtp-2025-e2e\/cierres/, { timeout: 15_000 })
  })

  test("la ficha del año en cierre dice qué meses faltan antes de poder cerrarlo", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-2025-e2e")
    await expect(textoVisible(page, "Pendiente antes de cerrar el año 2025:")).toBeVisible()
    await expect(textoVisible(page, /Faltan cierres mensuales del año 2025\. Faena E2E: enero/)).toBeVisible()
    await expect(page.getByRole("button", { name: "Cerrar el año 2025", exact: true })).toBeDisabled()
  })

  test("el inicio muestra la línea de cierre pendiente junto a la tarjeta del programa", async ({ page }) => {
    await page.goto("/dashboard?vista=prevencion")
    const pending = page.getByRole("link", { name: "PDTP 2025 · cierre pendiente", exact: true })
    await expect(pending).toBeVisible({ timeout: 30_000 })
    await expect(pending).toHaveAttribute("href", "/prevencion/pdtp?anio=2025")
  })
})
