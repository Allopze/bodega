import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * Smoke E2E del módulo de Documentación SST.
 *
 * Guarda de regresión para el bug que rompía el build de producción: el
 * componente cliente `documentacion-view.tsx` arrastraba `@/db` al bundle del
 * navegador. Este spec obliga a que las páginas del módulo (que hidratan ese
 * componente cliente) rendericen en un navegador real, no solo que compilen.
 */
test.describe("Documentación SST", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("el listado de documentación carga (no /forbidden)", async ({ page }) => {
    await page.goto("/prevencion/documentacion")
    await expect(page).toHaveURL(/\/prevencion\/documentacion/)
    await expect(page.getByRole("heading", { name: "Documentación" })).toBeVisible()
    // La vista cliente hidrató: el control para crear carpeta está presente.
    await expect(page.getByRole("button", { name: "Nueva carpeta" })).toBeVisible()
  })

  test("el botón Subir archivo abre el modal de subida (no navega a un formulario)", async ({ page }) => {
    await page.goto("/prevencion/documentacion")
    await page.getByRole("button", { name: /Subir archivo/i }).click()
    await expect(page.getByRole("button", { name: "Subir archivos" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Subir carpeta" })).toBeVisible()
  })

  test("la papelera carga", async ({ page }) => {
    await page.goto("/prevencion/documentacion/papelera")
    await expect(page).not.toHaveURL(/\/forbidden/)
  })
})
